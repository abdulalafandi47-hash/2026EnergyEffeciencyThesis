import { describe, expect, it } from 'vitest';
import { calculateTemperatureProfile, EngineInputError } from '../src/engine';
import type { ProfileLayer } from '../src/engine';
import { at, expectClose, issuesOf } from './helpers/helpers';

/** Case A layers as profile input: R = 0.03, 0.2, 2.0, 0.025. */
const LAYERS: ProfileLayer[] = [
  { name: 'Plaster', thicknessM: 0.015, resistanceM2KPerW: 0.03 },
  { name: 'Masonry', thicknessM: 0.2, resistanceM2KPerW: 0.2 },
  { name: 'Insulation', thicknessM: 0.08, resistanceM2KPerW: 2.0 },
  { name: 'Render', thicknessM: 0.02, resistanceM2KPerW: 0.025 },
];
const R_SI = 0.13;
const R_SE = 0.04;

describe('calculateTemperatureProfile', () => {
  it('hand-derived values for case A (20 °C inside, 5 °C outside)', () => {
    // q = 15 / 2.425 = 6.185567 W/m², so each drop is q × R:
    //   inside film 0.804124, plaster 0.185567, masonry 1.237113,
    //   insulation 12.371134, render 0.154639, outside film 0.247423.
    const t = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5).map((p) => p.temperatureC);
    expect(t[0]).toBe(20);
    expect(t[1]).toBeCloseTo(19.195876, 5);
    expect(t[2]).toBeCloseTo(19.010309, 5);
    expect(t[3]).toBeCloseTo(17.773196, 5);
    expect(t[4]).toBeCloseTo(5.402062, 5);
    expect(t[5]).toBeCloseTo(5.247423, 5);
    expect(t[6]).toBe(5);
  });

  it('returns layers + 3 points in the right order with the right kinds', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    expect(points).toHaveLength(LAYERS.length + 3);
    expect(points.map((p) => p.kind)).toEqual([
      'inside-air',
      'inside-surface',
      'interface',
      'interface',
      'interface',
      'outside-surface',
      'outside-air',
    ]);
  });

  it('positions are cumulative thicknesses, starting at the interior face', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    const positions = points.map((p) => p.positionM);
    expectClose(at(positions, 0), 0);
    expectClose(at(positions, 1), 0);
    expectClose(at(positions, 2), 0.015);
    expectClose(at(positions, 3), 0.215);
    expectClose(at(positions, 4), 0.295);
    expectClose(at(positions, 5), 0.315);
    expectClose(at(positions, 6), 0.315);
  });

  it('labels interfaces with the two layers that meet there', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    expect(at(points, 2).label).toBe('Plaster | Masonry');
    expect(at(points, 4).label).toBe('Insulation | Render');
  });

  it('the drop across each element is proportional to its resistance (the physical rule)', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    const total = 20 - 5;
    const rTotal = R_SI + 0.03 + 0.2 + 2.0 + 0.025 + R_SE;
    // Six elements in series: inside film, four layers, outside film. Each one's
    // temperature drop is the difference between two consecutive profile points.
    const resistances = [R_SI, 0.03, 0.2, 2.0, 0.025, R_SE];
    const temps = points.map((p) => p.temperatureC);
    const drops = resistances.map((_, i) => at(temps, i) - at(temps, i + 1));
    drops.forEach((drop, i) => {
      expectClose(drop / total, at(resistances, i) / rTotal, 1e-12);
    });
    expectClose(drops.reduce((a, b) => a + b, 0), total);
  });

  it('the insulation takes by far the largest share of the temperature drop', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    const insulationDrop = at(points, 3).temperatureC - at(points, 4).temperatureC;
    expect(insulationDrop / 15).toBeGreaterThan(0.8);
  });

  it('decreases monotonically from inside to outside when heat flows outward', () => {
    const t = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5).map((p) => p.temperatureC);
    for (let i = 1; i < t.length; i++) {
      expect(at(t, i)).toBeLessThanOrEqual(at(t, i - 1));
    }
  });

  it('increases monotonically when heat flows inward (outside warmer)', () => {
    const t = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 24, 35).map((p) => p.temperatureC);
    for (let i = 1; i < t.length; i++) {
      expect(at(t, i)).toBeGreaterThanOrEqual(at(t, i - 1));
    }
    expect(at(t, 1)).toBeGreaterThan(24); // inside surface is warmer than inside air
  });

  it('is flat when both sides are at the same temperature', () => {
    const t = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 18, 18).map((p) => p.temperatureC);
    t.forEach((value) => expect(value).toBe(18));
  });

  it('handles sub-zero temperatures', () => {
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 21, -3);
    const t = points.map((p) => p.temperatureC);
    expect(Math.min(...t)).toBe(-3);
    expect(Math.max(...t)).toBe(21);
    expect(at(t, 5)).toBeLessThan(0);
  });

  it('stays between the two air temperatures', () => {
    const t = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5).map((p) => p.temperatureC);
    t.forEach((value) => {
      expect(value).toBeLessThanOrEqual(20);
      expect(value).toBeGreaterThanOrEqual(5);
    });
  });

  it('the outside surface temperature agrees whether computed from inside or outside', () => {
    // Walking in from the inside air and walking in from the outside air must meet.
    const points = calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, 5);
    const q = (20 - 5) / (R_SI + 0.03 + 0.2 + 2.0 + 0.025 + R_SE);
    expectClose(at(points, 5).temperatureC, 20 - q * (R_SI + 0.03 + 0.2 + 2.0 + 0.025));
  });

  it('works for a single layer', () => {
    const points = calculateTemperatureProfile([at(LAYERS, 1)], R_SI, R_SE, 20, 10);
    expect(points.map((p) => p.kind)).toEqual(['inside-air', 'inside-surface', 'outside-surface', 'outside-air']);
  });

  it('a larger insulation resistance pushes the inside surface closer to the indoor temperature', () => {
    const thin = [...LAYERS.slice(0, 2), { ...at(LAYERS, 2), resistanceM2KPerW: 1.0 }, at(LAYERS, 3)];
    const thick = [...LAYERS.slice(0, 2), { ...at(LAYERS, 2), resistanceM2KPerW: 4.0 }, at(LAYERS, 3)];
    const tSurfaceThin = at(calculateTemperatureProfile(thin, R_SI, R_SE, 20, 5), 1).temperatureC;
    const tSurfaceThick = at(calculateTemperatureProfile(thick, R_SI, R_SE, 20, 5), 1).temperatureC;
    expect(tSurfaceThick).toBeGreaterThan(tSurfaceThin);
  });

  describe('invalid input', () => {
    it('rejects an empty layer list', () => {
      expect(issuesOf(() => calculateTemperatureProfile([], R_SI, R_SE, 20, 5))[0]?.code).toBe('no-layers');
    });
    it('rejects zero or negative thickness and resistance', () => {
      expect(() => calculateTemperatureProfile([{ name: 'x', thicknessM: 0, resistanceM2KPerW: 1 }], R_SI, R_SE, 20, 5)).toThrow(EngineInputError);
      expect(() => calculateTemperatureProfile([{ name: 'x', thicknessM: 0.1, resistanceM2KPerW: 0 }], R_SI, R_SE, 20, 5)).toThrow(EngineInputError);
      expect(() => calculateTemperatureProfile([{ name: 'x', thicknessM: -0.1, resistanceM2KPerW: 1 }], R_SI, R_SE, 20, 5)).toThrow(EngineInputError);
    });
    it('rejects invalid surface resistances and temperatures', () => {
      expect(() => calculateTemperatureProfile(LAYERS, -1, R_SE, 20, 5)).toThrow(EngineInputError);
      expect(() => calculateTemperatureProfile(LAYERS, R_SI, NaN, 20, 5)).toThrow(EngineInputError);
      expect(() => calculateTemperatureProfile(LAYERS, R_SI, R_SE, NaN, 5)).toThrow(EngineInputError);
      expect(() => calculateTemperatureProfile(LAYERS, R_SI, R_SE, 20, -400)).toThrow(EngineInputError);
    });
  });
});
