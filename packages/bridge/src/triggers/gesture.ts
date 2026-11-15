/**
 * Face-gesture trigger: both eyes closed (eyeBlinkLeft and eyeBlinkRight above the threshold) for
 * `holdMs`. Fires once, then re-arms only after the eyes open again.
 */
export class EyesClosedGesture {
  private closedSince: number | null = null;
  private fired = false;

  constructor(
    private threshold: number,
    private holdMs: number,
  ) {}

  configure(threshold: number, holdMs: number): void {
    this.threshold = threshold;
    this.holdMs = holdMs;
  }

  /** Returns true on the frame the gesture completes. */
  push(t: number, faceFound: boolean, blendshapes: Record<string, number>): boolean {
    const closed =
      faceFound &&
      (blendshapes.eyeBlinkLeft ?? 0) > this.threshold &&
      (blendshapes.eyeBlinkRight ?? 0) > this.threshold;
    if (!closed) {
      this.closedSince = null;
      this.fired = false;
      return false;
    }
    this.closedSince ??= t;
    if (!this.fired && t - this.closedSince >= this.holdMs) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
