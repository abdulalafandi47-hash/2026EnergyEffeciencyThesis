import { EngineInputError } from '../engine';
import type { ValidationIssue } from '../engine';
import { SI_MATERIAL_UNITS } from './types';
import type { CustomMaterialInput, MaterialRecord } from './types';
import { materialWarnings, validateMaterial } from './validateMaterial';

/** Longest name and longest note/conditions text accepted for a custom material. */
export const MAX_NAME_CHARS = 80;
export const MAX_NOTE_CHARS = 500;

/** "Mineral Wool (Brand X)!" → "mineral-wool-brand-x". Returns "material" if nothing usable remains. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'material';
}

/**
 * Turns user input into a validated material record with status "user-defined".
 *
 * - Values must be entered in SI units (W/(m·K), kg/m³, J/(kg·K)); convert first.
 * - The id is made unique against `existingIds` by adding -2, -3, ….
 * - Invalid input throws EngineInputError listing every problem.
 * - Suspicious-but-valid numbers (e.g. λ = 40) do not throw; they come back as
 *   `warnings` for the interface to show.
 */
export function createCustomMaterial(
  input: CustomMaterialInput,
  existingIds: Iterable<string> = [],
): { material: MaterialRecord; warnings: string[] } {
  const taken = new Set(existingIds);
  const name = typeof input?.name === 'string' ? input.name.trim() : '';

  const baseId = `custom-${slugify(name)}`;
  let id = baseId;
  for (let n = 2; taken.has(id); n++) {
    id = `${baseId}-${n}`;
  }

  const note = typeof input?.sourceNote === 'string' ? input.sourceNote.trim() : '';
  const conditions = typeof input?.conditions === 'string' ? input.conditions.trim() : '';
  const tooLong: ValidationIssue[] = [];
  for (const [path, text, max] of [['name', name, MAX_NAME_CHARS], ['sourceNote', note, MAX_NOTE_CHARS], ['conditions', conditions, MAX_NOTE_CHARS]] as const) {
    if (text.length > max) tooLong.push({ code: 'invalid-format', path, message: `${path === 'name' ? 'The name' : path === 'sourceNote' ? 'The source note' : 'The conditions text'} is too long (at most ${max} characters).` });
  }
  if (tooLong.length > 0) throw new EngineInputError(tooLong);
  const candidate = {
    id,
    name,
    category: input?.category ?? 'Other',
    lambdaWPerMK: input?.lambdaWPerMK,
    ...(input?.densityKgPerM3 != null ? { densityKgPerM3: input.densityKgPerM3 } : {}),
    ...(input?.specificHeatJPerKgK != null ? { specificHeatJPerKgK: input.specificHeatJPerKgK } : {}),
    units: { ...SI_MATERIAL_UNITS },
    status: 'user-defined',
    valueType: input?.valueType ?? 'unspecified',
    source: {
      type: note ? 'user-note' : 'none',
      citation: note
        ? `User-entered: ${note}`
        : 'User-entered values; no source stated. Not checked by this application.',
    },
    ...(conditions ? { conditions } : {}),
    assumptionsAndLimitations: [
      'User-defined values: the user is responsible for their accuracy and applicability.',
      'Not checked against any standard or datasheet by this application.',
    ],
  };

  const issues = validateMaterial(candidate);
  if (issues.length > 0) {
    throw new EngineInputError(issues);
  }
  const material = candidate as MaterialRecord;
  return { material, warnings: materialWarnings(material) };
}

export type CustomMaterialOutcome =
  | { ok: true; material: MaterialRecord; warnings: string[] }
  | { ok: false; issues: ValidationIssue[] };

/** Like `createCustomMaterial`, but returns the problems instead of throwing (for the screen). */
export function tryCreateCustomMaterial(input: CustomMaterialInput, existingIds: Iterable<string> = []): CustomMaterialOutcome {
  try {
    return { ok: true, ...createCustomMaterial(input, existingIds) };
  } catch (error) {
    if (error instanceof EngineInputError) return { ok: false, issues: error.issues };
    throw error;
  }
}
