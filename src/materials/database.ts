import { EngineInputError } from '../engine';
import type { ValidationIssue } from '../engine';
import builtInData from './data/builtInMaterials.json';
import type { MaterialFilter, MaterialRecord } from './types';
import { validateMaterial } from './validateMaterial';

export const DATABASE_DISCLAIMER =
  'This database is NOT a certified source of design values. Records with status "illustrative" are ' +
  'demonstration values with no source. Only "verified" records have been checked against the cited source, ' +
  'and even those depend on moisture content, temperature, density and product specification.';

/**
 * Validates a list of records (for example loaded from a file) and returns it
 * typed. Throws EngineInputError listing every problem, including duplicate ids.
 */
export function parseMaterialRecords(data: unknown): MaterialRecord[] {
  if (!Array.isArray(data)) {
    throw new EngineInputError([
      { code: 'invalid-structure', path: '', message: 'Material data must be a list of records.' },
    ]);
  }
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  data.forEach((record: unknown, index: number) => {
    for (const issue of validateMaterial(record)) {
      issues.push({ ...issue, path: `materials[${index}]${issue.path ? `.${issue.path}` : ''}` });
    }
    const id = (record as { id?: unknown } | null)?.id;
    if (typeof id === 'string') {
      if (seen.has(id)) {
        issues.push({ code: 'duplicate-id', path: `materials[${index}].id`, message: `Duplicate material id "${id}".` });
      }
      seen.add(id);
    }
  });
  if (issues.length > 0) {
    throw new EngineInputError(issues);
  }
  return data as MaterialRecord[];
}

/**
 * The built-in materials. Loaded through the validator, so a malformed data
 * file fails immediately (and the integrity tests catch it) instead of
 * producing quietly wrong results.
 */
export const BUILT_IN_MATERIALS: readonly MaterialRecord[] = parseMaterialRecords(builtInData);

/** Combines lists (e.g. built-in + the user's custom materials), rejecting duplicate ids. */
export function mergeMaterials(...lists: ReadonlyArray<readonly MaterialRecord[]>): MaterialRecord[] {
  return parseMaterialRecords(lists.flat());
}

export function findMaterialById(materials: readonly MaterialRecord[], id: string): MaterialRecord | undefined {
  return materials.find((material) => material.id === id);
}

/**
 * Case-insensitive search. Every word in `text` must appear in the material's
 * name, id or category; `category` and `status` must match exactly if given.
 * The original order is kept.
 */
export function searchMaterials(materials: readonly MaterialRecord[], filter: MaterialFilter = {}): MaterialRecord[] {
  const words = (filter.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return materials.filter((material) => {
    if (filter.category !== undefined && material.category !== filter.category) return false;
    if (filter.status !== undefined && material.status !== filter.status) return false;
    const haystack = `${material.name} ${material.id} ${material.category}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
