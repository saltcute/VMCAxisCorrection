import type { Config } from '@offaxis/shared';
import { useEffect, useMemo, useState } from 'react';
import { type BridgeState, clearConfigResult, send } from '../ws';

type Field =
  | { path: string; label: string; kind: 'text'; hint?: string }
  | {
      path: string;
      label: string;
      kind: 'number';
      /** Displayed value = stored value × factor (e.g. metres shown as cm). */
      factor?: number;
      unit?: string;
      step?: number;
      hint?: string;
    }
  | { path: string; label: string; kind: 'bool'; hint?: string }
  | { path: string; label: string; kind: 'select'; options: string[]; hint?: string };

const flips = (prefix: 'source' | 'output'): Field[] =>
  (['posX', 'posY', 'posZ', 'yaw', 'pitch', 'roll'] as const).map((k) => ({
    path: `${prefix}.flip.${k}`,
    label: `Flip ${k}`,
    kind: 'bool' as const,
  }));

const SECTIONS: { title: string; fields: Field[]; note?: string }[] = [
  {
    title: 'Phone input',
    fields: [
      {
        path: 'source.type',
        label: 'Tracking app',
        kind: 'select',
        options: ['ifacialmocap', 'vts'],
      },
      { path: 'source.phoneIp', label: 'Phone IP', kind: 'text' },
      { path: 'source.ifmPort', label: 'iFacialMocap port', kind: 'number', step: 1 },
      {
        path: 'source.vtsReceivePort',
        label: 'VTS input: local receive port',
        kind: 'number',
        step: 1,
      },
    ],
  },
  {
    title: 'Output to VNyan',
    fields: [
      {
        path: 'output.mode',
        label: 'Output mode',
        kind: 'select',
        options: ['vts', 'vmc'],
        hint: 'vts: point VNyan’s “VTube Studio” phone tracker at this bridge. vmc: experimental.',
      },
      { path: 'output.vtsPort', label: 'VTS phone port', kind: 'number', step: 1 },
      {
        path: 'output.vtsReplyHost',
        label: 'VNyan IP (optional)',
        kind: 'text',
        hint: 'Leave empty unless the bridge runs behind NAT (Docker with published ports).',
      },
      { path: 'output.vmcHost', label: 'VMC host', kind: 'text' },
      { path: 'output.vmcPort', label: 'VMC port', kind: 'number', step: 1 },
      { path: 'output.positionScale', label: 'Position scale', kind: 'number', step: 0.1 },
    ],
  },
  {
    title: 'Calibration',
    fields: [
      { path: 'calibration.threePoint', label: 'Three-point mode (also lean left)', kind: 'bool' },
      {
        path: 'calibration.levelFromArc',
        label: 'Level from the lean’s curve',
        kind: 'bool',
        hint: 'Lean naturally: the head’s dip is measured and removed. Off: lean at a constant height.',
      },
      {
        path: 'calibration.stillnessThreshold',
        label: 'Stillness threshold',
        kind: 'number',
        factor: 1000,
        unit: 'mm',
        step: 0.5,
      },
      {
        path: 'calibration.stillnessWindowMs',
        label: 'Stillness window',
        kind: 'number',
        unit: 'ms',
        step: 50,
      },
      {
        path: 'calibration.minLeanDistance',
        label: 'Minimum lean distance',
        kind: 'number',
        factor: 100,
        unit: 'cm',
        step: 0.5,
      },
      {
        path: 'calibration.stepTimeoutMs',
        label: 'Step timeout',
        kind: 'number',
        factor: 0.001,
        unit: 's',
        step: 1,
      },
    ],
  },
  {
    title: 'Triggers',
    fields: [
      {
        path: 'triggers.hotkeyEnabled',
        label: 'Global hotkey',
        kind: 'bool',
        hint: 'Windows/X11 only. Off in Docker.',
      },
      { path: 'triggers.hotkey', label: 'Hotkey', kind: 'text', hint: 'e.g. Ctrl+Alt+C' },
      { path: 'triggers.gestureEnabled', label: 'Eyes-closed gesture', kind: 'bool' },
      {
        path: 'triggers.gestureThreshold',
        label: 'Gesture blink threshold',
        kind: 'number',
        step: 0.05,
      },
      {
        path: 'triggers.gestureHoldMs',
        label: 'Gesture hold',
        kind: 'number',
        factor: 0.001,
        unit: 's',
        step: 0.5,
      },
    ],
  },
  {
    title: 'VNyan feedback',
    fields: [
      { path: 'vnyan.enabled', label: 'Fire VNyan triggers', kind: 'bool' },
      { path: 'vnyan.url', label: 'VNyan WebSocket URL', kind: 'text' },
      { path: 'vnyan.successTrigger', label: 'On success', kind: 'text' },
      { path: 'vnyan.failureTrigger', label: 'On failure', kind: 'text' },
    ],
  },
  {
    title: 'Web UI server',
    note: 'Changing these restarts the web server. Reload the page at the new address.',
    fields: [
      { path: 'server.bindHost', label: 'Bind host', kind: 'text' },
      {
        path: 'server.allowLan',
        label: 'Allow LAN access',
        kind: 'bool',
        hint: 'No authentication. Keep it on your LAN only.',
      },
      { path: 'server.uiPort', label: 'UI port', kind: 'number', step: 1 },
      {
        path: 'logLevel',
        label: 'Log level',
        kind: 'select',
        options: ['debug', 'info', 'warn', 'error'],
      },
    ],
  },
  {
    title: 'Axis flips: phone input (advanced)',
    note: 'Fix the sign of what the phone sends. Check against the Raw column of the Numbers panel; see docs/protocols.md.',
    fields: flips('source'),
  },
  {
    title: 'Axis flips: output to VNyan (advanced)',
    note: 'Fix the sign of what VNyan receives. Only change these after the input flips are right.',
    fields: flips('output'),
  },
];

type Json = Record<string, unknown>;

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Json | undefined)?.[k], obj);
}

function setPath(obj: Json, path: string, value: unknown): Json {
  const [head, ...rest] = path.split('.') as [string, ...string[]];
  if (rest.length === 0) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath((obj[head] as Json) ?? {}, rest.join('.'), value) };
}

/** Round away float noise from the display factor (0.004 × 1000 = 4.000000000000001). */
const display = (v: number, factor = 1) => Number((v * factor).toPrecision(10));

function FieldInput({
  f,
  value,
  onChange,
}: {
  f: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (f.kind) {
    case 'bool':
      return (
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      );
    case 'select':
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'text':
      return (
        <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'number': {
      const factor = f.factor ?? 1;
      return (
        <span className="row">
          <input
            type="number"
            step={f.step}
            value={typeof value === 'number' ? display(value, factor) : ''}
            onChange={(e) =>
              onChange(e.target.value === '' ? Number.NaN : Number(e.target.value) / factor)
            }
          />
          {f.unit && <span className="muted">{f.unit}</span>}
        </span>
      );
    }
  }
}

export function SettingsPanel({ s }: { s: BridgeState }) {
  const [draft, setDraft] = useState<Config | null>(s.config);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Follow server config while there are no local edits.
  useEffect(() => {
    if (!dirty) setDraft(s.config);
  }, [s.config, dirty]);

  const result = s.configResult;
  useEffect(() => {
    if (result?.ok) {
      setDirty(false);
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [result]);

  const errors = useMemo(() => (result && !result.ok ? (result.errors ?? {}) : {}), [result]);

  if (!draft) return null;

  const update = (path: string, v: unknown) => {
    setDraft((d) => (d ? (setPath(d as unknown as Json, path, v) as unknown as Config) : d));
    setDirty(true);
    setSaved(false);
  };

  return (
    <section className="panel settings">
      <h2>Settings</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          clearConfigResult();
          // NaN from an emptied number field becomes null, which the schema rejects with a message.
          const patch = JSON.parse(JSON.stringify(draft, (_k, v) => (Number.isNaN(v) ? null : v)));
          send({ type: 'updateConfig', requestId: String(Date.now()), patch });
        }}
      >
        {SECTIONS.map((sec) => (
          <fieldset key={sec.title}>
            <legend>{sec.title}</legend>
            {sec.note && <p className="muted small">{sec.note}</p>}
            <div className={sec.title.startsWith('Axis') ? 'grid flips' : 'grid'}>
              {sec.fields.map((f) => {
                const err = errors[f.path];
                return (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the control is rendered by FieldInput
                  <label
                    key={f.path}
                    className={`field ${err ? 'invalid' : ''} ${f.kind === 'bool' ? 'bool' : ''}`}
                  >
                    <span className="field-label">{f.label}</span>
                    <FieldInput
                      f={f}
                      value={getPath(draft, f.path)}
                      onChange={(v) => update(f.path, v)}
                    />
                    {f.hint && <span className="muted small">{f.hint}</span>}
                    {err && <span className="error-text">{err}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        {result && !result.ok && (
          <p className="error-text">
            Not saved. Fix the highlighted fields.
            {Object.entries(errors)
              .filter(([k]) => !SECTIONS.some((sec) => sec.fields.some((f) => f.path === k)))
              .map(([k, v]) => ` ${k}: ${v}`)
              .join(';')}
          </p>
        )}
        <div className="row sticky-actions">
          <button type="submit" className="primary" disabled={!dirty || !s.connected}>
            Save settings
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              setDraft(s.config);
              setDirty(false);
              clearConfigResult();
            }}
          >
            Discard changes
          </button>
          {saved && <span className="ok-text">Saved and applied.</span>}
        </div>
      </form>
    </section>
  );
}
