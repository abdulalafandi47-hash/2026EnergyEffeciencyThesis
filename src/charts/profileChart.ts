/**
 * Temperature profile through the wall: temperature (°C) against distance from
 * the interior face (mm).
 *
 * It draws exactly the points the calculation engine produced and joins them
 * with straight lines, which is what steady-state conduction through a
 * homogeneous layer gives. Nothing is smoothed or invented.
 *
 * The two air films have no thickness in the model, so at each face the line
 * drops vertically from the air temperature to the surface temperature (dashed).
 * The short flat dashed lines outside the wall only show which air they belong to.
 */
import { formatTick, linearScale, niceTicks } from './scales';
import { svg, truncate } from './svg';

export interface ProfileChartInput {
  /** From inside air to outside air, in order. `xMm` is the distance from the interior face. */
  points: Array<{ kind: string; label: string; xMm: number; temperatureC: number }>;
  bands: Array<{ name: string; x0Mm: number; x1Mm: number }>;
}

const W = 640;
const H = 300;
const M = { l: 52, r: 14, t: 16, b: 44 };

export function buildProfileChart(input: ProfileChartInput): SVGSVGElement {
  const { points, bands } = input;
  const wallEnd = Math.max(...points.map((p) => p.xMm), 1);
  const pad = wallEnd * 0.16;
  const temps = points.map((p) => p.temperatureC);
  const yTicks = niceTicks(Math.min(...temps), Math.max(...temps), 5);
  const yScale = linearScale([yTicks[0] as number, yTicks[yTicks.length - 1] as number], [H - M.b, M.t]);
  const xScale = linearScale([-pad, wallEnd + pad], [M.l, W - M.r]);
  const xTicks = niceTicks(0, wallEnd, 6).filter((t) => t >= 0 && t <= wallEnd + 1e-9);

  const byKind = (kind: string) => points.find((p) => p.kind === kind);
  const insideAir = byKind('inside-air');
  const outsideAir = byKind('outside-air');
  const wallPoints = points.filter((p) => p.kind !== 'inside-air' && p.kind !== 'outside-air');

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart profile-chart', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  const summary =
    `Steady-state temperature profile through the wall. ` +
    points.map((p) => `${p.label} ${Number(p.temperatureC.toFixed(2))} °C at ${Number(p.xMm.toFixed(2))} mm`).join('; ') +
    '.';
  root.setAttribute('aria-label', summary);
  root.append(svg('title', {}, 'Temperature profile through the wall (calculated, steady state)'));

  // layer bands
  bands.forEach((band, i) => {
    const x0 = xScale(band.x0Mm);
    const x1 = xScale(band.x1Mm);
    root.append(
      svg('rect', { x: x0, y: M.t, width: Math.max(0, x1 - x0), height: H - M.b - M.t, class: i % 2 === 0 ? 'band band-a' : 'band band-b' }, svg('title', {}, `Layer ${i + 1}: ${band.name} (${Number((band.x1Mm - band.x0Mm).toFixed(2))} mm)`)),
      svg('text', { x: (x0 + x1) / 2, y: M.t + 11, class: 'band-label', 'text-anchor': 'middle' }, String(i + 1)),
    );
  });

  // grid and axes
  for (const t of yTicks) {
    root.append(svg('line', { x1: M.l, x2: W - M.r, y1: yScale(t), y2: yScale(t), class: 'grid-line' }), svg('text', { x: M.l - 6, y: yScale(t) + 4, class: 'tick', 'text-anchor': 'end' }, formatTick(t)));
  }
  for (const t of xTicks) {
    root.append(svg('line', { x1: xScale(t), x2: xScale(t), y1: H - M.b, y2: H - M.b + 4, class: 'axis-line' }), svg('text', { x: xScale(t), y: H - M.b + 16, class: 'tick', 'text-anchor': 'middle' }, formatTick(t)));
  }
  root.append(
    svg('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'axis-line' }),
    svg('line', { x1: M.l, x2: M.l, y1: M.t, y2: H - M.b, class: 'axis-line' }),
    svg('text', { x: (M.l + W - M.r) / 2, y: H - 6, class: 'axis-title', 'text-anchor': 'middle' }, 'Distance from interior face (mm)'),
    svg('text', { x: 14, y: (M.t + H - M.b) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(M.t + H - M.b) / 2})` }, 'Temperature (°C)'),
    svg('text', { x: xScale(-pad / 2), y: H - M.b - 6, class: 'zone-label', 'text-anchor': 'middle' }, 'inside air'),
    svg('text', { x: xScale(wallEnd + pad / 2), y: H - M.b - 6, class: 'zone-label', 'text-anchor': 'middle' }, 'outside air'),
  );

  // air lines and the drop across each surface film
  const first = wallPoints[0];
  const last = wallPoints[wallPoints.length - 1];
  if (insideAir && first) {
    root.append(
      svg('line', { x1: xScale(-pad), x2: xScale(0), y1: yScale(insideAir.temperatureC), y2: yScale(insideAir.temperatureC), class: 'air-line' }),
      svg('line', { x1: xScale(0), x2: xScale(0), y1: yScale(insideAir.temperatureC), y2: yScale(first.temperatureC), class: 'film-drop' }, svg('title', {}, 'Temperature drop across the internal surface film (R_si)')),
    );
  }
  if (outsideAir && last) {
    root.append(
      svg('line', { x1: xScale(wallEnd), x2: xScale(wallEnd + pad), y1: yScale(outsideAir.temperatureC), y2: yScale(outsideAir.temperatureC), class: 'air-line' }),
      svg('line', { x1: xScale(wallEnd), x2: xScale(wallEnd), y1: yScale(last.temperatureC), y2: yScale(outsideAir.temperatureC), class: 'film-drop' }, svg('title', {}, 'Temperature drop across the external surface film (R_se)')),
    );
  }

  // the wall's own profile
  root.append(svg('polyline', { points: wallPoints.map((p) => `${xScale(p.xMm).toFixed(2)},${yScale(p.temperatureC).toFixed(2)}`).join(' '), class: 'profile-line' }));
  for (const p of points) {
    const air = p.kind === 'inside-air' || p.kind === 'outside-air';
    const cx = p.kind === 'inside-air' ? xScale(-pad * 0.5) : p.kind === 'outside-air' ? xScale(wallEnd + pad * 0.5) : xScale(p.xMm);
    root.append(svg('circle', { cx, cy: yScale(p.temperatureC), r: air ? 4 : 3.5, class: `marker marker-${p.kind}` }, svg('title', {}, `${p.label}: ${Number(p.temperatureC.toFixed(2))} °C at ${Number(p.xMm.toFixed(2))} mm`)));
  }
  root.append(svg('text', { x: M.l + 4, y: M.t - 4, class: 'chart-note' }, truncate('Straight lines inside each layer: steady-state conduction', 70)));
  return root;
}
