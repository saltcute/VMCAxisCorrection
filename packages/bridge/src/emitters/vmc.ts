import type { Socket } from 'node:dgram';
import type { Config, Quat } from '@offaxis/shared';
import { createLogger } from '../log.js';
import { eulerToQuat } from '../math/euler.js';
import { bindUdp, closeUdp } from '../net/udp.js';
import { applyFlips, arkitToVtsName } from '../protocols/axes.js';
import { encodeBundle, type OscMessage } from '../protocols/osc.js';
import type { Emitter, EmitterStatus, OutputFrame } from './types.js';

const log = createLogger('emitter:vmc');

/**
 * Canonical phone-frame rotation → Unity (left-handed: x = avatar right, y up, z = avatar forward).
 * Avatar forward is the user's forward, which is −z in the canonical frame, so this is a reflection
 * of z: (x, y, z, w) → (−x, −y, z, w).
 */
function toUnity(q: Quat): Quat {
  return [-q[0], -q[1], q[2], q[3]];
}

/**
 * EXPERIMENTAL VMC-protocol output: ARKit blendshapes (PascalCase, perfect-sync names) and the
 * Head bone rotation. Body lean from head position is not computed.
 */
export class VmcEmitter implements Emitter {
  readonly kind = 'vmc';
  private sock: Socket | null = null;
  private lastSentAt: number | null = null;

  constructor(private readonly cfg: Config['output']) {}

  async start(): Promise<void> {
    this.sock = await bindUdp(0);
    log.info('sending VMC', { host: this.cfg.vmcHost, port: this.cfg.vmcPort });
  }

  async stop(): Promise<void> {
    await closeUdp(this.sock);
    this.sock = null;
  }

  send(frame: OutputFrame): void {
    if (!this.sock) return;
    const head = applyFlips(frame.head, this.cfg.flip);
    const q = toUnity(eulerToQuat(head.rot));
    const msgs: OscMessage[] = [
      { address: '/VMC/Ext/OK', args: [{ int: frame.faceFound ? 1 : 0 }] },
      { address: '/VMC/Ext/T', args: [frame.t / 1000] },
      ...Object.entries(frame.blendshapes).map(([k, v]) => ({
        address: '/VMC/Ext/Blend/Val',
        args: [arkitToVtsName(k), v],
      })),
      { address: '/VMC/Ext/Blend/Apply', args: [] },
      { address: '/VMC/Ext/Bone/Pos', args: ['Head', 0, 0, 0, q[0], q[1], q[2], q[3]] },
    ];
    this.sock.send(encodeBundle(msgs), this.cfg.vmcPort, this.cfg.vmcHost);
    this.lastSentAt = Date.now();
  }

  status(): EmitterStatus {
    // VMC is fire-and-forget: there is no request to observe, so report "sending".
    const active = this.lastSentAt !== null && Date.now() - this.lastSentAt < 1000;
    return {
      requesting: active,
      peers: [`${this.cfg.vmcHost}:${this.cfg.vmcPort}`],
      lastRequestAt: this.lastSentAt,
    };
  }
}
