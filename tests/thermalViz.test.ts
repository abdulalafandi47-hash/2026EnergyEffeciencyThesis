import { describe, expect, it } from 'vitest';
import { gridSpec, layoutWall, temperatureFraction, THERMAL_STOPS, thermalCss, thermalGradientCss, thermalRgb } from '../src/geometry';
import { linearScale, niceTicks } from '../src/charts';
import { at } from './helpers/helpers';

describe('temperatureFraction', () => {
  it('maps the coldest temperature to 0 and the warmest to 1, linearly', () => {
    expect(temperatureFraction(5, 5, 20)).toBe(0);
    expect(temperatureFraction(20, 5, 20)).toBe(1);
    expect(temperatureFraction(12.5, 5, 20)).toBe(0.5);
    expect(temperatureFraction(8, 5, 20)).toBeCloseTo(0.2, 12);
  });
  it('clamps values outside the range and treats an empty range as the middle', () => {
    expect(temperatureFraction(-50, 5, 20)).toBe(0);
    expect(temperatureFraction(99, 5, 20)).toBe(1);
    expect(temperatureFraction(18, 18, 18)).toBe(0.5);
    expect(temperatureFraction(NaN, 5, 20)).toBe(0.5);
  });
  it('works for heat gain too (outside warmer than inside) and for negative temperatures', () => {
    expect(temperatureFraction(24, 24, 35)).toBe(0);
    expect(temperatureFraction(-3, -3, 21)).toBe(0);
    expect(temperatureFraction(9, -3, 21)).toBe(0.5);
  });
});

describe('thermal colour map', () => {
  it('reproduces its stops exactly', () => {
    for (const [f, r, g, b] of THERMAL_STOPS) expect(thermalRgb(f)).toEqual([r, g, b]);
  });
  it('cold is blue, the middle is neutral grey, warm is red', () => {
    expect(thermalCss(0)).toBe('#3b4cc0');
    expect(thermalCss(0.5)).toBe('#dddddd');
    expect(thermalCss(1)).toBe('#b40426');
  });
  it('interpolates linearly between neighbouring stops', () => {
    const [r, g, b] = thermalRgb(0.125);
    expect([r, g, b]).toEqual([(59 + 141) / 2, (76 + 176) / 2, (192 + 254) / 2]);
  });
  it('clamps out-of-range fractions', () => {
    expect(thermalRgb(-1)).toEqual(thermalRgb(0));
    expect(thermalRgb(7)).toEqual(thermalRgb(1));
  });
  it('is monotonic in "warmth": red minus blue never decreases as the temperature rises', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const [r, , b] = thermalRgb(i / 100);
      expect(r - b).toBeGreaterThanOrEqual(previous);
      previous = r - b;
    }
  });
  it('equal temperatures always get the same colour', () => {
    expect(thermalCss(temperatureFraction(12, 5, 20))).toBe(thermalCss(temperatureFraction(12, 5, 20)));
    expect(thermalCss(temperatureFraction(5, 5, 20))).not.toBe(thermalCss(temperatureFraction(20, 5, 20)));
  });
  it('the colour-bar gradient uses the same stops', () => {
    const css = thermalGradientCss('to right');
    expect(css).toContain('rgb(59, 76, 192) 0%');
    expect(css).toContain('rgb(180, 4, 38) 100%');
    expect(thermalGradientCss('to top')).toMatch(/^linear-gradient\(to top,/);
  });
});

describe('gridSpec', () => {
  const layout = (w: number, h: number) => layoutWall({ widthM: w, heightM: h, layers: [{ id: 'a', name: 'a', thicknessM: 0.1, category: 'Concrete', status: 'illustrative' }] }, { exploded: false, thicknessScale: 1 });
  it('uses round, metric spacing that gives at most 5 cells across the wall\'s longer side', () => {
    expect(gridSpec(layout(3, 2.5)).stepM).toBe(1);
    expect(gridSpec(layout(10, 8)).stepM).toBe(2);
    expect(gridSpec(layout(0.9, 1)).stepM).toBe(0.25);
    expect(gridSpec(layout(40, 3)).stepM).toBe(10);
  });
  it('puts the ground at the bottom of the wall and reaches beyond it on every side', () => {
    const g = gridSpec(layout(3, 2.5));
    expect(g.groundY).toBe(-1.25);
    expect(g.halfExtentM).toBeGreaterThanOrEqual(3 * 1.5);
    expect(Math.abs(g.halfExtentM / g.stepM - Math.round(g.halfExtentM / g.stepM))).toBeLessThan(1e-9); // whole cells
  });
  it('labels the spacing in metres or millimetres', () => {
    expect(gridSpec(layout(3, 2.5)).label).toBe('Grid: 1 m');
    expect(gridSpec(layout(0.4, 0.3)).label).toBe('Grid: 100 mm');
  });
});

describe('chart arithmetic', () => {
  it('niceTicks returns round values that contain the data', () => {
    expect(niceTicks(0, 20, 4)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(5, 20, 5)).toEqual([5, 10, 15, 20]);
    const t = niceTicks(-3, 21, 5);
    expect(at(t, 0)).toBeLessThanOrEqual(-3);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(21);
  });
  it('ticks are evenly spaced and free of floating-point noise', () => {
    const t = niceTicks(0, 0.9, 5);
    expect(t.every((v) => String(v).length < 8)).toBe(true);
    const steps = t.slice(1).map((v, i) => v - at(t, i));
    for (const s of steps) expect(s).toBeCloseTo(at(steps, 0), 9);
  });
  it('handles equal, reversed and bad ranges', () => {
    expect(niceTicks(7, 7).length).toBeGreaterThan(1);
    expect(niceTicks(20, 5, 5)).toEqual(niceTicks(5, 20, 5));
    expect(niceTicks(NaN, 5)).toEqual([]);
  });
  it('linearScale maps the domain onto the range, also reversed (for y axes)', () => {
    const s = linearScale([0, 10], [100, 200]);
    expect([s(0), s(5), s(10)]).toEqual([100, 150, 200]);
    const y = linearScale([0, 10], [300, 20]);
    expect([y(0), y(10)]).toEqual([300, 20]);
    expect(linearScale([4, 4], [0, 10])(4)).toBe(5);
  });
});
