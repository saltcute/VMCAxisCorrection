import { ago } from '../format';
import type { BridgeState } from '../ws';

type Level = 'ok' | 'warn' | 'bad' | 'off';

export function linkLevels(s: BridgeState): {
  bridge: Level;
  phone: Level;
  vnyan: Level;
  face: Level;
} {
  const snap = s.snapshot;
  if (!s.connected || !snap) return { bridge: 'bad', phone: 'off', vnyan: 'off', face: 'off' };
  const st = snap.status;
  const phoneOk = st.phone.packetsPerSec > 0;
  return {
    bridge: 'ok',
    phone: phoneOk ? 'ok' : 'bad',
    vnyan: st.vnyan.requesting ? 'ok' : 'warn',
    face: !phoneOk ? 'off' : st.faceFound ? 'ok' : 'warn',
  };
}

export function overallLevel(s: BridgeState): Level {
  const l = linkLevels(s);
  if (l.bridge === 'bad' || l.phone === 'bad') return 'bad';
  if (l.vnyan === 'warn' || l.face === 'warn') return 'warn';
  return 'ok';
}

export function statusSummary(s: BridgeState): string {
  const snap = s.snapshot;
  if (!s.connected || !snap) return 'Bridge offline';
  const st = snap.status;
  return [
    `Phone (${st.sourceType}): ${st.phone.packetsPerSec} pkt/s, last ${ago(st.phone.lastPacketAt)}`,
    `VNyan (${st.outputMode}): ${st.vnyan.requesting ? `streaming to ${st.vnyan.peers.join(', ')}` : 'not requesting'}`,
    `Face: ${st.faceFound ? 'found' : 'not found'}`,
    `Placement: ${st.activePlacement}`,
  ].join('\n');
}

export function Dot({ level, title }: { level: Level; title?: string }) {
  return (
    <span className={`dot dot-${level}`} role="img" title={title} aria-label={title ?? level} />
  );
}

export function StatusBar({ s }: { s: BridgeState }) {
  const l = linkLevels(s);
  const st = s.snapshot?.status;
  if (!s.connected || !st) {
    return (
      <div className="statusbar">
        <span className="status-item">
          <Dot level="bad" /> Bridge offline, reconnecting…
        </span>
      </div>
    );
  }
  return (
    <div className="statusbar">
      <span className="status-item">
        <Dot level={l.phone} /> Phone ({st.sourceType}): {st.phone.packetsPerSec} pkt/s · last{' '}
        {ago(st.phone.lastPacketAt)}
      </span>
      <span className="status-item" title={st.vnyan.peers.join('\n')}>
        <Dot level={l.vnyan} /> VNyan ({st.outputMode}):{' '}
        {st.vnyan.requesting ? 'streaming' : 'not requesting'}
      </span>
      <span className="status-item">
        <Dot level={l.face} /> Face {st.faceFound ? 'found' : 'not found'}
      </span>
      <span className="status-item">
        Placement: <strong>{st.activePlacement}</strong>
      </span>
    </div>
  );
}
