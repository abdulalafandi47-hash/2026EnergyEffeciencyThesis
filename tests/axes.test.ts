/**
 * Coordinate axes in the 3D view: the arithmetic (geometry) and the real
 * Three.js objects (scene builder). The axes are a display aid; these tests make
 * sure they point the way the documentation says and match the wall's corner.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AXES, axesSpec, describeAxes, layoutWall } from '../src/geometry';
import type { LayerSpec, WallSpec } from '../src/geometry';
import { buildAxes, disposeAxes } from '../src/viewer3d/sceneBuilder';
import { expectClose } from './helpers/helpers';

const layer = (id: string, thicknessM: number): LayerSpec => ({ id, name: id, thicknessM, category: 'Concrete', status: 'illustrative' });
const spec = (widthM = 3, heightM = 2.5): WallSpec => ({ widthM, heightM, layers: [layer('a', 0.015), layer('b', 0.2), layer('c', 0.08)] });

describe('axesSpec (geometry)', () => {
  it('x runs through the wall (interior → exterior), y up, z along the wall, in the usual red/green/blue', () => {
    expect(AXES.map((a) => [a.id, a.direction, a.color])).toEqual([
      ['x', [1, 0, 0], '#e5534b'],
      ['y', [0, 1, 0], '#57ab5a'],
      ['z', [0, 0, 1], '#539bf5'],
    ]);
    expect(describeAxes()).toBe('Axes: x through the wall, interior → exterior · y up (height) · z along the wall (width)');
  });

  it('starts at the bottom corner of the interior face and is a quarter of the smaller side long', () => {
    for (const [scale, exploded] of [[1, false], [5, false], [5, true]] as const) {
      const layout = layoutWall(spec(), { exploded, thicknessScale: scale });
      const a = axesSpec(layout);
      expect(a.origin).toEqual([layout.interiorFaceX, -1.25, 1.5]);
      expectClose(a.lengthM, 0.625, 1e-12);
    }
    expectClose(axesSpec(layoutWall(spec(10, 0.4), { exploded: false, thicknessScale: 1 })).lengthM, 0.1, 1e-12);
  });

  it('the origin is exactly on the wall: the interior face, the floor, and one end of the wall', () => {
    const layout = layoutWall(spec(), { exploded: false, thicknessScale: 1 });
    const first = layout.layers[0];
    expect(first).toBeDefined();
    expectClose(axesSpec(layout).origin[0], (first?.centerX ?? 0) - (first?.sizeX ?? 0) / 2, 1e-12);
  });
});

describe('buildAxes (real Three.js objects)', () => {
  it('makes three arrows from the origin, pointing along x, y and z, with the documented colours', () => {
    const s = axesSpec(layoutWall(spec(), { exploded: false, thicknessScale: 5 }));
    const group = buildAxes(s);
    expect(group.children).toHaveLength(3);
    group.children.forEach((child, i) => {
      const arrow = child as THREE.ArrowHelper;
      const axis = AXES[i];
      expect(arrow).toBeInstanceOf(THREE.ArrowHelper);
      expect(arrow.name).toBe(`axis-${axis?.id}`);
      expect(arrow.position.toArray()).toEqual([...s.origin]);
      // ArrowHelper points its local +y along the given direction.
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
      dir.toArray().forEach((v, k) => expectClose(v, axis?.direction[k] ?? NaN, 1e-9));
      expect(`#${(arrow.line.material as THREE.LineBasicMaterial).color.getHexString()}`).toBe(axis?.color);
      expectClose(arrow.line.scale.y + arrow.cone.scale.y, s.lengthM, 1e-9); // shaft + head = the stated length
    });
    disposeAxes(group);
  });

  it('is drawn on top of the wall (no depth test), so the wall never hides it', () => {
    const group = buildAxes(axesSpec(layoutWall(spec(), { exploded: false, thicknessScale: 1 })));
    for (const child of group.children) {
      const arrow = child as THREE.ArrowHelper;
      expect((arrow.line.material as THREE.Material).depthTest).toBe(false);
      expect((arrow.cone.material as THREE.Material).depthTest).toBe(false);
      expect(arrow.renderOrder).toBeGreaterThan(0);
    }
    disposeAxes(group);
  });
});
