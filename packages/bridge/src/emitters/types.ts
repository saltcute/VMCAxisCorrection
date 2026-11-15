import type { HeadPose, Vec3 } from '@offaxis/shared';

/** A corrected frame, expressed as a straight-on phone would report it (canonical phone frame). */
export interface OutputFrame {
  head: HeadPose;
  blendshapes: Record<string, number>;
  faceFound: boolean;
  eyes?: { left: Vec3; right: Vec3 } | undefined;
  t: number;
}

export interface EmitterStatus {
  /** Whether a consumer (VNyan) is currently asking for / receiving the stream. */
  requesting: boolean;
  peers: string[];
  lastRequestAt: number | null;
}

export interface Emitter {
  readonly kind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(frame: OutputFrame): void;
  status(): EmitterStatus;
}
