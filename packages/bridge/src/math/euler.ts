import type { Euler, Quat } from '@offaxis/shared';
import { fromAxisAngle, mul, toMat3 } from './quat.js';

/**
 * Canonical Euler convention, in the canonical phone frame
 * (x = right as the user sees the screen, y = up, z = out of the screen toward the user):
 *
 *   H = Ry(yaw) · Rx(pitch) · Rz(roll)        (degrees, right-handed rotations)
 *
 * For a head facing the phone (nose along −z):
 *   +yaw   turns the face toward the user's left,
 *   +pitch tilts the face up,
 *   +roll  tilts the top of the head toward the user's left.
 */
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function eulerToQuat(e: Euler): Quat {
  const qy = fromAxisAngle([0, 1, 0], e.yaw * D2R);
  const qx = fromAxisAngle([1, 0, 0], e.pitch * D2R);
  const qz = fromAxisAngle([0, 0, 1], e.roll * D2R);
  return mul(mul(qy, qx), qz);
}

export function quatToEuler(q: Quat): Euler {
  // M = Ry·Rx·Rz ⇒ m12 = −sin(pitch), m02 = cos(p)sin(yaw), m22 = cos(p)cos(yaw),
  // m10 = cos(p)sin(roll), m11 = cos(p)cos(roll).
  const m = toMat3(q);
  const sp = Math.max(-1, Math.min(1, -m[5]));
  const pitch = Math.asin(sp);
  let yaw: number;
  let roll: number;
  if (Math.abs(sp) < 0.999999) {
    yaw = Math.atan2(m[2], m[8]);
    roll = Math.atan2(m[3], m[4]);
  } else {
    // Gimbal lock: fold everything into yaw.
    yaw = Math.atan2(-m[6], m[0]);
    roll = 0;
  }
  return { yaw: yaw * R2D, pitch: pitch * R2D, roll: roll * R2D };
}
