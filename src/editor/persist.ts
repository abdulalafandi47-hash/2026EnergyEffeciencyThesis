/**
 * Saving a wall draft to a file and reading it back.
 *
 * A saved wall is a small JSON file holding the draft exactly as typed (text and
 * units), so reopening it restores the editor, and a thesis can keep the file
 * next to the report it produced.
 *
 * The file stores material IDS, not material properties: the numbers come from
 * the material database of the program that opens it. So that a change in the
 * database cannot go unnoticed, the file also records a snapshot of the values
 * used (id, name, λ, status) and loading warns when they differ from the
 * current database.
 *
 * Version 2 also stores the user's CUSTOM materials (status "user-defined"), so a
 * wall built with datasheet values can be reopened. A file can only ever add
 * user-defined records: anything claiming another status, or reusing a built-in
 * id, is refused. Version 1 files (no custom materials) still open.
 *
 * A file is untrusted input. `parseDraft` checks every field and copies it into
 * a fresh object (nothing from the file is passed on as-is), and never throws.
 */
import { MAX_NAME_CHARS, MAX_NOTE_CHARS, validateMaterial } from '../materials';
import type { MaterialRecord } from '../materials';
import type { LayerDraft, LengthUnit, SurfaceMode, TemperatureUnit, WallDraft } from './types';

export const WALL_FILE_SCHEMA = 'building-thermal-simulator.wall';
export const WALL_FILE_VERSION = 2;
/** Oldest version this program can still read. */
export const OLDEST_WALL_FILE_VERSION = 1;

/** Limits that keep a damaged or hostile file from using up memory. */
export const MAX_FILE_CHARS = 1_000_000;
export const MAX_LAYERS = 200;
export const MAX_TEXT_CHARS = 64;
const MAX_ID_CHARS = 100;
export const MAX_CUSTOM_MATERIALS = 100;

const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm'];
const TEMPERATURE_UNITS: readonly TemperatureUnit[] = ['C', 'K', 'F'];
const SURFACE_MODES: readonly SurfaceMode[] = ['preset-horizontal', 'custom'];

export interface MaterialSnapshot {
  id: string;
  name: string;
  lambdaWPerMK: number;
  status: string;
}

export interface WallFile {
  schema: typeof WALL_FILE_SCHEMA;
  schemaVersion: typeof WALL_FILE_VERSION;
  /** Free text reminding the reader what this file is and is not. */
  note: string;
  draft: WallDraft;
  /** Values of the materials used when the file was written (informational). */
  materialsUsed: MaterialSnapshot[];
  /** The user's custom materials (status "user-defined"), complete records. */
  customMaterials: MaterialRecord[];
}

export type ParseDraftResult =
  | { ok: true; draft: WallDraft; warnings: string[]; customMaterials: MaterialRecord[] }
  | { ok: false; error: string };

const FILE_NOTE =
  'Wall saved by the Wall Thermal Simulator. It stores what was typed in the editor and the user\'s custom materials; built-in material properties come from the program that opens it. ' +
  'Built-in material values are illustrative, not approved design values.';

/**
 * The text of a wall file for this draft. `materials` is every material the draft may
 * refer to; `customMaterials` are written out in full so they travel with the wall.
 */
export function serializeDraft(draft: WallDraft, materials: readonly MaterialRecord[], customMaterials: readonly MaterialRecord[] = []): string {
  const used: MaterialSnapshot[] = [];
  for (const layer of draft.layers) {
    const material = layer.materialId === null ? undefined : materials.find((m) => m.id === layer.materialId);
    if (material && !used.some((u) => u.id === material.id)) {
      used.push({ id: material.id, name: material.name, lambdaWPerMK: material.lambdaWPerMK, status: material.status });
    }
  }
  const file: WallFile = {
    schema: WALL_FILE_SCHEMA,
    schemaVersion: WALL_FILE_VERSION,
    note: FILE_NOTE,
    draft: copyDraft(draft),
    materialsUsed: used,
    customMaterials: customMaterials.map(copyMaterial),
  };
  return JSON.stringify(file, null, 2);
}

function copyDraft(draft: WallDraft): WallDraft {
  return {
    widthText: draft.widthText,
    heightText: draft.heightText,
    dimensionUnit: draft.dimensionUnit,
    layers: draft.layers.map((l) => ({ key: l.key, materialId: l.materialId, thicknessText: l.thicknessText, thicknessUnit: l.thicknessUnit })),
    insideTemperatureText: draft.insideTemperatureText,
    outsideTemperatureText: draft.outsideTemperatureText,
    temperatureUnit: draft.temperatureUnit,
    durationText: draft.durationText,
    surfaceMode: draft.surfaceMode,
    surfaceInsideText: draft.surfaceInsideText,
    surfaceOutsideText: draft.surfaceOutsideText,
    nextLayerNumber: draft.nextLayerNumber,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy of a material record holding only the known fields (anything extra is dropped). */
function copyMaterial(m: MaterialRecord): MaterialRecord {
  const optional = <K extends keyof MaterialRecord>(key: K): Partial<MaterialRecord> => (m[key] === undefined ? {} : { [key]: m[key] });
  const source = m.source;
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    lambdaWPerMK: m.lambdaWPerMK,
    ...optional('densityKgPerM3'),
    ...optional('specificHeatJPerKgK'),
    ...(m.additionalProperties ? { additionalProperties: m.additionalProperties.map((p) => ({ name: p.name, value: p.value, unit: p.unit })) } : {}),
    units: { conductivity: m.units.conductivity, density: m.units.density, specificHeat: m.units.specificHeat },
    status: m.status,
    valueType: m.valueType,
    source: {
      type: source.type,
      citation: source.citation,
      ...(source.url !== undefined ? { url: source.url } : {}),
      ...(source.location !== undefined ? { location: source.location } : {}),
      ...(source.checkedOn !== undefined ? { checkedOn: source.checkedOn } : {}),
      ...(source.checkedBy !== undefined ? { checkedBy: source.checkedBy } : {}),
    },
    ...optional('conditions'),
    assumptionsAndLimitations: [...m.assumptionsAndLimitations],
  };
}

/** Checks the custom materials of a file. Only complete, valid, user-defined records with new ids are accepted. */
function readCustomMaterials(raw: unknown, builtIn: readonly MaterialRecord[], problems: string[]): MaterialRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push('"customMaterials" must be a list.');
    return [];
  }
  if (raw.length > MAX_CUSTOM_MATERIALS) {
    problems.push(`A wall file may hold at most ${MAX_CUSTOM_MATERIALS} custom materials (this one has ${raw.length}).`);
    return [];
  }
  const accepted: MaterialRecord[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index: number) => {
    const where = `Custom material ${index + 1}`;
    const issues = validateMaterial(entry);
    if (issues.length > 0) return void problems.push(`${where} is not a valid material record (${issues[0]?.message ?? 'invalid'}).`);
    const m = entry as MaterialRecord;
    if (m.status !== 'user-defined') return void problems.push(`${where} claims the status "${m.status}"; a wall file may only add user-defined materials.`);
    if (!m.id.startsWith('custom-')) return void problems.push(`${where} has the id "${m.id}"; custom material ids start with "custom-".`);
    if (builtIn.some((b) => b.id === m.id) || seen.has(m.id)) return void problems.push(`${where} repeats the id "${m.id}".`);
    if (m.name.length > MAX_NAME_CHARS || (m.conditions ?? '').length > MAX_NOTE_CHARS || m.source.citation.length > MAX_NOTE_CHARS + 50) {
      return void problems.push(`${where} has text that is too long.`);
    }
    seen.add(m.id);
    accepted.push(copyMaterial(m));
  });
  return accepted;
}

/**
 * Reads a wall file. Never throws; explains what is wrong in plain words.
 * `materials` is the program's own (non-custom) material list; custom materials come from the file.
 */
export function parseDraft(text: string, materials: readonly MaterialRecord[]): ParseDraftResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'The file is empty.' };
  if (text.length > MAX_FILE_CHARS) return { ok: false, error: `The file is too large (more than ${MAX_FILE_CHARS.toLocaleString('en')} characters) to be a wall file.` };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON, so it cannot be a wall file saved by this program.' };
  }
  if (!isRecord(data) || data.schema !== WALL_FILE_SCHEMA) {
    return { ok: false, error: 'This is not a wall file from this program (its "schema" entry is missing or different).' };
  }
  if (typeof data.schemaVersion !== 'number' || !Number.isInteger(data.schemaVersion) || data.schemaVersion < OLDEST_WALL_FILE_VERSION) {
    return { ok: false, error: 'The wall file has no valid version number.' };
  }
  if (data.schemaVersion > WALL_FILE_VERSION) {
    return { ok: false, error: `The wall file is version ${data.schemaVersion}, newer than this program understands (version ${WALL_FILE_VERSION}).` };
  }
  const raw = data.draft;
  if (!isRecord(raw)) return { ok: false, error: 'The wall file has no "draft" section.' };

  const problems: string[] = [];
  const text64 = (name: string): string => {
    const value = raw[name];
    if (typeof value !== 'string') {
      problems.push(`"${name}" must be text.`);
      return '';
    }
    if (value.length > MAX_TEXT_CHARS) {
      problems.push(`"${name}" is longer than ${MAX_TEXT_CHARS} characters.`);
      return '';
    }
    return value;
  };
  const choice = <T extends string>(name: string, allowed: readonly T[]): T => {
    const value = raw[name];
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    problems.push(`"${name}" must be one of: ${allowed.join(', ')}.`);
    return allowed[0] as T;
  };

  const widthText = text64('widthText');
  const heightText = text64('heightText');
  const dimensionUnit = choice('dimensionUnit', LENGTH_UNITS);
  const insideTemperatureText = text64('insideTemperatureText');
  const outsideTemperatureText = text64('outsideTemperatureText');
  const temperatureUnit = choice('temperatureUnit', TEMPERATURE_UNITS);
  const durationText = text64('durationText');
  const surfaceMode = choice('surfaceMode', SURFACE_MODES);
  const surfaceInsideText = text64('surfaceInsideText');
  const surfaceOutsideText = text64('surfaceOutsideText');

  const layers: LayerDraft[] = [];
  const rawLayers = raw.layers;
  let highestKeyNumber = 0;
  if (!Array.isArray(rawLayers)) {
    problems.push('"layers" must be a list.');
  } else if (rawLayers.length > MAX_LAYERS) {
    problems.push(`A wall file may hold at most ${MAX_LAYERS} layers (this one has ${rawLayers.length}).`);
  } else {
    const seen = new Set<string>();
    rawLayers.forEach((entry: unknown, index: number) => {
      const where = `Layer ${index + 1}`;
      if (!isRecord(entry)) return void problems.push(`${where} must be an object.`);
      const key = entry.key;
      const keyMatch = typeof key === 'string' ? /^layer-([1-9]\d{0,8})$/.exec(key) : null;
      if (typeof key !== 'string' || !keyMatch) return void problems.push(`${where} has an invalid "key" (expected layer-1, layer-2, …).`);
      if (seen.has(key)) return void problems.push(`${where} repeats the key "${key}".`);
      seen.add(key);
      highestKeyNumber = Math.max(highestKeyNumber, Number(keyMatch[1]));
      const materialId = entry.materialId;
      if (materialId !== null && (typeof materialId !== 'string' || materialId.length > MAX_ID_CHARS)) {
        return void problems.push(`${where}: "materialId" must be text or null.`);
      }
      const thicknessText = entry.thicknessText;
      if (typeof thicknessText !== 'string' || thicknessText.length > MAX_TEXT_CHARS) return void problems.push(`${where}: "thicknessText" must be short text.`);
      const thicknessUnit = entry.thicknessUnit;
      if (typeof thicknessUnit !== 'string' || !(LENGTH_UNITS as readonly string[]).includes(thicknessUnit)) {
        return void problems.push(`${where}: "thicknessUnit" must be one of: ${LENGTH_UNITS.join(', ')}.`);
      }
      layers.push({ key, materialId: materialId as string | null, thicknessText, thicknessUnit: thicknessUnit as LengthUnit });
    });
  }

  const next = raw.nextLayerNumber;
  if (typeof next !== 'number' || !Number.isInteger(next) || next < 1 || next > 1_000_000_000) {
    problems.push('"nextLayerNumber" must be a whole number of at least 1.');
  } else if (next <= highestKeyNumber) {
    problems.push('"nextLayerNumber" must be larger than every layer key number.');
  }

  const customMaterials = readCustomMaterials(data.customMaterials, materials, problems);

  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join(' ');
    return { ok: false, error: `The wall file is damaged or not from this program: ${shown}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}` };
  }

  const known = [...materials, ...customMaterials];
  const warnings: string[] = [];
  const snapshot = Array.isArray(data.materialsUsed) ? data.materialsUsed.filter(isRecord) : [];
  for (const layer of layers) {
    if (layer.materialId !== null && !known.some((m) => m.id === layer.materialId)) {
      warnings.push(`Layer ${layers.indexOf(layer) + 1} uses the material "${layer.materialId}", which is not in this program's material database. Choose another material for that layer.`);
    }
  }
  for (const saved of snapshot) {
    const id = typeof saved.id === 'string' ? saved.id : null;
    const current = id === null ? undefined : known.find((m) => m.id === id);
    if (!current || !layers.some((l) => l.materialId === id)) continue;
    const lambdaChanged = typeof saved.lambdaWPerMK === 'number' && saved.lambdaWPerMK !== current.lambdaWPerMK;
    const statusChanged = typeof saved.status === 'string' && saved.status !== current.status;
    if (lambdaChanged || statusChanged) {
      warnings.push(
        `Material "${current.name}" differs from when the file was saved (saved λ ${String(saved.lambdaWPerMK)} W/(m·K), status ${String(saved.status)}; now λ ${current.lambdaWPerMK} W/(m·K), status ${current.status}). Results may not match the earlier ones.`,
      );
    }
  }

  const draft: WallDraft = {
    widthText, heightText, dimensionUnit, layers, insideTemperatureText, outsideTemperatureText, temperatureUnit,
    durationText, surfaceMode, surfaceInsideText, surfaceOutsideText, nextLayerNumber: next as number,
  };
  return { ok: true, draft, warnings, customMaterials };
}
