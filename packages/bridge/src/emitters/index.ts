import type { Config } from '@offaxis/shared';
import type { Emitter } from './types.js';
import { VmcEmitter } from './vmc.js';
import { VtsEmitter } from './vts.js';

export type { Emitter, EmitterStatus, OutputFrame } from './types.js';

export function createEmitter(cfg: Config['output']): Emitter {
  switch (cfg.mode) {
    case 'vts':
      return new VtsEmitter(cfg);
    case 'vmc':
      return new VmcEmitter(cfg);
  }
}
