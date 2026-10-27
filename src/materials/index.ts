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
export { materialToLayer } from './toLayer';
export { MATERIAL_CATEGORIES, SI_MATERIAL_UNITS } from './types';
export type {
  AdditionalProperty,
  CustomMaterialInput,
  MaterialCategory,
  MaterialFilter,
  MaterialRecord,
  MaterialSource,
  MaterialUnits,
} from './types';
export { isIsoDate, materialWarnings, validateMaterial } from './validateMaterial';
