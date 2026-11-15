import type { HeadPose, Vec3 } from '@offaxis/shared';
import { ifmToArkitName } from './axes.js';

/**
 * iFacialMocap UDP protocol (https://www.ifacialmocap.com/for-developer/).
 * The PC sends HANDSHAKE to phone:49983; the phone streams to PC:49983. Packets are `|`-separated:
 *   v2: `eyeBlink_L&43|…|=head#rx,ry,rz,tx,ty,tz|rightEye#x,y,z|leftEye#x,y,z|`
 *   v1: same with `name-value` instead of `name&value`.
 * Blendshapes are integers 0–100, rotations are degrees, position units are undocumented
 * (sample values look like metres).
 */
export const HANDSHAKE = 'iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719|sendDataVersion=v2';

export interface IfmPacket {
  blendshapes: Record<string, number>;
  /** Raw head values as sent: rx, ry, rz (degrees), tx, ty, tz. */
  head: [number, number, number, number, number, number] | null;
  /** The literal head field, used to spot frozen (face-lost) streams. */
  headRaw: string | null;
  rightEye: Vec3 | null;
  leftEye: Vec3 | null;
}

function parseNums(s: string, n: number): number[] | null {
  const parts = s.split(',').map(Number);
  return parts.length >= n && parts.slice(0, n).every(Number.isFinite) ? parts.slice(0, n) : null;
}

export function parseIfm(text: string): IfmPacket {
  const out: IfmPacket = {
    blendshapes: {},
    head: null,
    headRaw: null,
    rightEye: null,
    leftEye: null,
  };
  for (const part of text.split('|')) {
    if (!part) continue;
    const hash = part.indexOf('#');
    if (hash >= 0) {
      const key = part.slice(0, hash).replace(/^=/, '');
      const body = part.slice(hash + 1);
      if (key === 'head') {
        const v = parseNums(body, 6);
        if (v) {
          out.head = v as IfmPacket['head'];
          out.headRaw = body;
        }
      } else if (key === 'rightEye' || key === 'leftEye') {
        const v = parseNums(body, 3);
        if (v) out[key] = v as Vec3;
      }
      continue;
    }
    // v2 uses `&`; v1 uses `-` (values are non-negative, so split on the last one).
    const sep = part.includes('&') ? part.lastIndexOf('&') : part.lastIndexOf('-');
    if (sep <= 0) continue;
    const value = Number(part.slice(sep + 1));
    if (!Number.isFinite(value)) continue;
    out.blendshapes[ifmToArkitName(part.slice(0, sep))] = value / 100;
  }
  return out;
}

/**
 * iFacialMocap head → canonical phone frame (x right as the user sees the screen, y up, z toward
 * the user). Verified live 2026-11-15 against the canonical convention in math/euler.ts:
 * - position (tx, ty, −tz): with −tx, three-point calibration came out upside down;
 * - rotation yaw = −ry, pitch = −rx, roll = rz: turning left gave −ry, looking up +pitch from −rx,
 *   tilting toward the left shoulder −rz. iFacialMocap's frame is z-mirrored relative to the
 *   canonical one, which negates the x and y rotations and keeps z.
 */
export function ifmHeadToCanonical(h: NonNullable<IfmPacket['head']>): HeadPose {
  const [rx, ry, rz, tx, ty, tz] = h;
  return { rot: { yaw: -ry, pitch: -rx, roll: rz }, pos: [tx, ty, -tz] };
}
