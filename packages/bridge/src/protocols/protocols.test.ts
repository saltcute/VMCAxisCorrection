import { describe, expect, it } from 'vitest';
import { applyFlips, arkitToVtsName, ifmToArkitName, vtsToArkitName } from './axes.js';
import { ifmHeadToCanonical, parseIfm } from './ifacialmocap.js';
import { decodeMessage, encodeMessage } from './osc.js';
import { canonicalToVtsHead, encodeVtsFrame, VtsFrameSchema, vtsHeadToCanonical } from './vts.js';

describe('iFacialMocap', () => {
  const v2 =
    'mouthSmile_R&12|eyeBlink_L&100|jawOpen&3|=head#-21.488958,-6.038993,-6.6019735,-0.030653415,-0.10287084,-0.6584072|rightEye#1.5,-2,0|leftEye#1.25,-2.5,0|';

  it('parses v2 packets', () => {
    const p = parseIfm(v2);
    expect(p.blendshapes).toEqual({ mouthSmileRight: 0.12, eyeBlinkLeft: 1, jawOpen: 0.03 });
    expect(p.head).toEqual([
      -21.488958, -6.038993, -6.6019735, -0.030653415, -0.10287084, -0.6584072,
    ]);
    expect(p.rightEye).toEqual([1.5, -2, 0]);
    expect(p.leftEye).toEqual([1.25, -2.5, 0]);
  });

  it('parses v1 packets', () => {
    const p = parseIfm('eyeBlink_R-55|cheekPuff-0|=head#1,2,3,0.1,0.2,0.3|');
    expect(p.blendshapes).toEqual({ eyeBlinkRight: 0.55, cheekPuff: 0 });
    expect(p.head).toEqual([1, 2, 3, 0.1, 0.2, 0.3]);
  });

  it('ignores malformed parts', () => {
    const p = parseIfm('garbage|=head#1,2|eyeBlink_L&x||');
    expect(p.head).toBeNull();
    expect(p.blendshapes).toEqual({});
  });

  it('maps the head into the canonical frame', () => {
    const h = ifmHeadToCanonical([10, 20, 30, 0.01, 0.02, -0.5]);
    expect(h.rot).toEqual({ yaw: -20, pitch: -10, roll: 30 });
    expect(h.pos).toEqual([0.01, 0.02, 0.5]);
  });
});

describe('VTube Studio', () => {
  it('round-trips the head pose', () => {
    const head = {
      rot: { yaw: 10, pitch: -5, roll: 3 },
      pos: [0.01, -0.02, 0.5] as [number, number, number],
    };
    const back = vtsHeadToCanonical({
      FaceFound: true,
      BlendShapes: [],
      ...canonicalToVtsHead(head),
    });
    expect(back.rot).toEqual(head.rot);
    back.pos.forEach((v, i) => {
      expect(v).toBeCloseTo(head.pos[i]!, 12);
    });
  });

  it('encodes a frame that validates against the schema', () => {
    const json = encodeVtsFrame({
      head: { rot: { yaw: 1, pitch: 2, roll: 3 }, pos: [0, 0, 0.5] },
      blendshapes: { eyeBlinkLeft: 0.5, jawOpen: 0.1 },
      faceFound: true,
      t: 1,
    });
    const f = VtsFrameSchema.parse(JSON.parse(json));
    expect(f.BlendShapes).toEqual([
      { k: 'EyeBlinkLeft', v: 0.5 },
      { k: 'JawOpen', v: 0.1 },
    ]);
    expect(f.Rotation).toEqual({ x: -1, y: -2, z: 3 });
  });
});

describe('names and flips', () => {
  it('converts blendshape names', () => {
    expect(ifmToArkitName('eyeLookIn_L')).toBe('eyeLookInLeft');
    expect(ifmToArkitName('browInnerUp')).toBe('browInnerUp');
    expect(arkitToVtsName('mouthSmileRight')).toBe('MouthSmileRight');
    expect(vtsToArkitName('MouthSmileRight')).toBe('mouthSmileRight');
  });

  it('flips are self-inverse', () => {
    const pose = { rot: { yaw: 1, pitch: 2, roll: 3 }, pos: [4, 5, 6] as [number, number, number] };
    const flips = { posX: true, posY: false, posZ: true, yaw: true, pitch: false, roll: true };
    expect(applyFlips(pose, flips)).toEqual({
      rot: { yaw: -1, pitch: 2, roll: -3 },
      pos: [-4, 5, -6],
    });
    expect(applyFlips(applyFlips(pose, flips), flips)).toEqual(pose);
  });
});

describe('OSC', () => {
  it('round-trips a message', () => {
    const buf = encodeMessage({
      address: '/VMC/Ext/Blend/Val',
      args: ['JawOpen', 0.5, { int: 3 }],
    });
    expect(buf.length % 4).toBe(0);
    expect(decodeMessage(buf)).toEqual({
      address: '/VMC/Ext/Blend/Val',
      args: ['JawOpen', 0.5, { int: 3 }],
    });
  });
});
