import { AlertsPanel } from '../panels/AlertsPanel';
import { CalibratePanel } from '../panels/CalibratePanel';
import { PlacementSelect } from '../panels/PlacementsPanel';
import { Dot, overallLevel, statusSummary } from '../panels/StatusBar';
import { useBridge } from '../ws';

export function Dock() {
  const s = useBridge();
  const summary = statusSummary(s);
  return (
    <div className="dockpage">
      <div className="dock-top" title={summary}>
        <Dot level={overallLevel(s)} title={summary} />
        <PlacementSelect s={s} />
      </div>
      <AlertsPanel s={s} />
      <CalibratePanel s={s} compact />
    </div>
  );
}
