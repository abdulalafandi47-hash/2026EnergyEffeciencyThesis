/** Public API of the building-envelope module (model, geometry checks, calculations, editing). No screen code. */
export { calculateComponent, calculateEnvelope, ENVELOPE_ASSUMPTIONS, heatFlowForSurfaces, surfaceResistancesFor } from './calculate';
export type { ComponentResult, ComponentStatus, EnvelopeResult, SurfaceUsed } from './calculate';
export { addComponent, canAdd, createBlankProject, createExampleHouse, deleteComponent, dependentsOf, duplicateComponent, EXAMPLE_NOTE, freeSides, hasType, setVisible, SIDES, updateComponent } from './edit';
export { checkModel, dimensionsOf, openingsOf, sideLength, sillOf } from './geometry';
export type { ElementDimensions, ModelIssue } from './geometry';
export { COMPONENT_TYPE_LABEL, isGlazing, isOpening } from './types';
export type * from './types';
