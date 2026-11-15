import type { Config } from '@offaxis/shared';
import WebSocket from 'ws';
import { createLogger } from '../log.js';

const log = createLogger('vnyan');
const TIMEOUT_MS = 2000;

/**
 * Fires a VNyan node-graph trigger by sending its name as plain text to VNyan's WebSocket
 * receiver (Settings → Misc → WebSockets; matched by a "WebSocket Command" node).
 */
export class VnyanTriggers {
  private ws: WebSocket | null = null;

  constructor(private cfg: Config['vnyan']) {}

  setConfig(cfg: Config['vnyan']): void {
    if (cfg.url !== this.cfg.url) this.close();
    this.cfg = cfg;
  }

  async fire(kind: 'success' | 'failure'): Promise<void> {
    if (!this.cfg.enabled) return;
    const name = kind === 'success' ? this.cfg.successTrigger : this.cfg.failureTrigger;
    if (!name) return;
    try {
      const ws = await this.connect();
      ws.send(name);
      log.info('trigger sent', { name });
    } catch (err) {
      log.warn('could not reach VNyan WebSocket', {
        url: this.cfg.url,
        err: (err as Error).message,
      });
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.cfg.url, { handshakeTimeout: TIMEOUT_MS });
      ws.once('open', () => {
        this.ws = ws;
        resolve(ws);
      });
      ws.once('error', reject);
      ws.on('close', () => {
        if (this.ws === ws) this.ws = null;
      });
    });
  }
}
