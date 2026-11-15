import type { Config } from '@offaxis/shared';
import { IFacialMocapSource } from './ifacialmocap.js';
import type { TrackingSource } from './types.js';
import { VtsSource } from './vts.js';

export type { TrackingSource } from './types.js';

export function createSource(cfg: Config['source']): TrackingSource {
  switch (cfg.type) {
    case 'ifacialmocap':
      return new IFacialMocapSource(cfg);
    case 'vts':
      return new VtsSource(cfg);
  }
}
