import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import type { Config, ServerMessage } from '@offaxis/shared';
import { ClientMessageSchema } from '@offaxis/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { App } from '../app.js';
import { createLogger } from '../log.js';

const log = createLogger('server');
const SNAPSHOT_HZ = 15;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** Pages served by the single-page app. */
const SPA_ROUTES = new Set(['/', '/dock', '/dock/']);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function bindHostFor(cfg: Config['server']): string {
  return cfg.allowLan ? '0.0.0.0' : cfg.bindHost;
}

/** HTTP (REST mirror + static UI) and the `/ws` WebSocket on one port. */
export class UiServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    private readonly app: App,
    private readonly publicDir: string | null,
  ) {
    app.on('message', (m) => this.broadcast(m));
    app.on('serverConfigChanged', (cfg) => {
      log.info('restarting HTTP server');
      void this.restart(cfg);
    });
  }

  async start(cfg: Config['server']): Promise<void> {
    const http = createServer((req, res) => this.route(req, res));
    const wss = new WebSocketServer({ noServer: true });
    http.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.onClient(ws));
    });
    const host = bindHostFor(cfg);
    await new Promise<void>((resolveListen, reject) => {
      http.once('error', reject);
      http.listen(cfg.uiPort, host, () => {
        http.off('error', reject);
        resolveListen();
      });
    });
    this.http = http;
    this.wss = wss;
    this.ticker = setInterval(() => this.broadcast(this.app.snapshot()), 1000 / SNAPSHOT_HZ);
    log.info('web UI ready', {
      url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${cfg.uiPort}`,
      dock: '/dock',
      lan: host === '0.0.0.0',
      static: this.publicDir ?? '(none: run `npm run build` or use the Vite dev server)',
    });
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.wss?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.http?.closeAllConnections();
    this.http = null;
    this.wss = null;
  }

  private async restart(cfg: Config['server']) {
    await this.stop();
    try {
      await this.start(cfg);
    } catch (err) {
      log.error('HTTP server failed to restart', { err: (err as Error).message });
    }
  }

  private broadcast(msg: ServerMessage) {
    if (!this.wss || this.wss.clients.size === 0) return;
    const data = JSON.stringify(msg);
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private onClient(ws: WebSocket) {
    for (const m of this.app.welcome()) ws.send(JSON.stringify(m));
    ws.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' } satisfies ServerMessage));
        return;
      }
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown or malformed message' }));
        return;
      }
      const reply = this.app.handle(parsed.data);
      if ('type' in reply) ws.send(JSON.stringify(reply));
      else if (!reply.ok) ws.send(JSON.stringify({ type: 'error', message: reply.error }));
    });
  }

  private route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path.startsWith('/api/')) {
      if (method === 'GET' && path === '/api/health') return json(res, 200, this.app.health());
      if (method === 'GET' && path === '/api/state') return json(res, 200, this.app.snapshot());
      if (method === 'POST' && path === '/api/calibrate') {
        this.app.startCalibration('rest');
        return json(res, 202, { ok: true });
      }
      if (method === 'POST' && path === '/api/calibrate/cancel') {
        this.app.calibrator.cancel();
        return json(res, 200, { ok: true });
      }
      const m = /^\/api\/placement\/(.+)$/.exec(path);
      if (method === 'POST' && m) {
        const reply = this.app.handle({
          type: 'selectPlacement',
          name: decodeURIComponent(m[1] ?? ''),
        });
        return 'ok' in reply && !reply.ok ? json(res, 404, reply) : json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: 'Not found' });
    }

    if (method !== 'GET' && method !== 'HEAD')
      return json(res, 405, { ok: false, error: 'Method not allowed' });
    if (!this.publicDir) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Web UI not built. Run `npm run build`, or open the Vite dev server on :5173.');
      return;
    }
    this.serveStatic(path, res);
  }

  private serveStatic(path: string, res: ServerResponse) {
    const root = this.publicDir as string;
    let file = SPA_ROUTES.has(path)
      ? join(root, 'index.html')
      : resolve(root, `.${normalize(path)}`);
    if (!file.startsWith(resolve(root))) return json(res, 403, { ok: false, error: 'Forbidden' });
    if (!existsSync(file) || !statSync(file).isFile()) {
      // Unknown non-asset paths fall back to the SPA.
      if (extname(path)) return json(res, 404, { ok: false, error: 'Not found' });
      file = join(root, 'index.html');
    }
    const isIndex = file.endsWith('index.html');
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  }
}
