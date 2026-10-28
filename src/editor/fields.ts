/** Identifiers of the editor's input fields, shared by validation and the user interface. */
export const FIELD = {
  width: 'width',
  height: 'height',
  layers: 'layers',
  insideTemperature: 'insideTemperature',
  outsideTemperature: 'outsideTemperature',
  duration: 'duration',
  surfaceInside: 'surfaceInside',
  surfaceOutside: 'surfaceOutside',
  /** Problems that belong to no single field. */
  wall: 'wall',
} as const;

export type LayerFieldName = 'material' | 'thickness';

export const layerField = (layerKey: string, name: LayerFieldName): string => `layer:${layerKey}:${name}`;
