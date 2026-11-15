import { type BridgeState, send } from '../ws';

export function AlertsPanel({ s }: { s: BridgeState }) {
  if (!s.connected) {
    return <div className="alert error">Bridge offline. Reconnecting…</div>;
  }
  const alerts = s.snapshot?.alerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div className="alerts">
      {alerts.map((a) => (
        <div key={a.id} className={`alert ${a.level}`}>
          <span>{a.message}</span>
          <span className="alert-actions">
            {a.id === 'phoneMoved' && (
              <button
                type="button"
                className="primary"
                onClick={() => send({ type: 'startCalibration' })}
              >
                Recalibrate
              </button>
            )}
            <button
              type="button"
              onClick={() => send({ type: 'dismissAlert', id: a.id })}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
