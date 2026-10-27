/** Direction of steady-state heat flow through the wall (same meaning as the engine's). */
export type FlowDirection = 'outward' | 'inward' | 'none';

/**
 * Calculated temperatures to paint on the wall. Produced from the engine's
 * result; the viewer only draws it.
 */
export interface ThermalOverlay {
  /** Coldest temperature in the wall, °C (low end of the colour scale). */
  minC: number;
  /** Warmest temperature in the wall, °C (high end of the colour scale). */
  maxC: number;
  /** One entry per layer; `startC` is at the interior-side face, `endC` at the exterior-side face. */
  layers: Array<{ id: string; startC: number; endC: number }>;
  direction: FlowDirection;
}
