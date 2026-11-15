import { EventEmitter } from 'node:events';
import type { Alert, AlertId, Quat, Vec3 } from '@offaxis/shared';
import { angleBetween } from '../math/quat.js';
import { norm, sub } from '../math/vec.js';

export class Alerts extends EventEmitter<{ raised: [Alert] }> {
  private active = new Map<AlertId, Alert>();

  raise(alert: Alert): void {
    const had = this.active.has(alert.id);
    this.active.set(alert.id, alert);
    if (!had) this.emit('raised', alert);
  }

  clear(id: AlertId): void {
    this.active.delete(id);
  }

  list(): Alert[] {
    return [...this.active.values()];
  }
}

export interface PhoneMovedOptions {
  /** Face must be lost at least this long before a jump counts. */
  lostMs: number;
  jumpMetres: number;
  jumpDegrees: number;
}

/**
 * "Phone may have moved": after the face has been lost for a while, compare the first pose seen
 * again with the last one before the loss. A big jump suggests the phone was picked up.
 */
export class PhoneMovedDetector {
  private lastGood: { t: number; pos: Vec3; rot: Quat } | null = null;
  private lostSince: number | null = null;

  constructor(
    private readonly opts: PhoneMovedOptions = { lostMs: 2000, jumpMetres: 0.08, jumpDegrees: 25 },
  ) {}

  /** Returns true when the frame looks like the phone moved. */
  push(t: number, faceFound: boolean, pos: Vec3, rot: Quat): boolean {
    if (!faceFound) {
      this.lostSince ??= t;
      return false;
    }
    let moved = false;
    if (this.lostSince !== null && this.lastGood && t - this.lostSince >= this.opts.lostMs) {
      const dPos = norm(sub(pos, this.lastGood.pos));
      const dRot = (angleBetween(rot, this.lastGood.rot) * 180) / Math.PI;
      moved = dPos > this.opts.jumpMetres || dRot > this.opts.jumpDegrees;
    }
    this.lostSince = null;
    this.lastGood = { t, pos, rot };
    return moved;
  }

  /** A gap in the stream (no packets at all) counts as face lost. */
  markLost(t: number): void {
    this.lostSince ??= t;
  }
}
