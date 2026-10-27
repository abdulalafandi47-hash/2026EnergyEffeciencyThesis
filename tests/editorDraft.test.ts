import { describe, expect, it } from 'vitest';
import {
  addLayer,
  buildWall,
  createEmptyDraft,
  createInitialDraft,
  formatNumber,
  moveLayer,
  moveLayerTo,
  parseNumberInput,
  removeLayer,
  setDimensionUnit,
  setLayerMaterial,
  setLayerThickness,
  setLayerThicknessUnit,
  setTemperatureUnit,
  setWidth,
} from '../src/editor';
import type { WallDraft } from '../src/editor';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { at, expectClose } from './helpers/helpers';

const initial = (): WallDraft => createInitialDraft(BUILT_IN_MATERIALS);
const keys = (d: WallDraft): string[] => d.layers.map((l) => l.key);
const materialIds = (d: WallDraft): Array<string | null> => d.layers.map((l) => l.materialId);
const thicknessesM = (d: WallDraft): number[] => (buildWall(d, BUILT_IN_MATERIALS).wall?.layers ?? []).map((l) => l.thicknessM);

describe('parseNumberInput', () => {
  it.each([
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['  7 ', 7],
    ['.5', 0.5],
    [',5', 0.5],
    ['5.', 5],
    ['-3', -3],
    ['+3', 3],
    ['−3.5', -3.5], // typographic minus
    ['0', 0],
    ['007', 7],
  ])('reads %j as %d', (text, value) => {
    expect(parseNumberInput(text)).toEqual({ ok: true, value });
  });

  it.each(['', '   '])('treats %j as empty', (text) => {
    expect(parseNumberInput(text)).toEqual({ ok: false, reason: 'empty' });
  });

  it.each(['abc', '80mm', '80 mm', '1e3', '1E-2', '1 200', '1.200,5', '1,2,3', '1..2', '--3', '+-3', '0x10', 'Infinity', 'NaN', '-', '.', ',', '1/2', '٣'])(
    'rejects %j',
    (text) => {
      expect(parseNumberInput(text)).toEqual({ ok: false, reason: 'not-a-number' });
    },
  );

  it('rejects numbers too large to be finite', () => {
    expect(parseNumberInput('9'.repeat(400)).ok).toBe(false);
  });

  it('reads a comma as a decimal separator, so "1,200" is 1.2 (documented behaviour)', () => {
    expect(parseNumberInput('1,200')).toEqual({ ok: true, value: 1.2 });
  });
});

describe('formatNumber', () => {
  it('removes floating-point noise and never uses exponent notation', () => {
    expect(formatNumber(0.08 * 1000)).toBe('80');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(2.5e21)).not.toMatch(/e/i);
  });
  it('round-trips through the parser', () => {
    for (const v of [0, 1, 0.015, 293.15, -40, 12345.6789, 1e-7]) {
      const parsed = parseNumberInput(formatNumber(v));
      expect(parsed.ok && Math.abs(parsed.value - v) <= 1e-9 * Math.max(1, Math.abs(v))).toBe(true);
    }
  });
});

describe('starter and empty drafts', () => {
  it('the starter wall has four layers, interior first, with real database materials', () => {
    expect(materialIds(initial())).toEqual(['gypsum-plaster', 'clay-brick-solid', 'eps-slab', 'cement-plaster']);
  });
  it('the starter wall only uses materials that exist (null otherwise)', () => {
    expect(materialIds(createInitialDraft([]))).toEqual([null, null, null, null]);
  });
  it('the empty draft has no layers and builds nothing', () => {
    const result = buildWall(createEmptyDraft(), BUILT_IN_MATERIALS);
    expect(result.ok).toBe(false);
    expect(result.wall).toBeNull();
  });
});

describe('adding and removing layers', () => {
  it('adds an empty layer at the exterior end by default', () => {
    const d = addLayer(initial());
    expect(d.layers).toHaveLength(5);
    expect(at(d.layers, 4)).toEqual({ key: 'layer-5', materialId: null, thicknessText: '', thicknessUnit: 'mm' });
  });

  it('inserts at a given position (0 = interior face) and clamps out-of-range positions', () => {
    expect(materialIds(addLayer(initial(), 0))[0]).toBeNull();
    expect(materialIds(addLayer(initial(), 2))[2]).toBeNull();
    expect(materialIds(addLayer(initial(), 99)).at(-1)).toBeNull();
    expect(materialIds(addLayer(initial(), -5))[0]).toBeNull();
  });

  it('never reuses a layer key, even after removing layers', () => {
    let d = initial();
    d = removeLayer(d, 'layer-4');
    d = addLayer(d);
    d = addLayer(d);
    expect(new Set(keys(d)).size).toBe(d.layers.length);
    expect(keys(d)).toEqual(['layer-1', 'layer-2', 'layer-3', 'layer-5', 'layer-6']);
  });

  it('removes the chosen layer only', () => {
    expect(materialIds(removeLayer(initial(), 'layer-2'))).toEqual(['gypsum-plaster', 'eps-slab', 'cement-plaster']);
  });

  it('removing an unknown key changes nothing (same object returned)', () => {
    const d = initial();
    expect(removeLayer(d, 'layer-99')).toBe(d);
  });

  it('allows removing every layer, and the wall is then reported as incomplete', () => {
    let d = initial();
    for (const key of keys(d)) d = removeLayer(d, key);
    expect(d.layers).toEqual([]);
    expect(buildWall(d, BUILT_IN_MATERIALS).errors.map((e) => e.field)).toContain('layers');
  });

  it('supports many layers', () => {
    let d = createEmptyDraft();
    for (let i = 0; i < 50; i++) d = addLayer(d);
    expect(d.layers).toHaveLength(50);
    expect(new Set(keys(d)).size).toBe(50);
  });
});

describe('reordering layers', () => {
  it('moves a layer one place toward the exterior', () => {
    expect(materialIds(moveLayer(initial(), 'layer-1', 'toward-exterior'))).toEqual([
      'clay-brick-solid',
      'gypsum-plaster',
      'eps-slab',
      'cement-plaster',
    ]);
  });

  it('moves a layer one place toward the interior', () => {
    expect(materialIds(moveLayer(initial(), 'layer-4', 'toward-interior'))).toEqual([
      'gypsum-plaster',
      'clay-brick-solid',
      'cement-plaster',
      'eps-slab',
    ]);
  });

  it('does nothing when moving past either end (same object returned)', () => {
    const d = initial();
    expect(moveLayer(d, 'layer-1', 'toward-interior')).toBe(d);
    expect(moveLayer(d, 'layer-4', 'toward-exterior')).toBe(d);
    expect(moveLayer(d, 'nope', 'toward-exterior')).toBe(d);
  });

  it('moveLayerTo puts a layer at a position and clamps', () => {
    expect(keys(moveLayerTo(initial(), 'layer-4', 0))).toEqual(['layer-4', 'layer-1', 'layer-2', 'layer-3']);
    expect(keys(moveLayerTo(initial(), 'layer-1', 99))).toEqual(['layer-2', 'layer-3', 'layer-4', 'layer-1']);
    expect(keys(moveLayerTo(initial(), 'layer-2', -3))).toEqual(['layer-2', 'layer-1', 'layer-3', 'layer-4']);
  });

  it('a layer keeps its material, thickness and unit when it moves', () => {
    const moved = moveLayer(initial(), 'layer-3', 'toward-interior');
    expect(moved.layers.find((l) => l.key === 'layer-3')).toEqual(initial().layers.find((l) => l.key === 'layer-3'));
  });

  it('the order the user sees is the order the engine receives (interior first)', () => {
    const wall = buildWall(moveLayer(initial(), 'layer-3', 'toward-interior'), BUILT_IN_MATERIALS).wall;
    expect(wall?.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.08, 0.2, 0.02]);
  });

  it('many random reorderings never lose or duplicate a layer', () => {
    let d = initial();
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const key = at(keys(d), Math.floor(next() * d.layers.length));
      d = next() < 0.5 ? moveLayer(d, key, next() < 0.5 ? 'toward-interior' : 'toward-exterior') : moveLayerTo(d, key, Math.floor(next() * 6) - 1);
    }
    expect([...keys(d)].sort()).toEqual(['layer-1', 'layer-2', 'layer-3', 'layer-4']);
  });
});

describe('selecting materials and editing thickness', () => {
  it('changes only the chosen layer', () => {
    const d = setLayerMaterial(initial(), 'layer-3', 'xps-board');
    expect(materialIds(d)).toEqual(['gypsum-plaster', 'clay-brick-solid', 'xps-board', 'cement-plaster']);
  });

  it('an empty selection means "no material"', () => {
    expect(setLayerMaterial(initial(), 'layer-1', '').layers[0]?.materialId).toBeNull();
    expect(setLayerMaterial(initial(), 'layer-1', null).layers[0]?.materialId).toBeNull();
  });

  it('the engine receives the selected material\'s properties', () => {
    const wall = buildWall(setLayerMaterial(initial(), 'layer-3', 'polyurethane-board'), BUILT_IN_MATERIALS).wall;
    expect(wall?.layers[2]).toMatchObject({ lambdaWPerMK: 0.025, densityKgPerM3: 35, specificHeatJPerKgK: 1400, propertyStatus: 'illustrative' });
  });

  it('stores thickness exactly as typed and updates the wall immediately', () => {
    const d = setLayerThickness(initial(), 'layer-3', '120');
    expect(at(d.layers, 2).thicknessText).toBe('120');
    expect(thicknessesM(d)).toEqual([0.015, 0.2, 0.12, 0.02]);
  });

  it('unknown keys change nothing', () => {
    const d = initial();
    expect(setLayerMaterial(d, 'nope', 'eps-slab')).toBe(d);
    expect(setLayerThickness(d, 'nope', '5')).toBe(d);
    expect(setLayerThicknessUnit(d, 'nope', 'cm')).toBe(d);
  });
});

describe('operations never modify the draft they are given', () => {
  it('returns new objects and leaves the original untouched', () => {
    const original = initial();
    const snapshot = JSON.stringify(original);
    let d = original;
    d = addLayer(d);
    d = removeLayer(d, 'layer-1');
    d = moveLayer(d, 'layer-3', 'toward-interior');
    d = setLayerMaterial(d, 'layer-2', 'xps-board');
    d = setLayerThickness(d, 'layer-2', '1');
    d = setLayerThicknessUnit(d, 'layer-2', 'cm');
    d = setWidth(d, '9');
    d = setDimensionUnit(d, 'cm');
    d = setTemperatureUnit(d, 'K');
    expect(d).not.toBe(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('changing a unit keeps the physical value (no silent reinterpretation)', () => {
  it('thickness: 80 mm becomes 8 cm and 0.08 m, and the wall is unchanged', () => {
    const before = thicknessesM(initial());
    const cm = setLayerThicknessUnit(initial(), 'layer-3', 'cm');
    expect(at(cm.layers, 2)).toMatchObject({ thicknessText: '8', thicknessUnit: 'cm' });
    const m = setLayerThicknessUnit(initial(), 'layer-3', 'm');
    expect(at(m.layers, 2)).toMatchObject({ thicknessText: '0.08', thicknessUnit: 'm' });
    expect(thicknessesM(cm)).toEqual(before);
    expect(thicknessesM(m)).toEqual(before);
  });

  it('thickness: a round trip mm → m → mm restores the original text', () => {
    let d = initial();
    d = setLayerThicknessUnit(d, 'layer-1', 'm');
    d = setLayerThicknessUnit(d, 'layer-1', 'mm');
    expect(at(d.layers, 0).thicknessText).toBe('15');
  });

  it('thickness: invalid text is kept as typed; only the unit changes', () => {
    const typed = setLayerThickness(initial(), 'layer-1', '1x5');
    const changed = setLayerThicknessUnit(typed, 'layer-1', 'cm');
    expect(at(changed.layers, 0)).toMatchObject({ thicknessText: '1x5', thicknessUnit: 'cm' });
    expect(setLayerThicknessUnit(setLayerThickness(initial(), 'layer-1', ''), 'layer-1', 'm').layers[0]?.thicknessText).toBe('');
  });

  it('thickness: comma decimals convert too', () => {
    const d = setLayerThicknessUnit(setLayerThickness(initial(), 'layer-1', '12,5'), 'layer-1', 'cm');
    expect(at(d.layers, 0).thicknessText).toBe('1.25');
  });

  it('dimensions: 3 m × 2.5 m becomes 300 cm × 250 cm and the wall is unchanged', () => {
    const d = setDimensionUnit(initial(), 'cm');
    expect(d).toMatchObject({ widthText: '300', heightText: '250', dimensionUnit: 'cm' });
    const a = buildWall(initial(), BUILT_IN_MATERIALS).wall;
    const b = buildWall(d, BUILT_IN_MATERIALS).wall;
    expect(b?.widthM).toBe(a?.widthM);
    expect(b?.heightM).toBe(a?.heightM);
  });

  it('temperature: 20 °C and 5 °C become 293.15 K and 278.15 K, same physical wall', () => {
    const k = setTemperatureUnit(initial(), 'K');
    expect(k).toMatchObject({ insideTemperatureText: '293.15', outsideTemperatureText: '278.15', temperatureUnit: 'K' });
    const f = setTemperatureUnit(initial(), 'F');
    expect(f).toMatchObject({ insideTemperatureText: '68', outsideTemperatureText: '41' });
    for (const converted of [k, f]) {
      const c = buildWall(converted, BUILT_IN_MATERIALS).wall?.conditions;
      expectClose(c?.insideTemperatureC ?? NaN, 20, 1e-9);
      expectClose(c?.outsideTemperatureC ?? NaN, 5, 1e-9);
    }
  });

  it('temperature: C → K → F → C returns to the start', () => {
    let d = initial();
    for (const unit of ['K', 'F', 'C'] as const) d = setTemperatureUnit(d, unit);
    expect(d.insideTemperatureText).toBe('20');
    expect(d.outsideTemperatureText).toBe('5');
  });
});
