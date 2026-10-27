/**
 * What the interface shows for each layer: material name, thickness in metres,
 * the available thermal properties, and how far they can be trusted.
 * Display data only; nothing here feeds the calculation.
 */
import { findMaterialById, materialNotices } from '../materials';
import type { MaterialRecord, SourceType, ThermalValueType } from '../materials';
import type { DataStatus } from '../engine';
import { lengthToMetres } from '../units';
import { parseNumberInput } from './parseNumber';
import type { WallDraft } from './types';

export interface LayerView {
  key: string;
  /** 1-based position, counted from the interior face. */
  position: number;
  /** Which wall faces this layer touches. The first layer touches the interior, the last the exterior. */
  faces: Array<'interior' | 'exterior'>;
  /** null when no (valid) material is selected. */
  material: {
    id: string;
    name: string;
    category: string;
    lambdaWPerMK: number;
    densityKgPerM3?: number;
    specificHeatJPerKgK?: number;
    /** Names of the properties this material does not provide (so heat capacity is unavailable). */
    missingProperties: string[];
    status: DataStatus;
    valueType: ThermalValueType;
    sourceType: SourceType;
    sourceCitation: string;
    conditions?: string;
    notices: string[];
  } | null;
  /** Thickness in metres, or null if the typed thickness is not a valid number. */
  thicknessM: number | null;
}

export function describeLayers(draft: WallDraft, materials: readonly MaterialRecord[]): LayerView[] {
  const last = draft.layers.length - 1;
  return draft.layers.map((layer, index) => {
    const parsed = parseNumberInput(layer.thicknessText);
    const found = layer.materialId === null ? undefined : findMaterialById(materials, layer.materialId);
    const missingProperties: string[] = [];
    if (found && found.densityKgPerM3 === undefined) missingProperties.push('density');
    if (found && found.specificHeatJPerKgK === undefined) missingProperties.push('specific heat capacity');
    return {
      key: layer.key,
      position: index + 1,
      faces: [...(index === 0 ? (['interior'] as const) : []), ...(index === last ? (['exterior'] as const) : [])],
      material: found
        ? {
            id: found.id,
            name: found.name,
            category: found.category,
            lambdaWPerMK: found.lambdaWPerMK,
            ...(found.densityKgPerM3 !== undefined ? { densityKgPerM3: found.densityKgPerM3 } : {}),
            ...(found.specificHeatJPerKgK !== undefined ? { specificHeatJPerKgK: found.specificHeatJPerKgK } : {}),
            missingProperties,
            status: found.status,
            valueType: found.valueType,
            sourceType: found.source.type,
            sourceCitation: found.source.citation,
            ...(found.conditions !== undefined ? { conditions: found.conditions } : {}),
            notices: materialNotices(found),
          }
        : null,
      thicknessM: parsed.ok ? lengthToMetres(parsed.value, layer.thicknessUnit) : null,
    };
  });
}

export interface DataStatusSummary {
  /** Layers whose material has no source or has not been checked against it. */
  notVerified: string[];
  /** Layers with no material selected. */
  withoutMaterial: number[];
  /** True if at least one chosen material is not `verified`. */
  anyNotVerified: boolean;
}

/** Roll-up used by the summary panel to warn about unverified data. */
export function summarizeDataStatus(views: readonly LayerView[]): DataStatusSummary {
  const notVerified = views
    .filter((v) => v.material && v.material.status !== 'verified')
    .map((v) => `${v.material?.name ?? ''} (${v.material?.status ?? ''})`);
  const withoutMaterial = views.filter((v) => !v.material).map((v) => v.position);
  return { notVerified, withoutMaterial, anyNotVerified: notVerified.length > 0 };
}
