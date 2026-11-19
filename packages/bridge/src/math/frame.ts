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
          'Check that you leaned to your left; if so, turn on Settings → "Axis flips: phone input" → Flip posX and recalibrate.',
      };
    }
  }
  const u = cross(f, l);
  return { ok: true, R: fromRows(l, u, f), leanDistance };
}

export interface LeanPaths {
  /** Positions recorded while leaning forward (rest → P1), phone frame. */
  forward: Vec3[];
  /** Positions recorded during the left lean, three-point mode only. */
  left: Vec3[] | null;
}

export type LevelledFrameResult = BuildFrameResult & {
  /** How far the forward lean's chord dipped below level, degrees; null when not levelled. */
  leanDipDeg: number | null;
  /** Why the lean's path could not be used, when it couldn't. */
  levelNote?: string;
};

const D2R = Math.PI / 180;
/** Largest start-of-lean tilt accepted as a dip rather than a bad trace. */
const LEVEL_MAX_DEG = 30;
/** Largest standard error of a start slope (≈ 3°). */
const LEVEL_MAX_SE = 0.05;

/**
 * Direction of a lean's path where it leaves P0: each off-axis component (up, side) is fitted as
 * y = kx + qx² against the distance x along the provisional axis, and (1, k_up, k_side) is the
 * tangent. Fitting the side component too keeps the fixed point unique: with the up slope alone,
 * the axis could settle anywhere in a sideways fan of directions.
 */
function startTangent(
  path: Vec3[],
  p0: Vec3,
  axis: Vec3,
  up: Vec3,
  side: Vec3,
  reach: number,
): { tangent: Vec3; slope: number } | { error: string } {
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  let mid = 0;
  for (const p of path) {
    const d = sub(p, p0);
    const x = dot(d, axis);
    const w = dot(d, side);
    // Drop samples off the lean's plane, e.g. coming back from the forward lean before leaning
    // left: they would only add residual.
    if (x < 0 || x > 1.3 * reach || Math.abs(w) > 0.02 + 0.3 * x) continue;
    xs.push(x);
    ys.push(dot(d, up));
    ws.push(w);
    if (x > 0.15 * reach && x < 0.85 * reach) mid++;
  }
  if (mid < 4) return { error: 'the lean was too quick to trace its curve' };
  const up_ = fitStartSlope(xs, ys);
  const side_ = fitStartSlope(xs, ws);
  if (!up_ || !side_) return { error: 'the lean path was degenerate' };
  if (up_.se > LEVEL_MAX_SE || side_.se > LEVEL_MAX_SE) {
    return { error: 'the lean path was too noisy' };
  }
  if (Math.hypot(up_.k, side_.k) > Math.tan(LEVEL_MAX_DEG * D2R)) {
    return { error: `the lean curved more than ${LEVEL_MAX_DEG}°` };
  }
  return {
    tangent: normalize(add(axis, add(scale(up, up_.k), scale(side, side_.k)))),
    slope: Math.hypot(up_.k, side_.k),
  };
}

/** Least-squares y = kx + qx² (through the origin): k and its standard error. */
function fitStartSlope(xs: number[], ys: number[]): { k: number; se: number } | null {
  let sxx = 0;
  let sx3 = 0;
  let sx4 = 0;
  let sxy = 0;
  let sx2y = 0;
  xs.forEach((x, i) => {
    const y = ys[i] as number;
    sxx += x * x;
    sx3 += x * x * x;
    sx4 += x * x * x * x;
    sxy += x * y;
    sx2y += x * x * y;
  });
  const det = sxx * sx4 - sx3 * sx3;
  if (!(det > 0)) return null;
  const k = (sxy * sx4 - sx2y * sx3) / det;
  const q = (sxx * sx2y - sx3 * sxy) / det;
  let rss = 0;
  xs.forEach((x, i) => {
    rss += ((ys[i] as number) - k * x - q * x * x) ** 2;
  });
  return { k, se: Math.sqrt(((rss / Math.max(1, xs.length - 2)) * sx4) / det) };
}

/**
 * buildFrame, but levelled from the shape of each lean instead of its chord.
 *
 * A natural lean hinges at the hips (and neck), below the head, so the head travels on an arc: it
 * starts out level and dips as it goes. The chord P0 → P1 therefore points down, and the frame
 * built on it is pitched, so rising in the chair would read partly as leaning. The arc's tangent
 * at P0 is level as long as the user sits upright at rest, so the forward (and left) axes are
 * taken from the start slope of a quadratic fit to the recorded path. The fit lives in the
 * provisional frame's planes, so it is repeated a few times as that frame settles. If a path is
 * too short, quick or noisy, this falls back to the chord.
 */
export function buildLevelledFrame(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3 | null,
  paths: LeanPaths,
  opts: BuildFrameOptions,
): LevelledFrameResult {
  const chord = buildFrame(p0, p1, p2, opts);
  if (!chord.ok) return { ...chord, leanDipDeg: null };
  const leanLen = norm(sub(p1, p0));
  const leftLen = p2 ? norm(sub(p2, p0)) : 0;
  let res: BuildFrameResult = chord;
  let q1: Vec3;
  let q2 = p2;
  // Fixed-point iteration: the slopes go to zero once the frame is level. It converges linearly
  // (each pass fits in a frame that is still slightly tilted), so allow plenty of passes.
  for (let iter = 0; iter < 100; iter++) {
    const [l, u, f] = rowsOf(res.R);
    const fwd = startTangent(paths.forward, p0, f, u, l, dot(sub(p1, p0), f));
    if ('error' in fwd) return { ...chord, leanDipDeg: null, levelNote: fwd.error };
    q1 = add(p0, scale(fwd.tangent, leanLen));
    let worst = fwd.slope;
    if (p2 && paths.left) {
      const left = startTangent(paths.left, p0, l, u, f, dot(sub(p2, p0), l));
      if ('error' in left) return { ...chord, leanDipDeg: null, levelNote: left.error };
      q2 = add(p0, scale(left.tangent, leftLen));
      worst = Math.max(worst, left.slope);
    }
    if (worst < 1e-10) break;
    const next = buildFrame(p0, q1, q2, opts);
    if (!next.ok) return { ...chord, leanDipDeg: null, levelNote: next.reason };
    res = { ...next, leanDistance: chord.leanDistance };
  }
  const [, u, f] = rowsOf(res.R);
  const c = normalize(sub(p1, p0));
  const dip = Math.atan2(-dot(c, u), dot(c, f)) / D2R;
  return { ...res, leanDipDeg: dip };
}

function rowsOf(m: Mat3): [Vec3, Vec3, Vec3] {
  return [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
}

/** p' = R (p − P0): head offset from neutral in the user frame. */
export function correctPosition(R: Mat3, p0: Vec3, p: Vec3): Vec3 {
  return mulVec(R, sub(p, p0));
}

/**
 * Δ = H0⁻¹ · H: head change from neutral, in the neutral head's own axes.
 *
 * This deliberately ignores R. The user faces the monitor at rest, so the neutral head's axes
 * already are the user frame, and when the tracker reports camera-relative orientation this equals
 * q_straight⁻¹ · (q_R · H · H0⁻¹ · q_R⁻¹) · q_straight. It also holds when the tracker re-centres
 * rotation itself (iFacialMocap's own calibration zeroes head rotation but not position): a
 * correction applied as C⁻¹ · H cancels out of H0⁻¹ · H, whereas conjugating by q_R would turn the
 * already-centred axes a second time and leak head roll into pitch.
 */
export function correctRotation(h: Quat, h0: Quat): Quat {
  return mul(conj(h0), h);
}

/**
 * A placement prepared for per-frame use: matrices and quaternions precomputed.
 */
export interface Corrector {
  placement: Placement;
  R: Mat3;
  /** Where the neutral head sits for the virtual straight-on phone: (0, 0, |P0|). */
  virtualRest: Vec3;
}

export function makeCorrector(placement: Placement): Corrector {
  return {
    placement,
    R: placement.R,
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
 * H0⁻¹ · H. At rest that is the head centred and facing the phone. The
 * identity placement (R = R_straight, P0 = 0, H0 = 1) is an exact passthrough.
 */
export function correct(c: Corrector, pos: Vec3, rot: Quat): CorrectedPose {
  const userPos = correctPosition(c.R, c.placement.p0, pos);
  const phoneRot = correctRotation(rot, c.placement.h0);
  return {
    userPos,
    userRot: mul(mul(Q_STRAIGHT, phoneRot), conj(Q_STRAIGHT)),
    phonePos: add(mulVec(R_STRAIGHT_T, userPos), c.virtualRest),
    phoneRot,
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
