import type { EventEmitter } from 'node:events';
import type { TrackingFrame } from '@offaxis/shared';

export type SourceEvents = { frame: [TrackingFrame] };

/** A phone tracking app the bridge receives from. Frames are in the canonical phone frame. */
export interface TrackingSource extends EventEmitter<SourceEvents> {
  readonly kind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
