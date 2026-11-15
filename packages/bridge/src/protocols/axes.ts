import type { AxisFlips, HeadPose } from '@offaxis/shared';

/** Apply sign flips. Flips are their own inverse, so encode and decode use the same function. */
export function applyFlips(pose: HeadPose, f: AxisFlips): HeadPose {
  const s = (flip: boolean) => (flip ? -1 : 1);
  return {
    pos: [pose.pos[0] * s(f.posX), pose.pos[1] * s(f.posY), pose.pos[2] * s(f.posZ)],
    rot: {
      yaw: pose.rot.yaw * s(f.yaw),
      pitch: pose.rot.pitch * s(f.pitch),
      roll: pose.rot.roll * s(f.roll),
    },
  };
}

/** ARKit `eyeBlinkLeft` ↔ iFacialMocap `eyeBlink_L`. */
export function ifmToArkitName(name: string): string {
  if (name.endsWith('_L')) return `${name.slice(0, -2)}Left`;
  if (name.endsWith('_R')) return `${name.slice(0, -2)}Right`;
  return name;
}

/** ARKit `eyeBlinkLeft` ↔ VTube Studio iPhone `EyeBlinkLeft`. */
export const arkitToVtsName = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1);
export const vtsToArkitName = (name: string): string =>
  name.charAt(0).toLowerCase() + name.slice(1);
