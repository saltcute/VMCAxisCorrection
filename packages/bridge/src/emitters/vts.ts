import type { Socket } from 'node:dgram';
import type { Config } from '@offaxis/shared';
import { createLogger } from '../log.js';
import { bindUdp, closeUdp } from '../net/udp.js';
import { applyFlips } from '../protocols/axes.js';
import { encodeVtsFrame, requestSeconds, VtsRequestSchema } from '../protocols/vts.js';
import type { Emitter, EmitterStatus, OutputFrame } from './types.js';

const log = createLogger('emitter:vts');

/**
 * Impersonates the VTube Studio iPhone app: answers `iOSTrackingDataRequest`s on UDP 21412 and
 * streams frames to the requester's IP on each requested port until the request expires.
 */
export class VtsEmitter implements Emitter {
  readonly kind = 'vts';
  private sock: Socket | null = null;
  /** `ip:port` → expiry time (ms). */
  private peers = new Map<string, { address: string; port: number; until: number }>();
  private lastRequestAt: number | null = null;

  constructor(private readonly cfg: Config['output']) {}

  async start(): Promise<void> {
    this.sock = await bindUdp(this.cfg.vtsPort);
    this.sock.on('message', (msg, rinfo) => this.onRequest(msg, rinfo.address));
    this.sock.on('error', (err) => log.warn('socket error', { err: err.message }));
    log.info('answering VTS phone requests', { port: this.cfg.vtsPort });
  }

  async stop(): Promise<void> {
    await closeUdp(this.sock);
    this.sock = null;
    this.peers.clear();
  }

  private onRequest(msg: Buffer, address: string) {
    let json: unknown;
    try {
      json = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    const req = VtsRequestSchema.safeParse(json);
    if (!req.success) {
      log.debug('ignoring non-request packet', { from: address });
      return;
    }
    const until = Date.now() + requestSeconds(req.data) * 1000;
    for (const port of req.data.ports) {
      const key = `${address}:${port}`;
      if (!this.peers.has(key)) {
        log.info('consumer connected', { peer: key, sentBy: req.data.sentBy });
      }
      this.peers.set(key, { address, port, until });
    }
    this.lastRequestAt = Date.now();
  }

  send(frame: OutputFrame): void {
    if (!this.sock || this.peers.size === 0) return;
    const now = Date.now();
    const head = applyFlips(
      {
        rot: frame.head.rot,
        pos: [
          frame.head.pos[0] * this.cfg.positionScale,
          frame.head.pos[1] * this.cfg.positionScale,
          frame.head.pos[2] * this.cfg.positionScale,
        ],
      },
      this.cfg.flip,
    );
    const body = encodeVtsFrame({ ...frame, head });
    for (const [key, peer] of this.peers) {
      if (peer.until < now) {
        this.peers.delete(key);
        log.info('consumer request expired', { peer: key });
        continue;
      }
      this.sock.send(body, peer.port, peer.address);
    }
  }

  status(): EmitterStatus {
    const now = Date.now();
    const peers = [...this.peers.entries()].filter(([, p]) => p.until >= now).map(([k]) => k);
    return { requesting: peers.length > 0, peers, lastRequestAt: this.lastRequestAt };
  }
}
