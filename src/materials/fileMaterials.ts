/**
 * Custom materials inside saved files (walls and building projects).
 *
 * A saved file carries the user's custom materials so that a construction built
 * with datasheet values can be reopened. A file is untrusted input, so a file
 * may only ever ADD user-defined records: anything claiming another status,
 * using an id that is not a custom id, or reusing a built-in id is refused.
 * Accepted records are copied field by field (nothing extra is passed on).
 */
import { validateMaterial } from './validateMaterial';
import { MAX_NAME_CHARS, MAX_NOTE_CHARS } from './customMaterial';
import type { MaterialRecord } from './types';

/** Limit that keeps a damaged or hostile file from using up memory. */
export const MAX_CUSTOM_MATERIALS = 100;

/** A copy of a material record holding only the known fields (anything extra is dropped). */
export function copyMaterial(m: MaterialRecord): MaterialRecord {
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

/**
 * Checks the custom materials of a file. Only complete, valid, user-defined records with new ids are
 * accepted; each refused record adds a plain-words problem. `fileKind` names the file in messages
 * ("wall file", "building project file").
 */
export function readCustomMaterials(raw: unknown, builtIn: readonly MaterialRecord[], problems: string[], fileKind = 'wall file'): MaterialRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push('"customMaterials" must be a list.');
    return [];
  }
  if (raw.length > MAX_CUSTOM_MATERIALS) {
    problems.push(`A ${fileKind} may hold at most ${MAX_CUSTOM_MATERIALS} custom materials (this one has ${raw.length}).`);
    return [];
  }
  const accepted: MaterialRecord[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index: number) => {
    const where = `Custom material ${index + 1}`;
    const issues = validateMaterial(entry);
    if (issues.length > 0) return void problems.push(`${where} is not a valid material record (${issues[0]?.message ?? 'invalid'}).`);
    const m = entry as MaterialRecord;
    if (m.status !== 'user-defined') return void problems.push(`${where} claims the status "${m.status}"; a ${fileKind} may only add user-defined materials.`);
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
