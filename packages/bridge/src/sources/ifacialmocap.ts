import type { Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { Config } from '@offaxis/shared';
import { createLogger } from '../log.js';
import { bindUdp, closeUdp } from '../net/udp.js';
import { applyFlips } from '../protocols/axes.js';
import { HANDSHAKE, ifmHeadToCanonical, parseIfm } from '../protocols/ifacialmocap.js';
import type { SourceEvents, TrackingSource } from './types.js';

const log = createLogger('source:ifm');

/** Re-send the handshake if nothing has arrived for this long. */
const HANDSHAKE_IDLE_MS = 2000;
/** iFacialMocap keeps sending the last pose when it loses the face; this many identical head
 * fields in a row are treated as "face lost". */
const FROZEN_PACKETS = 20;

export class IFacialMocapSource extends EventEmitter<SourceEvents> implements TrackingSource {
  readonly kind = 'ifacialmocap';
  private sock: Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastPacketAt = 0;
  private lastHeadRaw: string | null = null;
  private sameHeadCount = 0;

  /** `phonePort` overrides the port handshakes go to (the protocol uses ifmPort on both ends;
   * tests on one machine need them to differ). */
  constructor(
    private readonly cfg: Config['source'],
    private readonly phonePort = cfg.ifmPort,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.sock = await bindUdp(this.cfg.ifmPort);
    this.sock.on('message', (msg) => this.onMessage(msg.toString('utf8')));
    this.sock.on('error', (err) => log.warn('socket error', { err: err.message }));
    this.handshake();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastPacketAt > HANDSHAKE_IDLE_MS) this.handshake();
    }, HANDSHAKE_IDLE_MS);
    log.info('listening', { port: this.cfg.ifmPort, phone: this.cfg.phoneIp });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await closeUdp(this.sock);
    this.sock = null;
  }

  private handshake() {
    this.sock?.send(HANDSHAKE, this.phonePort, this.cfg.phoneIp, (err) => {
      if (err) log.debug('handshake send failed', { err: err.message });
    });
  }

  private onMessage(text: string) {
    const p = parseIfm(text);
    if (!p.head) return;
    this.lastPacketAt = Date.now();
    if (p.headRaw === this.lastHeadRaw) this.sameHeadCount++;
    else this.sameHeadCount = 0;
    this.lastHeadRaw = p.headRaw;
    this.emit('frame', {
      blendshapes: p.blendshapes,
      head: applyFlips(ifmHeadToCanonical(p.head), this.cfg.flip),
      faceFound: this.sameHeadCount < FROZEN_PACKETS,
      ...(p.leftEye && p.rightEye ? { eyes: { left: p.leftEye, right: p.rightEye } } : {}),
      t: this.lastPacketAt,
    });
  }
}
