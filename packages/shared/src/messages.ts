import { z } from 'zod';
import type { Config } from './config.js';
import type { Euler, Placement, Vec3 } from './types.js';

export type CalibrationStep = 'idle' | 'waitStillRest' | 'waitLean' | 'waitLeanLeft';

export interface CalibrationResult {
  ok: boolean;
  /** Human-readable failure reason when `ok` is false. */
  reason?: string;
  /** How far the phone is turned from the user's forward axis, degrees. */
  yawOffsetDeg?: number;
  pitchOffsetDeg?: number;
  rollOffsetDeg?: number;
  /** |P1 − P0| in metres. */
  leanDistance?: number;
  placement?: string;
  at: string;
}

export interface CalibrationStatus {
  step: CalibrationStep;
  prompt: string;
  /** Current position standard deviation over the stillness window, metres. */
  stillness: number;
  stillnessThreshold: number;
  /** Displacement from P0 during a lean step, metres. */
  leanDistance: number;
  minLeanDistance: number;
  timeRemainingMs: number;
  /** Timer paused because the face was lost. */
  paused: boolean;
  lastResult: CalibrationResult | null;
}

export type AlertId = 'phoneMoved' | 'phoneLost' | 'vnyanIdle';

export interface Alert {
  id: AlertId;
  level: 'warn' | 'error';
  message: string;
}

export interface LinkStatus {
  phone: { packetsPerSec: number; lastPacketAt: number | null };
  vnyan: { requesting: boolean; peers: string[]; lastRequestAt: number | null };
  faceFound: boolean;
  activePlacement: string;
  outputMode: Config['output']['mode'];
  sourceType: Config['source']['type'];
}

/** Geometry for the live-view plots, all in the user frame (x left, y up, z forward), metres. */
export interface PlotFrame {
  /** Head offset from neutral as the uncorrected stream would show it. */
  raw: Vec3;
  /** Head offset from neutral after correction. */
  corrected: Vec3;
  /** Phone position relative to the neutral head position. */
  phonePos: Vec3;
  /** Unit vector the phone camera points along. */
  phoneFacing: Vec3;
}

export interface Snapshot {
  type: 'snapshot';
  t: number;
  status: LinkStatus;
  raw: { rot: Euler; pos: Vec3 } | null;
  corrected: { rot: Euler; pos: Vec3 } | null;
  plot: PlotFrame | null;
  calibration: CalibrationStatus;
  alerts: Alert[];
}

export type BridgeEvent =
  | { type: 'event'; event: 'calibrationStep'; step: CalibrationStep; prompt: string }
  | { type: 'event'; event: 'captureDone'; point: 'P0' | 'P1' | 'P2' }
  | { type: 'event'; event: 'calibrationResult'; result: CalibrationResult }
  | { type: 'event'; event: 'alert'; alert: Alert };

export type ServerMessage =
  | Snapshot
  | BridgeEvent
  | { type: 'config'; config: Config }
  | { type: 'placements'; active: string; placements: Placement[] }
  | {
      type: 'configResult';
      requestId?: string;
      ok: boolean;
      /** Dotted field path → error message. */
      errors?: Record<string, string>;
    }
  | { type: 'error'; message: string };

const placementName = z.string().trim().min(1).max(64);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('startCalibration') }),
  z.object({ type: z.literal('cancelCalibration') }),
  z.object({ type: z.literal('selectPlacement'), name: placementName }),
  z.object({ type: z.literal('savePlacement'), name: placementName }),
  z.object({ type: z.literal('renamePlacement'), from: placementName, to: placementName }),
  z.object({ type: z.literal('deletePlacement'), name: placementName }),
  z.object({
    type: z.literal('updateConfig'),
    requestId: z.string().optional(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('dismissAlert'),
    id: z.enum(['phoneMoved', 'phoneLost', 'vnyanIdle']),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
