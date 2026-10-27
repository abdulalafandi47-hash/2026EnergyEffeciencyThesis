/**
 * Chart arithmetic: round axis ticks and linear scales. Pure functions, no DOM.
 */
export interface LinearScale {
  /** Data value → pixel. */
  (value: number): number;
  domain: readonly [number, number];
  range: readonly [number, number];
}

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number): number => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0))) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/**
 * Round tick values covering [min, max] with about `count` ticks, using steps
 * of 1, 2, 2.5, 5 × 10ⁿ. The first tick is ≤ min and the last ≥ max, so the
 * axis always contains the data. A zero-width range is widened by ±1.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude);
  const first = Math.floor(min / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; first + i * step < max + step * 0.999 && i < 200; i++) {
    const value = Number((first + i * step).toFixed(10));
    ticks.push(value);
    if (value >= max - 1e-9) break;
  }
  return ticks;
}

/** Tick text without floating-point noise ("0.30000000000000004" → "0.3"). */
export function formatTick(value: number): string {
  return String(Number(value.toFixed(6)));
}
