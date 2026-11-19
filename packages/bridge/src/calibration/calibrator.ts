import { EventEmitter } from 'node:events';
import type {
  CalibrationResult,
  CalibrationStatus,
  CalibrationStep,
  Config,
  Mat3,
  Quat,
  Vec3,
} from '@offaxis/shared';
import { createLogger } from '../log.js';
import { buildFrame, buildLevelledFrame, phoneOffset } from '../math/frame.js';
import { norm, sub } from '../math/vec.js';
import { StillnessWindow } from './stillness.js';

const log = createLogger('calibration');

const PROMPTS: Record<CalibrationStep, string> = {
  idle: 'Press Calibrate to start',
  waitStillRest: 'Sit normally and look at your monitor',
  waitLean: 'Lean forward toward your monitor and hold',
  waitLeanLeft: 'Sit back, then lean to your left and hold',
};

/** Frames older than this mean the phone stream is gone; the step timer pauses. */
const STALE_MS = 500;
const TICK_MS = 100;
/** Cap on recorded lean samples (about 30 s at 60 fps); a step times out well before that. */
const MAX_PATH = 2000;

export interface CalibrationInput {
  t: number;
  pos: Vec3;
  rot: Quat;
  faceFound: boolean;
}

export interface CalibrationCapture {
  R: Mat3;
  p0: Vec3;
  h0: Quat;
  threePoint: boolean;
}

export type CalibratorEvents = {
  step: [CalibrationStep, string];
  capture: ['P0' | 'P1' | 'P2'];
  result: [CalibrationResult];
};

/**
 * Guided capture: P0 (rest) → P1 (lean forward) → optional P2 (lean left). Each point is captured
 * automatically once the head holds still. `save` stores a successful capture and returns the
 * placement name it was saved to.
 */
export class Calibrator extends EventEmitter<CalibratorEvents> {
  private step: CalibrationStep = 'idle';
  private window: StillnessWindow;
  private elapsedMs = 0;
  private lastTick = 0;
  private lastFrame: CalibrationInput | null = null;
  private leanReached = false;
  private p0: Vec3 | null = null;
  private h0: Quat | null = null;
  private p1: Vec3 | null = null;
  /** Positions recorded during each lean, for levelling from the lean's curve. */
  private forwardPath: Vec3[] = [];
  private leftPath: Vec3[] = [];
  private lastResult: CalibrationResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private threePoint = false;

  constructor(
    private cfg: Config['calibration'],
    private readonly save: (c: CalibrationCapture) => string,
    private readonly now: () => number = Date.now,
  ) {
    super();
    this.window = new StillnessWindow(cfg.stillnessWindowMs);
  }

  setConfig(cfg: Config['calibration']): void {
    this.cfg = cfg;
    this.window.setWindow(cfg.stillnessWindowMs);
  }

  isActive(): boolean {
    return this.step !== 'idle';
  }

  start(): void {
    if (this.isActive()) {
      log.info('calibration already running; restarting');
    }
    this.threePoint = this.cfg.threePoint;
    this.p0 = this.h0 = this.p1 = null;
    this.forwardPath = [];
    this.leftPath = [];
    this.goto('waitStillRest');
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  cancel(reason = 'Cancelled'): void {
    if (!this.isActive()) return;
    this.finish({ ok: false, reason, at: new Date(this.now()).toISOString() });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): CalibrationStatus {
    const spread = this.window.spread();
    const pos = this.lastFrame?.pos;
    const anchor = this.p0;
    return {
      step: this.step,
      prompt: PROMPTS[this.step],
      stillness: Number.isFinite(spread) ? spread : 0,
      stillnessThreshold: this.cfg.stillnessThreshold,
      leanDistance: anchor && pos ? norm(sub(pos, anchor)) : 0,
      minLeanDistance: this.cfg.minLeanDistance,
      timeRemainingMs: this.isActive() ? Math.max(0, this.cfg.stepTimeoutMs - this.elapsedMs) : 0,
      paused: this.isActive() && this.paused(),
      lastResult: this.lastResult,
    };
  }

  /** Feed one tracking frame (raw, phone frame). */
  push(f: CalibrationInput): void {
    this.lastFrame = f;
    if (!this.isActive()) return;
    if (!f.faceFound) {
      // Positions while the face is lost are garbage; start the stillness window over.
      this.window.reset();
      return;
    }
    this.window.push(f.t, f.pos);
    const path =
      this.step === 'waitLean'
        ? this.forwardPath
        : this.step === 'waitLeanLeft'
          ? this.leftPath
          : null;
    if (path && path.length < MAX_PATH) path.push(f.pos);
    this.evaluate(f);
  }

  /** Advance the step timer. Called on an interval; exposed for tests. */
  tick(): void {
    const now = this.now();
    const dt = this.lastTick ? now - this.lastTick : 0;
    this.lastTick = now;
    if (!this.isActive() || this.paused()) return;
    this.elapsedMs += dt;
    if (this.elapsedMs >= this.cfg.stepTimeoutMs) {
      log.info('step timed out', { step: this.step });
      this.finish({
        ok: false,
        reason: `Timed out: ${PROMPTS[this.step].toLowerCase()}`,
        at: new Date(now).toISOString(),
      });
    }
  }

  private paused(): boolean {
    const f = this.lastFrame;
    if (!f) return true;
    return !f.faceFound || this.now() - f.t > STALE_MS;
  }

  private still(): boolean {
    return this.window.full() && this.window.spread() < this.cfg.stillnessThreshold;
  }

  private evaluate(f: CalibrationInput) {
    switch (this.step) {
      case 'waitStillRest':
        if (this.still()) {
          this.p0 = this.window.mean();
          this.h0 = f.rot;
          this.emit('capture', 'P0');
          this.goto('waitLean');
        }
        return;
      case 'waitLean': {
        const p0 = this.p0 as Vec3;
        const away = norm(sub(f.pos, p0)) >= this.cfg.minLeanDistance;
        if (away) this.leanReached = true;
        if (
          this.leanReached &&
          this.still() &&
          norm(sub(this.window.mean(), p0)) >= this.cfg.minLeanDistance
        ) {
          this.p1 = this.window.mean();
          this.emit('capture', 'P1');
          if (this.threePoint) this.goto('waitLeanLeft');
          else this.complete(null);
        }
        return;
      }
      case 'waitLeanLeft': {
        const p0 = this.p0 as Vec3;
        const p1 = this.p1 as Vec3;
        const m = this.window.mean();
        const ok =
          norm(sub(m, p0)) >= this.cfg.minLeanDistance &&
          norm(sub(m, p1)) >= this.cfg.minLeanDistance;
        if (ok && this.still()) {
          this.emit('capture', 'P2');
          this.complete(m);
        }
        return;
      }
      case 'idle':
        return;
    }
  }

  private complete(p2: Vec3 | null) {
    const p0 = this.p0 as Vec3;
    const at = new Date(this.now()).toISOString();
    const opts = { minLeanDistance: this.cfg.minLeanDistance };
    const p1 = this.p1 as Vec3;
    const res = this.cfg.levelFromArc
      ? buildLevelledFrame(
          p0,
          p1,
          p2,
          { forward: this.forwardPath, left: p2 ? this.leftPath : null },
          opts,
        )
      : { ...buildFrame(p0, p1, p2, opts), leanDipDeg: null };
    if (!res.ok) {
      this.finish({ ok: false, reason: res.reason, leanDistance: res.leanDistance, at });
      return;
    }
    const off = phoneOffset(res.R);
    let placement: string;
    try {
      placement = this.save({ R: res.R, p0, h0: this.h0 as Quat, threePoint: p2 !== null });
    } catch (err) {
      this.finish({ ok: false, reason: `Could not save: ${(err as Error).message}`, at });
      return;
    }
    this.finish({
      ok: true,
      yawOffsetDeg: off.yaw,
      pitchOffsetDeg: off.pitch,
      rollOffsetDeg: off.roll,
      leanDistance: res.leanDistance,
      ...(res.leanDipDeg !== null && { leanDipDeg: res.leanDipDeg }),
      ...(res.levelNote && { levelNote: res.levelNote }),
      placement,
      at,
    });
  }

  private finish(result: CalibrationResult) {
    this.lastResult = result;
    log.info(result.ok ? 'calibration succeeded' : 'calibration failed', { ...result });
    this.goto('idle');
    this.emit('result', result);
  }

  private goto(step: CalibrationStep) {
    this.step = step;
    this.elapsedMs = 0;
    this.lastTick = this.now();
    this.leanReached = false;
    this.window.reset();
    if (step === 'idle' && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('step', step, PROMPTS[step]);
  }
}
