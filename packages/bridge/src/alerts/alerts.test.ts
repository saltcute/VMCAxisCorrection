import type { Quat } from '@offaxis/shared';
import { describe, expect, it } from 'vitest';
import { fromAxisAngle } from '../math/quat.js';
import { PhoneMovedDetector } from './alerts.js';

const I: Quat = [0, 0, 0, 1];

describe('PhoneMovedDetector', () => {
  it('flags a large jump after a long face loss', () => {
    const d = new PhoneMovedDetector();
    expect(d.push(0, true, [0, 0, 0.5], I)).toBe(false);
    d.push(100, false, [0, 0, 0], I);
    expect(d.push(2500, true, [0.2, 0, 0.5], I)).toBe(true);
  });

  it('ignores jumps after a short loss', () => {
    const d = new PhoneMovedDetector();
    d.push(0, true, [0, 0, 0.5], I);
    d.push(100, false, [0, 0, 0], I);
    expect(d.push(1000, true, [0.2, 0, 0.5], I)).toBe(false);
  });

  it('ignores small changes after a long loss', () => {
    const d = new PhoneMovedDetector();
    d.push(0, true, [0, 0, 0.5], I);
    d.markLost(100);
    expect(d.push(5000, true, [0.01, 0, 0.5], fromAxisAngle([0, 1, 0], 0.1))).toBe(false);
  });

  it('flags a large rotation jump', () => {
    const d = new PhoneMovedDetector();
    d.push(0, true, [0, 0, 0.5], I);
    d.markLost(100);
    expect(d.push(5000, true, [0, 0, 0.5], fromAxisAngle([0, 1, 0], 1))).toBe(true);
  });
});
