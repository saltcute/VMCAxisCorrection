import { describe, expect, it } from 'vitest';
import { EyesClosedGesture } from './gesture.js';

const closed = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.95 };
const open = { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 };

describe('EyesClosedGesture', () => {
  it('fires once after both eyes are closed long enough', () => {
    const g = new EyesClosedGesture(0.8, 2000);
    const fires = [0, 500, 1000, 1999, 2000, 2500, 4000].map((t) => g.push(t, true, closed));
    expect(fires).toEqual([false, false, false, false, true, false, false]);
  });

  it('re-arms after the eyes open', () => {
    const g = new EyesClosedGesture(0.8, 1000);
    g.push(0, true, closed);
    expect(g.push(1000, true, closed)).toBe(true);
    g.push(1100, true, open);
    g.push(1200, true, closed);
    expect(g.push(2200, true, closed)).toBe(true);
  });

  it('needs both eyes', () => {
    const g = new EyesClosedGesture(0.8, 1000);
    g.push(0, true, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 });
    expect(g.push(3000, true, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 })).toBe(false);
  });
});
