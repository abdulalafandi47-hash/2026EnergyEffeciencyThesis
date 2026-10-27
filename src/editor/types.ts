/**
 * Wall editor state ("draft").
 *
 * The draft stores exactly what the user typed (as TEXT, with its unit), not
 * numbers, because half-typed input such as "1." or "" must be kept as typed.
 * Nothing in the draft is trusted: `buildWall` (buildWall.ts) parses it,
 * converts it to SI and validates it before anything reaches the engine.
 *
 * This module knows nothing about the screen (no DOM). The user interface in
 * `src/ui/` only displays a draft and calls the functions in draft.ts.
 */
import type { TemperatureUnit } from '../units';
import type { LengthUnit } from '../units';

export type { LengthUnit, TemperatureUnit };

export type SurfaceMode =
  /** Use the ISO 6946-style preset for horizontal heat flow (labelled unverified). */
  | 'preset-horizontal'
  /** Use the two values typed by the user. */
  | 'custom';

export interface LayerDraft {
  /** Stable identifier for this layer row (survives reordering). */
  key: string;
  /** Id of a material in the database, or null if none is chosen yet. */
  materialId: string | null;
  /** Thickness exactly as typed, in `thicknessUnit`. */
  thicknessText: string;
  thicknessUnit: LengthUnit;
}

export interface WallDraft {
  widthText: string;
  heightText: string;
  /** Unit of width and height. */
  dimensionUnit: LengthUnit;
  /** Layers from the INTERIOR face (index 0) to the EXTERIOR face (last). */
  layers: LayerDraft[];
  insideTemperatureText: string;
  outsideTemperatureText: string;
  temperatureUnit: TemperatureUnit;
  /** Duration of the energy estimate, hours. */
  durationText: string;
  surfaceMode: SurfaceMode;
  /** R_si in m²·K/W, used only when surfaceMode is "custom". */
  surfaceInsideText: string;
  /** R_se in m²·K/W, used only when surfaceMode is "custom". */
  surfaceOutsideText: string;
  /** Counter used to create the next layer key (keeps the draft deterministic). */
  nextLayerNumber: number;
}

/** One problem (error or warning) attached to a field of the editor. */
export interface DraftProblem {
  /** Field identifier, see `FIELD` and `layerField` in fields.ts. */
  field: string;
  message: string;
}
