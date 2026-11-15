import { z } from 'zod';

const port = z.number().int().min(1).max(65535);

export const SourceConfigSchema = z
  .object({
    /** Which phone app the bridge receives from. */
    type: z.enum(['ifacialmocap', 'vts']).default('ifacialmocap'),
    /** LAN IP of the phone running the tracking app. */
    phoneIp: z.string().min(1).default('192.168.1.50'),
    /** iFacialMocap: UDP port on both phone and PC (the protocol uses the same one). */
    ifmPort: port.default(49983),
    /** VTS input: local UDP port the phone streams to (must differ from output.vtsPort). */
    vtsReceivePort: port.default(21413),
  })
  .prefault({});

export const OutputConfigSchema = z
  .object({
    /** `vts` impersonates the VTube Studio iPhone app; `vmc` sends OSC to a VMC receiver layer. */
    mode: z.enum(['vts', 'vmc']).default('vts'),
    /** UDP port the impersonated VTS phone app answers requests on. */
    vtsPort: port.default(21412),
    vmcHost: z.string().min(1).default('127.0.0.1'),
    vmcPort: port.default(39540),
    /** Multiplier applied to emitted head position (bridge-internal unit is metres). */
    positionScale: z.number().positive().max(1000).default(1),
  })
  .prefault({});

export const CalibrationConfigSchema = z
  .object({
    /** Add the optional "lean left" step (P2) instead of assuming the phone is upright. */
    threePoint: z.boolean().default(false),
    /** Max position standard deviation (metres) over the window to count as holding still. */
    stillnessThreshold: z.number().positive().max(0.1).default(0.004),
    stillnessWindowMs: z.number().int().min(100).max(3000).default(400),
    /** Minimum displacement from P0 (metres) for a lean to count. */
    minLeanDistance: z.number().positive().max(1).default(0.06),
    stepTimeoutMs: z.number().int().min(2000).max(60000).default(10000),
  })
  .prefault({});

export const TriggersConfigSchema = z
  .object({
    hotkeyEnabled: z.boolean().default(false),
    /** e.g. `Ctrl+Alt+C`. Modifiers: Ctrl, Alt, Shift, Meta. */
    hotkey: z
      .string()
      .regex(
        /^((Ctrl|Alt|Shift|Meta)\+)*[A-Za-z0-9]$|^((Ctrl|Alt|Shift|Meta)\+)*F([1-9]|1[0-2])$/,
        {
          message: 'Use modifiers + one key, e.g. Ctrl+Alt+C',
        },
      )
      .default('Ctrl+Alt+C'),
    gestureEnabled: z.boolean().default(false),
    gestureThreshold: z.number().min(0.1).max(1).default(0.8),
    gestureHoldMs: z.number().int().min(500).max(10000).default(2000),
  })
  .prefault({});

export const VnyanConfigSchema = z
  .object({
    /** Fire VNyan node-graph triggers over VNyan's WebSocket on calibration success/failure. */
    enabled: z.boolean().default(false),
    url: z.string().url().default('ws://127.0.0.1:8000/vnyan'),
    successTrigger: z.string().default('offaxis_calibrated'),
    failureTrigger: z.string().default('offaxis_calibration_failed'),
  })
  .prefault({});

export const ServerConfigSchema = z
  .object({
    /** `127.0.0.1` by default; `0.0.0.0` (or allowLan) exposes the UI to the LAN. No auth. */
    bindHost: z.string().min(1).default('127.0.0.1'),
    allowLan: z.boolean().default(false),
    uiPort: port.default(8787),
  })
  .prefault({});

export const ConfigSchema = z
  .object({
    source: SourceConfigSchema,
    output: OutputConfigSchema,
    calibration: CalibrationConfigSchema,
    triggers: TriggersConfigSchema,
    vnyan: VnyanConfigSchema,
    server: ServerConfigSchema,
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((c, ctx) => {
    if (c.source.type === 'vts' && c.source.vtsReceivePort === c.output.vtsPort) {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'vtsReceivePort'],
        message: 'Must differ from output.vtsPort',
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

/** Deep-partial shape accepted by `updateConfig`. */
export type ConfigPatch = {
  [K in keyof Config]?: Config[K] extends object ? Partial<Config[K]> : Config[K];
};

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}
