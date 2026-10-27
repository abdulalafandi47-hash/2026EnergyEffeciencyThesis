/**
 * Steady-state temperature profile through a multilayer wall.
 *
 * Physics: in steady state the same heat flux q (W/m²) passes through every
 * layer and both surface films. The temperature drop across any one element is
 * therefore proportional to its thermal resistance:
 *
 *     q        = (T_inside − T_outside) / R_total          (positive = outward)
 *     ΔT_i     = q · R_i                                    (R_i = d_i/λ_i, R_si or R_se)
 *     T_si     = T_inside  − q · R_si                       (inside surface)
 *     T_k      = T_si − q · Σ R_j  (j ≤ k)                  (interface after layer k)
 *     T_se     = T_outside + q · R_se                       (outside surface)
 *
 * Inside each homogeneous layer the temperature varies linearly with position
 * (exact for steady 1-D conduction), so a chart can simply join the points.
 * The drop across a surface film occurs at the wall surface, so the air point
 * and the surface point share the same position.
 *
 * Nothing here is "for show": every value follows from the equations above.
 */
import { totalResistance } from './formulas';
import { EngineInputError } from './errors';
import { assertNumber } from './validation';
import type { TemperaturePoint } from './types';

export interface ProfileLayer {
  name: string;
  /** Thickness in m (> 0). */
  thicknessM: number;
  /** R = d/λ in m²·K/W (> 0). */
  resistanceM2KPerW: number;
}

/** Returns the points from inside air to outside air, in order. */
export function calculateTemperatureProfile(
  layers: readonly ProfileLayer[],
  insideSurfaceM2KPerW: number,
  outsideSurfaceM2KPerW: number,
  insideTemperatureC: number,
  outsideTemperatureC: number,
): TemperaturePoint[] {
  if (layers.length === 0) {
    throw new EngineInputError([
      { code: 'no-layers', path: 'layers', message: 'At least one layer is required.' },
    ]);
  }
  layers.forEach((layer, index) => {
    assertNumber(layer.thicknessM, `layers[${index}].thicknessM`, 'Layer thickness', 'positive');
  });
  assertNumber(insideTemperatureC, 'insideTemperatureC', 'Inside temperature', 'temperature-c');
  assertNumber(outsideTemperatureC, 'outsideTemperatureC', 'Outside temperature', 'temperature-c');

  // totalResistance also validates the surface and layer resistances.
  const rTotal = totalResistance(
    layers.map((layer) => layer.resistanceM2KPerW),
    insideSurfaceM2KPerW,
    outsideSurfaceM2KPerW,
  );

  // Signed heat flux in W/m²: positive means heat flows from inside to outside.
  const flux = (insideTemperatureC - outsideTemperatureC) / rTotal;

  const insideSurfaceTemperatureC = insideTemperatureC - flux * insideSurfaceM2KPerW;
  const points: TemperaturePoint[] = [
    { kind: 'inside-air', label: 'Inside air', positionM: 0, temperatureC: insideTemperatureC },
    { kind: 'inside-surface', label: 'Inside surface', positionM: 0, temperatureC: insideSurfaceTemperatureC },
  ];

  let positionM = 0;
  let temperatureC = insideSurfaceTemperatureC;
  layers.forEach((layer, index) => {
    positionM += layer.thicknessM;
    temperatureC -= flux * layer.resistanceM2KPerW;
    const next = layers[index + 1];
    if (next) {
      points.push({
        kind: 'interface',
        label: `${layer.name} | ${next.name}`,
        positionM,
        temperatureC,
      });
    }
  });

  points.push(
    {
      kind: 'outside-surface',
      label: 'Outside surface',
      positionM,
      temperatureC: outsideTemperatureC + flux * outsideSurfaceM2KPerW,
    },
    { kind: 'outside-air', label: 'Outside air', positionM, temperatureC: outsideTemperatureC },
  );
  return points;
}
