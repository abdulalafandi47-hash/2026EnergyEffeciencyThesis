import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  describeLayout,
  colorForCategory,
  explodedGap,
  formatThickness,
  GeometryError,
  layoutWall,
  MAX_THICKNESS_SCALE,
  spreadLabels,
} from '../src/geometry';
import type { LayerSpec, WallSpec } from '../src/geometry';
import { MATERIAL_CATEGORIES } from '../src/materials';
import { at, expectClose } from './helpers/helpers';

const layer = (id: string, thicknessM: number, category = 'Concrete'): LayerSpec => ({
  id,
  name: `Layer ${id}`,
  thicknessM,
  category,
  status: 'illustrative',
});
/** 3 m × 2.5 m wall, layers 15 mm / 200 mm / 80 mm / 20 mm (total 0.315 m). */
const wall = (): WallSpec => ({
  widthM: 3,
  heightM: 2.5,
  layers: [layer('a', 0.015, 'Gypsum plaster'), layer('b', 0.2, 'Clay brick'), layer('c', 0.08, 'EPS'), layer('d', 0.02, 'Cement plaster')],
});
const assembled = { exploded: false, thicknessScale: 1 };

describe('layoutWall: assembled wall at true scale', () => {
  const layout = layoutWall(wall(), assembled);

  it('has one box per layer, in interior → exterior order', () => {
    expect(layout.layers.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(layout.layers.map((l) => l.index)).toEqual([0, 1, 2, 3]);
  });

  it('box sizes are the real dimensions: thickness × height × width', () => {
    expect(layout.layers.map((l) => l.sizeX)).toEqual([0.015, 0.2, 0.08, 0.02]);
    for (const l of layout.layers) {
      expect(l.sizeY).toBe(2.5);
      expect(l.sizeZ).toBe(3);
    }
  });

  it('layers touch exactly: each starts where the previous one ends, with no gap or overlap', () => {
    for (let i = 1; i < layout.layers.length; i++) {
      expectClose(at(layout.layers, i).minX, at(layout.layers, i - 1).maxX, 1e-12);
    }
  });

  it('the true thicknesses add up to the wall thickness, and the drawn depth equals it', () => {
    expectClose(layout.totalThicknessM, 0.315);
    expectClose(layout.exteriorFaceX - layout.interiorFaceX, 0.315, 1e-12);
  });

  it('the wall is centred on the origin', () => {
    expectClose(layout.interiorFaceX, -0.1575, 1e-12);
    expectClose(layout.exteriorFaceX, 0.1575, 1e-12);
  });

  it('the interior face is the minimum x of the first layer, the exterior face the maximum x of the last', () => {
    expect(layout.interiorFaceX).toBe(at(layout.layers, 0).minX);
    expect(layout.exteriorFaceX).toBe(at(layout.layers, 3).maxX);
    expect(layout.interiorFaceX).toBeLessThan(layout.exteriorFaceX);
  });

  it('centres lie midway between each box\'s faces', () => {
    for (const l of layout.layers) expectClose(l.centerX, (l.minX + l.maxX) / 2, 1e-12);
  });

  it('records the options used and no gap', () => {
    expect(layout).toMatchObject({ exploded: false, thicknessScale: 1, gapM: 0, widthM: 3, heightM: 2.5 });
  });

  it('labels use the true thickness', () => {
    expect(layout.layers.map((l) => l.thicknessLabel)).toEqual(['15 mm', '200 mm', '80 mm', '20 mm']);
  });

  it('colours identify the material category', () => {
    expect(layout.layers.map((l) => l.color)).toEqual([
      CATEGORY_COLORS['Gypsum plaster'],
      CATEGORY_COLORS['Clay brick'],
      CATEGORY_COLORS['EPS'],
      CATEGORY_COLORS['Cement plaster'],
    ]);
  });

  it('the bounding radius contains every corner', () => {
    for (const l of layout.layers) {
      for (const x of [l.minX, l.maxX]) {
        for (const y of [-1.25, 1.25]) for (const z of [-1.5, 1.5]) expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(layout.boundingRadius + 1e-12);
      }
    }
  });
});

describe('layoutWall: the drawing follows the inputs', () => {
  it('doubling one layer\'s thickness doubles its box and widens the wall by exactly that amount', () => {
    const base = layoutWall(wall(), assembled);
    const spec = wall();
    spec.layers[2] = layer('c', 0.16, 'EPS');
    const thicker = layoutWall(spec, assembled);
    expectClose(at(thicker.layers, 2).sizeX, 2 * at(base.layers, 2).sizeX);
    expectClose(thicker.exteriorFaceX - thicker.interiorFaceX, 0.395, 1e-12);
    expect(at(thicker.layers, 0).sizeX).toBe(at(base.layers, 0).sizeX); // other layers unchanged
  });

  it('width and height set the box sizes', () => {
    const l = layoutWall({ ...wall(), widthM: 6, heightM: 4 }, assembled);
    for (const box of l.layers) expect([box.sizeY, box.sizeZ]).toEqual([4, 6]);
  });

  it('reordering layers reorders the boxes and swaps the interior/exterior layers', () => {
    const spec = wall();
    spec.layers.reverse();
    const l = layoutWall(spec, assembled);
    expect(l.layers.map((b) => b.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(at(l.layers, 0).minX).toBe(l.interiorFaceX);
    expect(at(l.layers, 3).maxX).toBe(l.exteriorFaceX);
    expectClose(l.exteriorFaceX - l.interiorFaceX, 0.315, 1e-12); // same wall, different order
  });

  it('works for one layer and for many layers', () => {
    const one = layoutWall({ widthM: 1, heightM: 1, layers: [layer('x', 0.1)] }, assembled);
    expect(one.interiorFaceX).toBeCloseTo(-0.05);
    expect(one.exteriorFaceX).toBeCloseTo(0.05);
    const many = layoutWall({ widthM: 1, heightM: 1, layers: Array.from({ length: 30 }, (_, i) => layer(`l${i}`, 0.01)) }, assembled);
    expect(many.layers).toHaveLength(30);
    expectClose(many.exteriorFaceX - many.interiorFaceX, 0.3, 1e-12);
  });
});

describe('layoutWall: exploded view', () => {
  const layout = layoutWall(wall(), { exploded: true, thicknessScale: 1 });
  const gap = explodedGap(3, 2.5);

  it('separates neighbouring layers by one uniform gap', () => {
    expect(layout.gapM).toBe(gap);
    for (let i = 1; i < layout.layers.length; i++) {
      expectClose(at(layout.layers, i).minX - at(layout.layers, i - 1).maxX, gap, 1e-12);
    }
  });

  it('keeps sizes and order, and stays centred', () => {
    expect(layout.layers.map((l) => l.sizeX)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expectClose(layout.interiorFaceX, -layout.exteriorFaceX, 1e-12);
    expectClose(layout.exteriorFaceX - layout.interiorFaceX, 0.315 + 3 * gap, 1e-12);
  });

  it('the gap is a tenth of the smaller side, never below 5 cm', () => {
    expect(explodedGap(3, 2.5)).toBe(0.25);
    expect(explodedGap(0.2, 0.3)).toBe(0.05);
    expect(explodedGap(10, 20)).toBe(1);
  });

  it('total thickness reported is still the TRUE wall thickness, not the exploded depth', () => {
    expectClose(layout.totalThicknessM, 0.315);
  });

  it('a single layer has no gaps', () => {
    const l = layoutWall({ widthM: 2, heightM: 2, layers: [layer('x', 0.1)] }, { exploded: true, thicknessScale: 1 });
    expectClose(l.exteriorFaceX - l.interiorFaceX, 0.1, 1e-12);
  });
});

describe('layoutWall: thickness exaggeration (display only)', () => {
  it('multiplies box thickness but not height, width, or the true thickness shown in labels', () => {
    const scaled = layoutWall(wall(), { exploded: false, thicknessScale: 5 });
    expect(scaled.layers.map((l) => l.sizeX)).toEqual([0.075, 1, 0.4, 0.1]);
    expect(scaled.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expect(scaled.layers.map((l) => l.thicknessLabel)).toEqual(['15 mm', '200 mm', '80 mm', '20 mm']);
    expect(scaled.layers.every((l) => l.sizeY === 2.5 && l.sizeZ === 3)).toBe(true);
    expect(scaled.thicknessScale).toBe(5);
    expectClose(scaled.totalThicknessM, 0.315);
  });

  it('keeps layers touching when scaled', () => {
    const scaled = layoutWall(wall(), { exploded: false, thicknessScale: 7 });
    for (let i = 1; i < scaled.layers.length; i++) expectClose(at(scaled.layers, i).minX, at(scaled.layers, i - 1).maxX, 1e-12);
  });
});

describe('layoutWall: invalid input is rejected, never drawn', () => {
  const bad = (spec: WallSpec, options = assembled) => () => layoutWall(spec, options);

  it.each([0, -1, NaN, Infinity])('width/height %s', (v) => {
    expect(bad({ ...wall(), widthM: v })).toThrow(GeometryError);
    expect(bad({ ...wall(), heightM: v })).toThrow(GeometryError);
  });
  it.each([0, -0.01, NaN, Infinity])('layer thickness %s', (v) => {
    const spec = wall();
    spec.layers[1] = layer('b', v);
    expect(bad(spec)).toThrow(/Thickness of layer 2/);
  });
  it('no layers', () => expect(bad({ ...wall(), layers: [] })).toThrow('at least one layer'));
  it('duplicate layer ids', () => {
    expect(bad({ ...wall(), layers: [layer('x', 0.1), layer('x', 0.1)] })).toThrow('Duplicate layer id');
  });
  it.each([0, 0.5, -3, NaN, MAX_THICKNESS_SCALE + 1])('thickness scale %s', (v) => {
    expect(bad(wall(), { exploded: false, thicknessScale: v })).toThrow(GeometryError);
  });
  it('accepts the scale limits', () => {
    expect(() => layoutWall(wall(), { exploded: false, thicknessScale: 1 })).not.toThrow();
    expect(() => layoutWall(wall(), { exploded: false, thicknessScale: MAX_THICKNESS_SCALE })).not.toThrow();
  });
});

describe('formatThickness', () => {
  it.each([
    [0.015, '15 mm'],
    [0.0125, '12.5 mm'],
    [0.0005, '0.5 mm'],
    [0.2, '200 mm'],
    [0.999, '999 mm'],
    [1, '1 m'],
    [1.25, '1.25 m'],
  ])('%d m → %s', (m, text) => expect(formatThickness(m)).toBe(text));
  it('shows a dash for unusable numbers', () => expect(formatThickness(NaN)).toBe('—'));
});

describe('colours', () => {
  it('every material category has its own colour', () => {
    const colours = MATERIAL_CATEGORIES.map((c) => colorForCategory(c));
    expect(new Set(colours).size).toBe(MATERIAL_CATEGORIES.length);
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('unknown categories get a neutral fallback, and inherited object keys are not mistaken for categories', () => {
    expect(colorForCategory('Unobtainium')).toBe('#b0b0b0');
    expect(colorForCategory('toString')).toBe('#b0b0b0');
  });
});

describe('spreadLabels', () => {
  const label = (id: string, x: number, y: number, width = 100, height = 20) => ({ id, x, y, width, height });
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, w = 100, h = 20) =>
    Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;

  it('leaves well-separated labels where they are', () => {
    const out = spreadLabels([label('a', 50, 10), label('b', 400, 10)]);
    expect(out).toEqual([{ id: 'a', x: 50, y: 10 }, { id: 'b', x: 400, y: 10 }]);
  });

  it('pushes colliding labels apart so none overlap', () => {
    const anchors = [label('a', 100, 50), label('b', 110, 50), label('c', 105, 55), label('d', 90, 48)];
    const out = spreadLabels(anchors);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(at(out, i), at(out, j))).toBe(false);
  });

  it('never moves a label sideways, never upwards, and returns results in the caller\'s order', () => {
    const anchors = [label('a', 100, 50), label('b', 110, 50), label('c', 105, 55)];
    const out = spreadLabels(anchors);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    out.forEach((o, i) => {
      expect(o.x).toBe(at(anchors, i).x);
      expect(o.y).toBeGreaterThanOrEqual(at(anchors, i).y);
    });
  });

  it('is deterministic, handles identical anchors, and ends for many labels', () => {
    const same = Array.from({ length: 12 }, (_, i) => label(`l${i}`, 200, 40));
    const out = spreadLabels(same);
    expect(out).toEqual(spreadLabels(same));
    expect(new Set(out.map((o) => o.y)).size).toBe(12);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(at(out, i), at(out, j))).toBe(false);
  });

  it('handles no labels', () => expect(spreadLabels([])).toEqual([]));

  describe('stacking upwards (away from the wall) with a top limit', () => {
    const cluster = [label('a', 100, 80), label('b', 105, 80), label('c', 110, 80)];

    it('moves colliding labels UP, never down, and none overlap', () => {
      const out = spreadLabels(cluster, { direction: 'up' });
      out.forEach((o, i) => expect(o.y).toBeLessThanOrEqual(at(cluster, i).y));
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(at(out, i), at(out, j))).toBe(false);
      expect(Math.max(...out.map((o) => o.y))).toBe(80); // the first label stays where it wanted to be
    });

    it('shifts the whole group down just enough to respect minY, keeping the spacing', () => {
      const free = spreadLabels(cluster, { direction: 'up' });
      expect(Math.min(...free.map((o) => o.y))).toBe(36); // unconstrained, the top label would sit at y = 36 (80, 58, 36)
      const limited = spreadLabels(cluster, { direction: 'up', minY: 50 });
      expect(Math.min(...limited.map((o) => o.y))).toBe(50);
      const shift = at(limited, 0).y - at(free, 0).y;
      limited.forEach((o, i) => expect(o.y - at(free, i).y).toBe(shift));
    });

    it('does not move anything when the limit is already respected', () => {
      expect(spreadLabels(cluster, { direction: 'up', minY: -500 })).toEqual(spreadLabels(cluster, { direction: 'up' }));
    });

    it('a custom gap keeps labels further apart', () => {
      const tight = spreadLabels(cluster, { direction: 'up', gap: 0 });
      const loose = spreadLabels(cluster, { direction: 'up', gap: 10 });
      const span = (r: Array<{ y: number }>) => Math.max(...r.map((o) => o.y)) - Math.min(...r.map((o) => o.y));
      expect(span(loose)).toBeGreaterThan(span(tight));
    });
  });
});

describe('describeLayout (text alternative for the 3D picture)', () => {
  it('lists size, layers in order with TRUE thicknesses, and the view mode', () => {
    const text = describeLayout(layoutWall(wall(), { exploded: false, thicknessScale: 1 }));
    expect(text).toContain('3 m wide and 2.5 m high');
    expect(text).toContain('total thickness 315 mm');
    expect(text).toContain('4 layers from the interior face to the exterior face');
    expect(text).toContain('1. Layer a, 15 mm; 2. Layer b, 200 mm; 3. Layer c, 80 mm; 4. Layer d, 20 mm');
    expect(text).toContain('assembled view, true proportions');
    expect(text).toContain('Colours identify material categories, not temperatures');
  });
  it('states exaggeration and exploded mode, and the true thickness is still used', () => {
    const text = describeLayout(layoutWall(wall(), { exploded: true, thicknessScale: 5 }));
    expect(text).toContain('exploded view, thickness exaggerated 5 times for visibility');
    expect(text).toContain('200 mm');
    expect(text).not.toContain('1000 mm'); // not the 5x drawn size
  });
  it('uses the singular for one layer', () => {
    expect(describeLayout(layoutWall({ widthM: 1, heightM: 1, layers: [layer('x', 0.1)] }, { exploded: false, thicknessScale: 1 }))).toContain('1 layer from');
  });
});
