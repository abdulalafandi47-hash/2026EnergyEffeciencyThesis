/**
 * Saving a building project to a file and reading it back.
 *
 * The file holds the whole model (geometry, condition, every component with its
 * layers, documented window and door values with their sources) and the user's
 * custom materials, so a project can be reopened, shared with a supervisor or
 * kept with the thesis. Like a wall file, it stores material IDS: the numbers of
 * built-in materials come from the program that opens it, and a snapshot of the
 * values used lets loading warn when the database has changed.
 *
 * A file is untrusted input. `parseProject` checks every field, copies it into a
 * fresh object, and never throws. A file cannot raise the trust of a value: custom
 * materials must be user-defined (see `readCustomMaterials`), and documented
 * window and door values from a file must be user-defined too.
 */
import { isRecord } from '../engine';
import type { DataStatus } from '../engine';
import { copyMaterial, readCustomMaterials, THERMAL_VALUE_TYPES } from '../materials';
import type { MaterialRecord, ThermalValueType } from '../materials';
import type {
  BuildingProject,
  Component,
  ComponentType,
  Construction,
  DocumentedValue,
  Exposure,
  Side,
} from './types';

export const PROJECT_FILE_SCHEMA = 'building-thermal-simulator.building';
export const PROJECT_FILE_VERSION = 1;

/** Limits that keep a damaged or hostile file from using up memory. */
export const MAX_PROJECT_FILE_CHARS = 2_000_000;
export const MAX_COMPONENTS = 500;
export const MAX_LAYERS_PER_CONSTRUCTION = 200;
const MAX_NAME = 120;
const MAX_LABEL = 200;
const MAX_SOURCE = 300;
const MAX_UNIT = 30;
const MAX_ID = 100;
/** Larger than any building this model is meant for; keeps arithmetic finite. */
const MAX_LENGTH_M = 10_000;
const MAX_DURATION_H = 1_000_000;

const COMPONENT_TYPES: readonly ComponentType[] = ['exterior-wall', 'partition', 'roof', 'floor', 'window', 'glazed-door', 'door'];
const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];
const EXPOSURE_KINDS: ReadonlyArray<Exposure['kind']> = ['outside', 'unconditioned', 'ground', 'conditioned'];

const FILE_NOTE =
  'Building project saved by the Building Thermal Simulator. It stores the model as entered and the user\'s custom materials; built-in material properties come from the program that opens it. ' +
  'Built-in material values are illustrative, not approved design values. Window and door values are as documented by the user and not checked by the program.';

export interface ProjectMaterialSnapshot {
  id: string;
  name: string;
  lambdaWPerMK: number;
  status: string;
}

export interface ProjectFile {
  schema: typeof PROJECT_FILE_SCHEMA;
  schemaVersion: typeof PROJECT_FILE_VERSION;
  note: string;
  project: BuildingProject;
  materialsUsed: ProjectMaterialSnapshot[];
  customMaterials: MaterialRecord[];
}

export type ParseProjectResult =
  | { ok: true; project: BuildingProject; customMaterials: MaterialRecord[]; warnings: string[] }
  | { ok: false; error: string };

/** Material ids used anywhere in the project's constructions. */
export function materialIdsOf(project: BuildingProject): string[] {
  const ids = new Set<string>();
  const add = (c: Construction): void => c.layers.forEach((l) => l.materialId && ids.add(l.materialId));
  for (const c of project.components) {
    if ('construction' in c) add(c.construction);
    if (c.type === 'door' && c.spec.kind === 'layers') add(c.spec.construction);
  }
  return [...ids];
}

/**
 * The text of a project file. `materials` is every material the project may refer to;
 * the custom materials it USES are written out in full so they travel with it.
 */
export function serializeProject(project: BuildingProject, materials: readonly MaterialRecord[]): string {
  const used = materialIdsOf(project);
  const usedRecords = used.map((id) => materials.find((m) => m.id === id)).filter((m): m is MaterialRecord => m !== undefined);
  const file: ProjectFile = {
    schema: PROJECT_FILE_SCHEMA,
    schemaVersion: PROJECT_FILE_VERSION,
    note: FILE_NOTE,
    project,
    materialsUsed: usedRecords.map((m) => ({ id: m.id, name: m.name, lambdaWPerMK: m.lambdaWPerMK, status: m.status })),
    customMaterials: usedRecords.filter((m) => m.status === 'user-defined').map(copyMaterial),
  };
  return JSON.stringify(file, null, 2);
}

// ---- field readers: each records a problem and returns undefined when a value is unusable ------------------

class Reader {
  readonly problems: string[] = [];
  fail(where: string, what: string): undefined {
    this.problems.push(`${where}: ${what}`);
    return undefined;
  }
  text(v: unknown, where: string, max: number, allowEmpty = true): string | undefined {
    if (typeof v !== 'string') return this.fail(where, 'must be text.');
    if (v.length > max) return this.fail(where, `is longer than ${max} characters.`);
    if (!allowEmpty && v.trim() === '') return this.fail(where, 'is empty.');
    return v;
  }
  num(v: unknown, where: string, min: number, max: number, minInclusive = true): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.fail(where, 'must be a number.');
    if (v < min || (!minInclusive && v === min) || v > max) return this.fail(where, `must be ${minInclusive ? 'at least' : 'more than'} ${min} and at most ${max}.`);
    return v;
  }
  /** Numbers the user may still be editing: any finite value is kept (the calculation reports bad ones). */
  anyNum(v: unknown, where: string): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_LENGTH_M) return this.fail(where, 'must be a number.');
    return v;
  }
  bool(v: unknown, where: string): boolean | undefined {
    return typeof v === 'boolean' ? v : this.fail(where, 'must be true or false.');
  }
  oneOf<T>(v: unknown, where: string, allowed: readonly T[]): T | undefined {
    return allowed.includes(v as T) ? (v as T) : this.fail(where, `must be one of: ${allowed.join(', ')}.`);
  }
}

function readConstruction(r: Reader, raw: unknown, where: string): Construction | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.layers)) return r.fail(where, 'must have a list of layers.');
  if (raw.layers.length > MAX_LAYERS_PER_CONSTRUCTION) return r.fail(where, `has more than ${MAX_LAYERS_PER_CONSTRUCTION} layers.`);
  const layers: Construction['layers'] = [];
  raw.layers.forEach((l: unknown, i: number) => {
    const at = `${where}, layer ${i + 1}`;
    if (!isRecord(l)) return void r.fail(at, 'is not a layer.');
    const materialId = l.materialId === null ? null : r.text(l.materialId, `${at} material`, MAX_ID, false);
    const thicknessM = l.thicknessM === null ? null : r.anyNum(l.thicknessM, `${at} thickness`);
    if (materialId === undefined || thicknessM === undefined) return;
    layers.push({ materialId, thicknessM });
  });
  return { layers };
}

function readExposure(r: Reader, raw: unknown, where: string): Exposure | undefined {
  if (!isRecord(raw)) return r.fail(where, 'is missing.');
  const kind = r.oneOf(raw.kind, `${where} kind`, EXPOSURE_KINDS);
  if (kind === undefined) return undefined;
  if (kind !== 'unconditioned') return { kind };
  if (raw.temperatureC === null) return { kind, temperatureC: null };
  const t = r.num(raw.temperatureC, `${where} temperature`, -273.15, 1000);
  return t === undefined ? undefined : { kind, temperatureC: t };
}

function readDocumented(r: Reader, raw: unknown, where: string): DocumentedValue | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return r.fail(where, 'is not a documented value.');
  const value = typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : r.fail(`${where} value`, 'must be a number.');
  const unit = r.text(raw.unit, `${where} unit`, MAX_UNIT);
  const source = r.text(raw.source, `${where} source`, MAX_SOURCE);
  const valueType = r.oneOf<ThermalValueType>(raw.valueType, `${where} value type`, THERMAL_VALUE_TYPES);
  const conditions = raw.conditions === undefined ? '' : r.text(raw.conditions, `${where} conditions`, MAX_SOURCE);
  // A file cannot make a typed value "verified": the program has not checked it.
  const status: DataStatus | undefined = raw.status === 'user-defined' ? 'user-defined' : r.fail(`${where} status`, 'a project file may only hold user-defined documented values.');
  if (value === undefined || unit === undefined || source === undefined || valueType === undefined || conditions === undefined || status === undefined) return undefined;
  return { value, unit, source, valueType, ...(conditions !== '' ? { conditions } : {}), status };
}

function readComponent(r: Reader, raw: unknown, index: number): Component | undefined {
  const where = `Component ${index + 1}`;
  if (!isRecord(raw)) return r.fail(where, 'is not a component.');
  const id = r.text(raw.id, `${where} id`, MAX_ID, false);
  const type = r.oneOf(raw.type, `${where} type`, COMPONENT_TYPES);
  const name = r.text(raw.name, `${where} name`, MAX_NAME);
  const visible = r.bool(raw.visible, `${where} visible`);
  if (id === undefined || type === undefined || name === undefined || visible === undefined) return undefined;
  const base = { id, name, visible };
  const at = `${where} (${name || id})`;
  switch (type) {
    case 'exterior-wall': {
      const side = r.oneOf(raw.side, `${at} side`, SIDES);
      const exposure = readExposure(r, raw.exposure, `${at} other side`);
      const construction = readConstruction(r, raw.construction, at);
      return side && exposure && construction ? { ...base, type, side, exposure, construction } : undefined;
    }
    case 'partition': {
      const positionM = r.anyNum(raw.positionM, `${at} position`);
      const exposure = readExposure(r, raw.exposure, `${at} other side`);
      const construction = readConstruction(r, raw.construction, at);
      return positionM !== undefined && exposure && construction ? { ...base, type, positionM, exposure, construction } : undefined;
    }
    case 'roof': {
      const form = r.oneOf(raw.form, `${at} form`, ['flat'] as const);
      const exposure = readExposure(r, raw.exposure, `${at} other side`);
      const construction = readConstruction(r, raw.construction, at);
      return form && exposure && construction ? { ...base, type, form, exposure, construction } : undefined;
    }
    case 'floor': {
      const exposure = readExposure(r, raw.exposure, `${at} other side`);
      const construction = readConstruction(r, raw.construction, at);
      return exposure && construction ? { ...base, type, exposure, construction } : undefined;
    }
    case 'window':
    case 'glazed-door': {
      const hostId = r.text(raw.hostId, `${at} wall`, MAX_ID, false);
      const offsetM = r.anyNum(raw.offsetM, `${at} offset`);
      const sillM = r.anyNum(raw.sillM, `${at} sill`);
      const widthM = r.anyNum(raw.widthM, `${at} width`);
      const heightM = r.anyNum(raw.heightM, `${at} height`);
      const uValue = readDocumented(r, raw.uValue, `${at} U-value`);
      const gValue = readDocumented(r, raw.gValue, `${at} g-value`);
      const shadingFactor = readDocumented(r, raw.shadingFactor, `${at} shading factor`);
      if ([hostId, offsetM, sillM, widthM, heightM, uValue, gValue, shadingFactor].includes(undefined)) return undefined;
      return { ...base, type, hostId: hostId as string, offsetM: offsetM as number, sillM: sillM as number, widthM: widthM as number, heightM: heightM as number, uValue: uValue ?? null, gValue: gValue ?? null, shadingFactor: shadingFactor ?? null };
    }
    case 'door': {
      const hostId = r.text(raw.hostId, `${at} wall`, MAX_ID, false);
      const offsetM = r.anyNum(raw.offsetM, `${at} offset`);
      const widthM = r.anyNum(raw.widthM, `${at} width`);
      const heightM = r.anyNum(raw.heightM, `${at} height`);
      const spec = isRecord(raw.spec) ? raw.spec : undefined;
      if (!spec) return r.fail(at, 'has no door properties.');
      const kind = r.oneOf(spec.kind, `${at} door properties`, ['u-value', 'layers'] as const);
      if (hostId === undefined || offsetM === undefined || widthM === undefined || heightM === undefined || kind === undefined) return undefined;
      if (kind === 'u-value') {
        const uValue = readDocumented(r, spec.uValue, `${at} U-value`);
        return uValue === undefined ? undefined : { ...base, type, hostId, offsetM, widthM, heightM, spec: { kind, uValue } };
      }
      const construction = readConstruction(r, spec.construction, at);
      return construction ? { ...base, type, hostId, offsetM, widthM, heightM, spec: { kind, construction } } : undefined;
    }
  }
}

/**
 * Reads a building project file. Never throws; explains what is wrong in plain words.
 * `materials` is the program's own (non-custom) material list; custom materials come from the file.
 */
export function parseProject(text: string, materials: readonly MaterialRecord[]): ParseProjectResult {
  if (text.length > MAX_PROJECT_FILE_CHARS) return { ok: false, error: `The file is too large for a building project (more than ${MAX_PROJECT_FILE_CHARS} characters).` };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not a building project: it is not valid JSON.' };
  }
  if (!isRecord(data) || data.schema !== PROJECT_FILE_SCHEMA) {
    return { ok: false, error: isRecord(data) && data.schema === 'building-thermal-simulator.wall' ? 'This is a saved WALL; open it in the Single wall workspace.' : 'The file is not a building project of this program.' };
  }
  if (data.schemaVersion !== PROJECT_FILE_VERSION) {
    return { ok: false, error: `The file is a building project of version ${String(data.schemaVersion)}; this program reads version ${PROJECT_FILE_VERSION}.` };
  }
  const p = data.project;
  if (!isRecord(p)) return { ok: false, error: 'The file has no project.' };
  const r = new Reader();
  const name = r.text(p.name, 'Project name', MAX_NAME);
  const isExample = r.bool(p.isExample, 'Example flag');
  const g = isRecord(p.geometry) ? p.geometry : {};
  const lengthM = r.num(g.lengthM, 'House length', 0, MAX_LENGTH_M, false);
  const depthM = r.num(g.depthM, 'House depth', 0, MAX_LENGTH_M, false);
  const heightM = r.num(g.heightM, 'Storey height', 0, MAX_LENGTH_M, false);
  const c = isRecord(p.conditions) ? p.conditions : {};
  const insideC = r.num(c.insideC, 'Inside temperature', -273.15, 1000);
  const outsideC = r.num(c.outsideC, 'Outdoor temperature', -273.15, 1000);
  const durationH = r.num(c.durationH, 'Duration', 0, MAX_DURATION_H);
  const label = r.text(c.label, 'Condition name', MAX_LABEL);
  if (!Array.isArray(p.components)) return { ok: false, error: 'The project has no list of components.' };
  if (p.components.length > MAX_COMPONENTS) return { ok: false, error: `The project has more than ${MAX_COMPONENTS} components.` };
  const components: Component[] = [];
  p.components.forEach((raw: unknown, i: number) => {
    const comp = readComponent(r, raw, i);
    if (comp) components.push(comp);
  });
  const ids = new Set<string>();
  for (const comp of components) {
    if (ids.has(comp.id)) r.fail(`Component "${comp.name}"`, `repeats the id "${comp.id}".`);
    ids.add(comp.id);
  }
  const customMaterials = readCustomMaterials(data.customMaterials, materials, r.problems, 'building project file');

  if (r.problems.length > 0 || name === undefined || isExample === undefined || lengthM === undefined || depthM === undefined || heightM === undefined || insideC === undefined || outsideC === undefined || durationH === undefined || label === undefined) {
    const shown = r.problems.slice(0, 5);
    return { ok: false, error: `The project cannot be opened: ${shown.join(' ')}${r.problems.length > shown.length ? ` (and ${r.problems.length - shown.length} more problems)` : ''}` };
  }

  // New component ids must not collide with the file's own (ids look like "c12").
  const highest = components.reduce((max, comp) => Math.max(max, /^c(\d+)$/.test(comp.id) ? Number(comp.id.slice(1)) : 0), 0);
  const nextId = Math.max(typeof p.nextId === 'number' && Number.isInteger(p.nextId) && p.nextId > 0 ? p.nextId : 1, highest + 1);
  const project: BuildingProject = { name, isExample, geometry: { lengthM, depthM, heightM }, conditions: { insideC, outsideC, durationH, label }, components, nextId };

  const warnings: string[] = [];
  const known = [...materials, ...customMaterials];
  const unknown = materialIdsOf(project).filter((id) => !known.some((m) => m.id === id));
  if (unknown.length > 0) warnings.push(`Materials not in this program's database: ${unknown.join(', ')}. Those layers are reported as invalid until you choose another material.`);
  if (Array.isArray(data.materialsUsed)) {
    for (const snap of data.materialsUsed) {
      if (!isRecord(snap) || typeof snap.id !== 'string') continue;
      const now = known.find((m) => m.id === snap.id);
      if (now && typeof snap.lambdaWPerMK === 'number' && Math.abs(now.lambdaWPerMK - snap.lambdaWPerMK) > 1e-12) {
        warnings.push(`"${now.name}": λ was ${snap.lambdaWPerMK} W/(m·K) when the file was saved and is ${now.lambdaWPerMK} W/(m·K) in this program; results use the current value.`);
      }
    }
  }
  return { ok: true, project, customMaterials, warnings };
}
