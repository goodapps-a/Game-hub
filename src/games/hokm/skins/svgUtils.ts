import { useId } from 'react';

/** Collision-free prefix for SVG ids (gradients, patterns) — safe in `url(#…)`. */
export function useSvgUid(prefix: string): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Points of a regular star polygon (outer/inner radius), as an SVG `points` string. */
export function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  spikes: number,
  rotationDeg = -90
): string {
  const pts: string[] = [];
  const step = Math.PI / spikes;
  let angle = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`);
    angle += step;
  }
  return pts.join(' ');
}

export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Number((cx + Math.cos(a) * r).toFixed(2)), Number((cy + Math.sin(a) * r).toFixed(2))];
}
