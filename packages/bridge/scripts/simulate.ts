/**
 * Dev simulator: a fake iFacialMocap phone placed off-axis, plus a fake VNyan VTS client.
 *
 *   npm run simulate -w @offaxis/bridge -- [--yaw 30] [--pitch 10] [--port 49983] [--vts 21412]
 *
 * The user sits at rest, leans straight forward 10 cm, holds, sits back, and loops. With the
 * bridge calibrated, the corrected trail in the Live view should be a vertical line.
 */
import { createSocket } from 'node:dgram';
import { parseArgs } from 'node:util';
import type { Vec3 } from '@offaxis/shared';
import { quatToEuler } from '../src/math/euler.js';
import { R_STRAIGHT } from '../src/math/frame.js';
import { mul, mulVec, transpose } from '../src/math/mat3.js';
import { conj, fromAxisAngle, fromMat3, mul as qmul, toMat3 } from '../src/math/quat.js';
import { add } from '../src/math/vec.js';

const { values } = parseArgs({
  options: {
    yaw: { type: 'string', default: '30' },
    pitch: { type: 'string', default: '10' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '49983' },
    vts: { type: 'string', default: '21412' },
    noise: { type: 'string', default: '0.0005' },
  },
});
const D2R = Math.PI / 180;
const yaw = Number(values.yaw) * D2R;
const pitch = Number(values.pitch) * D2R;
const noise = Number(values.noise);

// Phone offset in the user frame (yaw about up, then pitch about the phone's level x axis).
const O = toMat3(qmul(fromAxisAngle([0, 1, 0], yaw), fromAxisAngle([1, 0, 0], pitch)));
const R = mul(O, R_STRAIGHT);
const Rt = transpose(R);
const qR = fromMat3(R);
const rest: Vec3 = [0, 0, 0.55];
// At rest the user faces the monitor: the nose points along user-forward, i.e. H0 = Rᵀ·R_straight.
const h0 = fromMat3(mul(Rt, R_STRAIGHT));

/** User-frame head offset over a 6 s loop. */
function userPos(t: number): Vec3 {
  const p = t % 6;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const lean = p < 2 ? 0 : p < 3 ? ease(p - 2) : p < 4.5 ? 1 : ease(1 - (p - 4.5) / 1.0);
  return [0, 0, 0.1 * lean];
}

const jitter = () => (Math.random() - 0.5) * noise;
const sock = createSocket('udp4');
const port = Number(values.port);
const vtsPort = Number(values.vts);
let received = 0;

sock.bind(0, () => {
  const myPort = sock.address().port;
  console.log(`fake phone → ${values.host}:${port} (yaw ${values.yaw}°, pitch ${values.pitch}°)`);
  console.log(`fake VNyan requesting VTS frames from ${values.host}:${vtsPort} on :${myPort}`);
  const t0 = Date.now();

  setInterval(() => {
    const t = (Date.now() - t0) / 1000;
    const u = userPos(t);
    const pos = add(mulVec(Rt, [u[0] + jitter(), u[1] + jitter(), u[2] + jitter()]), rest);
    const turn = fromAxisAngle([0, 1, 0], 0.15 * Math.sin(t * 0.7));
    const h = quatToEuler(qmul(qmul(qmul(conj(qR), turn), qR), h0));
    // Canonical → iFacialMocap (inverse of ifmHeadToCanonical).
    const head = [-h.pitch, h.yaw, -h.roll, -pos[0], pos[1], -pos[2]].map((v) => v.toFixed(6));
    const blink = Math.round(50 + 50 * Math.sin(t * 3));
    const msg = `eyeBlink_L&${blink}|eyeBlink_R&${blink}|jawOpen&10|=head#${head.join(',')}|rightEye#0,0,0|leftEye#0,0,0|`;
    sock.send(msg, port, values.host);
  }, 1000 / 60);

  const request = () =>
    sock.send(
      JSON.stringify({
        messageType: 'iOSTrackingDataRequest',
        time: 2,
        sentBy: 'FakeVNyan',
        ports: [myPort],
      }),
      vtsPort,
      values.host,
    );
  request();
  setInterval(request, 1000);
  setInterval(() => {
    console.log(`fake VNyan received ${received} frames in the last 5 s`);
    received = 0;
  }, 5000);
});

sock.on('message', (msg) => {
  if (msg[0] === 0x7b /* '{' */) received++;
});
