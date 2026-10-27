import type { LayerView } from '../editor';
import type { WallSpec } from '../geometry';
import type { WallInput } from '../engine';

/**
 * Builds what the 3D view draws from the VALIDATED wall (the exact SI input
 * the engine would receive) plus the display information about each layer.
 *
 * Sizes come only from `wall` (metres); `views` supplies the layer keys,
 * names, categories and data status. They must describe the same layers in the
 * same order, which holds whenever the editor reports a valid wall.
 */
export function wallSpecFromViews(wall: WallInput, views: readonly LayerView[]): WallSpec {
  if (wall.layers.length !== views.length) {
    throw new Error(`Wall has ${wall.layers.length} layers but ${views.length} layer views were given.`);
  }
  return {
    widthM: wall.widthM,
    heightM: wall.heightM,
    layers: wall.layers.map((layer, index) => {
      const view = views[index];
      if (!view?.material) throw new Error(`Layer ${index + 1} has no material, so it cannot be drawn.`);
      return {
        id: view.key,
        name: view.material.name,
        thicknessM: layer.thicknessM,
        category: view.material.category,
        status: view.material.status,
      };
    }),
  };
}
