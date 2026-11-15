import type { Vec3 } from '@offaxis/shared';
import type { BridgeState } from '../ws';

const SIZE = 240;
const HALF = SIZE / 2;

type Axis = 0 | 1 | 2;

interface ViewSpec {
  title: string;
  /** User-frame axis drawn horizontally, its sign (+1 = increasing to the right) and the
   * [left edge, right edge] labels. */
  h: { axis: Axis; sign: 1 | -1; label: [string, string] };
  /** User-frame axis drawn vertically (+1 = increasing upward), [bottom, top] labels. */
  v: { axis: Axis; sign: 1 | -1; label: [string, string] };
}

// User frame: x = left, y = up, z = forward.
const TOP: ViewSpec = {
  title: 'Top-down (X–Z)',
  h: { axis: 0, sign: -1, label: ['left', 'right'] },
  v: { axis: 2, sign: 1, label: ['back', 'forward'] },
};
const SIDE: ViewSpec = {
  title: 'Side (Y–Z)',
  h: { axis: 2, sign: 1, label: ['back', 'forward'] },
  v: { axis: 1, sign: 1, label: ['down', 'up'] },
};

function project(spec: ViewSpec, p: Vec3, scale: number): [number, number] {
  return [HALF + spec.h.sign * p[spec.h.axis] * scale, HALF - spec.v.sign * p[spec.v.axis] * scale];
}

function polyline(spec: ViewSpec, pts: Vec3[], scale: number): string {
  return pts
    .map((p) =>
      project(spec, p, scale)
        .map((n) => n.toFixed(1))
        .join(','),
    )
    .join(' ');
}

function View({ spec, s, range }: { spec: ViewSpec; s: BridgeState; range: number }) {
  const scale = HALF / range;
  const last = s.trail[s.trail.length - 1]?.plot;
  const raw = s.trail.map((t) => t.plot.raw);
  const cor = s.trail.map((t) => t.plot.corrected);
  const forwardEnd: Vec3 = [0, 0, range * 0.8];
  const [fx, fy] = project(spec, forwardEnd, scale);
  let phone: { at: [number, number]; to: [number, number] } | null = null;
  if (last) {
    const tip: Vec3 = [
      last.phonePos[0] + last.phoneFacing[0] * range * 0.2,
      last.phonePos[1] + last.phoneFacing[1] * range * 0.2,
      last.phonePos[2] + last.phoneFacing[2] * range * 0.2,
    ];
    phone = { at: project(spec, last.phonePos, scale), to: project(spec, tip, scale) };
  }
  const gridStep = range > 0.5 ? 0.2 : 0.1;
  const grid: number[] = [];
  for (let g = gridStep; g < range; g += gridStep) grid.push(g);

  return (
    <figure className="view">
      <figcaption>{spec.title}</figcaption>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={spec.title}>
        <rect x="0" y="0" width={SIZE} height={SIZE} className="plot-bg" />
        {grid.map((g) => (
          <g key={g} className="plot-grid">
            <line x1={HALF + g * scale} y1={0} x2={HALF + g * scale} y2={SIZE} />
            <line x1={HALF - g * scale} y1={0} x2={HALF - g * scale} y2={SIZE} />
            <line x1={0} y1={HALF + g * scale} x2={SIZE} y2={HALF + g * scale} />
            <line x1={0} y1={HALF - g * scale} x2={SIZE} y2={HALF - g * scale} />
          </g>
        ))}
        <line x1={0} y1={HALF} x2={SIZE} y2={HALF} className="plot-axis" />
        <line x1={HALF} y1={0} x2={HALF} y2={SIZE} className="plot-axis" />
        <line
          x1={HALF}
          y1={HALF}
          x2={fx}
          y2={fy}
          className="plot-forward"
          markerEnd="url(#arrow)"
        />
        {phone && (
          <g className="plot-phone">
            <line x1={phone.at[0]} y1={phone.at[1]} x2={phone.to[0]} y2={phone.to[1]} />
            <rect x={phone.at[0] - 5} y={phone.at[1] - 5} width={10} height={10} rx={2} />
          </g>
        )}
        <polyline points={polyline(spec, raw, scale)} className="trail-raw" />
        <polyline points={polyline(spec, cor, scale)} className="trail-corrected" />
        {last && (
          <circle
            cx={project(spec, last.corrected, scale)[0]}
            cy={project(spec, last.corrected, scale)[1]}
            r={4}
            className="head-dot"
          />
        )}
        <text x={4} y={HALF - 4} className="plot-label">
          {spec.h.label[0]}
        </text>
        <text x={SIZE - 4} y={HALF - 4} className="plot-label" textAnchor="end">
          {spec.h.label[1]}
        </text>
        <text x={HALF + 4} y={12} className="plot-label">
          {spec.v.label[1]}
        </text>
        <text x={HALF + 4} y={SIZE - 4} className="plot-label">
          {spec.v.label[0]}
        </text>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="plot-forward-head" />
          </marker>
        </defs>
      </svg>
    </figure>
  );
}

export function LiveView({ s }: { s: BridgeState }) {
  const last = s.trail[s.trail.length - 1]?.plot;
  // Fit the phone in view, with at least ±25 cm around the neutral head.
  const phoneDist = last ? Math.max(...last.phonePos.map(Math.abs)) : 0;
  const range = Math.min(1.5, Math.max(0.25, phoneDist * 1.25));
  return (
    <section className="panel liveview">
      <h2>Live view</h2>
      <p className="muted small">
        Your frame, centred on the neutral head. <span className="swatch raw" /> raw (uncorrected){' '}
        <span className="swatch corrected" /> corrected · ▢ phone · arrow = forward. A straight
        forward lean should draw a vertical line in the corrected trail.
      </p>
      <div className="views">
        <View spec={TOP} s={s} range={range} />
        <View spec={SIDE} s={s} range={range} />
      </div>
    </section>
  );
}
