import type { Vec3 } from '@offaxis/shared';

/** Sliding window of positions; reports spread (RMS distance from the mean) and the mean. */
export class StillnessWindow {
  private samples: { t: number; p: Vec3 }[] = [];

  constructor(private windowMs: number) {}

  setWindow(ms: number): void {
    this.windowMs = ms;
  }

  reset(): void {
    this.samples = [];
  }

  push(t: number, p: Vec3): void {
    this.samples.push({ t, p });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 1 && (this.samples[0] as { t: number }).t < cutoff) {
      this.samples.shift();
    }
  }

  /** True once the window holds at least ~90% of its span and three samples. */
  full(): boolean {
    if (this.samples.length < 3) return false;
    const first = this.samples[0] as { t: number };
    const last = this.samples[this.samples.length - 1] as { t: number };
    return last.t - first.t >= this.windowMs * 0.9;
  }

  mean(): Vec3 {
    const n = this.samples.length || 1;
    const m: Vec3 = [0, 0, 0];
    for (const { p } of this.samples) {
      m[0] += p[0];
      m[1] += p[1];
      m[2] += p[2];
    }
    return [m[0] / n, m[1] / n, m[2] / n];
  }

  /** RMS distance from the mean, metres. Infinity until there are samples. */
  spread(): number {
    if (this.samples.length === 0) return Number.POSITIVE_INFINITY;
    const m = this.mean();
    let sum = 0;
    for (const { p } of this.samples) {
      sum += (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2 + (p[2] - m[2]) ** 2;
    }
    return Math.sqrt(sum / this.samples.length);
  }
}
