import type { Euler, Vec3 } from '@offaxis/shared';
import type { BridgeState } from '../ws';

const rows: { label: string; get: (p: { rot: Euler; pos: Vec3 }) => number; unit: 'deg' | 'cm' }[] =
  [
    { label: 'Yaw', get: (p) => p.rot.yaw, unit: 'deg' },
    { label: 'Pitch', get: (p) => p.rot.pitch, unit: 'deg' },
    { label: 'Roll', get: (p) => p.rot.roll, unit: 'deg' },
    { label: 'X', get: (p) => p.pos[0], unit: 'cm' },
    { label: 'Y', get: (p) => p.pos[1], unit: 'cm' },
    { label: 'Z', get: (p) => p.pos[2], unit: 'cm' },
  ];

function fmt(v: number | undefined, unit: 'deg' | 'cm') {
  if (v === undefined) return '–';
  return unit === 'deg' ? `${v.toFixed(1)}°` : `${(v * 100).toFixed(1)}`;
}

export function NumbersPanel({ s }: { s: BridgeState }) {
  const raw = s.snapshot?.raw ?? undefined;
  const cor = s.snapshot?.corrected ?? undefined;
  return (
    <section className="panel numbers">
      <h2>Numbers</h2>
      <p className="muted small">
        Phone frame (x right, y up, z toward you). Corrected = what VNyan receives. Positions in cm.
      </p>
      <table>
        <thead>
          <tr>
            <th />
            <th>Raw</th>
            <th>Corrected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>{fmt(raw && r.get(raw), r.unit)}</td>
              <td>{fmt(cor && r.get(cor), r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
