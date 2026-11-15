import { AlertsPanel } from '../panels/AlertsPanel';
import { CalibratePanel } from '../panels/CalibratePanel';
import { LiveView } from '../panels/LiveView';
import { NumbersPanel } from '../panels/NumbersPanel';
import { PlacementsPanel } from '../panels/PlacementsPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { StatusBar } from '../panels/StatusBar';
import { useBridge } from '../ws';

export function Full() {
  const s = useBridge();
  return (
    <div className="full">
      <header>
        <h1>Off-Axis Bridge</h1>
        <a
          href="/dock"
          className="muted small"
          title="Compact layout for an OBS custom browser dock"
        >
          Dock layout →
        </a>
      </header>
      <StatusBar s={s} />
      <AlertsPanel s={s} />
      <main className="columns">
        <div className="col">
          <CalibratePanel s={s} />
          <LiveView s={s} />
          <NumbersPanel s={s} />
        </div>
        <div className="col">
          <PlacementsPanel s={s} />
          <SettingsPanel s={s} />
        </div>
      </main>
    </div>
  );
}
