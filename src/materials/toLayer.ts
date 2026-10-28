import type { Layer } from '../engine';
import type { MaterialRecord } from './types';

/**
 * Builds an engine `Layer` from a material and a thickness in metres.
 * The material's data status travels with the layer, so the engine can warn
 * when a result rests on illustrative or unverified numbers.
 * Thickness is checked by the engine (it must be > 0).
 */
export function materialToLayer(material: MaterialRecord, thicknessM: number, layerName?: string): Layer {
  return {
    name: layerName ?? material.name,
    thicknessM,
    lambdaWPerMK: material.lambdaWPerMK,
    ...(material.densityKgPerM3 !== undefined ? { densityKgPerM3: material.densityKgPerM3 } : {}),
    ...(material.specificHeatJPerKgK !== undefined ? { specificHeatJPerKgK: material.specificHeatJPerKgK } : {}),
    propertyStatus: material.status,
  };
}
