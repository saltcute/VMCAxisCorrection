import type { Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { Config, Vec3 } from '@offaxis/shared';
import { createLogger } from '../log.js';
import { bindUdp, closeUdp } from '../net/udp.js';
import { applyFlips } from '../protocols/axes.js';
import {
  decodeVtsBlendshapes,
  VTS_PHONE_PORT,
  VtsFrameSchema,
  vtsHeadToCanonical,
} from '../protocols/vts.js';
import type { SourceEvents, TrackingSource } from './types.js';

const log = createLogger('source:vts');
const REQUEST_EVERY_MS = 1000;

/** Receives from the VTube Studio iPhone app by sending it periodic tracking requests. */
export class VtsSource extends EventEmitter<SourceEvents> implements TrackingSource {
  readonly kind = 'vts';
  private sock: Socket | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: Config['source']) {
    super();
  }

  async start(): Promise<void> {
    this.sock = await bindUdp(this.cfg.vtsReceivePort);
    this.sock.on('message', (msg) => this.onMessage(msg));
    this.sock.on('error', (err) => log.warn('socket error', { err: err.message }));
    this.request();
    this.timer = setInterval(() => this.request(), REQUEST_EVERY_MS);
    log.info('requesting', { phone: this.cfg.phoneIp, receivePort: this.cfg.vtsReceivePort });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await closeUdp(this.sock);
    this.sock = null;
  }

  private request() {
    const body = JSON.stringify({
      messageType: 'iOSTrackingDataRequest',
      time: 3,
      sentBy: 'OffAxisBridge',
      ports: [this.cfg.vtsReceivePort],
    });
    this.sock?.send(body, VTS_PHONE_PORT, this.cfg.phoneIp, (err) => {
      if (err) log.debug('request send failed', { err: err.message });
    });
  }

  private onMessage(msg: Buffer) {
    let json: unknown;
    try {
      json = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    const parsed = VtsFrameSchema.safeParse(json);
    if (!parsed.success) return;
    const f = parsed.data;
    const v = (e: { x: number; y: number; z: number }): Vec3 => [e.x, e.y, e.z];
    this.emit('frame', {
      blendshapes: decodeVtsBlendshapes(f),
      head: applyFlips(vtsHeadToCanonical(f), this.cfg.flip),
      faceFound: f.FaceFound,
      ...(f.EyeLeft && f.EyeRight ? { eyes: { left: v(f.EyeLeft), right: v(f.EyeRight) } } : {}),
      t: Date.now(),
    });
  }
}
