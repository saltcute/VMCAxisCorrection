export const deg = (v: number | undefined) => (v === undefined ? '–' : `${v.toFixed(1)}°`);
export const cm = (m: number | undefined) => (m === undefined ? '–' : `${(m * 100).toFixed(1)} cm`);

export function ago(t: number | null, now = Date.now()): string {
  if (t === null) return 'never';
  const s = (now - t) / 1000;
  if (s < 1) return 'just now';
  if (s < 60) return `${s.toFixed(0)} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}
