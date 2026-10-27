// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { analyzeWall, profileForChart } from '../src/analysis';
import { buildBarChart, buildProfileChart } from '../src/charts';
import { expectClose, referenceWall } from './helpers/helpers';

function chartFor(wall = referenceWall()) {
  const outcome = analyzeWall(wall);
  if (!outcome.ok) throw new Error(outcome.message);
  const data = profileForChart(outcome.analysis);
  return buildProfileChart({
    points: data.points.map((p) => ({ kind: p.kind, label: p.label, xMm: p.xM * 1000, temperatureC: p.temperatureC })),
    bands: data.bands.map((b) => ({ name: b.name, x0Mm: b.x0M * 1000, x1Mm: b.x1M * 1000 })),
  });
}

describe('profile chart', () => {
  const chart = chartFor();

  it('is a labelled image whose text lists every calculated temperature', () => {
    expect(chart.getAttribute('role')).toBe('img');
    const label = chart.getAttribute('aria-label') ?? '';
    expect(label).toContain('Inside air 20 °C at 0 mm');
    expect(label).toContain('Inside surface 19.2 °C at 0 mm');
    expect(label).toContain('Plaster (test) | Masonry (test) 19.01 °C at 15 mm');
    expect(label).toContain('Outside surface 5.25 °C at 315 mm');
    expect(label).toContain('Outside air 5 °C at 315 mm');
  });

  it('draws one band per layer and one marker per calculated point', () => {
    expect(chart.querySelectorAll('rect.band')).toHaveLength(4);
    expect(chart.querySelectorAll('circle.marker')).toHaveLength(7);
    expect(chart.querySelectorAll('circle.marker-interface')).toHaveLength(3);
  });

  it('the wall line passes through exactly the surface and interface points, in order, with positions proportional to distance', () => {
    const pts = (chart.querySelector('polyline.profile-line')?.getAttribute('points') ?? '').split(' ').map((p) => p.split(',').map(Number) as [number, number]);
    expect(pts).toHaveLength(5); // inside surface, 3 interfaces, outside surface
    const xs = pts.map((p) => p[0]);
    const span = (xs[4] as number) - (xs[0] as number);
    // interfaces at 15, 215, 295 of 315 mm
    expectClose(((xs[1] as number) - (xs[0] as number)) / span, 15 / 315, 1e-3);
    expectClose(((xs[2] as number) - (xs[0] as number)) / span, 215 / 315, 1e-3);
    expectClose(((xs[3] as number) - (xs[0] as number)) / span, 295 / 315, 1e-3);
    // heat loss: the line only ever goes down on screen = up in SVG y
    const ys = pts.map((p) => p[1]);
    for (let i = 1; i < ys.length; i++) expect(ys[i] as number).toBeGreaterThanOrEqual(ys[i - 1] as number);
  });

  it('warm side is higher up than the cold side (SVG y grows downward)', () => {
    const markers = [...chart.querySelectorAll('circle.marker')].map((m) => Number(m.getAttribute('cy')));
    expect(markers[0] as number).toBeLessThan(markers[6] as number); // inside air (20 °C) above outside air (5 °C)
  });

  it('shows the two air films as dashed drops and labels both axes with units', () => {
    expect(chart.querySelectorAll('line.film-drop')).toHaveLength(2);
    expect(chart.querySelectorAll('line.air-line')).toHaveLength(2);
    const text = chart.textContent ?? '';
    expect(text).toContain('Distance from interior face (mm)');
    expect(text).toContain('Temperature (°C)');
    expect(text).toContain('inside air');
    expect(text).toContain('outside air');
    expect(text).toContain('steady-state conduction');
  });

  it('works for heat gain (outside warmer) and for sub-zero temperatures', () => {
    const gain = chartFor(referenceWall({ conditions: { insideTemperatureC: 24, outsideTemperatureC: 35, durationHours: 1 } }));
    const markers = [...gain.querySelectorAll('circle.marker')].map((m) => Number(m.getAttribute('cy')));
    expect(markers[0] as number).toBeGreaterThan(markers[6] as number); // inside air (24) is now BELOW outside air (35)
    expect(chartFor(referenceWall({ conditions: { insideTemperatureC: 21, outsideTemperatureC: -3, durationHours: 1 } })).querySelectorAll('circle.marker')).toHaveLength(7);
  });

  it('works for a single layer and for a flat profile (no temperature difference)', () => {
    expect(chartFor(referenceWall({ layers: [{ name: 'Only', thicknessM: 0.2, lambdaWPerMK: 1 }] })).querySelectorAll('rect.band')).toHaveLength(1);
    expect(chartFor(referenceWall({ conditions: { insideTemperatureC: 18, outsideTemperatureC: 18, durationHours: 1 } })).querySelectorAll('circle.marker')).toHaveLength(7);
  });

  it('inserts layer names as text, so markup in a name cannot become elements', () => {
    const wall = referenceWall();
    wall.layers[0] = { ...(wall.layers[0] as NonNullable<(typeof wall.layers)[0]>), name: '<img src=x onerror=alert(1)>' };
    const svgEl = chartFor(wall);
    expect(svgEl.querySelector('img')).toBeNull();
    expect(svgEl.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('bar chart', () => {
  const items = [
    { label: 'Current', value: 0.412, highlight: true },
    { label: '120 mm', value: 0.2 },
    { label: 'broken', value: null },
  ];
  const chart = buildBarChart(items, { title: 'U-value', unit: 'W/(m²·K)' });

  it('draws bars from zero with lengths proportional to the values, and "n/a" instead of a bar for a missing value', () => {
    const bars = [...chart.querySelectorAll('rect.bar')].map((r) => Number(r.getAttribute('width')));
    expect(bars).toHaveLength(2);
    expectClose((bars[1] as number) / (bars[0] as number), 0.2 / 0.412, 1e-2);
    expect(chart.querySelector('.bar-na')?.textContent).toBe('n/a');
  });

  it('highlights the current wall and prints each value', () => {
    expect(chart.querySelectorAll('rect.bar-current')).toHaveLength(1);
    expect([...chart.querySelectorAll('.bar-value')].map((t) => t.textContent)).toEqual(['0.412', '0.200']);
  });

  it('has a text alternative with every value and its unit', () => {
    const label = chart.getAttribute('aria-label') ?? '';
    expect(label).toContain('Current: 0.412 W/(m²·K)');
    expect(label).toContain('broken: not available');
  });

  it('copes with no data and with all values zero', () => {
    expect(() => buildBarChart([], { title: 't', unit: 'u' })).not.toThrow();
    expect(() => buildBarChart([{ label: 'z', value: 0 }], { title: 't', unit: 'u' })).not.toThrow();
  });
});
