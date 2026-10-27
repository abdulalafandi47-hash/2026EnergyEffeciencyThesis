/**
 * Turns a wall draft (what the user typed) into an engine `WallInput`, or
 * explains what is wrong.
 *
 * Division of labour:
 *  - THIS file: reading typed text, choosing units, converting to SI (metres,
 *    °C), looking up materials, and writing messages a person can understand.
 *  - The ENGINE (`validateWallInput`): decides what is physically valid. The
 *    editor does not repeat those rules; it asks the engine, so the two can
 *    never disagree. The wall is only returned if the engine accepts it.
 *
 * The plausibility warnings at the bottom are NOT errors. They are rough
 * "did you pick the right unit?" checks, not scientific limits.
 */
import { customSurfaceResistances, iso6946Preset, validateWallInput } from '../engine';
import type { Layer, ValidationIssue, WallInput } from '../engine';
import { findMaterialById, materialToLayer } from '../materials';
import type { MaterialRecord } from '../materials';
import { lengthToMetres, temperatureToCelsius } from '../units';
import { FIELD, layerField } from './fields';
import { parseNumberInput } from './parseNumber';
import type { DraftProblem, WallDraft } from './types';

export interface BuildResult {
  /** True only if the engine accepted the wall. */
  ok: boolean;
  /** The wall in SI units for the engine; null unless `ok`. */
  wall: WallInput | null;
  errors: DraftProblem[];
  warnings: DraftProblem[];
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** First error message for a field, or undefined. */
export function errorFor(result: Pick<BuildResult, 'errors'>, field: string): string | undefined {
  return result.errors.find((problem) => problem.field === field)?.message;
}

/** First warning message for a field, or undefined. */
export function warningFor(result: Pick<BuildResult, 'warnings'>, field: string): string | undefined {
  return result.warnings.find((problem) => problem.field === field)?.message;
}

export function buildWall(draft: WallDraft, materials: readonly MaterialRecord[]): BuildResult {
  const errors: DraftProblem[] = [];
  const warnings: DraftProblem[] = [];
  /** Fields that already have an error, so engine issues about them are not repeated. */
  const reported = new Set<string>();

  const labels = new Map<string, string>();
  const label = (field: string, text: string): string => {
    labels.set(field, text);
    return text;
  };

  /** Reads a typed number; records a friendly error and returns NaN if it cannot. */
  const read = (text: string, field: string, name: string): number => {
    label(field, name);
    const parsed = parseNumberInput(text);
    if (parsed.ok) return parsed.value;
    errors.push({
      field,
      message:
        parsed.reason === 'empty'
          ? `Enter ${lowerFirst(name)}.`
          : `${name} must be a number such as 2.5 (digits with a decimal point or comma; no units or letters).`,
    });
    reported.add(field);
    return Number.NaN;
  };

  /** Applies a conversion only to real numbers (the converters reject NaN). */
  const toSI = (value: number, convert: (v: number) => number): number =>
    Number.isNaN(value) ? Number.NaN : convert(value);

  // ---- dimensions ----------------------------------------------------------
  const widthM = toSI(read(draft.widthText, FIELD.width, 'The wall width'), (v) => lengthToMetres(v, draft.dimensionUnit));
  const heightM = toSI(read(draft.heightText, FIELD.height, 'The wall height'), (v) => lengthToMetres(v, draft.dimensionUnit));

  // ---- layers ----------------------------------------------------------------
  const layerIssuesToSkip = new Set<string>(); // layer keys whose material problem is already reported
  const thicknessesM: number[] = [];
  const engineLayers: Layer[] = draft.layers.map((layer, index) => {
    const n = index + 1;
    const thicknessField = layerField(layer.key, 'thickness');
    const materialField = layerField(layer.key, 'material');
    label(materialField, `The material of layer ${n}`);

    const thicknessM = toSI(
      read(layer.thicknessText, thicknessField, `The thickness of layer ${n}`),
      (v) => lengthToMetres(v, layer.thicknessUnit),
    );
    thicknessesM.push(thicknessM);

    let material: MaterialRecord | undefined;
    if (layer.materialId === null) {
      errors.push({ field: materialField, message: `Select a material for layer ${n}.` });
      reported.add(materialField);
      layerIssuesToSkip.add(layer.key);
    } else {
      material = findMaterialById(materials, layer.materialId);
      if (!material) {
        errors.push({
          field: materialField,
          message: `The material chosen for layer ${n} is not in the database. Choose another material.`,
        });
        reported.add(materialField);
        layerIssuesToSkip.add(layer.key);
      }
    }
    return material
      ? materialToLayer(material, thicknessM)
      : { name: `Layer ${n}`, thicknessM, lambdaWPerMK: Number.NaN };
  });

  // ---- boundary conditions -----------------------------------------------------
  const insideC = toSI(
    read(draft.insideTemperatureText, FIELD.insideTemperature, 'The inside temperature'),
    (v) => temperatureToCelsius(v, draft.temperatureUnit),
  );
  const outsideC = toSI(
    read(draft.outsideTemperatureText, FIELD.outsideTemperature, 'The outside temperature'),
    (v) => temperatureToCelsius(v, draft.temperatureUnit),
  );
  const durationHours = read(draft.durationText, FIELD.duration, 'The duration');

  // ---- surface resistances: always an explicit choice ---------------------------
  let surfaceResistances;
  if (draft.surfaceMode === 'preset-horizontal') {
    surfaceResistances = iso6946Preset('horizontal');
  } else {
    const rsi = read(draft.surfaceInsideText, FIELD.surfaceInside, 'The internal surface resistance R_si');
    const rse = read(draft.surfaceOutsideText, FIELD.surfaceOutside, 'The external surface resistance R_se');
    surfaceResistances = customSurfaceResistances(rsi, rse, 'horizontal', 'Entered by the user in the wall editor.');
  }

  // ---- ask the engine what is physically valid ---------------------------------
  const wall: WallInput = {
    layers: engineLayers,
    widthM,
    heightM,
    surfaceResistances,
    conditions: { insideTemperatureC: insideC, outsideTemperatureC: outsideC, durationHours },
  };

  for (const issue of validateWallInput(wall)) {
    const field = fieldForIssue(issue, draft);
    if (reported.has(field)) continue;
    if (field.startsWith('layer:')) {
      const key = field.split(':')[1] ?? '';
      if (layerIssuesToSkip.has(key)) continue;
    }
    errors.push({ field, message: friendlyMessage(issue, field, labels) });
    reported.add(field);
  }

  // ---- warnings (only for values that are otherwise fine) -------------------------
  const warn = (field: string, message: string): void => {
    if (!reported.has(field)) warnings.push({ field, message });
  };
  if (widthM < 0.1 || widthM > 100) warn(FIELD.width, `A width of ${widthM} m is unusual for a wall. Check the unit (mm, cm or m).`);
  if (heightM < 0.1 || heightM > 100) warn(FIELD.height, `A height of ${heightM} m is unusual for a wall. Check the unit (mm, cm or m).`);
  draft.layers.forEach((layer, index) => {
    const t = thicknessesM[index] ?? Number.NaN;
    const field = layerField(layer.key, 'thickness');
    if (t < 0.001) warn(field, `Layer ${index + 1} is thinner than 1 mm (${t} m). Check the unit (mm, cm or m).`);
    if (t > 1) warn(field, `Layer ${index + 1} is thicker than 1 m (${t} m). Check the unit (mm, cm or m).`);
  });
  for (const [field, c] of [
    [FIELD.insideTemperature, insideC],
    [FIELD.outsideTemperature, outsideC],
  ] as const) {
    if (c < -40 || c > 60) warn(field, `${c.toFixed(1)} °C is outside the −40 to 60 °C range usually used for air temperatures. Check the unit (°C, K or °F).`);
  }
  if (durationHours > 8760) {
    warn(FIELD.duration, 'This is longer than one year (8760 h). The energy figure is a constant-conditions estimate, not an annual energy demand.');
  }
  // Layers whose material is chosen but lacks density and/or specific heat.
  const noCapacity = engineLayers.filter(
    (l) => !Number.isNaN(l.lambdaWPerMK) && (l.densityKgPerM3 === undefined || l.specificHeatJPerKgK === undefined),
  );
  if (draft.layers.length > 0 && noCapacity.length > 0) {
    warn(FIELD.layers, `Heat capacity cannot be calculated: density and/or specific heat is missing for ${noCapacity.map((l) => l.name).join(', ')}.`);
  }

  const ok = errors.length === 0;
  return { ok, wall: ok ? wall : null, errors, warnings };
}

// ---- mapping engine issues to editor fields and friendly messages -------------

function fieldForIssue(issue: ValidationIssue, draft: WallDraft): string {
  const layerMatch = /^layers\[(\d+)\]\.(\w+)$/.exec(issue.path);
  if (layerMatch) {
    const layer = draft.layers[Number(layerMatch[1])];
    if (layer) {
      return layerMatch[2] === 'thicknessM' ? layerField(layer.key, 'thickness') : layerField(layer.key, 'material');
    }
  }
  switch (issue.path) {
    case 'widthM':
      return FIELD.width;
    case 'heightM':
      return FIELD.height;
    case 'layers':
      return FIELD.layers;
    case 'conditions.insideTemperatureC':
      return FIELD.insideTemperature;
    case 'conditions.outsideTemperatureC':
      return FIELD.outsideTemperature;
    case 'conditions.durationHours':
      return FIELD.duration;
    case 'surfaceResistances.insideM2KPerW':
      return FIELD.surfaceInside;
    case 'surfaceResistances.outsideM2KPerW':
      return FIELD.surfaceOutside;
    default:
      return FIELD.wall;
  }
}

function friendlyMessage(issue: ValidationIssue, field: string, labels: Map<string, string>): string {
  const name = labels.get(field);
  if (field === FIELD.layers && issue.code === 'no-layers') return 'Add at least one layer.';
  if (!name) return issue.message; // unmapped: show the engine's own text rather than hide it
  if (field.endsWith(':material')) {
    return `${name} has invalid thermal data in the database: ${issue.message}`;
  }
  switch (issue.code) {
    case 'must-be-positive':
      return `${name} must be greater than zero.`;
    case 'must-be-non-negative':
      return `${name} cannot be negative.`;
    case 'below-absolute-zero':
      return `${name} cannot be below absolute zero (−273.15 °C = 0 K = −459.67 °F).`;
    case 'not-a-finite-number':
      return `${name} must be a finite number.`;
    case 'missing-value':
      return `Enter ${lowerFirst(name)}.`;
    default:
      return issue.message;
  }
}
