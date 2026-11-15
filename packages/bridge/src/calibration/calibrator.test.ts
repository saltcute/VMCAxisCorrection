import type { CalibrationResult, Config, Quat, Vec3 } from '@offaxis/shared';
import { defaultConfig } from '@offaxis/shared';
import { describe, expect, it } from 'vitest';
import { R_STRAIGHT } from '../math/frame.js';
import { mul, mulVec, transpose } from '../math/mat3.js';
import { fromAxisAngle, toMat3 } from '../math/quat.js';
import { add } from '../math/vec.js';
import { type CalibrationCapture, Calibrator } from './calibrator.js';

const ROT: Quat = [0, 0, 0, 1];

function setup(overrides: Partial<Config['calibration']> = {}) {
  const cfg = { ...defaultConfig().calibration, ...overrides };
  let now = 1_000_000;
  const saved: CalibrationCapture[] = [];
  const cal = new Calibrator(
    cfg,
    (c) => {
      saved.push(c);
      return 'desk';
    },
    () => now,
  );
  const results: CalibrationResult[] = [];
  cal.on('result', (r) => results.push(r));
  // Phone yawed 30°: user-frame offset u → phone-frame position.
  const R = mul(toMat3(fromAxisAngle([0, 1, 0], Math.PI / 6)), R_STRAIGHT);
  const rest: Vec3 = [0.05, 0.1, 0.6];
  const toPhone = (u: Vec3) => add(mulVec(transpose(R), u), rest);
  /** Hold a user-frame offset for `ms`, at 60 fps with a little jitter. */
  const hold = (u: Vec3, ms: number, opts: { jitter?: number; faceFound?: boolean } = {}) => {
    const end = now + ms;
    while (now < end) {
      now += 16;
      const j = opts.jitter ?? 0.0005;
      const p = toPhone([u[0] + (Math.random() - 0.5) * j, u[1], u[2]]);
      cal.push({ t: now, pos: p, rot: ROT, faceFound: opts.faceFound ?? true });
      cal.tick();
    }
  };
  /** Move linearly between two user-frame offsets. */
  const move = (from: Vec3, to: Vec3, ms: number) => {
    const steps = Math.ceil(ms / 16);
    for (let i = 1; i <= steps; i++) {
      now += 16;
      const k = i / steps;
      cal.push({
        t: now,
        pos: toPhone([
          from[0] + (to[0] - from[0]) * k,
          from[1] + (to[1] - from[1]) * k,
          from[2] + (to[2] - from[2]) * k,
        ]),
        rot: ROT,
        faceFound: true,
      });
      cal.tick();
    }
  };
  const advance = (ms: number) => {
    now += ms;
    cal.tick();
  };
  return { cal, saved, results, hold, move, advance, R };
}

describe('Calibrator', () => {
  it('captures rest and forward lean, then saves R', () => {
    const t = setup();
    t.cal.start();
    expect(t.cal.status().step).toBe('waitStillRest');
    t.hold([0, 0, 0], 600);
    expect(t.cal.status().step).toBe('waitLean');
    t.move([0, 0, 0], [0, 0, 0.1], 400);
    t.hold([0, 0, 0.1], 600);
    expect(t.cal.status().step).toBe('idle');
    expect(t.results[0]?.ok).toBe(true);
    expect(t.results[0]?.yawOffsetDeg).toBeCloseTo(30, 0);
    expect(t.results[0]?.placement).toBe('desk');
    const R = t.saved[0]?.R ?? [];
    R.forEach((v, i) => {
      expect(Math.abs(v - (t.R[i] as number))).toBeLessThan(0.02);
    });
  });

  it('does not capture P1 while the user is still at rest', () => {
    const t = setup();
    t.cal.start();
    t.hold([0, 0, 0], 600);
    t.hold([0, 0, 0], 2000);
    expect(t.cal.status().step).toBe('waitLean');
  });

  it('runs the three-point routine', () => {
    const t = setup({ threePoint: true });
    t.cal.start();
    t.hold([0, 0, 0], 600);
    t.move([0, 0, 0], [0, 0, 0.1], 400);
    t.hold([0, 0, 0.1], 600);
    expect(t.cal.status().step).toBe('waitLeanLeft');
    t.move([0, 0, 0.1], [0.09, 0, 0], 600);
    t.hold([0.09, 0, 0], 600);
    expect(t.results[0]?.ok).toBe(true);
    expect(t.saved[0]?.threePoint).toBe(true);
  });

  it('times out a step and keeps the old calibration', () => {
    const t = setup({ stepTimeoutMs: 3000 });
    t.cal.start();
    t.hold([0, 0, 0], 600);
    t.hold([0, 0, 0], 3500);
    expect(t.cal.status().step).toBe('idle');
    expect(t.results[0]?.ok).toBe(false);
    expect(t.saved).toHaveLength(0);
  });

  it('pauses the timer while the face is lost', () => {
    const t = setup({ stepTimeoutMs: 3000 });
    t.cal.start();
    t.hold([0, 0, 0], 5000, { faceFound: false });
    expect(t.cal.status().step).toBe('waitStillRest');
    expect(t.cal.status().paused).toBe(true);
    t.advance(10_000); // no frames at all: stale stream also pauses
    expect(t.cal.status().step).toBe('waitStillRest');
  });

  it('does not capture rest while moving', () => {
    const t = setup();
    t.cal.start();
    t.hold([0, 0, 0], 1000, { jitter: 0.05 });
    expect(t.cal.status().step).toBe('waitStillRest');
  });

  it('can be cancelled', () => {
    const t = setup();
    t.cal.start();
    t.cal.cancel();
    expect(t.cal.status().step).toBe('idle');
    expect(t.results[0]).toMatchObject({ ok: false, reason: 'Cancelled' });
    t.cal.dispose();
  });
});
