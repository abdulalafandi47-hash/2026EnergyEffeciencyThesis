/**
 * Machine-readable exports: a JSON file with full-precision numbers (for
 * re-analysis or archiving next to a thesis) and a CSV of the layer table (for
 * spreadsheets).
 */
import { csvCell, stableJson } from './format';
import type { ReportInput, ReportModel } from './types';

/**
 * JSON export. `report` carries the formatted document; `data` carries the raw
 * numbers: the draft as typed, the SI engine input and the complete engine result.
 */
export function renderJson(model: ReportModel, input: ReportInput): string {
  const materials = input.views.flatMap((v) => (v.material ? [v.material] : []));
  return (
    stableJson(
      {
        schema: model.schema,
        schemaVersion: model.schemaVersion,
        title: model.title,
        generatedAt: model.generatedAt,
        software: model.software,
        fingerprint: model.fingerprint,
        notes: model.notes,
        banners: model.banners,
        data: {
          draft: input.draft,
          engineInput: input.wall,
          materialsUsed: materials.filter((m, i) => materials.findIndex((o) => o.id === m.id) === i),
          result: input.analysis.result,
          layerTemperatures: input.analysis.layerTemperatures,
          comparisons: input.comparisons,
        },
        report: { sections: model.sections },
      },
      2,
    ) + '\n'
  );
}

const CSV_COLUMNS = [
  'position', 'layer', 'thickness_m', 'lambda_W_per_mK', 'resistance_m2K_per_W', 'share_of_R_total',
  'temp_interior_side_C', 'temp_exterior_side_C', 'temp_drop_K', 'density_kg_per_m3', 'specific_heat_J_per_kgK', 'data_status',
] as const;

/** CSV of the layer table (comma-separated, UTF-8). Numbers are at full precision. */
export function renderLayersCsv(input: ReportInput): string {
  const { result, layerTemperatures } = input.analysis;
  const full = (v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? '' : String(v));
  const rows = result.layers.map((layer, i) => {
    const wallLayer = input.wall.layers[i];
    const t = layerTemperatures[i];
    return [
      String(i + 1), csvCell(layer.name), full(layer.thicknessM), full(layer.lambdaWPerMK), full(layer.resistanceM2KPerW), full(layer.fractionOfTotal),
      full(t?.startC), full(t?.endC), full(t?.dropK), full(wallLayer?.densityKgPerM3), full(wallLayer?.specificHeatJPerKgK), csvCell(layer.propertyStatus ?? ''),
    ].join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
