import type { CalibrationStatus } from '@offaxis/shared';
import { cm, deg } from '../format';
import { type BridgeState, send } from '../ws';

function Meter({
  value,
  max,
  good,
  label,
}: {
  value: number;
  max: number;
  good: boolean;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" title={label}>
      <div className={`meter-fill ${good ? 'good' : ''}`} style={{ width: `${pct}%` }} />
      <span className="meter-label">{label}</span>
    </div>
  );
}

function StepMeters({ c }: { c: CalibrationStatus }) {
  if (c.step === 'idle') return null;
  const still = c.stillness < c.stillnessThreshold;
  const stillLabel = `Stillness ${(c.stillness * 1000).toFixed(1)} mm (need < ${(c.stillnessThreshold * 1000).toFixed(1)} mm)`;
  return (
    <div className="meters">
      <Meter
        value={Math.max(0, c.stillnessThreshold * 3 - c.stillness)}
        max={c.stillnessThreshold * 3}
        good={still}
        label={stillLabel}
      />
      {c.step !== 'waitStillRest' && (
        <Meter
          value={c.leanDistance}
          max={c.minLeanDistance * 1.5}
          good={c.leanDistance >= c.minLeanDistance}
          label={`Lean ${cm(c.leanDistance)} (need ≥ ${cm(c.minLeanDistance)})`}
        />
      )}
      <div className="muted small">
        {c.paused
          ? 'Paused: face not found'
          : `Step times out in ${(c.timeRemainingMs / 1000).toFixed(1)} s`}
      </div>
    </div>
  );
}

export function CalibratePanel({ s, compact = false }: { s: BridgeState; compact?: boolean }) {
  const c = s.snapshot?.calibration;
  const active = !!c && c.step !== 'idle';
  const r = c?.lastResult ?? null;
  return (
    <section className="panel calibrate">
      {!compact && <h2>Calibrate</h2>}
      <div className="row">
        <button
          type="button"
          className="primary big"
          disabled={!s.connected}
          onClick={() => send({ type: 'startCalibration' })}
        >
          {active ? 'Restart' : 'Calibrate'}
        </button>
        <button
          type="button"
          className="big"
          disabled={!active}
          onClick={() => send({ type: 'cancelCalibration' })}
        >
          Cancel
        </button>
      </div>
      {c && <p className={`prompt ${active ? 'active' : ''}`}>{c.prompt}</p>}
      {c && <StepMeters c={c} />}
      {r && !active && (
        <div className={`result ${r.ok ? 'ok' : 'fail'}`}>
          {r.ok ? (
            <>
              <strong>Calibrated</strong> “{r.placement}” · phone yaw {deg(r.yawOffsetDeg)}, pitch{' '}
              {deg(r.pitchOffsetDeg)}
              {!compact && <>, roll {deg(r.rollOffsetDeg)}</>} · lean {cm(r.leanDistance)}
            </>
          ) : (
            <>
              <strong>Failed:</strong> {r.reason}
            </>
          )}
        </div>
      )}
    </section>
  );
}
