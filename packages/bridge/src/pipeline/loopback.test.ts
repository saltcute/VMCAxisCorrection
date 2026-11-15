import { createSocket, type Socket } from 'node:dgram';
import { defaultConfig } from '@offaxis/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { VtsEmitter } from '../emitters/vts.js';
import { identityPlacement } from '../math/frame.js';
import { bindUdp, closeUdp } from '../net/udp.js';
import { HANDSHAKE } from '../protocols/ifacialmocap.js';
import { VtsFrameSchema } from '../protocols/vts.js';
import { IFacialMocapSource } from '../sources/ifacialmocap.js';
import { Pipeline } from './pipeline.js';

const sockets: Socket[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  for (const s of sockets.splice(0)) await closeUdp(s);
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createSocket('udp4');
    s.bind(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function nextMessage(sock: Socket, timeoutMs = 2000): Promise<{ text: string; port: number }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    sock.once('message', (msg, rinfo) => {
      clearTimeout(t);
      resolve({ text: msg.toString('utf8'), port: rinfo.port });
    });
  });
}

describe('loopback: fake iFacialMocap phone → bridge → fake VNyan', () => {
  it('passes a frame through with the identity placement', async () => {
    const [ifmPort, phonePort, vtsPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const cfg = defaultConfig();
    cfg.source.phoneIp = '127.0.0.1';
    cfg.source.ifmPort = ifmPort;
    cfg.output.vtsPort = vtsPort;

    const phone = await bindUdp(phonePort, '127.0.0.1');
    const vnyan = await bindUdp(0, '127.0.0.1');
    sockets.push(phone, vnyan);

    const pipeline = new Pipeline(identityPlacement());
    const source = new IFacialMocapSource(cfg.source, phonePort);
    source.on('frame', (f) => pipeline.onFrame(f));
    const emitter = new VtsEmitter(cfg.output);
    pipeline.attachEmitter(emitter);
    const handshake = nextMessage(phone);
    await source.start();
    await emitter.start();
    cleanups.push(
      () => source.stop(),
      () => emitter.stop(),
    );

    // 1. The bridge handshakes with the phone.
    const hs = await handshake;
    expect(hs.text).toBe(HANDSHAKE);

    // 2. VNyan asks the "phone" (the bridge) for data.
    const vnyanPort = vnyan.address().port;
    vnyan.send(
      JSON.stringify({
        messageType: 'iOSTrackingDataRequest',
        time: 2,
        sentBy: 'VNyan',
        ports: [vnyanPort],
      }),
      vtsPort,
      '127.0.0.1',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(emitter.status().requesting).toBe(true);

    // 3. The phone streams a frame; VNyan receives it in VTS format.
    const received = nextMessage(vnyan);
    phone.send(
      'eyeBlink_L&80|jawOpen&25|=head#10,-20,5,0.01,-0.02,-0.55|rightEye#1,2,3|leftEye#4,5,6|',
      ifmPort,
      '127.0.0.1',
    );
    const frame = VtsFrameSchema.parse(JSON.parse((await received).text));
    expect(frame.FaceFound).toBe(true);
    expect(frame.BlendShapes).toEqual([
      { k: 'EyeBlinkLeft', v: 0.8 },
      { k: 'JawOpen', v: 0.25 },
    ]);
    // iFM (rx, ry, rz) = (10, −20, 5) → canonical (yaw 20, pitch −10, roll 5) → VTS (x, y, z).
    expect(frame.Rotation.x).toBeCloseTo(20, 6);
    expect(frame.Rotation.y).toBeCloseTo(-10, 6);
    expect(frame.Rotation.z).toBeCloseTo(5, 6);
    expect(frame.Position.z).toBeCloseTo(55, 6);
    expect(frame.EyeLeft).toEqual({ x: 4, y: 5, z: 6 });
  });
});
