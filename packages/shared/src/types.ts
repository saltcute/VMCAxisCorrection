/** [x, y, z]. Positions are metres. */
export type Vec3 = [number, number, number];
/** [x, y, z, w] unit quaternion. */
export type Quat = [number, number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Euler angles in degrees, in the bridge's canonical convention (see math/euler.ts). */
export interface Euler {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface HeadPose {
  rot: Euler;
  pos: Vec3;
}

/**
 * One tracking frame in the bridge's canonical phone frame:
 * x = right as the user sees the screen, y = up, z = out of the screen toward the user.
 * Blendshapes use ARKit names (`eyeBlinkLeft`, `jawOpen`, …) with values 0..1.
 */
export interface TrackingFrame {
  blendshapes: Record<string, number>;
  head: HeadPose;
  faceFound: boolean;
  /** Receive time, ms since epoch. */
  t: number;
}

export interface Placement {
  name: string;
  /** Rotation phone frame → user frame (rows: left, up, forward). */
  R: Mat3;
  /** Neutral head position (phone frame). */
  p0: Vec3;
  /** Neutral head orientation (phone frame). */
  h0: Quat;
  createdAt: string;
  threePoint: boolean;
}

export interface PlacementsFile {
  active: string;
  placements: Placement[];
}
