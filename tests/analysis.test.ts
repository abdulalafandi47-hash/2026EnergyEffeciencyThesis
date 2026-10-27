import { describe, expect, it } from 'vitest';
import { analyzeWall, describeDirection, profileForChart, swapLayerMaterial, sweepLayerThickness, sweepOutsideTemperature } from '../src/analysis';
import { customSurfaceResistances } from '../src/engine';
import { BUILT_IN_MATERIALS, findMaterialById, materialToLayer } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import referenceData from './fixtures/reference-cases.json';
import { at, expectClose, INSULATION, PLASTER, referenceWall } from './helpers/helpers';

const ok = (wall = referenceWall()) => {
  const outcome = analyzeWall(wall);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.analysis;
};
const material = (id: string): MaterialRecord => findMaterialById(BUILT_IN_MATERIALS, id) as MaterialRecord;

describe('analyzeWall', () => {
  it('returns the engine\'s numbers unchanged (case A: U = 40/97, Q = 4500/97 W)', () => {
    const a = ok();
    expectClose(a.result.uValueWPerM2K, 40 / 97);
    expectClose(a.result.heatTransfer.magnitudeW, 4500 / 97);
    expect(a.result.heatTransfer.direction).toBe('outward');
  });

  it('layer temperatures match the independent reference profile (all four cases)', () => {
    for (const c of referenceData.cases) {
      const wall = {
        layers: c.input.layers.map((l) => ({ ...l })),
        widthM: c.input.widthM,
        heightM: c.input.heightM,
        surfaceResistances: customSurfaceResistances(c.input.surfaceResistances.insideM2KPerW, c.input.surfaceResistances.outsideM2KPerW, 'horizontal', 'reference'),
        conditions: { ...c.input.conditions },
      };
      const a = ok(wall);
      const t = c.expected.temperatureProfile; // [air, inside surface, interfaces…, outside surface, air]
      a.layerTemperatures.forEach((lt, i) => {
        expectClose(lt.startC, at(t, 1 + i).temperatureC, 1e-12);
        expectClose(lt.endC, at(t, 2 + i).temperatureC, 1e-12);
      });
    }
  });

  it('layers join up: each layer starts at the temperature where the previous one ended', () => {
    const lt = ok().layerTemperatures;
    for (let i = 1; i < lt.length; i++) expectClose(at(lt, i).startC, at(lt, i - 1).endC, 1e-12);
  });

  it('the drops across the layers plus the two surface films add up to the air-to-air difference', () => {
    const a = ok();
    const layerDrops = a.layerTemperatures.reduce((s, l) => s + l.dropK, 0);
    const profile = a.result.temperatureProfile;
    const films = at(profile, 0).temperatureC - at(profile, 1).temperatureC + (at(profile, profile.length - 2).temperatureC - at(profile, profile.length - 1).temperatureC);
    expectClose(layerDrops + films, 15);
  });

  it('the insulation takes the largest drop; drops are positive for heat loss and negative for heat gain', () => {
    const loss = ok().layerTemperatures;
    expect(loss.every((l) => l.dropK > 0)).toBe(true);
    expect(loss[2]?.dropK).toBe(Math.max(...loss.map((l) => l.dropK)));
    const gain = ok(referenceWall({ conditions: { insideTemperatureC: 24, outsideTemperatureC: 35, durationHours: 12 } })).layerTemperatures;
    expect(gain.every((l) => l.dropK < 0)).toBe(true);
  });

  it('temperature range spans from the cold side to the warm side', () => {
    expect(ok().temperatureRangeC).toEqual({ minC: 5, maxC: 20 });
    expect(ok(referenceWall({ conditions: { insideTemperatureC: 24, outsideTemperatureC: 35, durationHours: 1 } })).temperatureRangeC).toEqual({ minC: 24, maxC: 35 });
  });

  it('flags use of unverified data only when layers say so', () => {
    expect(ok().usesUnverifiedData).toBe(false); // test layers carry no status
    const dbWall = referenceWall({ layers: [materialToLayer(material('gypsum-plaster'), 0.015), materialToLayer(material('eps-slab'), 0.08)] });
    expect(ok(dbWall).usesUnverifiedData).toBe(true);
    expect(ok(dbWall).result.warnings.map((w) => w.code)).toContain('layer-properties-not-verified');
  });

  it('turns engine errors into a message instead of throwing', () => {
    const outcome = analyzeWall(referenceWall({ widthM: -1 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.message).toContain('widthM');
  });

  it('zero temperature difference gives zero heat flow and a flat profile', () => {
    const a = ok(referenceWall({ conditions: { insideTemperatureC: 18, outsideTemperatureC: 18, durationHours: 24 } }));
    expect(a.result.heatTransfer.magnitudeW).toBe(0);
    expect(a.layerTemperatures.every((l) => l.startC === 18 && l.endC === 18 && l.dropK === 0)).toBe(true);
  });
});

describe('describeDirection', () => {
  it('states loss, gain and none in words, never as a negative number', () => {
    expect(describeDirection('outward')).toContain('heat loss');
    expect(describeDirection('inward')).toContain('heat gain');
    expect(describeDirection('none')).toContain('no steady-state heat flow');
  });
});

describe('profileForChart', () => {
  it('gives the profile points and one band per layer covering the wall thickness exactly', () => {
    const data = profileForChart(ok());
    expect(data.points.map((p) => p.kind)).toEqual(['inside-air', 'inside-surface', 'interface', 'interface', 'interface', 'outside-surface', 'outside-air']);
    expect(data.bands).toHaveLength(4);
    expect(at(data.bands, 0).x0M).toBe(0);
    expectClose(at(data.bands, 3).x1M, 0.315, 1e-12);
    for (let i = 1; i < data.bands.length; i++) expectClose(at(data.bands, i).x0M, at(data.bands, i - 1).x1M, 1e-12);
    expectClose(data.totalThicknessM, 0.315, 1e-12);
  });
});

describe('sweepLayerThickness (e.g. insulation 40 / 80 / 120 mm)', () => {
  const wall = referenceWall();
  const cmp = sweepLayerThickness(wall, 2, [0.04, 0.08, 0.12]);

  it('lists the current wall first, then each variant, naming what changed', () => {
    expect(cmp.variants.map((v) => v.label)).toEqual(['Current', '40 mm', '80 mm', '120 mm']);
    expect(at(cmp.variants, 0).changed).toBe('');
    expect(at(cmp.variants, 1).changed).toContain('Insulation (test): thickness 40 mm (instead of 80 mm)');
  });

  it('U decreases and resistance increases as the insulation gets thicker', () => {
    const u = cmp.variants.map((v) => v.uValueWPerM2K);
    expect(u[1]).toBeGreaterThan(u[2] as number);
    expect(u[2]).toBeGreaterThan(u[3] as number);
    const r = cmp.variants.map((v) => v.totalResistanceM2KPerW);
    expect(r[1]).toBeLessThan(r[2] as number);
    expect(r[2]).toBeLessThan(r[3] as number);
  });

  it('matches hand calculations: 40 mm → R_total 1.425 (U 0.7018), 120 mm → 3.425', () => {
    expectClose(at(cmp.variants, 1).totalResistanceM2KPerW, 1.425, 1e-12);
    expectClose(at(cmp.variants, 1).uValueWPerM2K, 1 / 1.425, 1e-12);
    expectClose(at(cmp.variants, 3).totalResistanceM2KPerW, 3.425, 1e-12);
  });

  it('a variant equal to the current wall changes nothing, and percentages are relative to the current wall', () => {
    expect(at(cmp.variants, 2).deltaUPercent).toBeCloseTo(0, 10);
    expect(at(cmp.variants, 2).deltaHeatTransferPercent).toBeCloseTo(0, 10);
    expectClose(at(cmp.variants, 3).deltaUPercent as number, ((1 / 3.425) / (1 / 2.425) - 1) * 100, 1e-9);
    expect(at(cmp.variants, 0).deltaUPercent).toBeNull();
  });

  it('holds area, temperatures, duration and surface resistances constant (so Q changes only through U)', () => {
    for (const v of cmp.variants) expectClose(v.heatTransferW / v.uValueWPerM2K, 7.5 * 15, 1e-9);
    expect(cmp.heldConstant.join(' ')).toContain('Surface resistances');
  });

  it('heat capacity grows with the extra material and is reported per area and in total', () => {
    expectClose(at(cmp.variants, 3).arealHeatCapacityJPerM2K as number, 457600 + 30 * 1500 * 0.04, 1e-9);
    expectClose(at(cmp.variants, 3).totalHeatCapacityJPerK as number, (457600 + 1800) * 7.5, 1e-9);
  });

  it('an impossible value is reported for that variant only', () => {
    const c = sweepLayerThickness(wall, 2, [0.06, 0, -0.02]);
    expect(c.variants.map((v) => v.ok)).toEqual([true, true, false, false]);
    expect(at(c.variants, 2).error).toContain('thicknessM');
    expect(Number.isNaN(at(c.variants, 2).uValueWPerM2K)).toBe(true);
    expect(at(c.variants, 2).deltaUPercent).toBeNull();
  });

  it('does not modify the wall it was given', () => {
    const before = JSON.stringify(wall);
    sweepLayerThickness(wall, 2, [0.2]);
    expect(JSON.stringify(wall)).toBe(before);
  });

  it('rejects a layer index outside the wall', () => {
    expect(() => sweepLayerThickness(wall, 7, [0.1])).toThrow(RangeError);
    expect(() => sweepLayerThickness(wall, -1, [0.1])).toThrow(RangeError);
  });
});

describe('swapLayerMaterial (e.g. EPS vs mineral wool vs XPS)', () => {
  const dbWall = referenceWall({ layers: [PLASTER, { ...INSULATION, name: 'EPS', lambdaWPerMK: 0.035 }].map((l) => ({ ...l })) });
  const cmp = swapLayerMaterial(dbWall, 1, ['eps-slab', 'xps-board', 'mineral-wool-slab', 'polyurethane-board'].map(material));

  it('keeps the layer thickness and replaces only the material, naming the change', () => {
    expect(cmp.variants).toHaveLength(5);
    expect(at(cmp.variants, 2).changed).toContain('Extruded polystyrene (XPS) board (demonstration) instead of EPS (same thickness, 80 mm)');
  });

  it('a lower conductivity at equal thickness gives a lower U-value (PUR < XPS < EPS < mineral wool)', () => {
    const u = (label: string) => cmp.variants.find((v) => v.label.startsWith(label))?.uValueWPerM2K as number;
    expect(u('Polyurethane')).toBeLessThan(u('Extruded'));
    expect(u('Extruded')).toBeLessThan(u('Expanded'));
    expect(u('Expanded')).toBeLessThan(u('Mineral'));
  });

  it('matches a hand calculation for mineral wool: R = 0.03 + 0.08/0.037 + 0.17', () => {
    const wool = cmp.variants.find((v) => v.label.startsWith('Mineral')) as (typeof cmp.variants)[number];
    expectClose(wool.totalResistanceM2KPerW, 0.03 + 0.08 / 0.037 + 0.17, 1e-12);
  });

  it('marks variants that use illustrative data', () => {
    expect(at(cmp.variants, 1).usesUnverifiedData).toBe(true);
    expect(at(cmp.variants, 0).usesUnverifiedData).toBe(false);
  });

  it('a material without density gives no heat capacity (null, never zero)', () => {
    const noCp: MaterialRecord = { ...material('eps-slab'), id: 'bare', name: 'Bare', status: 'user-defined', valueType: 'unspecified', source: { type: 'none', citation: 'user' } };
    delete (noCp as { densityKgPerM3?: number }).densityKgPerM3;
    const c = swapLayerMaterial(dbWall, 1, [noCp]);
    expect(at(c.variants, 1).ok).toBe(true);
    expect(at(c.variants, 1).arealHeatCapacityJPerM2K).toBeNull();
    expect(at(c.variants, 1).totalHeatCapacityJPerK).toBeNull();
    expect(at(c.variants, 0).arealHeatCapacityJPerM2K).not.toBeNull();
  });
});

describe('sweepOutsideTemperature', () => {
  const cmp = sweepOutsideTemperature(referenceWall(), [-5, 5, 30]);

  it('Q is proportional to the temperature difference; U does not change', () => {
    const base = at(cmp.variants, 0);
    expectClose(at(cmp.variants, 1).heatTransferW, base.heatTransferW * (25 / 15), 1e-12); // outside −5 → ΔT 25
    expectClose(at(cmp.variants, 2).heatTransferW, base.heatTransferW, 1e-12); // outside 5 = current
    expect(cmp.variants.every((v) => v.uValueWPerM2K === base.uValueWPerM2K)).toBe(true);
  });

  it('shows the direction separately: 30 °C outside means heat gain, with a positive magnitude', () => {
    const hot = at(cmp.variants, 3);
    expect(hot.direction).toBe('inward');
    expect(hot.heatTransferW).toBeGreaterThan(0);
    expectClose(hot.deltaHeatTransferPercent as number, (10 / 15 - 1) * 100, 1e-9);
  });

  it('percentages are relative to the current wall and the change is described in °C', () => {
    expectClose(at(cmp.variants, 1).deltaHeatTransferPercent as number, (25 / 15 - 1) * 100, 1e-9);
    expect(at(cmp.variants, 1).changed).toBe('Outside air -5 °C (instead of 5 °C), inside 20 °C');
  });

  it('equal temperatures give zero heat transfer with direction "none"', () => {
    const c = sweepOutsideTemperature(referenceWall(), [20]);
    expect(at(c.variants, 1)).toMatchObject({ heatTransferW: 0, direction: 'none' });
  });
});
