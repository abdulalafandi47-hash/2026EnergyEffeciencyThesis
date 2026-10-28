/**
 * Sequential colour scale for heat-flux magnitude |q| (W/m²) on the house view:
 * dark blue (low) → green → yellow (high). Linear between the smallest and largest
 * value shown; a single value or a zero range gives the middle colour.
 * Elements without a calculated value are drawn in NOT_CALCULATED_COLOR.
 */
export const FLUX_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 49, 104, 142],
  [0.5, 53, 183, 121],
  [1, 253, 231, 37],
];
export const NOT_CALCULATED_COLOR = '#4a4f57';

export function fluxColor(fraction: number): string {
  const f = Number.isNaN(fraction) ? 0.5 : Math.min(1, Math.max(0, fraction));
  for (let i = 1; i < FLUX_STOPS.length; i++) {
    const [f1, r1, g1, b1] = FLUX_STOPS[i] as readonly [number, number, number, number];
    const [f0, r0, g0, b0] = FLUX_STOPS[i - 1] as readonly [number, number, number, number];
    if (f <= f1) {
      const k = (f - f0) / (f1 - f0);
      const hex = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
      return `#${hex(r0 + (r1 - r0) * k)}${hex(g0 + (g1 - g0) * k)}${hex(b0 + (b1 - b0) * k)}`;
    }
  }
  return '#fde725';
}

export const fluxGradientCss = (): string => `linear-gradient(to right, ${FLUX_STOPS.map(([f, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${f * 100}%`).join(', ')})`;
