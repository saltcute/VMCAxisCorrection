import type { Euler, Mat3, Placement, Quat, Vec3 } from '@offaxis/shared';
import { quatToEuler } from './euler.js';
import { fromRows, mul as mulMat, mulVec, transpose } from './mat3.js';
import { conj, fromMat3, IDENTITY_Q, mul } from './quat.js';
import { add, cross, dot, norm, normalize, scale, sub } from './vec.js';

/**
 * Frames
 * - Phone frame (canonical): x = right as the user sees the screen, y = up, z = toward the user.
 * - User frame: x = user's left, y = up, z = forward (toward the monitor). Right-handed.
 *
 * R maps phone-frame vectors into the user frame; its rows are the user's left, up and forward
 * axes expressed in phone coordinates.
 */

/** R for a phone directly in front of the user, facing them: a 180° turn about y. */
export const R_STRAIGHT: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
export const Q_STRAIGHT: Quat = fromMat3(R_STRAIGHT);
const R_STRAIGHT_T: Mat3 = transpose(R_STRAIGHT);

export const PHONE_RIGHT: Vec3 = [1, 0, 0];

export interface BuildFrameOptions {
  minLeanDistance: number;
  /** Reject when l' and f are closer to parallel than this (|sin angle|). */
  minPerpendicular?: number;
}

export type BuildFrameResult =
  | { ok: true; R: Mat3; leanDistance: number }
  | { ok: false; reason: string; leanDistance: number };

/**
 * Build R from the rest point P0, the forward-lean point P1 and optionally the left-lean point P2.
 *
 * Without P2 the phone is assumed to have no roll: its horizontal edge (phone x) is level, so the
 * user's up axis is perpendicular to both f and phone x: l' = (phoneRight × f) × f. This is exact
 * for any combination of yaw and pitch. (phoneUp × f, the other obvious choice, is only exact when
 * yaw or pitch is zero.)
 */
export function buildFrame(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3 | null,
  opts: BuildFrameOptions,
): BuildFrameResult {
  const minPerp = opts.minPerpendicular ?? 0.25;
  const forward = sub(p1, p0);
  const leanDistance = norm(forward);
  if (leanDistance < opts.minLeanDistance) {
    return {
      ok: false,
      leanDistance,
      reason: `Lean too small (${(leanDistance * 100).toFixed(1)} cm < ${(opts.minLeanDistance * 100).toFixed(1)} cm)`,
    };
  }
  const f = scale(forward, 1 / leanDistance);
  // The phone has to face the user, so any lean toward the monitor brings the head closer to it
  // (f has a −z component unless the phone is turned more than 90°). Moving away means the user
  // leaned back, or started the routine while leaning.
  if (f[2] >= 0) {
    return {
      ok: false,
      leanDistance,
      reason:
        'The lean moved away from the phone. Sit normally first, then lean toward the monitor.',
    };
  }

  let lPrime: Vec3;
  if (p2) {
    lPrime = sub(p2, p0);
    if (norm(lPrime) < opts.minLeanDistance) {
      return { ok: false, leanDistance, reason: 'Left lean too small' };
    }
  } else {
    const up = cross(PHONE_RIGHT, f);
    if (norm(up) < minPerp) {
      return {
        ok: false,
        leanDistance,
        reason: "Forward lean runs along the phone's horizontal edge; use three-point mode",
      };
    }
    lPrime = cross(up, f);
  }

  const ortho = sub(lPrime, scale(f, dot(lPrime, f)));
  const orthoNorm = norm(ortho);
  if (orthoNorm < minPerp * norm(lPrime) || orthoNorm === 0) {
    return {
      ok: false,
      leanDistance,
      reason: 'Left lean is nearly parallel to the forward lean',
    };
  }
  const l = scale(ortho, 1 / orthoNorm);
  if (p2) {
    // Handedness check. If the source's position axes are mirrored (one sign wrong), the measured
    // left lands on the side opposite to where the phone's own axes put it, and u = f × l comes
    // out pointing down. A rolled phone (portrait/landscape, up to ~±120°) still passes.
    const predicted = cross(cross(PHONE_RIGHT, f), f);
    if (norm(predicted) >= minPerp && dot(l, normalize(predicted)) < -0.5) {
      return {
        ok: false,
        leanDistance,
        reason:
          'The left lean came out on the right: the phone position data looks mirrored. ' +
          'Check that you leaned to your left; if so, turn on Settings → Axis flips → source Flip posX and recalibrate.',
      };
    }
  }
  const u = cross(f, l);
  return { ok: true, R: fromRows(l, u, f), leanDistance };
}

/** p' = R (p − P0): head offset from neutral in the user frame. */
export function correctPosition(R: Mat3, p0: Vec3, p: Vec3): Vec3 {
  return mulVec(R, sub(p, p0));
}

/** D = q_R · H · H0⁻¹ · q_R⁻¹: head change from neutral, expressed in the user frame. */
export function correctRotation(qR: Quat, h: Quat, h0: Quat): Quat {
  return mul(mul(mul(qR, h), conj(h0)), conj(qR));
}

/**
 * A placement prepared for per-frame use: matrices and quaternions precomputed.
 */
export interface Corrector {
  placement: Placement;
  R: Mat3;
  qR: Quat;
  /** Where the neutral head sits for the virtual straight-on phone: (0, 0, |P0|). */
  virtualRest: Vec3;
}

export function makeCorrector(placement: Placement): Corrector {
  const qR = fromMat3(placement.R);
  return {
    placement,
    R: placement.R,
    qR,
    virtualRest: [0, 0, norm(placement.p0)],
  };
}

export interface CorrectedPose {
  /** Offset from neutral, user frame. */
  userPos: Vec3;
  /** Rotation from neutral, user frame. */
  userRot: Quat;
  /** Position as a straight-on phone would report it (phone frame). */
  phonePos: Vec3;
  /** Rotation as a straight-on phone would report it (phone frame). */
  phoneRot: Quat;
}

/**
 * Correct one frame. The emitted pose is what a phone straight in front of the user, at the same
 * distance as the real one, would report: position R_straightᵀ·p' + (0, 0, |P0|) and rotation
 * q_straight⁻¹ · D · q_straight. At rest that is the head centred and facing the phone. The
 * identity placement (R = R_straight, P0 = 0, H0 = 1) is an exact passthrough.
 */
export function correct(c: Corrector, pos: Vec3, rot: Quat): CorrectedPose {
  const userPos = correctPosition(c.R, c.placement.p0, pos);
  const userRot = correctRotation(c.qR, rot, c.placement.h0);
  return {
    userPos,
    userRot,
    phonePos: add(mulVec(R_STRAIGHT_T, userPos), c.virtualRest),
    phoneRot: mul(mul(conj(Q_STRAIGHT), userRot), Q_STRAIGHT),
  };
}

export function identityPlacement(name = 'default'): Placement {
  return {
    name,
    R: [...R_STRAIGHT] as Mat3,
    p0: [0, 0, 0],
    h0: [...IDENTITY_Q] as Quat,
    createdAt: new Date(0).toISOString(),
    threePoint: false,
  };
}

/**
 * How the phone is turned relative to a straight-on phone, in degrees, as right-handed rotations
 * in the user frame: yaw about up (> 0 = counter-clockwise seen from above), pitch about the
 * user's left axis (> 0 = camera tilted upward, typical for a phone below the face), roll about
 * forward.
 */
export function phoneOffset(R: Mat3): Euler {
  // O = R · R_straightᵀ, decomposed as Ry·Rx·Rz about the user-frame axes.
  return quatToEuler(fromMat3(mulMat(R, transpose(R_STRAIGHT))));
}

/** Phone position and camera direction in the user frame, relative to the neutral head. */
export function phoneInUserFrame(
  c: Corrector,
  neutral: Vec3 = c.placement.p0,
): { pos: Vec3; facing: Vec3 } {
  return {
    pos: mulVec(c.R, scale(neutral, -1)),
    facing: mulVec(c.R, [0, 0, 1]),
  };
}
