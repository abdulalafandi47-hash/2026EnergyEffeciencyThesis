/**
 * Building-envelope model and calculations, checked against hand calculations.
 *
 * Synthetic test materials (clean numbers, NOT real data):
 *   P plaster λ 0.5, ρ 1200, c 1000 · M masonry λ 1.0, ρ 2000, c 1000 · I insulation λ 0.04, ρ 30, c 1500 · R render λ 0.8, ρ 1800, c 1000
 * Layers P 15 mm + M 200 mm + I 80 mm + R 20 mm → Σ d/λ = 0.03 + 0.2 + 2.0 + 0.025 = 2.255 m²·K/W.
 */
import { describe, expect, it } from 'vitest';
import { calculateWall, iso6946Preset } from '../src/engine';
import {
  addComponent,
  calculateComponent,
  calculateEnvelope,
  canAdd,
  checkModel,
  createBlankProject,
  createExampleHouse,
  deleteComponent,
  dependentsOf,
  dimensionsOf,
  duplicateComponent,
  heatFlowForSurfaces,
  setVisible,
  surfaceResistancesFor,
  updateComponent,
} from '../src/envelope';
import type { BuildingProject, Component, Construction, DocumentedValue, Door, ExteriorWall, Glazing } from '../src/envelope';
import { BUILT_IN_MATERIALS, createCustomMaterial } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import { at, expectClose } from './helpers/helpers';

const mat = (name: string, lambda: number, rho: number, c: number): MaterialRecord =>
  ({ ...createCustomMaterial({ name, lambdaWPerMK: lambda, densityKgPerM3: rho, specificHeatJPerKgK: c, sourceNote: 'synthetic test value' }).material, id: `t-${name}` });
const MATERIALS = [mat('p', 0.5, 1200, 1000), mat('m', 1.0, 2000, 1000), mat('i', 0.04, 30, 1500), mat('r', 0.8, 1800, 1000)];
const LAYERS_R = 0.03 + 0.2 + 2.0 + 0.025; // Σ d/λ
const AREAL_C = 1200 * 1000 * 0.015 + 2000 * 1000 * 0.2 + 30 * 1500 * 0.08 + 1800 * 1000 * 0.02; // J/(m²·K)
const construction = (): Construction => ({ layers: [['t-p', 0.015], ['t-m', 0.2], ['t-i', 0.08], ['t-r', 0.02]].map(([materialId, thicknessM]) => ({ materialId: materialId as string, thicknessM: thicknessM as number })) });
const documented = (value: number, unit = 'W/(m²·K)', source = 'synthetic test datasheet'): DocumentedValue => ({ value, unit, source, valueType: 'declared', status: 'user-defined' });

/** A 10 × 8 × 3 m box with whatever components are given; inside 20 °C, outside 0 °C, 10 h. */
function project(components: Component[], conditions: Partial<BuildingProject['conditions']> = {}): BuildingProject {
  return {
    name: 'test', isExample: false,
    geometry: { lengthM: 10, depthM: 8, heightM: 3 },
    conditions: { insideC: 20, outsideC: 0, durationH: 10, label: 'test', ...conditions },
    components, nextId: 100,
  };
}
const wall = (id: string, side: ExteriorWall['side'], exposure: ExteriorWall['exposure'] = { kind: 'outside' }): ExteriorWall => ({ id, type: 'exterior-wall', name: `${side} wall`, visible: true, side, exposure, construction: construction() });
const glazing = (id: string, hostId: string, offsetM: number, uValue: DocumentedValue | null, extra: Partial<Glazing> = {}): Glazing => ({ id, type: 'window', name: `window ${id}`, visible: true, hostId, offsetM, sillM: 1, widthM: 1.5, heightM: 1.2, uValue, gValue: null, shadingFactor: null, ...extra });
const result = (p: BuildingProject, id: string) => {
  const c = p.components.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return calculateComponent(p, c, MATERIALS);
};

describe('dimensions and areas', () => {
  it('north/south walls run along the length, east/west along the depth; roof and floor cover the footprint; a partition spans the depth', () => {
    const p = project([wall('n', 'north'), wall('e', 'east'), { id: 'r', type: 'roof', name: 'roof', visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: construction() }, { id: 'pt', type: 'partition', name: 'pt', visible: true, positionM: 4, exposure: { kind: 'conditioned' }, construction: construction() }]);
    expect(dimensionsOf(p, at(p.components, 0)).grossAreaM2).toBe(30); // 10 × 3
    expect(dimensionsOf(p, at(p.components, 1)).grossAreaM2).toBe(24); // 8 × 3
    expect(dimensionsOf(p, at(p.components, 2)).grossAreaM2).toBe(80); // 10 × 8
    expect(dimensionsOf(p, at(p.components, 3)).grossAreaM2).toBe(24); // 8 × 3
  });

  it("a wall's net area is its gross area minus the openings in it", () => {
    const p = project([wall('s', 'south'), glazing('w1', 's', 1, null), glazing('w2', 's', 5, null)]);
    const d = dimensionsOf(p, at(p.components, 0));
    expectClose(d.openingsAreaM2, 2 * 1.5 * 1.2, 1e-12);
    expectClose(d.netAreaM2, 30 - 3.6, 1e-12);
    expectClose(dimensionsOf(p, at(p.components, 1)).netAreaM2, 1.8, 1e-12);
  });
});

describe('model checks', () => {
  const issuesFor = (p: BuildingProject, id: string | null): string => checkModel(p).filter((i) => i.componentId === id).map((i) => i.message).join(' | ');

  it('openings must fit inside their wall, not overlap, and have a host wall', () => {
    expect(issuesFor(project([wall('s', 'south'), glazing('w', 's', 9, null)]), 'w')).toMatch(/does not fit along its wall/); // 9 + 1.5 > 10
    expect(issuesFor(project([wall('s', 'south'), glazing('w', 's', -0.1, null)]), 'w')).toMatch(/negative offset/);
    expect(issuesFor(project([wall('s', 'south'), glazing('w', 's', 1, null, { sillM: 2 })]), 'w')).toMatch(/storey height/); // 2 + 1.2 > 3
    expect(issuesFor(project([wall('s', 'south'), glazing('a', 's', 1, null), glazing('b', 's', 2, null)]), 'b')).toMatch(/overlaps/);
    expect(issuesFor(project([wall('s', 'south'), glazing('a', 's', 1, null), glazing('b', 's', 2.5, null)]), 'b')).toBe(''); // touching edges is fine
    expect(issuesFor(project([glazing('w', 'nowhere', 1, null)]), 'w')).toMatch(/exterior wall/);
    expect(issuesFor(project([wall('s', 'south'), glazing('w', 's', 8.5, null)]), 'w')).toBe(''); // exactly fits: 8.5 + 1.5 = 10
  });

  it('one wall per side, one roof, one floor; partitions inside the house; exposures that make sense', () => {
    expect(issuesFor(project([wall('a', 'south'), wall('b', 'south')]), 'b')).toMatch(/already has an exterior wall/);
    const roof = (id: string): Component => ({ id, type: 'roof', name: id, visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: construction() });
    expect(issuesFor(project([roof('r1'), roof('r2')]), 'r2')).toMatch(/one roof/);
    expect(issuesFor(project([{ id: 'pt', type: 'partition', name: 'pt', visible: true, positionM: 10, exposure: { kind: 'conditioned' }, construction: construction() }]), 'pt')).toMatch(/inside the house/);
    expect(issuesFor(project([wall('a', 'south', { kind: 'ground' })]), 'a')).toMatch(/not a possible exposure/);
    expect(issuesFor(project([wall('a', 'south', { kind: 'conditioned' })]), 'a')).toMatch(/not a possible exposure/);
  });

  it('impossible house dimensions stop every calculation', () => {
    const p = { ...project([wall('s', 'south')]), geometry: { lengthM: 0, depthM: 8, heightM: 3 } };
    expect(issuesFor(p, null)).toMatch(/greater than zero/);
    const env = calculateEnvelope(p, MATERIALS);
    expect(env.components.every((c) => c.status === 'invalid')).toBe(true);
    expect(env.netHeatFlowW).toBe(0);
  });
});

describe('surface resistances depend on the element and the direction of heat flow', () => {
  it('walls horizontal; roof up when the inside is warmer, down when cooler; floors the reverse', () => {
    expect(heatFlowForSurfaces('exterior-wall', 10)).toBe('horizontal');
    expect(heatFlowForSurfaces('exterior-wall', -10)).toBe('horizontal');
    expect(heatFlowForSurfaces('roof', 10)).toBe('upwards');
    expect(heatFlowForSurfaces('roof', -10)).toBe('downwards');
    expect(heatFlowForSurfaces('floor', 10)).toBe('downwards');
    expect(heatFlowForSurfaces('floor', -10)).toBe('upwards');
    expect(heatFlowForSurfaces('roof', 0)).toBe('upwards'); // no flow: the heat-loss direction is shown
  });

  it('outdoor air uses R_se; an unconditioned space uses R_si on both sides; all are labelled unverified', () => {
    expect(surfaceResistancesFor('exterior-wall', 5, 'outside')).toMatchObject({ insideM2KPerW: 0.13, outsideM2KPerW: 0.04, status: 'unverified' });
    expect(surfaceResistancesFor('exterior-wall', 5, 'unconditioned')).toMatchObject({ insideM2KPerW: 0.13, outsideM2KPerW: 0.13, status: 'unverified' });
    expect(surfaceResistancesFor('roof', -5, 'outside')).toMatchObject({ insideM2KPerW: 0.17, outsideM2KPerW: 0.04 });
    expect(surfaceResistancesFor('floor', 5, 'unconditioned')).toMatchObject({ insideM2KPerW: 0.17, outsideM2KPerW: 0.17 });
    expect(surfaceResistancesFor('floor', 5, 'unconditioned').basis).toMatch(/BOTH sides/);
  });
});

describe('opaque elements against hand calculations', () => {
  it('exterior wall to outdoor air: U = 1 / (0.13 + 2.255 + 0.04), Q = U·A·ΔT, positive = heat loss', () => {
    const r = result(project([wall('s', 'south')]), 's');
    const u = 1 / (0.13 + LAYERS_R + 0.04);
    expect(r.status).toBe('calculated');
    expectClose(r.uValueWPerM2K ?? NaN, u, 1e-12);
    expectClose(r.heatFlowW ?? NaN, u * 30 * 20, 1e-12);
    expect(r.direction).toBe('outward');
    expectClose(r.heatCapacity?.totalJPerK ?? NaN, AREAL_C * 30, 1e-9);
    expectClose(r.layersResistanceM2KPerW ?? NaN, LAYERS_R, 1e-12);
  });

  it('heat gain (outside hotter) gives a negative heat flow of the same magnitude for a wall', () => {
    const loss = result(project([wall('s', 'south')], { insideC: 26, outsideC: 16 }), 's');
    const gain = result(project([wall('s', 'south')], { insideC: 26, outsideC: 36 }), 's');
    expect(gain.direction).toBe('inward');
    expectClose(gain.heatFlowW ?? NaN, -(loss.heatFlowW ?? NaN), 1e-12);
  });

  it('roof: R_si 0.10 for heat loss, 0.17 for heat gain, so U differs with the direction', () => {
    const roof: Component = { id: 'r', type: 'roof', name: 'roof', visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: construction() };
    const winter = result(project([roof]), 'r');
    const summer = result(project([roof], { insideC: 26, outsideC: 35 }), 'r');
    expectClose(winter.uValueWPerM2K ?? NaN, 1 / (0.1 + LAYERS_R + 0.04), 1e-12);
    expectClose(summer.uValueWPerM2K ?? NaN, 1 / (0.17 + LAYERS_R + 0.04), 1e-12);
    expectClose(summer.heatFlowW ?? NaN, -(1 / (0.17 + LAYERS_R + 0.04)) * 80 * 9, 1e-12);
    expect(winter.surface?.heatFlow).toBe('upwards');
    expect(summer.surface?.heatFlow).toBe('downwards');
    // The engine's "vertical wall" warning must not appear for a roof.
    expect(summer.engine?.warnings.some((w) => w.code === 'surface-resistance-orientation')).toBe(false);
    expect(summer.reasons.join(' ')).toMatch(/sol-air/);
  });

  it('floor over outdoor air (e.g. pilotis): R_si 0.17 for heat loss, 0.10 for heat gain', () => {
    const floor: Component = { id: 'f', type: 'floor', name: 'floor', visible: true, exposure: { kind: 'outside' }, construction: construction() };
    expectClose(result(project([floor]), 'f').uValueWPerM2K ?? NaN, 1 / (0.17 + LAYERS_R + 0.04), 1e-12);
    expectClose(result(project([floor], { insideC: 26, outsideC: 35 }), 'f').uValueWPerM2K ?? NaN, 1 / (0.1 + LAYERS_R + 0.04), 1e-12);
  });

  it('a wall to an unconditioned space uses that space’s temperature and R_si on both sides', () => {
    const missingT = result(project([wall('n', 'north', { kind: 'unconditioned', temperatureC: null })]), 'n');
    expect(missingT.status).toBe('missing-data');
    const r = result(project([wall('n', 'north', { kind: 'unconditioned', temperatureC: 12 })]), 'n');
    const u = 1 / (0.13 + LAYERS_R + 0.13);
    expectClose(r.uValueWPerM2K ?? NaN, u, 1e-12);
    expectClose(r.heatFlowW ?? NaN, u * 30 * (20 - 12), 1e-12);
    expect(r.deltaTK).toBe(8);
  });

  it('a ground-contact floor is NOT calculated, but its layer resistance and heat capacity are shown', () => {
    const floor: Component = { id: 'f', type: 'floor', name: 'slab', visible: true, exposure: { kind: 'ground' }, construction: construction() };
    const r = result(project([floor]), 'f');
    expect(r.status).toBe('unsupported');
    expect(r.reasons.join(' ')).toMatch(/EN ISO 13370/);
    expect(r.uValueWPerM2K).toBeNull();
    expect(r.heatFlowW).toBeNull();
    expectClose(r.layersResistanceM2KPerW ?? NaN, LAYERS_R, 1e-12);
    expectClose(r.heatCapacity?.totalJPerK ?? NaN, AREAL_C * 80, 1e-9);
  });

  it('a partition between conditioned rooms is excluded from heat transfer, but counts as thermal mass', () => {
    const p = project([{ id: 'pt', type: 'partition', name: 'pt', visible: true, positionM: 5, exposure: { kind: 'conditioned' }, construction: construction() }]);
    const r = result(p, 'pt');
    expect(r.status).toBe('excluded');
    expect(r.heatFlowW).toBeNull();
    const env = calculateEnvelope(p, MATERIALS);
    expect(env.netHeatFlowW).toBe(0);
    expectClose(env.heatCapacityJPerK, AREAL_C * 24, 1e-9);
  });

  it('missing layers, materials or thicknesses are reported as missing; unknown materials and zero thickness as invalid', () => {
    const w = (c: Construction): BuildingProject => project([{ ...wall('s', 'south'), construction: c }]);
    expect(result(w({ layers: [] }), 's').status).toBe('missing-data');
    expect(result(w({ layers: [{ materialId: null, thicknessM: 0.1 }] }), 's').reasons.join()).toMatch(/no material chosen/);
    expect(result(w({ layers: [{ materialId: 't-m', thicknessM: null }] }), 's').reasons.join()).toMatch(/no thickness/);
    expect(result(w({ layers: [{ materialId: 'unobtainium', thicknessM: 0.1 }] }), 's').status).toBe('invalid');
    expect(result(w({ layers: [{ materialId: 't-m', thicknessM: 0 }] }), 's').status).toBe('invalid');
    // A material without density: U still calculated, heat capacity reported as unavailable.
    const light = { ...mat('light', 0.04, 1, 1), id: 't-light', densityKgPerM3: undefined } as unknown as MaterialRecord;
    const lightWall: ExteriorWall = { ...wall('s', 'south'), construction: { layers: [{ materialId: 't-light', thicknessM: 0.1 }] } };
    const c = calculateComponent(project([lightWall]), lightWall, [...MATERIALS, light]);
    expect(c.status).toBe('calculated');
    expect(c.heatCapacity).toBeNull();
  });

  it('openings filling a whole wall leave no opaque area: invalid, never a negative area', () => {
    const p = project([wall('e', 'east'), glazing('w', 'e', 0, documented(1.5), { widthM: 8, heightM: 3, sillM: 0 })]);
    expect(result(p, 'e').status).toBe('invalid');
  });

  it('matches the unchanged single-wall engine exactly (regression)', () => {
    const r = result(project([wall('s', 'south')]), 's');
    const direct = calculateWall({
      layers: r.engine?.layers.map((l, i) => ({ name: l.name, thicknessM: l.thicknessM, lambdaWPerMK: l.lambdaWPerMK, densityKgPerM3: MATERIALS[i]?.densityKgPerM3, specificHeatJPerKgK: MATERIALS[i]?.specificHeatJPerKgK })) ?? [],
      widthM: 10, heightM: 3, surfaceResistances: iso6946Preset('horizontal'),
      conditions: { insideTemperatureC: 20, outsideTemperatureC: 0, durationHours: 10 },
    });
    expect(r.uValueWPerM2K).toBe(direct.uValueWPerM2K);
    expectClose(r.heatFlowW ?? NaN, direct.heatTransfer.magnitudeW, 1e-12);
    expect(r.engine?.temperatureProfile.map((t) => t.temperatureC)).toEqual(direct.temperatureProfile.map((t) => t.temperatureC));
  });
});

describe('windows and doors', () => {
  it('without a documented U-value a window is "missing data", and nothing is guessed', () => {
    const r = result(project([wall('s', 'south'), glazing('w', 's', 1, null)]), 'w');
    expect(r.status).toBe('missing-data');
    expect(r.uValueWPerM2K).toBeNull();
    expect(r.heatFlowW).toBeNull();
  });

  it('with a documented U-value: Q = U·A·ΔT, conduction only, solar gains stated as not calculated', () => {
    const r = result(project([wall('s', 'south'), glazing('w', 's', 1, documented(1.8), { gValue: documented(0.6, '-') })]), 'w');
    expect(r.status).toBe('calculated');
    expectClose(r.heatFlowW ?? NaN, 1.8 * 1.5 * 1.2 * 20, 1e-12);
    expect(r.reasons.join(' ')).toMatch(/Solar gains .* NOT calculated/);
    expect(r.documented.map((d) => d.label)).toEqual(['Overall U-value U_w', 'Solar energy transmittance g']);
  });

  it('a value without a source, or out of range, is refused', () => {
    expect(result(project([wall('s', 'south'), glazing('w', 's', 1, documented(1.8, 'W/(m²·K)', '  '))]), 'w').reasons.join()).toMatch(/source of the value is missing/);
    expect(result(project([wall('s', 'south'), glazing('w', 's', 1, documented(0))]), 'w').status).toBe('invalid');
    expect(result(project([wall('s', 'south'), glazing('w', 's', 1, documented(1.8), { gValue: documented(1.2, '-') })]), 'w').reasons.join()).toMatch(/g-value/);
    expect(result(project([wall('s', 'south'), glazing('w', 's', 1, documented(1.8), { shadingFactor: documented(-0.1, '-') })]), 'w').status).toBe('invalid');
  });

  it('a window in a wall to an unconditioned space uses that space’s temperature', () => {
    const r = result(project([wall('n', 'north', { kind: 'unconditioned', temperatureC: 14 }), glazing('w', 'n', 1, documented(2))]), 'w');
    expectClose(r.heatFlowW ?? NaN, 2 * 1.8 * 6, 1e-12);
  });

  it('opaque door: documented U-value, or layers calculated like a wall (horizontal heat flow)', () => {
    const door = (spec: Door['spec']): Component => ({ id: 'd', type: 'door', name: 'door', visible: true, hostId: 'n', offsetM: 1, widthM: 1, heightM: 2, spec });
    expectClose(result(project([wall('n', 'north'), door({ kind: 'u-value', uValue: documented(2.5) })]), 'd').heatFlowW ?? NaN, 2.5 * 2 * 20, 1e-12);
    const layered = result(project([wall('n', 'north'), door({ kind: 'layers', construction: { layers: [{ materialId: 't-m', thicknessM: 0.05 }] } })]), 'd');
    expectClose(layered.uValueWPerM2K ?? NaN, 1 / (0.13 + 0.05 + 0.04), 1e-12);
    expectClose(layered.heatFlowW ?? NaN, (1 / 0.22) * 2 * 20, 1e-12);
    expect(result(project([wall('n', 'north'), door({ kind: 'u-value', uValue: null })]), 'd').status).toBe('missing-data');
  });
});

describe('the envelope total: Q = Σ U·A·ΔT over the calculated components only', () => {
  it('adds walls, roof and a window by hand, with each its own ΔT, and lists what is not included', () => {
    const p = project([
      wall('s', 'south'),
      wall('n', 'north', { kind: 'unconditioned', temperatureC: 30 }), // warmer than inside: a heat GAIN through this wall
      { id: 'r', type: 'roof', name: 'roof', visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: construction() },
      { id: 'f', type: 'floor', name: 'slab', visible: true, exposure: { kind: 'ground' }, construction: construction() },
      glazing('w', 's', 1, documented(2)),
      glazing('w2', 's', 4, null),
    ]);
    const env = calculateEnvelope(p, MATERIALS);
    const uWall = 1 / (0.13 + LAYERS_R + 0.04);
    const uWallU = 1 / (0.13 + LAYERS_R + 0.13);
    const uRoof = 1 / (0.1 + LAYERS_R + 0.04);
    const southNet = 30 - 2 * 1.8;
    const qSouth = uWall * southNet * 20;
    const qNorth = -uWallU * 30 * 10; // inside 20, space 30
    const qRoof = uRoof * 80 * 20;
    const qWindow = 2 * 1.8 * 20;
    expectClose(env.netHeatFlowW, qSouth + qNorth + qRoof + qWindow, 1e-9);
    expectClose(env.outwardW, qSouth + qRoof + qWindow, 1e-9);
    expectClose(env.inwardW, -qNorth, 1e-9);
    expectClose(env.netEnergyKWh, (env.netHeatFlowW * 10) / 1000, 1e-12);
    expectClose(env.contributions.reduce((s, c) => s + c.share, 0), 1, 1e-12);
    expect(env.notIncluded.map((n) => [n.name, n.status])).toEqual([['slab', 'unsupported'], ['window w2', 'missing-data']]);
    const areas = Object.fromEntries(env.areaByType.map((a) => [a.type, a.areaM2]));
    expectClose(areas['exterior-wall'] ?? NaN, southNet + 30, 1e-12);
    expectClose(areas.window ?? NaN, 3.6, 1e-12);
    expect(areas.roof).toBe(80);
    expect(env.assumptions.join(' ')).toMatch(/not an annual energy use or cooling demand/);
  });

  it('doubling the house length doubles the north and south wall heat flow (east/west unchanged)', () => {
    const p = project([wall('n', 'north'), wall('e', 'east')]);
    const long = { ...p, geometry: { ...p.geometry, lengthM: 20 } };
    expectClose(result(long, 'n').heatFlowW ?? NaN, 2 * (result(p, 'n').heatFlowW ?? NaN), 1e-12);
    expectClose(result(long, 'e').heatFlowW ?? NaN, result(p, 'e').heatFlowW ?? NaN, 1e-12);
  });

  it('hiding a component changes nothing in the calculation', () => {
    const p = project([wall('s', 'south'), wall('n', 'north')]);
    expect(calculateEnvelope(setVisible(p, 's', false), MATERIALS).netHeatFlowW).toBe(calculateEnvelope(p, MATERIALS).netHeatFlowW);
  });

  it('never produces NaN or Infinity in totals, whatever is missing', () => {
    const env = calculateEnvelope(createBlankProject(), MATERIALS);
    expect([env.netHeatFlowW, env.outwardW, env.inwardW, env.netEnergyKWh, env.heatCapacityJPerK].every(Number.isFinite)).toBe(true);
  });
});

describe('creating, duplicating, editing and deleting components', () => {
  it('a blank project is empty; components are added with no thermal data', () => {
    let p = createBlankProject();
    expect(p.components).toEqual([]);
    for (const type of ['exterior-wall', 'roof', 'floor', 'partition'] as const) p = addComponent(p, type).project;
    expect(p.components.map((c) => c.type)).toEqual(['exterior-wall', 'roof', 'floor', 'partition']);
    expect(p.components.every((c) => 'construction' in c && c.construction.layers.length === 0)).toBe(true);
    const { project: withWindow, id } = addComponent(p, 'window');
    const w = withWindow.components.find((c) => c.id === id) as Glazing;
    expect(w.uValue).toBeNull();
    expect(w.hostId).toBe(at(p.components, 0).id);
    expect(checkModel(withWindow)).toEqual([]); // the starting size fits
    expect(new Set(withWindow.components.map((c) => c.id)).size).toBe(withWindow.components.length);
  });

  it('refuses what the model cannot hold, with a reason', () => {
    let p = createBlankProject();
    expect(canAdd(p, 'window')).toEqual({ ok: false, reason: expect.stringMatching(/Add an exterior wall first/) });
    for (let i = 0; i < 4; i++) p = addComponent(p, 'exterior-wall').project;
    expect(p.components.map((c) => (c as ExteriorWall).side)).toEqual(['north', 'east', 'south', 'west']);
    expect(canAdd(p, 'exterior-wall').ok).toBe(false);
    expect(() => addComponent(p, 'exterior-wall')).toThrow(/Every side/);
    p = addComponent(p, 'roof').project;
    expect(() => addComponent(p, 'roof')).toThrow(/one roof/);
  });

  it('duplicate: a wall goes to a free side, an opening next to the original, a roof is refused', () => {
    let p = addComponent(createBlankProject(), 'exterior-wall', { side: 'south' }).project;
    const southId = at(p.components, 0).id;
    const dup = duplicateComponent(p, southId);
    expect((dup.project.components.find((c) => c.id === dup.id) as ExteriorWall).side).toBe('north');
    p = addComponent(p, 'window', { hostId: southId }).project;
    const winId = at(p.components, 1).id;
    const copy = duplicateComponent(p, winId);
    const a = p.components.find((c) => c.id === winId) as Glazing;
    const b = copy.project.components.find((c) => c.id === copy.id) as Glazing;
    expectClose(b.offsetM, a.offsetM + a.widthM + 0.3, 1e-9);
    expect(checkModel(copy.project)).toEqual([]);
    p = addComponent(p, 'roof').project;
    expect(() => duplicateComponent(p, at(p.components, 2).id)).toThrow(/cannot be duplicated/);
  });

  it('deleting a wall also deletes its openings (which are listed first, for confirmation)', () => {
    const p = createExampleHouse(BUILT_IN_MATERIALS);
    expect(dependentsOf(p, 'c3').map((o) => o.name)).toEqual(['South window 1', 'South glazed door', 'South window 2']);
    const after = deleteComponent(p, 'c3');
    expect(after.components.some((c) => ['c3', 'c8', 'c9', 'c10'].includes(c.id))).toBe(false);
    expect(after.components).toHaveLength(p.components.length - 4);
    expect(deleteComponent(p, 'nope')).toBe(p);
    expect(p.components).toHaveLength(14); // the original is untouched
  });

  it('editing returns a new project and marks it as no longer the untouched example', () => {
    const p = createExampleHouse(BUILT_IN_MATERIALS);
    const wallC = p.components.find((c) => c.id === 'c1') as ExteriorWall;
    const edited = updateComponent(p, { ...wallC, name: 'N' });
    expect(edited.isExample).toBe(false);
    expect(p.isExample).toBe(true);
    expect((p.components[0] as ExteriorWall).name).toBe('North wall');
  });
});

describe('the example house', () => {
  const p = createExampleHouse(BUILT_IN_MATERIALS);
  const env = calculateEnvelope(p, BUILT_IN_MATERIALS);

  it('is clearly an editable illustration, valid, with every element type', () => {
    expect(p.isExample).toBe(true);
    expect(p.name).toMatch(/illustrative/);
    expect(p.conditions.label).toMatch(/not a Cyprus design value/);
    expect(checkModel(p)).toEqual([]);
    expect(new Set(p.components.map((c) => c.type))).toEqual(new Set(['exterior-wall', 'roof', 'floor', 'partition', 'window', 'glazed-door', 'door']));
    expect(p.components.flatMap((c) => ('construction' in c ? c.construction.layers : [])).every((l) => BUILT_IN_MATERIALS.some((m) => m.id === l.materialId))).toBe(true);
  });

  it('invents no window or door values: they are missing data until documented ones are entered', () => {
    for (const c of p.components) {
      if (c.type === 'window' || c.type === 'glazed-door') expect([c.uValue, c.gValue, c.shadingFactor]).toEqual([null, null, null]);
      if (c.type === 'door') expect(c.spec).toEqual({ kind: 'u-value', uValue: null });
    }
    expect(env.components.filter((r) => r.type === 'window' || r.type === 'glazed-door' || r.type === 'door').every((r) => r.status === 'missing-data')).toBe(true);
  });

  it('calculates walls and roof (a heat GAIN on the hot afternoon), excludes the partition, does not support the ground floor', () => {
    const status = Object.fromEntries(env.components.map((r) => [r.componentId, r.status]));
    expect([status.c1, status.c2, status.c3, status.c4, status.c5]).toEqual(['calculated', 'calculated', 'calculated', 'calculated', 'calculated']);
    expect(status.c6).toBe('unsupported');
    expect(status.c7).toBe('excluded');
    expect(env.netHeatFlowW).toBeLessThan(0); // 26 °C inside, 35 °C outside
    expect(env.usesUnverifiedData).toBe(true);
    expect(env.components.find((r) => r.componentId === 'c5')?.surface?.heatFlow).toBe('downwards');
  });
});
