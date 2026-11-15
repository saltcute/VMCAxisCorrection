import type { HeadPose, Vec3 } from '@offaxis/shared';
import { z } from 'zod';
import { arkitToVtsName, vtsToArkitName } from './axes.js';

/**
 * VTube Studio iPhone app UDP protocol
 * (https://github.com/DenchiSoft/VTubeStudioBlendshapeUDPReceiverTest).
 * A client sends a request to phone:21412; the phone streams JSON to the request's source IP on
 * each listed port for `time` seconds (0.5–10). Clients re-send every second or so.
 */
export const VTS_PHONE_PORT = 21412;

export const VtsRequestSchema = z.object({
  messageType: z.literal('iOSTrackingDataRequest'),
  time: z.number().optional(),
  sendForSeconds: z.number().optional(),
  sentBy: z.string().min(1).max(64).optional(),
  ports: z.array(z.number().int().min(1).max(65535)).min(1).max(32),
});
export type VtsRequest = z.infer<typeof VtsRequestSchema>;

export function requestSeconds(req: VtsRequest): number {
  return Math.min(10, Math.max(0.5, req.time ?? req.sendForSeconds ?? 2));
}

const xyz = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const VtsFrameSchema = z.object({
  Timestamp: z.number().optional(),
  Hotkey: z.number().optional(),
  FaceFound: z.boolean(),
  Rotation: xyz,
  Position: xyz,
  EyeLeft: xyz.optional(),
  EyeRight: xyz.optional(),
  BlendShapes: z.array(z.object({ k: z.string(), v: z.number() })),
});
export type VtsFrame = z.infer<typeof VtsFrameSchema>;

/**
 * VTS position unit. UNCONFIRMED: Android VTS-protocol emulators send centimetres; the bridge works
 * in metres internally.
 */
const VTS_POS_PER_METRE = 100;

/**
 * VTS head ↔ canonical phone frame. Rotation.x = pitch, Rotation.y = yaw, Rotation.z = roll
 * (degrees, per third-party implementations). Signs and position axes are UNVERIFIED; fix with
 * `output.flip` / `source.flip` after a live test.
 */
export function vtsHeadToCanonical(f: VtsFrame): HeadPose {
  return {
    rot: { yaw: f.Rotation.y, pitch: f.Rotation.x, roll: f.Rotation.z },
    pos: [
      f.Position.x / VTS_POS_PER_METRE,
      f.Position.y / VTS_POS_PER_METRE,
      f.Position.z / VTS_POS_PER_METRE,
    ],
  };
}

export function canonicalToVtsHead(h: HeadPose): Pick<VtsFrame, 'Rotation' | 'Position'> {
  return {
    Rotation: { x: h.rot.pitch, y: h.rot.yaw, z: h.rot.roll },
    Position: {
      x: h.pos[0] * VTS_POS_PER_METRE,
      y: h.pos[1] * VTS_POS_PER_METRE,
      z: h.pos[2] * VTS_POS_PER_METRE,
    },
  };
}

const toXyz = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });

export function encodeVtsFrame(args: {
  head: HeadPose;
  blendshapes: Record<string, number>;
  faceFound: boolean;
  eyes?: { left: Vec3; right: Vec3 } | undefined;
  t: number;
}): string {
  const frame: VtsFrame = {
    Timestamp: args.t,
    Hotkey: -1,
    FaceFound: args.faceFound,
    ...canonicalToVtsHead(args.head),
    EyeLeft: toXyz(args.eyes?.left ?? [0, 0, 0]),
    EyeRight: toXyz(args.eyes?.right ?? [0, 0, 0]),
    BlendShapes: Object.entries(args.blendshapes).map(([k, v]) => ({ k: arkitToVtsName(k), v })),
  };
  return JSON.stringify(frame);
}

export function decodeVtsBlendshapes(f: VtsFrame): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { k, v } of f.BlendShapes) out[vtsToArkitName(k)] = v;
  return out;
}
