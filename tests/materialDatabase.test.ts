import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../src/engine';
import {
  BUILT_IN_MATERIALS,
  DATABASE_DISCLAIMER,
  exportMaterialsCsv,
  exportMaterialsJson,
  findMaterialById,
  MATERIAL_CATEGORIES,
  mergeMaterials,
  parseMaterialRecords,
  searchMaterials,
  validateMaterial,
} from '../src/materials';
import type { MaterialCategory, MaterialRecord } from '../src/materials';
import builtInData from '../src/materials/data/builtInMaterials.json';
import { at, issuesOf } from './helpers/helpers';

describe('built-in database integrity', () => {
  it('every record passes validation', () => {
    for (const record of builtInData) {
      expect(validateMaterial(record), `record ${record.id}`).toEqual([]);
    }
  });

  it('ids are unique', () => {
    const ids = BUILT_IN_MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every category requested in the brief', () => {
    const required: MaterialCategory[] = [
      'Concrete',
      'Cement plaster',
      'Gypsum plaster',
      'Clay brick',
      'Concrete block',
      'EPS',
      'XPS',
      'Mineral wool',
      'Polyurethane',
    ];
    const present = new Set(BUILT_IN_MATERIALS.map((m) => m.category));
    for (const category of required) {
      expect(present.has(category), `category ${category}`).toBe(true);
    }
  });

  it('every built-in record has conductivity, density and specific heat (so heat capacity works)', () => {
    for (const m of BUILT_IN_MATERIALS) {
      expect(m.lambdaWPerMK, m.id).toBeGreaterThan(0);
      expect(m.densityKgPerM3, m.id).toBeGreaterThan(0);
      expect(m.specificHeatJPerKgK, m.id).toBeGreaterThan(0);
    }
  });

  it('every record states a source (or the lack of one), conditions and limitations', () => {
    for (const m of BUILT_IN_MATERIALS) {
      expect(m.source.citation.trim().length, m.id).toBeGreaterThan(0);
      expect(m.conditions?.trim().length ?? 0, m.id).toBeGreaterThan(0);
      expect(m.assumptionsAndLimitations.length, m.id).toBeGreaterThan(0);
    }
  });

  it('is honest: nothing is "verified" without a full source trail, and no record is user-defined', () => {
    for (const m of BUILT_IN_MATERIALS) {
      expect(m.status, m.id).not.toBe('user-defined');
      if (m.status === 'verified') {
        expect(m.source.location, m.id).toBeTruthy();
        expect(m.source.checkedOn, m.id).toBeTruthy();
        expect(m.source.checkedBy, m.id).toBeTruthy();
      }
      if (m.status === 'illustrative') {
        expect(m.source.url, m.id).toBeUndefined();
        expect(m.source.citation.toLowerCase(), m.id).toContain('none');
      }
    }
  });

  it('values are in plausible ranges for their category (catches typos like 0.35 for 0.035)', () => {
    // Rough sanity bounds, NOT scientific claims.
    const bounds: Partial<Record<MaterialCategory, { lambda: [number, number]; density: [number, number] }>> = {
      Concrete: { lambda: [0.8, 2.5], density: [1800, 2600] },
      'Cement plaster': { lambda: [0.4, 1.5], density: [1200, 2200] },
      'Gypsum plaster': { lambda: [0.2, 0.8], density: [600, 1600] },
      'Clay brick': { lambda: [0.3, 1.2], density: [1200, 2200] },
      'Concrete block': { lambda: [0.3, 1.6], density: [800, 2200] },
      EPS: { lambda: [0.028, 0.045], density: [10, 60] },
      XPS: { lambda: [0.025, 0.045], density: [20, 60] },
      'Mineral wool': { lambda: [0.03, 0.05], density: [15, 200] },
      Polyurethane: { lambda: [0.018, 0.035], density: [25, 80] },
    };
    for (const m of BUILT_IN_MATERIALS) {
      const b = bounds[m.category];
      if (!b) continue;
      expect(m.lambdaWPerMK, `${m.id} λ`).toBeGreaterThanOrEqual(b.lambda[0]);
      expect(m.lambdaWPerMK, `${m.id} λ`).toBeLessThanOrEqual(b.lambda[1]);
      expect(m.densityKgPerM3 ?? 0, `${m.id} ρ`).toBeGreaterThanOrEqual(b.density[0]);
      expect(m.densityKgPerM3 ?? 0, `${m.id} ρ`).toBeLessThanOrEqual(b.density[1]);
    }
  });

  it('physical ordering holds: insulation conducts far less than masonry, which conducts less than dense concrete', () => {
    const lambda = (id: string) => findMaterialById(BUILT_IN_MATERIALS, id)?.lambdaWPerMK ?? NaN;
    const insulation = ['eps-slab', 'xps-board', 'mineral-wool-slab', 'polyurethane-board'].map(lambda);
    expect(Math.max(...insulation)).toBeLessThan(0.1);
    expect(Math.min(lambda('clay-brick-solid'), lambda('concrete-block-medium'), lambda('gypsum-plaster'))).toBeGreaterThan(
      Math.max(...insulation) * 5,
    );
    expect(lambda('concrete-normal-weight')).toBeGreaterThan(lambda('clay-brick-solid'));
  });

  it('no material has zero or negative values', () => {
    for (const m of BUILT_IN_MATERIALS) {
      for (const value of [m.lambdaWPerMK, m.densityKgPerM3, m.specificHeatJPerKgK]) {
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('every category in the list is a distinct string', () => {
    expect(new Set(MATERIAL_CATEGORIES).size).toBe(MATERIAL_CATEGORIES.length);
  });
});

describe('parseMaterialRecords', () => {
  const good = at(BUILT_IN_MATERIALS, 0);

  it('rejects non-lists', () => {
    expect(() => parseMaterialRecords({})).toThrow(EngineInputError);
    expect(() => parseMaterialRecords(null)).toThrow(EngineInputError);
  });

  it('reports duplicate ids with the position of the duplicate', () => {
    const issues = issuesOf(() => parseMaterialRecords([good, good]));
    expect(issues).toEqual([{ code: 'duplicate-id', path: 'materials[1].id', message: `Duplicate material id "${good.id}".` }]);
  });

  it('prefixes problems with the record position', () => {
    const issues = issuesOf(() => parseMaterialRecords([good, { ...good, id: 'bad', lambdaWPerMK: 0 }]));
    expect(issues.map((i) => i.path)).toEqual(['materials[1].lambdaWPerMK']);
  });
});

describe('searchMaterials', () => {
  it('returns everything for an empty filter, in the original order', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS)).toEqual([...BUILT_IN_MATERIALS]);
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: '   ' })).toEqual([...BUILT_IN_MATERIALS]);
  });

  it('matches names case-insensitively', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'GYPSUM' }).map((m) => m.id)).toEqual(['gypsum-plaster']);
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'mineral wool' }).map((m) => m.id)).toEqual(['mineral-wool-slab']);
  });

  it('requires every word to match, in any order', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'plaster cement' }).map((m) => m.id)).toEqual(['cement-plaster']);
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'plaster banana' })).toEqual([]);
  });

  it('matches category and id text too', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'polyurethane' })).toHaveLength(1);
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'xps-board' })).toHaveLength(1);
  });

  it('filters by category and status', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, { category: 'EPS' }).map((m) => m.id)).toEqual(['eps-slab']);
    expect(searchMaterials(BUILT_IN_MATERIALS, { status: 'verified' })).toEqual([]);
    expect(searchMaterials(BUILT_IN_MATERIALS, { status: 'illustrative' })).toHaveLength(BUILT_IN_MATERIALS.length);
  });

  it('combines text, category and status', () => {
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'plaster', category: 'Gypsum plaster' })).toHaveLength(1);
    expect(searchMaterials(BUILT_IN_MATERIALS, { text: 'plaster', category: 'EPS' })).toEqual([]);
  });

  it('findMaterialById finds or returns undefined', () => {
    expect(findMaterialById(BUILT_IN_MATERIALS, 'eps-slab')?.category).toBe('EPS');
    expect(findMaterialById(BUILT_IN_MATERIALS, 'nope')).toBeUndefined();
  });
});

describe('mergeMaterials', () => {
  it('combines lists and rejects id clashes', () => {
    const extra: MaterialRecord = { ...at(BUILT_IN_MATERIALS, 0), id: 'my-extra' };
    expect(mergeMaterials(BUILT_IN_MATERIALS, [extra])).toHaveLength(BUILT_IN_MATERIALS.length + 1);
    expect(() => mergeMaterials(BUILT_IN_MATERIALS, [at(BUILT_IN_MATERIALS, 0)])).toThrow(EngineInputError);
  });
});

describe('export', () => {
  it('JSON export is self-describing and round-trips through the validator', () => {
    const parsed = JSON.parse(exportMaterialsJson(BUILT_IN_MATERIALS));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.disclaimer).toBe(DATABASE_DISCLAIMER);
    expect(parsed.units).toEqual({ conductivity: 'W/(m·K)', density: 'kg/m³', specificHeat: 'J/(kg·K)' });
    expect(parsed.count).toBe(BUILT_IN_MATERIALS.length);
    expect(parseMaterialRecords(parsed.materials)).toEqual([...BUILT_IN_MATERIALS]);
  });

  it('the disclaimer says the database is not a certified source', () => {
    expect(DATABASE_DISCLAIMER).toContain('NOT a certified source');
  });

  it('JSON export is deterministic', () => {
    expect(exportMaterialsJson(BUILT_IN_MATERIALS)).toBe(exportMaterialsJson(BUILT_IN_MATERIALS));
  });

  it('CSV export has a header and one row per material, with the status visible', () => {
    const lines = exportMaterialsCsv(BUILT_IN_MATERIALS).trimEnd().split('\n');
    expect(at(lines, 0)).toBe(
      'id,name,category,lambda_W_per_mK,density_kg_per_m3,specific_heat_J_per_kgK,status,source_citation,source_url,source_location,checked_on,checked_by,conditions,assumptions_and_limitations',
    );
    expect(lines).toHaveLength(BUILT_IN_MATERIALS.length + 1);
    expect(at(lines, 1)).toContain('"concrete-normal-weight"');
    expect(at(lines, 1)).toContain(',1.7,2300,1000,"illustrative"');
  });

  it('CSV export escapes quotes and neutralises spreadsheet formulas', () => {
    const nasty: MaterialRecord = {
      ...at(BUILT_IN_MATERIALS, 0),
      id: 'nasty',
      name: '=HYPERLINK("http://x")',
      conditions: 'says "hello", ok',
    };
    const csv = exportMaterialsCsv([nasty]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"says ""hello"", ok"');
  });
});
