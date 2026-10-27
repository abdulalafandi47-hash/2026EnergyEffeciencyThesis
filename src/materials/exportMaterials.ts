import { DATABASE_DISCLAIMER } from './database';
import { SI_MATERIAL_UNITS } from './types';
import type { MaterialRecord } from './types';

/**
 * Self-describing JSON export: schema version, units and the "not a certified
 * source" disclaimer travel with the data. Output is deterministic.
 */
export function exportMaterialsJson(materials: readonly MaterialRecord[]): string {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        disclaimer: DATABASE_DISCLAIMER,
        units: SI_MATERIAL_UNITS,
        count: materials.length,
        materials,
      },
      null,
      2,
    ) + '\n'
  );
}

const CSV_COLUMNS = [
  'id',
  'name',
  'category',
  'lambda_W_per_mK',
  'density_kg_per_m3',
  'specific_heat_J_per_kgK',
  'status',
  'source_citation',
  'source_url',
  'source_location',
  'checked_on',
  'checked_by',
  'conditions',
  'assumptions_and_limitations',
] as const;

/** Quotes a text cell. A leading = + - @ is neutralised so spreadsheets do not run it as a formula. */
function textCell(value: string | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const numberCell = (value: number | undefined): string => (value === undefined ? '' : String(value));

/** CSV export (comma-separated, UTF-8, header row first) for spreadsheets. */
export function exportMaterialsCsv(materials: readonly MaterialRecord[]): string {
  const rows = materials.map((m) =>
    [
      textCell(m.id),
      textCell(m.name),
      textCell(m.category),
      numberCell(m.lambdaWPerMK),
      numberCell(m.densityKgPerM3),
      numberCell(m.specificHeatJPerKgK),
      textCell(m.status),
      textCell(m.source.citation),
      textCell(m.source.url),
      textCell(m.source.location),
      textCell(m.source.checkedOn),
      textCell(m.source.checkedBy),
      textCell(m.conditions),
      textCell(m.assumptionsAndLimitations.join(' | ')),
    ].join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
