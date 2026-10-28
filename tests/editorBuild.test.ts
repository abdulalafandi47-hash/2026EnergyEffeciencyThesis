import { describe, expect, it } from 'vitest';
import { calculateWall, validateWallInput } from '../src/engine';
import {
  addLayer,
  buildWall,
  createInitialDraft,
  describeLayers,
  errorFor,
  FIELD,
  layerField,
  moveLayer,
  removeLayer,
  setDimensionUnit,
  setDuration,
  setHeight,
  setInsideTemperature,
  setLayerMaterial,
  setLayerThickness,
  setLayerThicknessUnit,
  setOutsideTemperature,
  setSurfaceInside,
  setSurfaceMode,
  setSurfaceOutside,
  setTemperatureUnit,
  setWidth,
  summarizeDataStatus,
  warningFor,
} from '../src/editor';
import type { WallDraft } from '../src/editor';
import { BUILT_IN_MATERIALS, createCustomMaterial, mergeMaterials } from '../src/materials';
import { at, expectClose } from './helpers/helpers';

const initial = (): WallDraft => createInitialDraft(BUILT_IN_MATERIALS);
const build = (d: WallDraft) => buildWall(d, BUILT_IN_MATERIALS);

describe('valid configurations', () => {
  it('the starter wall is valid and becomes an SI engine input', () => {
    const result = build(initial());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const wall = result.wall;
    if (!wall) throw new Error('wall expected');
    expect(wall.widthM).toBe(3);
    expect(wall.heightM).toBe(2.5);
    expect(wall.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.2, 0.08, 0.02]); // mm → m, exactly
    expect(wall.layers.map((l) => l.name)).toEqual([
      'Gypsum plaster (demonstration)',
      'Clay brick, solid (demonstration)',
      'Expanded polystyrene (EPS) slab (demonstration)',
      'Cement plaster / render (demonstration)',
    ]);
    expect(wall.conditions).toEqual({ insideTemperatureC: 20, outsideTemperatureC: 5, durationHours: 24 });
    expect(validateWallInput(wall)).toEqual([]);
  });

  it('the engine can calculate what the editor built, and the result matches a hand calculation', () => {
    const wall = build(initial()).wall;
    if (!wall) throw new Error('wall expected');
    const result = calculateWall(wall);
    // R = 0.015/0.43 + 0.2/0.7 + 0.08/0.035 + 0.02/1.0 + R_si 0.13 + R_se 0.04 (database values are illustrative)
    const expectedR = 0.015 / 0.43 + 0.2 / 0.7 + 0.08 / 0.035 + 0.02 / 1.0 + 0.13 + 0.04;
    expectClose(result.resistance.totalM2KPerW, expectedR);
    expectClose(result.uValueWPerM2K, 1 / expectedR);
  });

  it('the same physical wall typed in different units gives the same engine input', () => {
    const reference = build(initial()).wall;
    let d = initial();
    d = setLayerThicknessUnit(d, 'layer-1', 'm'); // 0.015
    d = setLayerThicknessUnit(d, 'layer-2', 'cm'); // 20
    d = setDimensionUnit(d, 'mm'); // 3000 × 2500
    d = setTemperatureUnit(d, 'F');
    const converted = build(d).wall;
    expect(converted?.layers.map((l) => l.thicknessM)).toEqual(reference?.layers.map((l) => l.thicknessM));
    expect(converted?.widthM).toBe(3);
    expect(converted?.heightM).toBe(2.5);
    expectClose(converted?.conditions.insideTemperatureC ?? NaN, 20, 1e-9);
    expectClose(converted?.conditions.outsideTemperatureC ?? NaN, 5, 1e-9);
  });

  it('typed values (not just converted ones) are converted to SI using the unit shown next to them', () => {
    // The user types 4200 and 2700 with the unit set to mm, and 25 for layer 2 with the unit set to cm.
    const base = initial();
    const d: WallDraft = {
      ...base,
      widthText: '4200',
      heightText: '2700',
      dimensionUnit: 'mm',
      layers: base.layers.map((l) => (l.key === 'layer-2' ? { ...l, thicknessText: '25', thicknessUnit: 'cm' as const } : l)),
    };
    const wall = build(d).wall;
    expect(wall?.widthM).toBe(4.2);
    expect(wall?.heightM).toBe(2.7);
    expect(at(wall?.layers ?? [], 1).thicknessM).toBe(0.25);
  });

  it('accepts comma decimals', () => {
    const wall = build(setHeight(setWidth(initial(), '3,6'), '2,75')).wall;
    expect(wall?.widthM).toBe(3.6);
    expect(wall?.heightM).toBe(2.75);
  });

  it('accepts a single-layer wall and a 20-layer wall', () => {
    let one = initial();
    for (const k of ['layer-2', 'layer-3', 'layer-4']) one = removeLayer(one, k);
    expect(build(one).wall?.layers).toHaveLength(1);

    let many = initial();
    for (let i = 0; i < 16; i++) {
      many = addLayer(many);
      const key = at(many.layers, many.layers.length - 1).key;
      many = setLayerMaterial(setLayerThickness(many, key, '10'), key, 'concrete-normal-weight');
    }
    expect(many.layers).toHaveLength(20);
    expect(build(many).wall?.layers).toHaveLength(20);
  });

  it('accepts equal temperatures and zero duration', () => {
    const d = setDuration(setOutsideTemperature(initial(), '20'), '0');
    expect(build(d).ok).toBe(true);
  });

  it('accepts negative temperatures in any unit above absolute zero', () => {
    expect(build(setOutsideTemperature(initial(), '-15')).ok).toBe(true);
    expect(build(setOutsideTemperature(setTemperatureUnit(initial(), 'K'), '250')).ok).toBe(true);
  });

  describe('surface resistances are an explicit, visible choice', () => {
    it('preset: the horizontal preset, still labelled unverified', () => {
      const sr = build(initial()).wall?.surfaceResistances;
      expect(sr).toMatchObject({ insideM2KPerW: 0.13, outsideM2KPerW: 0.04, heatFlowOrientation: 'horizontal', status: 'unverified' });
    });
    it('custom: uses the typed values and marks them user-defined', () => {
      let d = setSurfaceMode(initial(), 'custom');
      d = setSurfaceOutside(setSurfaceInside(d, '0,11'), '0.05');
      expect(build(d).wall?.surfaceResistances).toMatchObject({ insideM2KPerW: 0.11, outsideM2KPerW: 0.05, status: 'user-defined' });
    });
    it('custom: zero is allowed (pure conduction), negative and empty are not', () => {
      const custom = setSurfaceMode(initial(), 'custom');
      expect(build(setSurfaceOutside(setSurfaceInside(custom, '0'), '0')).ok).toBe(true);
      expect(errorFor(build(setSurfaceInside(custom, '-0.1')), FIELD.surfaceInside)).toBe('The internal surface resistance R_si cannot be negative.');
      expect(errorFor(build(setSurfaceOutside(custom, '')), FIELD.surfaceOutside)).toBe('Enter the external surface resistance R_se.');
    });
    it('typed custom values are ignored (and not validated) while the preset is selected', () => {
      expect(build(setSurfaceInside(initial(), 'garbage')).ok).toBe(true);
    });
  });

  it('works with user-defined materials from the same list', () => {
    const { material } = createCustomMaterial({ name: 'My board', lambdaWPerMK: 0.2, densityKgPerM3: 700, specificHeatJPerKgK: 1100 });
    const materials = mergeMaterials(BUILT_IN_MATERIALS, [material]);
    const d = setLayerMaterial(createInitialDraft(materials), 'layer-1', material.id);
    const wall = buildWall(d, materials).wall;
    expect(wall?.layers[0]).toMatchObject({ lambdaWPerMK: 0.2, propertyStatus: 'user-defined' });
  });
});

describe('invalid inputs give clear, field-specific messages', () => {
  const messageFor = (d: WallDraft, field: string) => errorFor(build(d), field);

  describe.each([
    ['width', FIELD.width, setWidth, 'The wall width'],
    ['height', FIELD.height, setHeight, 'The wall height'],
  ] as const)('%s', (_name, field, setter, label) => {
    it('empty', () => expect(messageFor(setter(initial(), ''), field)).toBe(`Enter ${label.toLowerCase()}.`));
    it('not a number', () => {
      for (const text of ['abc', '3m', '1e2', '1 000']) {
        expect(messageFor(setter(initial(), text), field)).toBe(`${label} must be a number such as 2.5 (digits with a decimal point or comma; no units or letters).`);
      }
    });
    it('zero', () => expect(messageFor(setter(initial(), '0'), field)).toBe(`${label} must be greater than zero.`));
    it('negative', () => expect(messageFor(setter(initial(), '-2'), field)).toBe(`${label} must be greater than zero.`));
  });

  describe('layer thickness', () => {
    it('empty names the layer', () => {
      expect(messageFor(addLayer(initial()), layerField('layer-5', 'thickness'))).toBe('Enter the thickness of layer 5.');
    });
    it('negative', () => {
      expect(messageFor(setLayerThickness(initial(), 'layer-2', '-200'), layerField('layer-2', 'thickness'))).toBe('The thickness of layer 2 must be greater than zero.');
    });
    it('zero', () => {
      expect(messageFor(setLayerThickness(initial(), 'layer-3', '0'), layerField('layer-3', 'thickness'))).toBe('The thickness of layer 3 must be greater than zero.');
    });
    it('not a number / has a unit typed into it', () => {
      expect(messageFor(setLayerThickness(initial(), 'layer-1', '15mm'), layerField('layer-1', 'thickness'))).toContain('must be a number such as 2.5');
    });
    it('the message uses the layer\'s position at the time, so after reordering it follows the layer', () => {
      const moved = moveLayer(setLayerThickness(initial(), 'layer-4', '-1'), 'layer-4', 'toward-interior');
      expect(messageFor(moved, layerField('layer-4', 'thickness'))).toBe('The thickness of layer 3 must be greater than zero.');
    });
  });

  describe('materials', () => {
    it('a new layer has no material', () => {
      expect(messageFor(addLayer(initial()), layerField('layer-5', 'material'))).toBe('Select a material for layer 5.');
    });
    it('deselecting a material', () => {
      expect(messageFor(setLayerMaterial(initial(), 'layer-2', ''), layerField('layer-2', 'material'))).toBe('Select a material for layer 2.');
    });
    it('a material id that is not in the database', () => {
      expect(messageFor(setLayerMaterial(initial(), 'layer-1', 'unobtainium'), layerField('layer-1', 'material'))).toBe(
        'The material chosen for layer 1 is not in the database. Choose another material.',
      );
    });
    it('a material that vanished from the list after being chosen', () => {
      const without = BUILT_IN_MATERIALS.filter((m) => m.id !== 'eps-slab');
      expect(errorFor(buildWall(initial(), without), layerField('layer-3', 'material'))).toContain('not in the database');
    });
    it('an incomplete layer reports BOTH its missing material and its missing thickness', () => {
      const fields = build(addLayer(initial())).errors.map((e) => e.field).sort();
      expect(fields).toEqual([layerField('layer-5', 'material'), layerField('layer-5', 'thickness')].sort());
    });
  });

  describe('no layers', () => {
    it('is reported once, on the layers field', () => {
      let d = initial();
      for (const key of d.layers.map((l) => l.key)) d = removeLayer(d, key);
      const result = build(d);
      expect(result.errors).toEqual([{ field: FIELD.layers, message: 'Add at least one layer.' }]);
    });
  });

  describe('boundary conditions', () => {
    it('empty or non-numeric temperatures', () => {
      expect(messageFor(setInsideTemperature(initial(), ''), FIELD.insideTemperature)).toBe('Enter the inside temperature.');
      expect(messageFor(setOutsideTemperature(initial(), '20C'), FIELD.outsideTemperature)).toContain('must be a number');
    });
    it.each([
      ['C', '-300'],
      ['K', '-1'],
      ['F', '-500'],
    ] as const)('below absolute zero in %s (%s)', (unit, text) => {
      const d = setInsideTemperature({ ...initial(), temperatureUnit: unit }, text);
      expect(messageFor(d, FIELD.insideTemperature)).toBe('The inside temperature cannot be below absolute zero (−273.15 °C = 0 K = −459.67 °F).');
    });
    it('exactly absolute zero is not rejected as "below"', () => {
      expect(messageFor(setOutsideTemperature({ ...initial(), temperatureUnit: 'K' }, '0'), FIELD.outsideTemperature)).toBeUndefined();
    });
    it('negative or empty duration', () => {
      expect(messageFor(setDuration(initial(), '-5'), FIELD.duration)).toBe('The duration cannot be negative.');
      expect(messageFor(setDuration(initial(), ''), FIELD.duration)).toBe('Enter the duration.');
    });
  });

  it('collects every problem at once, each on its own field', () => {
    let d = setWidth(initial(), '0');
    d = setLayerThickness(d, 'layer-1', '-5');
    d = setLayerMaterial(d, 'layer-2', '');
    d = setOutsideTemperature(d, 'cold');
    const fields = build(d).errors.map((e) => e.field).sort();
    expect(fields).toEqual([FIELD.outsideTemperature, FIELD.width, layerField('layer-1', 'thickness'), layerField('layer-2', 'material')].sort());
  });

  it('never produces a wall while there is any error', () => {
    const result = build(setWidth(initial(), '-1'));
    expect(result.ok).toBe(false);
    expect(result.wall).toBeNull();
  });

  it('messages are written for people: no metre-only wording, no raw numbers from the engine', () => {
    let d = setLayerThickness(initial(), 'layer-1', '-20'); // -20 mm
    d = setWidth(d, '-4');
    for (const e of build(d).errors) {
      expect(e.message).not.toContain('(m)');
      expect(e.message).not.toContain('got ');
    }
  });
});

describe('plausibility warnings (not errors)', () => {
  const result = (d: WallDraft) => build(d);

  it('a thickness that looks like the wrong unit still builds, with a warning', () => {
    const tiny = result(setLayerThickness(initial(), 'layer-3', '0.08')); // 0.08 mm: probably meant 0.08 m
    expect(tiny.ok).toBe(true);
    expect(warningFor(tiny, layerField('layer-3', 'thickness'))).toContain('thinner than 1 mm');
    const huge = result(setLayerThickness(initial(), 'layer-3', '2000')); // 2 m
    expect(huge.ok).toBe(true);
    expect(warningFor(huge, layerField('layer-3', 'thickness'))).toContain('thicker than 1 m');
  });

  it('unusual dimensions, temperatures and durations', () => {
    expect(warningFor(result(setWidth(initial(), '5000')), FIELD.width)).toContain('unusual');
    expect(warningFor(result(setHeight(initial(), '0.01')), FIELD.height)).toContain('unusual');
    expect(warningFor(result(setOutsideTemperature(initial(), '120')), FIELD.outsideTemperature)).toContain('Check the unit');
    expect(warningFor(result(setOutsideTemperature(setTemperatureUnit(initial(), 'K'), '20')), FIELD.outsideTemperature)).toContain('Check the unit');
    expect(warningFor(result(setDuration(initial(), '9000')), FIELD.duration)).toContain('not an annual energy demand');
  });

  it('normal input produces no warnings', () => {
    expect(result(initial()).warnings).toEqual([]);
  });

  it('a field with an error does not also get a warning', () => {
    const r = result(setWidth(initial(), '-5000'));
    expect(warningFor(r, FIELD.width)).toBeUndefined();
  });

  it('warns when a chosen material cannot provide heat capacity', () => {
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.3 });
    const materials = mergeMaterials(BUILT_IN_MATERIALS, [material]);
    const r = buildWall(setLayerMaterial(createInitialDraft(materials), 'layer-1', material.id), materials);
    expect(r.ok).toBe(true);
    expect(warningFor(r, FIELD.layers)).toContain('Heat capacity cannot be calculated');
    expect(warningFor(r, FIELD.layers)).toContain('Only lambda');
  });
});

describe('describing layers for display', () => {
  const views = () => describeLayers(initial(), BUILT_IN_MATERIALS);

  it('identifies the interior and exterior sides', () => {
    expect(views().map((v) => v.faces)).toEqual([['interior'], [], [], ['exterior']]);
  });

  it('a single layer touches both faces', () => {
    let d = initial();
    for (const k of ['layer-2', 'layer-3', 'layer-4']) d = removeLayer(d, k);
    expect(at(describeLayers(d, BUILT_IN_MATERIALS), 0).faces).toEqual(['interior', 'exterior']);
  });

  it('after reordering, the faces follow the positions, not the layers', () => {
    const v = describeLayers(moveLayer(initial(), 'layer-4', 'toward-interior'), BUILT_IN_MATERIALS);
    expect(v.map((x) => x.key)).toEqual(['layer-1', 'layer-2', 'layer-4', 'layer-3']);
    expect(at(v, 3).faces).toEqual(['exterior']);
  });

  it('shows name, thickness in metres and available properties with their status', () => {
    const eps = at(views(), 2);
    expect(eps.position).toBe(3);
    expect(eps.thicknessM).toBe(0.08);
    expect(eps.material).toMatchObject({
      name: 'Expanded polystyrene (EPS) slab (demonstration)',
      lambdaWPerMK: 0.035,
      densityKgPerM3: 25,
      specificHeatJPerKgK: 1450,
      missingProperties: [],
      status: 'illustrative',
      valueType: 'unspecified',
      sourceType: 'none',
    });
    expect(eps.material?.notices.at(-1)).toBe('This application has not confirmed this value as an approved Cypriot design value.');
  });

  it('lists missing properties instead of hiding them', () => {
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.3 });
    const materials = mergeMaterials(BUILT_IN_MATERIALS, [material]);
    const v = describeLayers(setLayerMaterial(createInitialDraft(materials), 'layer-1', material.id), materials);
    expect(at(v, 0).material?.missingProperties).toEqual(['density', 'specific heat capacity']);
    expect(at(v, 0).material?.densityKgPerM3).toBeUndefined();
  });

  it('shows null for a missing material and for an unreadable thickness', () => {
    const v = describeLayers(setLayerThickness(addLayer(initial()), 'layer-1', 'x'), BUILT_IN_MATERIALS);
    expect(at(v, 4).material).toBeNull();
    expect(at(v, 4).thicknessM).toBeNull();
    expect(at(v, 0).thicknessM).toBeNull();
  });

  it('summarises unverified data and layers without a material', () => {
    const summary = summarizeDataStatus(describeLayers(addLayer(initial()), BUILT_IN_MATERIALS));
    expect(summary.anyNotVerified).toBe(true);
    expect(summary.notVerified).toHaveLength(4);
    expect(summary.notVerified[0]).toBe('Gypsum plaster (demonstration) (illustrative)');
    expect(summary.withoutMaterial).toEqual([5]);
  });
});

describe('editor and engine never disagree (2000 random drafts)', () => {
  // Deterministic pseudo-random generator, so a failure is reproducible.
  let seed = 987654321;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pick = <T,>(items: readonly T[]): T => at(items, Math.floor(rnd() * items.length));

  // Mostly plausible values with some junk mixed in, so BOTH outcomes are exercised.
  const junk = ['', ' ', 'abc', '0', '-1', '-0.5', '0.001', '1e3', '1 000', '12mm', '999999999', '-300', '.', '-', 'NaN', 'Infinity'];
  const withJunk = (good: readonly string[]): string => (rnd() < 0.85 ? pick(good) : pick(junk));
  const dimensions = ['2.5', '3', '4,2', '3000', '0.9'];
  const thicknesses = ['15', '80', '200', '0,5', '0.02', '120'];
  const temperatures = ['20', '5', '-3', '0', '24', '35'];
  const durations = ['24', '0', '8', '1000'];
  const surfaces = ['0.13', '0.04', '0', '0,1'];
  const units = ['mm', 'cm', 'm'] as const;
  const tUnits = ['C', 'K', 'F'] as const;
  const ids = [...BUILT_IN_MATERIALS.map((m) => m.id), null, 'ghost'];
  const goodIds = BUILT_IN_MATERIALS.map((m) => m.id);

  const randomDraft = (): WallDraft => ({
    widthText: withJunk(dimensions),
    heightText: withJunk(dimensions),
    dimensionUnit: pick(units),
    layers: Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => ({
      key: `layer-${i + 1}`,
      materialId: rnd() < 0.9 ? pick(goodIds) : pick(ids),
      thicknessText: withJunk(thicknesses),
      thicknessUnit: pick(units),
    })),
    insideTemperatureText: withJunk(temperatures),
    outsideTemperatureText: withJunk(temperatures),
    temperatureUnit: pick(tUnits),
    durationText: withJunk(durations),
    surfaceMode: pick(['preset-horizontal', 'custom'] as const),
    surfaceInsideText: withJunk(surfaces),
    surfaceOutsideText: withJunk(surfaces),
    nextLayerNumber: 7,
  });

  it('whenever the editor accepts a draft, the engine accepts the wall and can calculate it; otherwise there is an error and no wall', () => {
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 2000; i++) {
      const draft = randomDraft();
      const result = build(draft);
      if (result.ok) {
        accepted++;
        expect(result.wall).not.toBeNull();
        expect(validateWallInput(result.wall)).toEqual([]);
        const calc = calculateWall(result.wall as NonNullable<typeof result.wall>);
        expect(Number.isFinite(calc.uValueWPerM2K)).toBe(true);
        expect(Number.isFinite(calc.heatTransfer.magnitudeW)).toBe(true);
      } else {
        rejected++;
        expect(result.wall).toBeNull();
        expect(result.errors.length).toBeGreaterThan(0);
        const known = new Set<string>(Object.values(FIELD));
        for (const layer of draft.layers) {
          known.add(layerField(layer.key, 'material'));
          known.add(layerField(layer.key, 'thickness'));
        }
        for (const e of result.errors) {
          expect(known.has(e.field), `unexpected field ${e.field}`).toBe(true);
          expect(e.message.length).toBeGreaterThan(0);
          expect(e.field, 'engine safety-net message should never be needed').not.toBe(FIELD.wall);
        }
      }
    }
    // The generator must exercise both outcomes, or this test proves nothing.
    expect(accepted).toBeGreaterThan(200);
    expect(rejected).toBeGreaterThan(200);
  });
});
