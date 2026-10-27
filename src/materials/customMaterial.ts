import { EngineInputError } from '../engine';
import { SI_MATERIAL_UNITS } from './types';
import type { CustomMaterialInput, MaterialRecord } from './types';
import { materialWarnings, validateMaterial } from './validateMaterial';

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
  const candidate = {
    id,
    name,
    category: input?.category ?? 'Other',
    lambdaWPerMK: input?.lambdaWPerMK,
    ...(input?.densityKgPerM3 != null ? { densityKgPerM3: input.densityKgPerM3 } : {}),
    ...(input?.specificHeatJPerKgK != null ? { specificHeatJPerKgK: input.specificHeatJPerKgK } : {}),
    units: { ...SI_MATERIAL_UNITS },
    status: 'user-defined',
    source: {
      citation: note
        ? `User-entered: ${note}`
        : 'User-entered values; no source stated. Not checked by this application.',
    },
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
