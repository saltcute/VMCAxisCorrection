import type { Euler, Mat3, Quat, Vec3 } from '@offaxis/shared';
import { describe, expect, it } from 'vitest';
import { eulerToQuat, quatToEuler } from './euler.js';
import {
  buildFrame,
  correct,
  identityPlacement,
  makeCorrector,
  phoneOffset,
  R_STRAIGHT,
} from './frame.js';
import { isRotation, mul as mulMat, mulVec, transpose } from './mat3.js';
import { angleBetween, conj, fromAxisAngle, fromMat3, mul, rotate, toMat3 } from './quat.js';
import { add } from './vec.js';

const EPS = 1e-6;
const D2R = Math.PI / 180;

function expectVec(actual: Vec3, expected: Vec3, eps = EPS) {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThan(eps);
}

function expectRot(actual: Quat, expected: Quat, eps = EPS) {
  expect(angleBetween(actual, expected)).toBeLessThan(eps);
}

/**
 * A synthetic rig: the phone's offset from straight-on is the user-frame rotation
 * O = Ry(yaw)·Rx(pitch)·Rz(roll), so the true R (phone → user) is O · R_straight.
 */
function rig(offset: Euler, restInPhone: Vec3 = [0.05, 0.12, 0.55], h0Euler?: Euler) {
  const O = toMat3(
    mul(
      mul(fromAxisAngle([0, 1, 0], offset.yaw * D2R), fromAxisAngle([1, 0, 0], offset.pitch * D2R)),
      fromAxisAngle([0, 0, 1], offset.roll * D2R),
    ),
  );
  const R = mulMat(O, R_STRAIGHT);
  const Rt = transpose(R);
  const qR = fromMat3(R);
  const h0 = h0Euler ? eulerToQuat(h0Euler) : fromAxisAngle([0, 1, 0], 0.3);
  return {
    R,
    h0,
    /** User-frame offset from rest → phone-frame position. */
    toPhone: (u: Vec3): Vec3 => add(mulVec(Rt, u), restInPhone),
    /** User-frame head rotation from rest → phone-frame head orientation. */
    rotToPhone: (g: Quat): Quat => mul(mul(mul(conj(qR), g), qR), h0),
    restInPhone,
  };
}

function calibrate(r: ReturnType<typeof rig>, threePoint: boolean) {
  const p0 = r.toPhone([0, 0, 0]);
  const p1 = r.toPhone([0, 0, 0.1]);
  const p2 = threePoint ? r.toPhone([0.08, 0, 0.01]) : null;
  const res = buildFrame(p0, p1, p2, { minLeanDistance: 0.05 });
  if (!res.ok) throw new Error(res.reason);
  return makeCorrector({
    name: 'test',
    R: res.R,
    p0,
    h0: r.h0,
    createdAt: '',
    threePoint,
  });
}

const samples: { pos: Vec3; rot: Euler }[] = [
  { pos: [0, 0, 0.08], rot: { yaw: 0, pitch: 0, roll: 0 } },
  { pos: [0.03, -0.02, 0.05], rot: { yaw: 20, pitch: -10, roll: 5 } },
  { pos: [-0.04, 0.01, -0.02], rot: { yaw: -35, pitch: 15, roll: -12 } },
];

describe('euler', () => {
  it('round-trips through quaternions', () => {
    for (const e of [
      { yaw: 10, pitch: 20, roll: 30 },
      { yaw: -170, pitch: -45, roll: 89 },
      { yaw: 0, pitch: 0, roll: 0 },
    ]) {
      const back = quatToEuler(eulerToQuat(e));
      expect(back.yaw).toBeCloseTo(e.yaw, 9);
      expect(back.pitch).toBeCloseTo(e.pitch, 9);
      expect(back.roll).toBeCloseTo(e.roll, 9);
    }
  });

  it('follows the documented sign convention', () => {
    // +yaw turns the nose (−z) toward the user's left (−x in the phone frame).
    expectVec(rotate(eulerToQuat({ yaw: 90, pitch: 0, roll: 0 }), [0, 0, -1]), [-1, 0, 0]);
    // +pitch tilts the nose up.
    expectVec(rotate(eulerToQuat({ yaw: 0, pitch: 90, roll: 0 }), [0, 0, -1]), [0, 1, 0]);
    // +roll tilts the top of the head toward the user's left.
    expectVec(rotate(eulerToQuat({ yaw: 0, pitch: 0, roll: 90 }), [0, 1, 0]), [-1, 0, 0]);
  });
});

describe('buildFrame + correct', () => {
  const cases: { name: string; offset: Euler; threePoint: boolean }[] = [
    { name: 'yaw only', offset: { yaw: 30, pitch: 0, roll: 0 }, threePoint: false },
    { name: 'negative yaw', offset: { yaw: -45, pitch: 0, roll: 0 }, threePoint: false },
    { name: 'pitch only', offset: { yaw: 0, pitch: 15, roll: 0 }, threePoint: false },
    { name: 'yaw + pitch', offset: { yaw: 30, pitch: 15, roll: 0 }, threePoint: false },
    {
      name: '3-point, yaw + pitch + roll',
      offset: { yaw: 30, pitch: 15, roll: 10 },
      threePoint: true,
    },
    {
      name: '3-point, large offsets',
      offset: { yaw: -60, pitch: -20, roll: -25 },
      threePoint: true,
    },
  ];

  for (const c of cases) {
    it(`recovers user-frame motion: ${c.name}`, () => {
      const r = rig(c.offset);
      const corr = calibrate(r, c.threePoint);
      expect(isRotation(corr.R)).toBe(true);
      corr.R.forEach((v, i) => {
        expect(Math.abs(v - r.R[i]!)).toBeLessThan(EPS);
      });
      for (const s of samples) {
        const g = eulerToQuat(s.rot);
        const out = correct(corr, r.toPhone(s.pos), r.rotToPhone(g));
        expectVec(out.userPos, s.pos);
        expectRot(out.userRot, g);
      }
    });
  }

  it('a straight forward lean comes out purely along z', () => {
    const r = rig({ yaw: 30, pitch: 0, roll: 0 });
    const corr = calibrate(r, false);
    const out = correct(corr, r.toPhone([0, 0, 0.12]), r.h0);
    expectVec(out.userPos, [0, 0, 0.12]);
  });

  it('emits the pose a straight-on phone at the same distance would report', () => {
    const r = rig({ yaw: 30, pitch: 15, roll: 0 });
    const corr = calibrate(r, false);
    const qS = fromMat3(R_STRAIGHT);
    const dist = Math.hypot(...r.restInPhone);
    // At rest: head centred in front of the virtual phone, facing it.
    const rest = correct(corr, r.toPhone([0, 0, 0]), r.rotToPhone([0, 0, 0, 1]));
    expectVec(rest.phonePos, [0, 0, dist]);
    expectRot(rest.phoneRot, [0, 0, 0, 1]);
    // Leaning forward 6 cm moves the head 6 cm toward the virtual phone (−z), nothing else.
    const g = eulerToQuat({ yaw: 12, pitch: -7, roll: 3 });
    const out = correct(corr, r.toPhone([0.02, 0.01, 0.06]), r.rotToPhone(g));
    expectVec(out.phonePos, [-0.02, 0.01, dist - 0.06]);
    expectRot(out.phoneRot, mul(mul(conj(qS), g), qS));
  });

  it('identity placement is an exact passthrough', () => {
    const corr = makeCorrector(identityPlacement());
    const pos: Vec3 = [0.03, -0.1, 0.6];
    const rot = eulerToQuat({ yaw: 15, pitch: -5, roll: 8 });
    const out = correct(corr, pos, rot);
    expectVec(out.phonePos, pos);
    expectRot(out.phoneRot, rot);
  });

  it('reports the phone offset', () => {
    const off = phoneOffset(rig({ yaw: 30, pitch: 15, roll: 0 }).R);
    expect(off.yaw).toBeCloseTo(30, 6);
    expect(off.pitch).toBeCloseTo(15, 6);
    expect(off.roll).toBeCloseTo(0, 6);
  });

  it('rejects a lean below the minimum distance', () => {
    const res = buildFrame([0, 0, 0.5], [0, 0, 0.48], null, { minLeanDistance: 0.05 });
    expect(res.ok).toBe(false);
  });

  it('rejects a lean away from the phone', () => {
    const r = rig({ yaw: 30, pitch: 10, roll: 0 });
    const res = buildFrame(r.toPhone([0, 0, 0]), r.toPhone([0, 0, -0.1]), null, {
      minLeanDistance: 0.05,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a three-point capture whose left lean is mirrored', () => {
    // Source position X has the wrong sign: the user leans left, the data says right. Without the
    // guard, u = f × l comes out pointing down and the avatar's up/down is reversed.
    const r = rig({ yaw: 20, pitch: 5, roll: 0 });
    const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
    const res = buildFrame(
      mirror(r.toPhone([0, 0, 0])),
      mirror(r.toPhone([0, 0, 0.1])),
      mirror(r.toPhone([0.08, 0, 0])),
      { minLeanDistance: 0.05 },
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(/mirrored/);
  });

  it('accepts a three-point capture with the phone in portrait or landscape (±90° roll)', () => {
    for (const roll of [90, -90]) {
      const r = rig({ yaw: 20, pitch: 5, roll });
      const res = buildFrame(
        r.toPhone([0, 0, 0]),
        r.toPhone([0, 0, 0.1]),
        r.toPhone([0.08, 0, 0]),
        {
          minLeanDistance: 0.05,
        },
      );
      expect(res.ok).toBe(true);
    }
  });

  it('rejects a left lean parallel to the forward lean', () => {
    const res = buildFrame([0, 0, 0.5], [0, 0, 0.4], [0, 0, 0.38], { minLeanDistance: 0.05 });
    expect(res.ok).toBe(false);
  });

  it('rejects a forward lean along the phone x axis in two-point mode', () => {
    const res = buildFrame([0, 0, 0.5], [0.1, 0, 0.495], null, { minLeanDistance: 0.05 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(/horizontal edge/);
  });
});

describe('mat3/quat helpers', () => {
  it('fromMat3 inverts toMat3', () => {
    const q = eulerToQuat({ yaw: 123, pitch: -33, roll: 77 });
    expectRot(fromMat3(toMat3(q)), q);
    const m: Mat3 = toMat3(q);
    expectVec(mulVec(m, [1, 2, 3]), rotate(q, [1, 2, 3]));
  });
});
