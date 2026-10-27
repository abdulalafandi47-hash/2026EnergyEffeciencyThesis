import { describe, expect, it } from 'vitest';
import { calculateWall, customSurfaceResistances, EngineInputError, validateWallInput } from '../src/engine';
import {
  BUILT_IN_MATERIALS,
  createCustomMaterial,
  findMaterialById,
  materialToLayer,
  mergeMaterials,
  slugify,
  validateMaterial,
} from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import { expectClose, issuesOf, referenceWall, wrong } from './helpers/helpers';

describe('slugify', () => {
  it('makes safe ids', () => {
    expect(slugify('Mineral Wool (Brand X)!')).toBe('mineral-wool-brand-x');
    expect(slugify('  Ξύλο / Wood  ')).toBe('wood');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
  });
  it('never returns an empty id', () => {
    expect(slugify('###')).toBe('material');
    expect(slugify('')).toBe('material');
  });
});

describe('createCustomMaterial', () => {
  const input = { name: 'My Insulation', lambdaWPerMK: 0.032, densityKgPerM3: 45, specificHeatJPerKgK: 1200 };

  it('creates a valid, clearly user-defined record', () => {
    const { material, warnings } = createCustomMaterial(input);
    expect(validateMaterial(material)).toEqual([]);
    expect(material.id).toBe('custom-my-insulation');
    expect(material.status).toBe('user-defined');
    expect(material.category).toBe('Other');
    expect(material.units).toEqual({ conductivity: 'W/(m·K)', density: 'kg/m³', specificHeat: 'J/(kg·K)' });
    expect(material.source.citation).toContain('no source stated');
    expect(material.assumptionsAndLimitations.join(' ')).toContain('user is responsible');
    expect(warnings).toEqual([]);
  });

  it('keeps the user\'s source note and category', () => {
    const { material } = createCustomMaterial({ ...input, category: 'Mineral wool', sourceNote: 'Brand X datasheet rev. 3' });
    expect(material.category).toBe('Mineral wool');
    expect(material.source.citation).toBe('User-entered: Brand X datasheet rev. 3');
  });

  it('trims the name', () => {
    expect(createCustomMaterial({ ...input, name: '  Padded  ' }).material.name).toBe('Padded');
  });

  it('allows conductivity alone (heat capacity then unavailable)', () => {
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.5 });
    expect('densityKgPerM3' in material).toBe(false);
    expect('specificHeatJPerKgK' in material).toBe(false);
  });

  it('makes ids unique against existing ones', () => {
    const first = createCustomMaterial(input).material;
    const second = createCustomMaterial(input, [first.id]).material;
    const third = createCustomMaterial(input, [first.id, second.id]).material;
    expect([first.id, second.id, third.id]).toEqual(['custom-my-insulation', 'custom-my-insulation-2', 'custom-my-insulation-3']);
  });

  it('cannot clash with built-in ids and merges cleanly into the database', () => {
    const { material } = createCustomMaterial({ name: 'EPS slab', lambdaWPerMK: 0.04 }, BUILT_IN_MATERIALS.map((m) => m.id));
    expect(material.id).toBe('custom-eps-slab');
    expect(mergeMaterials(BUILT_IN_MATERIALS, [material])).toHaveLength(BUILT_IN_MATERIALS.length + 1);
  });

  it.each([[0], [-0.04], [NaN], [Infinity], [wrong(undefined)], [wrong('0.04')]])('rejects conductivity %s', (value) => {
    const issues = issuesOf(() => createCustomMaterial({ ...input, lambdaWPerMK: value }));
    expect(issues.map((i) => i.path)).toEqual(['lambdaWPerMK']);
  });

  it('rejects a blank name and invalid optional values, listing all problems', () => {
    const issues = issuesOf(() => createCustomMaterial({ name: '   ', lambdaWPerMK: 0.04, densityKgPerM3: -1, specificHeatJPerKgK: 0 }));
    expect(issues.map((i) => i.path)).toEqual(['name', 'densityKgPerM3', 'specificHeatJPerKgK']);
  });

  it('rejects an unknown category and junk input', () => {
    expect(() => createCustomMaterial({ ...input, category: wrong('Wood') })).toThrow(EngineInputError);
    expect(() => createCustomMaterial(wrong(null))).toThrow(EngineInputError);
  });

  it('does not throw for suspicious numbers but returns warnings', () => {
    const { material, warnings } = createCustomMaterial({ name: 'Typo', lambdaWPerMK: 40, specificHeatJPerKgK: 1.2 });
    expect(material.lambdaWPerMK).toBe(40);
    expect(warnings).toHaveLength(2);
  });
});

describe('materialToLayer (database → engine)', () => {
  const eps = findMaterialById(BUILT_IN_MATERIALS, 'eps-slab') as MaterialRecord;

  it('copies the properties and carries the data status', () => {
    expect(materialToLayer(eps, 0.08)).toEqual({
      name: eps.name,
      thicknessM: 0.08,
      lambdaWPerMK: 0.035,
      densityKgPerM3: 25,
      specificHeatJPerKgK: 1450,
      propertyStatus: 'illustrative',
    });
  });

  it('allows a custom layer name and omits missing density/specific heat', () => {
    const { material } = createCustomMaterial({ name: 'Bare', lambdaWPerMK: 0.5 });
    const layer = materialToLayer(material, 0.1, 'Inner leaf');
    expect(layer).toEqual({ name: 'Inner leaf', thicknessM: 0.1, lambdaWPerMK: 0.5, propertyStatus: 'user-defined' });
  });
});

describe('database + engine working together', () => {
  const layersFrom = (specs: Array<[string, number]>) =>
    specs.map(([id, thicknessM]) => materialToLayer(findMaterialById(BUILT_IN_MATERIALS, id) as MaterialRecord, thicknessM));

  const wallFromDatabase = () =>
    referenceWall({
      layers: layersFrom([
        ['gypsum-plaster', 0.015],
        ['clay-brick-solid', 0.2],
        ['eps-slab', 0.08],
        ['cement-plaster', 0.02],
      ]),
    });

  it('builds a valid wall from database materials and calculates it', () => {
    const wall = wallFromDatabase();
    expect(validateWallInput(wall)).toEqual([]);
    const result = calculateWall(wall);
    // Independent hand calculation: R = 0.015/0.43 + 0.2/0.7 + 0.08/0.035 + 0.02/1.0, plus 0.13 + 0.04
    const expectedR = 0.015 / 0.43 + 0.2 / 0.7 + 0.08 / 0.035 + 0.02 / 1.0 + 0.13 + 0.04;
    expectClose(result.resistance.totalM2KPerW, expectedR);
    expectClose(result.uValueWPerM2K, 1 / expectedR);
    expect(result.heatCapacity.available).toBe(true);
  });

  it('flags the result because the data is illustrative', () => {
    const result = calculateWall(wallFromDatabase());
    const warning = result.warnings.find((w) => w.code === 'layer-properties-not-verified');
    expect(warning?.message).toContain('Gypsum plaster (demonstration) (illustrative)');
    expect(warning?.message).toContain('not for design or compliance');
    result.layers.forEach((layer) => expect(layer.propertyStatus).toBe('illustrative'));
  });

  it('does not flag user-defined or status-less layers with this warning', () => {
    const { material } = createCustomMaterial({ name: 'Mine', lambdaWPerMK: 0.1, densityKgPerM3: 800, specificHeatJPerKgK: 1000 });
    const custom = calculateWall(
      referenceWall({ layers: [materialToLayer(material, 0.1)], surfaceResistances: customSurfaceResistances(0.13, 0.04, 'horizontal', 'test') }),
    );
    expect(custom.warnings.map((w) => w.code)).not.toContain('layer-properties-not-verified');
    expect(calculateWall(referenceWall()).warnings.map((w) => w.code)).not.toContain('layer-properties-not-verified');
  });

  it('flags "unverified" layers too, and lists only the weak ones', () => {
    const wall = wallFromDatabase();
    const layer0 = wall.layers[0];
    if (!layer0) throw new Error('missing layer');
    wall.layers[0] = { ...layer0, propertyStatus: 'verified', name: 'Checked plaster' };
    wall.layers[1] = { ...(wall.layers[1] ?? layer0), propertyStatus: 'unverified', name: 'Brick' };
    const message = calculateWall(wall).warnings.find((w) => w.code === 'layer-properties-not-verified')?.message ?? '';
    expect(message).toContain('Brick (unverified)');
    expect(message).not.toContain('Checked plaster');
  });

  it('rejects an invalid propertyStatus value', () => {
    const wall = wallFromDatabase();
    wall.layers[0] = { ...(wall.layers[0] as NonNullable<(typeof wall.layers)[0]>), propertyStatus: wrong('certified') };
    expect(validateWallInput(wall).map((i) => i.path)).toEqual(['layers[0].propertyStatus']);
  });

  it('supports the comparison from the brief: EPS vs mineral wool vs XPS vs PUR at equal thickness', () => {
    const uFor = (id: string) =>
      calculateWall(
        referenceWall({
          layers: layersFrom([
            ['gypsum-plaster', 0.015],
            ['concrete-block-medium', 0.2],
            [id, 0.08],
            ['cement-plaster', 0.02],
          ]),
        }),
      ).uValueWPerM2K;
    const u = Object.fromEntries(['eps-slab', 'xps-board', 'mineral-wool-slab', 'polyurethane-board'].map((id) => [id, uFor(id)]));
    // Lower λ at equal thickness must give lower U (illustrative values, but the ordering follows from λ).
    expect(u['polyurethane-board']).toBeLessThan(u['xps-board'] as number);
    expect(u['xps-board']).toBeLessThan(u['eps-slab'] as number);
    expect(u['eps-slab']).toBeLessThan(u['mineral-wool-slab'] as number);
  });
});
