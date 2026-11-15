import type { Mat3, Vec3 } from '@offaxis/shared';

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function fromRows(r0: Vec3, r1: Vec3, r2: Vec3): Mat3 {
  return [...r0, ...r1, ...r2];
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        (a[r * 3] as number) * (b[c] as number) +
        (a[r * 3 + 1] as number) * (b[3 + c] as number) +
        (a[r * 3 + 2] as number) * (b[6 + c] as number);
    }
  }
  return out as Mat3;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** True if `m` is a proper rotation (orthonormal, det +1) within `eps`. */
export function isRotation(m: Mat3, eps = 1e-6): boolean {
  const p = mul(m, transpose(m));
  return (
    p.every((v, i) => Math.abs(v - (IDENTITY[i] as number)) < eps) && Math.abs(det(m) - 1) < eps
  );
}
