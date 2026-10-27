import { describe, expect, it } from 'vitest';
import {
  addLayer,
  buildWall,
  createEmptyDraft,
  createInitialDraft,
  MAX_FILE_CHARS,
  MAX_LAYERS,
  moveLayer,
  parseDraft,
  serializeDraft,
  setLayerMaterial,
  setLayerThickness,
  setLayerThicknessUnit,
  setTemperatureUnit,
  WALL_FILE_SCHEMA,
} from '../src/editor';
import type { WallDraft } from '../src/editor';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { at } from './helpers/helpers';

const initial = (): WallDraft => createInitialDraft(BUILT_IN_MATERIALS);
const parse = (text: string) => parseDraft(text, BUILT_IN_MATERIALS);

/** Parses a saved file, edits the JSON, and writes it back as text. */
function edited(change: (file: any) => void, draft: WallDraft = initial()): string {
  const file = JSON.parse(serializeDraft(draft, BUILT_IN_MATERIALS));
  change(file);
  return JSON.stringify(file);
}

describe('save and load round trip', () => {
  it('restores the starter wall exactly', () => {
    const result = parse(serializeDraft(initial(), BUILT_IN_MATERIALS));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft).toEqual(initial());
      expect(result.warnings).toEqual([]);
    }
  });

  it('restores half-typed text, other units, a custom surface mode and an incomplete layer exactly as typed', () => {
    let draft = initial();
    draft = setTemperatureUnit(draft, 'F');
    draft = setLayerThicknessUnit(draft, 'layer-2', 'cm');
    draft = setLayerThickness(draft, 'layer-1', '1,5.');
    draft = addLayer(draft);
    draft = moveLayer(draft, 'layer-3', 'toward-interior');
    draft = { ...draft, surfaceMode: 'custom', surfaceInsideText: '0,13', surfaceOutsideText: 'abc' };
    const result = parse(serializeDraft(draft, BUILT_IN_MATERIALS));
    expect(result.ok && result.draft).toEqual(draft);
  });

  it('a reopened wall gives the same engine input as the original', () => {
    const draft = setLayerMaterial(initial(), 'layer-3', 'xps-board');
    const result = parse(serializeDraft(draft, BUILT_IN_MATERIALS));
    expect(result.ok).toBe(true);
    if (result.ok) expect(buildWall(result.draft, BUILT_IN_MATERIALS).wall).toEqual(buildWall(draft, BUILT_IN_MATERIALS).wall);
  });

  it('works for an empty wall', () => {
    const result = parse(serializeDraft(createEmptyDraft(), BUILT_IN_MATERIALS));
    expect(result.ok && result.draft).toEqual(createEmptyDraft());
  });

  it('the file says what it is and records the materials used', () => {
    const file = JSON.parse(serializeDraft(initial(), BUILT_IN_MATERIALS));
    expect(file.schema).toBe(WALL_FILE_SCHEMA);
    expect(file.schemaVersion).toBe(1);
    expect(file.note).toMatch(/illustrative/i);
    expect(file.materialsUsed.map((m: { id: string }) => m.id).sort()).toEqual(['cement-plaster', 'clay-brick-solid', 'eps-slab', 'gypsum-plaster']);
    expect(file.materialsUsed.every((m: { status: string }) => m.status === 'illustrative')).toBe(true);
  });
});

describe('changed or missing materials produce warnings, not silent differences', () => {
  it('warns about a material that is not in the database', () => {
    const result = parse(edited((f) => (f.draft.layers[1].materialId = 'unobtainium')));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.join(' ')).toMatch(/unobtainium/);
      expect(result.draft.layers[1]?.materialId).toBe('unobtainium'); // kept, so the editor can report it
    }
  });

  it('warns when the saved conductivity or status differs from the current database', () => {
    const result = parse(edited((f) => (f.materialsUsed.find((m: { id: string }) => m.id === 'eps-slab').lambdaWPerMK = 0.99)));
    expect(result.ok && result.warnings.join(' ')).toMatch(/EPS|eps/i);
    const status = parse(edited((f) => (f.materialsUsed[0].status = 'verified')));
    expect(status.ok && status.warnings.length).toBe(1);
  });

  it('a snapshot entry for a material no longer used by any layer is ignored', () => {
    const result = parse(edited((f) => f.materialsUsed.push({ id: 'xps-board', name: 'x', lambdaWPerMK: 99, status: 'verified' })));
    expect(result.ok && result.warnings).toEqual([]);
  });
});

describe('bad files are refused with a clear message and never throw', () => {
  const refused = (text: string): string => {
    const result = parse(text);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.error;
  };

  it('empty, not JSON, wrong shape', () => {
    expect(refused('')).toMatch(/empty/);
    expect(refused('   \n')).toMatch(/empty/);
    expect(refused('{not json')).toMatch(/not valid JSON/);
    expect(refused('[]')).toMatch(/not a wall file/);
    expect(refused('null')).toMatch(/not a wall file/);
    expect(refused('"text"')).toMatch(/not a wall file/);
    expect(refused('{}')).toMatch(/not a wall file/);
    expect(refused(JSON.stringify({ schema: 'something-else', schemaVersion: 1, draft: {} }))).toMatch(/not a wall file/);
  });

  it('missing, invalid or newer version', () => {
    expect(refused(edited((f) => delete f.schemaVersion))).toMatch(/version/);
    expect(refused(edited((f) => (f.schemaVersion = 1.5)))).toMatch(/version/);
    expect(refused(edited((f) => (f.schemaVersion = 0)))).toMatch(/version/);
    expect(refused(edited((f) => (f.schemaVersion = '1')))).toMatch(/version/);
    expect(refused(edited((f) => (f.schemaVersion = 2)))).toMatch(/newer/);
  });

  it('a file that is too large', () => {
    expect(refused('x'.repeat(MAX_FILE_CHARS + 1))).toMatch(/too large/);
  });

  it('missing or wrongly typed draft fields', () => {
    expect(refused(edited((f) => delete f.draft))).toMatch(/draft/);
    expect(refused(edited((f) => (f.draft = []))) ).toMatch(/draft/);
    expect(refused(edited((f) => (f.draft.widthText = 3)))).toMatch(/widthText/);
    expect(refused(edited((f) => delete f.draft.heightText))).toMatch(/heightText/);
    expect(refused(edited((f) => (f.draft.durationText = 'x'.repeat(65))))).toMatch(/durationText/);
    expect(refused(edited((f) => (f.draft.dimensionUnit = 'km')))).toMatch(/dimensionUnit/);
    expect(refused(edited((f) => (f.draft.temperatureUnit = 'R')))).toMatch(/temperatureUnit/);
    expect(refused(edited((f) => (f.draft.surfaceMode = 'magic')))).toMatch(/surfaceMode/);
    expect(refused(edited((f) => (f.draft.layers = 'none')))).toMatch(/layers/);
  });

  it('bad layer entries', () => {
    expect(refused(edited((f) => (f.draft.layers[0] = 5)))).toMatch(/Layer 1 must be an object/);
    expect(refused(edited((f) => (f.draft.layers[0].key = 'layer-0')))).toMatch(/invalid "key"/);
    expect(refused(edited((f) => (f.draft.layers[0].key = '__proto__')))).toMatch(/invalid "key"/);
    expect(refused(edited((f) => (f.draft.layers[0].key = 'layer-1; drop')))).toMatch(/invalid "key"/);
    expect(refused(edited((f) => (f.draft.layers[1].key = 'layer-1')))).toMatch(/repeats/);
    expect(refused(edited((f) => (f.draft.layers[0].materialId = 7)))).toMatch(/materialId/);
    expect(refused(edited((f) => (f.draft.layers[0].materialId = 'x'.repeat(101))))).toMatch(/materialId/);
    expect(refused(edited((f) => delete f.draft.layers[0].materialId))).toMatch(/materialId/);
    expect(refused(edited((f) => (f.draft.layers[0].thicknessText = null)))).toMatch(/thicknessText/);
    expect(refused(edited((f) => (f.draft.layers[0].thicknessUnit = 'in')))).toMatch(/thicknessUnit/);
  });

  it('too many layers', () => {
    const many = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({ key: `layer-${i + 1}`, materialId: null, thicknessText: '1', thicknessUnit: 'mm' }));
    expect(refused(edited((f) => { f.draft.layers = many; f.draft.nextLayerNumber = MAX_LAYERS + 5; }))).toMatch(/at most/);
    const allowed = many.slice(0, MAX_LAYERS);
    expect(parse(edited((f) => { f.draft.layers = allowed; f.draft.nextLayerNumber = MAX_LAYERS + 1; })).ok).toBe(true);
  });

  it('next layer number must keep new layer keys unique', () => {
    expect(refused(edited((f) => (f.draft.nextLayerNumber = 4)))).toMatch(/nextLayerNumber/); // layers 1-4 exist
    expect(refused(edited((f) => (f.draft.nextLayerNumber = 0)))).toMatch(/nextLayerNumber/);
    expect(refused(edited((f) => (f.draft.nextLayerNumber = 2.5)))).toMatch(/nextLayerNumber/);
    expect(refused(edited((f) => (f.draft.nextLayerNumber = '5')))).toMatch(/nextLayerNumber/);
    expect(refused(edited((f) => (f.draft.nextLayerNumber = 2e9)))).toMatch(/nextLayerNumber/);
    expect(parse(edited((f) => (f.draft.nextLayerNumber = 99))).ok).toBe(true);
  });

  it('reports several problems at once but keeps the message short', () => {
    const message = refused(edited((f) => { for (const k of ['widthText', 'heightText', 'durationText', 'insideTemperatureText', 'outsideTemperatureText', 'surfaceInsideText', 'surfaceOutsideText']) f.draft[k] = 1; }));
    expect(message).toMatch(/and 2 more/);
  });
});

describe('a file cannot smuggle extra data into the draft', () => {
  it('extra fields and a __proto__ entry are not copied', () => {
    const text = edited((f) => { f.draft.evil = 'x'; f.draft.layers[0].evil = 'y'; }).replace('"draft":{', '"draft":{"__proto__":{"polluted":true},');
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.draft).sort()).toEqual(Object.keys(initial()).sort());
      expect(Object.keys(at(result.draft.layers, 0)).sort()).toEqual(['key', 'materialId', 'thicknessText', 'thicknessUnit']);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('text containing markup is kept as plain text (the editor only ever displays it as text)', () => {
    const result = parse(edited((f) => (f.draft.widthText = '<img src=x onerror=alert(1)>')));
    expect(result.ok && result.draft.widthText).toBe('<img src=x onerror=alert(1)>');
    // ...and it is then reported by the normal validation as "not a number", not executed.
    if (result.ok) expect(buildWall(result.draft, BUILT_IN_MATERIALS).ok).toBe(false);
  });
});

describe('random damage never crashes the reader', () => {
  it('survives truncation and random byte flips of a valid file', () => {
    const valid = serializeDraft(initial(), BUILT_IN_MATERIALS);
    let seed = 12345;
    const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 400; i++) {
      let text = valid;
      if (i % 3 === 0) text = valid.slice(0, Math.floor(random() * valid.length));
      else {
        const chars = [...valid];
        for (let j = 0; j < 1 + Math.floor(random() * 4); j++) chars[Math.floor(random() * chars.length)] = String.fromCharCode(32 + Math.floor(random() * 95));
        text = chars.join('');
      }
      const result = parse(text);
      if (result.ok) {
        // whatever was accepted must still be a well-formed draft the editor can handle
        expect(() => buildWall(result.draft, BUILT_IN_MATERIALS)).not.toThrow();
      } else {
        expect(result.error.length).toBeGreaterThan(5);
      }
    }
  });
});
