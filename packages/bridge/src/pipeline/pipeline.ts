import { EventEmitter } from 'node:events';
import type { Config, Placement, Quat, TrackingFrame } from '@offaxis/shared';
import { createEmitter, type Emitter, type EmitterStatus } from '../emitters/index.js';
import type { OutputFrame } from '../emitters/types.js';
import { createLogger } from '../log.js';
import { eulerToQuat, quatToEuler } from '../math/euler.js';
import { type CorrectedPose, type Corrector, correct, makeCorrector } from '../math/frame.js';
import { createSource, type TrackingSource } from '../sources/index.js';

const log = createLogger('pipeline');

export interface ProcessedFrame {
  frame: TrackingFrame;
  /** Raw head orientation as a quaternion (canonical phone frame). */
  rawQ: Quat;
  corrected: CorrectedPose;
  out: OutputFrame;
}

/**
 * Source → corrector → emitter. Owns the running source and emitter and can swap either one
 * (on config changes) without stopping the other.
 */
export class Pipeline extends EventEmitter<{ frame: [ProcessedFrame] }> {
  private source: TrackingSource | null = null;
  private emitter: Emitter | null = null;
  private corrector: Corrector;
  private arrivals: number[] = [];
  private lastPacketAt: number | null = null;
  private latest: ProcessedFrame | null = null;

  constructor(placement: Placement) {
    super();
    this.corrector = makeCorrector(placement);
  }

  async startSource(cfg: Config['source']): Promise<void> {
    await this.source?.stop();
    this.source = null;
    const src = createSource(cfg);
    src.on('frame', (f) => this.onFrame(f));
    try {
      await src.start();
      this.source = src;
    } catch (err) {
      log.error('source failed to start', { kind: src.kind, err: (err as Error).message });
      throw err;
    }
  }

  async startEmitter(cfg: Config['output']): Promise<void> {
    await this.emitter?.stop();
    this.emitter = null;
    const em = createEmitter(cfg);
    try {
      await em.start();
      this.attachEmitter(em);
    } catch (err) {
      log.error('emitter failed to start', { kind: em.kind, err: (err as Error).message });
      throw err;
    }
  }

  /** Use an already-started emitter. */
  attachEmitter(em: Emitter): void {
    this.emitter = em;
  }

  async stop(): Promise<void> {
    await this.source?.stop();
    await this.emitter?.stop();
    this.source = null;
    this.emitter = null;
  }

  setPlacement(p: Placement): void {
    this.corrector = makeCorrector(p);
    log.info('placement applied', { name: p.name });
  }

  getCorrector(): Corrector {
    return this.corrector;
  }

  latestFrame(): ProcessedFrame | null {
    return this.latest;
  }

  phoneStats(): { packetsPerSec: number; lastPacketAt: number | null } {
    const cutoff = Date.now() - 1000;
    while (this.arrivals.length && (this.arrivals[0] as number) < cutoff) this.arrivals.shift();
    return { packetsPerSec: this.arrivals.length, lastPacketAt: this.lastPacketAt };
  }

  emitterStatus(): EmitterStatus {
    return this.emitter?.status() ?? { requesting: false, peers: [], lastRequestAt: null };
  }

  /** Exposed for tests and the REST mirror; normally called by the source. */
  onFrame(frame: TrackingFrame): void {
    this.lastPacketAt = frame.t;
    this.arrivals.push(frame.t);
    if (this.arrivals.length > 600) this.arrivals.splice(0, this.arrivals.length - 600);

    const rawQ = eulerToQuat(frame.head.rot);
    const corrected = correct(this.corrector, frame.head.pos, rawQ);
    const out: OutputFrame = {
      head: { pos: corrected.phonePos, rot: quatToEuler(corrected.phoneRot) },
      blendshapes: frame.blendshapes,
      faceFound: frame.faceFound,
      eyes: frame.eyes,
      t: frame.t,
    };
    this.emitter?.send(out);
    this.latest = { frame, rawQ, corrected, out };
    this.emit('frame', this.latest);
  }
}
