/**
 * Temperature → colour for the thermal overlay.
 *
 * This is a VISUAL ENCODING of numbers the calculation engine already
 * produced; it creates no data. The mapping is linear: a temperature's
 * position between the coldest and warmest temperature in the wall
 * (fraction 0…1) picks a colour from a blue → light grey → red
 * ("cool-warm") scale. Two equal temperatures always have the same colour,
 * and the colour bar shown on screen is this same function.
 *
 * Within one layer the engine's temperature varies linearly with position
 * (steady-state conduction), and the overlay samples that line.
 */
export type Rgb = readonly [number, number, number];

/** Colour stops: [fraction, red, green, blue] with channels 0–255. */
export const THERMAL_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 59, 76, 192],
  [0.25, 141, 176, 254],
  [0.5, 221, 221, 221],
  [0.75, 244, 154, 123],
  [1, 180, 4, 38],
];

const clamp01 = (x: number): number => (Number.isNaN(x) ? 0.5 : Math.min(1, Math.max(0, x)));

/** Position of `temperatureC` between `minC` and `maxC` (0 = coldest, 1 = warmest). A zero range gives 0.5. */
export function temperatureFraction(temperatureC: number, minC: number, maxC: number): number {
  if (!(maxC > minC)) return 0.5;
  return clamp01((temperatureC - minC) / (maxC - minC));
}

/** Colour for a fraction 0…1, as RGB with channels 0–255 (linear interpolation between stops). */
export function thermalRgb(fraction: number): Rgb {
  const f = clamp01(fraction);
  for (let i = 1; i < THERMAL_STOPS.length; i++) {
    const [f1, r1, g1, b1] = THERMAL_STOPS[i] as readonly [number, number, number, number];
    const [f0, r0, g0, b0] = THERMAL_STOPS[i - 1] as readonly [number, number, number, number];
    if (f <= f1) {
      const k = (f - f0) / (f1 - f0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  const last = THERMAL_STOPS[THERMAL_STOPS.length - 1] as readonly [number, number, number, number];
  return [last[1], last[2], last[3]];
}

const hex = (v: number): string => Math.round(v).toString(16).padStart(2, '0');

/** `#rrggbb` for a fraction 0…1. */
export function thermalCss(fraction: number): string {
  const [r, g, b] = thermalRgb(fraction);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** CSS gradient for the colour bar (cold on the left/bottom, warm on the right/top). */
export function thermalGradientCss(direction: 'to right' | 'to top' = 'to right'): string {
  return `linear-gradient(${direction}, ${THERMAL_STOPS.map(([f, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${f * 100}%`).join(', ')})`;
}
