/** Public API of the material database. Other modules import from here only. */
export { createCustomMaterial, slugify } from './customMaterial';
export {
  BUILT_IN_MATERIALS,
  DATABASE_DISCLAIMER,
  findMaterialById,
  mergeMaterials,
  parseMaterialRecords,
  searchMaterials,
} from './database';
export { exportMaterialsCsv, exportMaterialsJson } from './exportMaterials';
export { materialNotices, NOT_APPROVED_NOTICE } from './notices';
export { materialToLayer } from './toLayer';
export { MATERIAL_CATEGORIES, SI_MATERIAL_UNITS, SOURCE_TYPES, THERMAL_VALUE_TYPES } from './types';
export type {
  AdditionalProperty,
  CustomMaterialInput,
  MaterialCategory,
  MaterialFilter,
  MaterialRecord,
  MaterialSource,
  MaterialUnits,
  SourceType,
  ThermalValueType,
} from './types';
export { isIsoDate, materialWarnings, validateMaterial } from './validateMaterial';
