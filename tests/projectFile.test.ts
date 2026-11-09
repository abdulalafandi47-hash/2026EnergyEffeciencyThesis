/**
 * Building project files: round trip, refusals of damaged or hostile files, and
 * random corruption (the reader must never throw and never let bad data through).
 */
import { describe, expect, it } from 'vitest';
import { calculateEnvelope, createBlankProject, createExampleHouse, parseProject, PROJECT_FILE_SCHEMA, serializeProject, updateComponent } from '../src/envelope';
import type { BuildingProject, DocumentedValue, Glazing } from '../src/envelope';
import { BUILT_IN_MATERIALS, createCustomMaterial } from '../src/materials';

const documented = (value: number, source = 'Manufacturer datasheet (test)'): DocumentedValue => ({ value, unit: 'W/(m²·K)', source, valueType: 'declared', conditions: 'EN test (test)', status: 'user-defined' });
const custom = createCustomMaterial({ name: 'Datasheet block (test)', lambdaWPerMK: 0.21, densityKgPerM3: 900, specificHeatJPerKgK: 1000, sourceNote: 'Datasheet (test)', valueType: 'declared' }).material;

function richProject(): BuildingProject {
  let p = createExampleHouse(BUILT_IN_MATERIALS);
  const w = p.components.find((c) => c.id === 'c8') as Glazing;
  p = updateComponent(p, { ...w, uValue: documented(1.6), gValue: { ...documented(0.5), unit: '–' } });
  const wall = p.components.find((c) => c.id === 'c1');
  if (wall && 'construction' in wall) p = updateComponent(p, { ...wall, construction: { layers: [...wall.construction.layers, { materialId: custom.id, thicknessM: 0.1 }] } });
  return { ...p, name: 'My test house' };
}
const all = [...BUILT_IN_MATERIALS, custom];
const parse = (text: string) => parseProject(text, BUILT_IN_MATERIALS);
const fileOf = (p: BuildingProject) => JSON.parse(serializeProject(p, all)) as Record<string, any>;

describe('building project file: round trip', () => {
  it('reopens the same model, including documented values and the custom material it uses', () => {
    const p = richProject();
    const out = parse(serializeProject(p, all));
    if (!out.ok) throw new Error(out.error);
    expect(out.project).toEqual(p);
    expect(out.customMaterials.map((m) => m.id)).toEqual([custom.id]);
    expect(out.warnings).toEqual([]);
    // The same results come out.
    expect(calculateEnvelope(out.project, [...BUILT_IN_MATERIALS, ...out.customMaterials])).toEqual(calculateEnvelope(p, all));
  });

  it('a blank project round-trips too', () => {
    const p = createBlankProject();
    const out = parse(serializeProject(p, all));
    expect(out.ok && out.project).toEqual(p);
  });

  it('records the file kind, a note and a snapshot of the materials used', () => {
    const f = fileOf(richProject());
    expect(f.schema).toBe(PROJECT_FILE_SCHEMA);
    expect(f.note).toMatch(/illustrative/);
    expect(f.materialsUsed.map((m: { id: string }) => m.id)).toContain('clay-brick-solid');
    expect(f.customMaterials).toHaveLength(1); // only custom materials it uses
  });

  it('drops unknown extra fields', () => {
    const f = fileOf(richProject());
    f.project.components[0].evil = '<script>';
    f.project.extra = 1;
    const out = parse(JSON.stringify(f));
    expect(out.ok && JSON.stringify(out.project)).not.toContain('evil');
    expect(out.ok && 'extra' in out.project).toBe(false);
  });
});

describe('building project file: refusals', () => {
  const mutate = (fn: (f: Record<string, any>) => void): string => {
    const f = fileOf(richProject());
    fn(f);
    return JSON.stringify(f);
  };
  const refused = (text: string, words: RegExp): void => {
    const out = parse(text);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(words);
  };

  it('not JSON, not a project, a wall file, another version, too large', () => {
    refused('nonsense', /not valid JSON/);
    refused('{}', /not a building project/);
    refused(JSON.stringify({ schema: 'building-thermal-simulator.wall' }), /WALL/);
    refused(mutate((f) => (f.schemaVersion = 99)), /version 99/);
    refused('x'.repeat(2_000_001), /too large/);
  });

  it('a documented value cannot claim to be verified, and needs its fields', () => {
    refused(mutate((f) => (f.project.components.find((c: any) => c.id === 'c8').uValue.status = 'verified')), /user-defined documented values/);
    refused(mutate((f) => delete f.project.components.find((c: any) => c.id === 'c8').uValue.source), /source/);
    refused(mutate((f) => (f.project.components.find((c: any) => c.id === 'c8').uValue.valueType = 'guessed')), /value type/);
  });

  it('a custom material cannot claim another status or a built-in id', () => {
    refused(mutate((f) => (f.customMaterials[0].status = 'verified')), /user-defined materials|not a valid material record/);
    refused(mutate((f) => (f.customMaterials[0].status = 'illustrative')), /user-defined materials|not a valid material record/);
    refused(mutate((f) => (f.customMaterials[0].id = 'clay-brick-solid')), /custom material ids|repeats/);
  });

  it('bad geometry, conditions, component types and duplicate ids', () => {
    refused(mutate((f) => (f.project.geometry.lengthM = 0)), /House length/);
    refused(mutate((f) => (f.project.geometry.depthM = 'ten')), /House depth/);
    refused(mutate((f) => (f.project.conditions.insideC = -300)), /Inside temperature/);
    refused(mutate((f) => (f.project.components[0].type = 'chimney')), /type/);
    refused(mutate((f) => (f.project.components[1].id = f.project.components[0].id)), /repeats the id/);
    refused(mutate((f) => (f.project.components = {})), /no list of components/);
    refused(mutate((f) => (f.project.components[0].construction.layers[0].thicknessM = 'thick')), /thickness/);
  });

  it('every refusal is plain words, never an exception', () => {
    for (const text of ['null', '[]', '1', '"x"', JSON.stringify({ schema: PROJECT_FILE_SCHEMA, schemaVersion: 1 }), JSON.stringify({ schema: PROJECT_FILE_SCHEMA, schemaVersion: 1, project: { components: [null, 1, 'x', []] } })]) {
      const out = parse(text);
      expect(out.ok).toBe(false);
    }
  });
});

describe('building project file: warnings and ids', () => {
  it('warns about materials missing from this program and changed built-in values', () => {
    const f = fileOf(richProject());
    f.project.components[0].construction.layers[0].materialId = 'no-such-material';
    f.materialsUsed.find((m: { id: string }) => m.id === 'clay-brick-solid').lambdaWPerMK = 9.99;
    const out = parse(JSON.stringify(f));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warnings.join(' ')).toMatch(/no-such-material/);
      expect(out.warnings.join(' ')).toMatch(/λ was 9.99/);
    }
  });

  it('a too-small id counter is raised so new components never reuse an id', () => {
    const f = fileOf(richProject());
    f.project.nextId = 1;
    const out = parse(JSON.stringify(f));
    expect(out.ok && out.project.nextId).toBe(15);
  });
});

describe('building project file: random corruption', () => {
  // Deterministic pseudo-random numbers, so a failure can be reproduced.
  let seed = 12345;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const junk = [null, -1, 0, 1e309, 'x', '', true, [], {}, { kind: 'outside' }, NaN];

  it('400 corrupted files: never throws; anything accepted is a well-formed project', () => {
    const base = serializeProject(richProject(), all);
    let accepted = 0;
    for (let i = 0; i < 400; i++) {
      const f = JSON.parse(base);
      // Replace one random leaf value somewhere in the project.
      const paths: Array<[any, string | number]> = [];
      const walk = (o: any): void => {
        if (o && typeof o === 'object') for (const k of Object.keys(o)) { paths.push([o, Array.isArray(o) ? Number(k) : k]); walk(o[k]); }
      };
      walk(f.project);
      const [obj, key] = paths[Math.floor(rand() * paths.length)] as [any, string | number];
      obj[key] = junk[Math.floor(rand() * junk.length)];
      const out = parse(JSON.stringify(f));
      if (out.ok) {
        accepted++;
        // Accepted means usable: it calculates without throwing.
        expect(() => calculateEnvelope(out.project, [...BUILT_IN_MATERIALS, ...out.customMaterials])).not.toThrow();
        expect(out.project.geometry.lengthM).toBeGreaterThan(0);
      }
    }
    expect(accepted).toBeLessThan(400); // most corruptions are caught
  });
});
