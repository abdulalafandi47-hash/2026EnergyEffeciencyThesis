import type { WallLayout } from '../geometry';

/** Named camera positions. Directions are relative to the wall (x runs interior → exterior). */
export type ViewPreset =
  /** Oblique 3D view showing the interior face and a cut edge. */
  | 'iso'
  /** Looking at the interior face from inside the building. */
  | 'interior'
  /** Looking at the exterior face from outside. */
  | 'exterior'
  /** Looking at the cut edge: layers appear side by side, interior on the left. */
  | 'section';

export interface ViewerHandlers {
  /** Called when the user clicks a layer in the 3D view (or empty space → null). */
  onSelect?: (layerId: string | null) => void;
}

/**
 * What the page needs from a 3D viewer. The page only talks to this interface,
 * so it can be tested with a fake viewer, and the 3D library can be changed
 * without touching the editor.
 */
export interface WallViewer {
  /** Draws (or redraws) the wall from a layout. Moves smoothly if the layers already exist. */
  update(layout: WallLayout): void;
  /** Highlights one layer and dims the others; null clears the highlight. */
  select(layerId: string | null): void;
  setLabelsVisible(visible: boolean): void;
  setView(preset: ViewPreset): void;
  destroy(): void;
}

/**
 * Creates a viewer inside `container`, or resolves to null if 3D graphics
 * (WebGL) is not available. Async so the 3D library can be loaded on demand.
 */
export type ViewerFactory = (container: HTMLElement, handlers: ViewerHandlers) => Promise<WallViewer | null>;
