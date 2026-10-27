/**
 * The Three.js scene is built only from a layout. These tests use real Three.js
 * objects (no GPU needed) and check that what would be drawn matches the
 * geometry exactly.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gridSpec, layoutWall, temperatureFraction, thermalCss } from '../src/geometry';
import type { LayerSpec, ThermalOverlay, WallLayout, WallSpec } from '../src/geometry';
import {
  applyThermalOverlay,
  buildGround,
  createWallScene,
  THERMAL_SLICES,
  syncHeatFlow,
  DIMMED_OPACITY,
  disposeWallScene,
  EDGE_COLOR,
  pickLayer,
  SELECTED_EDGE_COLOR,
  setSelection,
  stepWallScene,
  syncWallScene,
} from '../src/viewer3d/sceneBuilder';
import { at, expectClose } from './helpers/helpers';

const layer = (id: string, thicknessM: number, category: string): LayerSpec => ({ id, name: `L-${id}`, thicknessM, category, status: 'illustrative' });
const spec = (): WallSpec => ({
  widthM: 3,
  heightM: 2.5,
  layers: [layer('a', 0.015, 'Gypsum plaster'), layer('b', 0.2, 'Clay brick'), layer('c', 0.08, 'EPS'), layer('d', 0.02, 'Cement plaster')],
});
const layoutOf = (s: WallSpec, exploded = false, scale = 1): WallLayout => layoutWall(s, { exploded, thicknessScale: scale });
const meshOf = (scene: ReturnType<typeof createWallScene>, id: string): THREE.Mesh => {
  const m = scene.meshes.get(id);
  if (!m) throw new Error(`no mesh ${id}`);
  return m;
};
const materialOf = (m: THREE.Mesh) => (m.userData as { standardMaterial: THREE.MeshStandardMaterial }).standardMaterial;
const edgesOf = (m: THREE.Mesh) => m.children.find((c): c is THREE.LineSegments => c instanceof THREE.LineSegments) as THREE.LineSegments;
const sizeOf = (m: THREE.Mesh): THREE.Vector3 => new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
const centerOf = (m: THREE.Mesh): THREE.Vector3 => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());

describe('syncWallScene: boxes match the layout', () => {
  const scene = createWallScene();
  const layout = layoutOf(spec());
  syncWallScene(scene, layout, true);
  scene.group.updateMatrixWorld(true);

  it('creates one box per layer, all inside one group', () => {
    expect([...scene.meshes.keys()]).toEqual(['a', 'b', 'c', 'd']);
    expect(scene.group.children).toHaveLength(4);
  });

  it('every box has exactly the layer\'s thickness × height × width, in metres', () => {
    for (const box of layout.layers) {
      const size = sizeOf(meshOf(scene, box.id));
      expectClose(size.x, box.sizeX, 1e-12);
      expectClose(size.y, box.sizeY, 1e-12);
      expectClose(size.z, box.sizeZ, 1e-12);
    }
  });

  it('every box sits at its layout position and layers touch', () => {
    for (const box of layout.layers) expectClose(centerOf(meshOf(scene, box.id)).x, box.centerX, 1e-12);
    const bounds = layout.layers.map((l) => new THREE.Box3().setFromObject(meshOf(scene, l.id)));
    for (let i = 1; i < bounds.length; i++) expectClose(at(bounds, i).min.x, at(bounds, i - 1).max.x, 1e-12);
  });

  it('the whole group spans exactly interior face → exterior face', () => {
    const all = new THREE.Box3().setFromObject(scene.group);
    expectClose(all.min.x, layout.interiorFaceX, 1e-12);
    expectClose(all.max.x, layout.exteriorFaceX, 1e-12);
    expectClose(all.max.y - all.min.y, 2.5, 1e-12);
    expectClose(all.max.z - all.min.z, 3, 1e-12);
  });

  it('colours come from the layer category', () => {
    for (const box of layout.layers) expect('#' + materialOf(meshOf(scene, box.id)).color.getHexString()).toBe(box.color);
  });

  it('each box has an outline, and names/draw order follow the layers', () => {
    for (const box of layout.layers) {
      const m = meshOf(scene, box.id);
      expect(edgesOf(m)).toBeDefined();
      expect(m.name).toBe(box.name);
      expect(m.renderOrder).toBe(box.index);
      expect(m.userData.layerId).toBe(box.id);
    }
  });

  it('boxes share one geometry (cheap), not one per layer', () => {
    const geometries = new Set([...scene.meshes.values()].map((m) => m.geometry));
    expect(geometries.size).toBe(1);
  });
});

describe('syncWallScene: thickness exaggeration (the 5x default) is drawn, true thickness is not', () => {
  it('boxes are exactly the exaggerated size and the layers still touch', () => {
    const scene = createWallScene();
    const layout = layoutOf(spec(), false, 5);
    syncWallScene(scene, layout, true);
    scene.group.updateMatrixWorld(true);
    for (const box of layout.layers) {
      expectClose(sizeOf(meshOf(scene, box.id)).x, box.thicknessM * 5, 1e-12); // drawn 5x the true thickness
      expectClose(sizeOf(meshOf(scene, box.id)).y, 2.5, 1e-12); // height and width are never exaggerated
      expectClose(sizeOf(meshOf(scene, box.id)).z, 3, 1e-12);
    }
    const all = new THREE.Box3().setFromObject(scene.group);
    expectClose(all.max.x - all.min.x, 0.315 * 5, 1e-12);
    expectClose(all.min.x, layout.interiorFaceX, 1e-12);
  });
});

describe('syncWallScene: the scene follows changes', () => {
  it('a thicker layer makes a thicker box and moves the layers after it', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    const s = spec();
    s.layers[1] = layer('b', 0.4, 'Clay brick');
    const layout = layoutOf(s);
    expect(syncWallScene(scene, layout, true)).toBe(false); // same layers: not structural
    scene.group.updateMatrixWorld(true);
    expectClose(sizeOf(meshOf(scene, 'b')).x, 0.4, 1e-12);
    expectClose(centerOf(meshOf(scene, 'c')).x, at(layout.layers, 2).centerX, 1e-12);
  });

  it('adding and removing layers adds and removes boxes, reporting a structural change', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    const fewer = spec();
    fewer.layers.splice(1, 1);
    expect(syncWallScene(scene, layoutOf(fewer), true)).toBe(true);
    expect([...scene.meshes.keys()]).toEqual(['a', 'c', 'd']);
    expect(scene.group.children).toHaveLength(3);
    const more = spec();
    more.layers.push(layer('e', 0.05, 'Mineral wool'));
    expect(syncWallScene(scene, layoutOf(more), true)).toBe(true);
    expect(scene.meshes.size).toBe(5);
    expect(scene.group.children).toHaveLength(5);
  });

  it('reordering moves the boxes: the same layer ends up at the other position', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    const s = spec();
    s.layers.reverse();
    const layout = layoutOf(s);
    syncWallScene(scene, layout, true);
    expect(meshOf(scene, 'd').position.x).toBeLessThan(meshOf(scene, 'a').position.x);
    expectClose(meshOf(scene, 'd').position.x - meshOf(scene, 'd').scale.x / 2, layout.interiorFaceX, 1e-12);
  });

  it('exploded view spreads the boxes with the gap from the layout', () => {
    const scene = createWallScene();
    const layout = layoutOf(spec(), true);
    syncWallScene(scene, layout, true);
    const bounds = layout.layers.map((l) => new THREE.Box3().setFromObject(meshOf(scene, l.id)));
    for (let i = 1; i < bounds.length; i++) expectClose(at(bounds, i).min.x - at(bounds, i - 1).max.x, layout.gapM, 1e-12);
  });
});

describe('animation: stepWallScene', () => {
  it('moves smoothly toward the new target and then stops', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    const exploded = layoutOf(spec(), true);
    syncWallScene(scene, exploded, false); // not immediate: boxes stay put until stepped
    expect(meshOf(scene, 'd').position.x).toBe(at(layoutOf(spec()).layers, 3).centerX);

    let frames = 0;
    let previous = meshOf(scene, 'd').position.x;
    while (stepWallScene(scene, 0.25)) {
      frames++;
      const now = meshOf(scene, 'd').position.x;
      expect(now).toBeGreaterThan(previous); // always moving toward the target, never overshooting
      expect(now).toBeLessThanOrEqual(at(exploded.layers, 3).centerX + 1e-9);
      previous = now;
      expect(frames).toBeLessThan(200);
    }
    expect(frames).toBeGreaterThan(3);
    for (const box of exploded.layers) {
      const m = meshOf(scene, box.id);
      expect(m.position.x).toBe(box.centerX);
      expect([m.scale.x, m.scale.y, m.scale.z]).toEqual([box.sizeX, box.sizeY, box.sizeZ]);
    }
  });

  it('reports nothing moving when already at the target', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    expect(stepWallScene(scene, 0.25)).toBe(false);
  });

  it('factor 1 arrives in one step', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    syncWallScene(scene, layoutOf(spec(), true, 5), false);
    expect(stepWallScene(scene, 1)).toBe(true); // it moved
    expect(stepWallScene(scene, 1)).toBe(false); // and is now at rest
  });
});

describe('selection highlighting', () => {
  const build = () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    return scene;
  };

  it('selected layer stays solid with an orange outline; the others fade', () => {
    const scene = build();
    setSelection(scene, 'b');
    expect(materialOf(meshOf(scene, 'b')).opacity).toBe(1);
    expect(materialOf(meshOf(scene, 'b')).transparent).toBe(false);
    expect((edgesOf(meshOf(scene, 'b')).material as THREE.LineBasicMaterial).color.getHex()).toBe(SELECTED_EDGE_COLOR);
    for (const id of ['a', 'c', 'd']) {
      expect(materialOf(meshOf(scene, id)).opacity).toBe(DIMMED_OPACITY);
      expect(materialOf(meshOf(scene, id)).transparent).toBe(true);
      expect(materialOf(meshOf(scene, id)).depthWrite).toBe(false);
      expect((edgesOf(meshOf(scene, id)).material as THREE.LineBasicMaterial).color.getHex()).toBe(EDGE_COLOR);
    }
  });

  it('clearing the selection restores everything', () => {
    const scene = build();
    setSelection(scene, 'b');
    setSelection(scene, null);
    for (const m of scene.meshes.values()) {
      expect(materialOf(m).opacity).toBe(1);
      expect(materialOf(m).transparent).toBe(false);
      expect(materialOf(m).depthWrite).toBe(true);
      expect((edgesOf(m).material as THREE.LineBasicMaterial).color.getHex()).toBe(EDGE_COLOR);
    }
  });

  it('selecting an id that does not exist dims nothing', () => {
    const scene = build();
    setSelection(scene, 'ghost');
    for (const m of scene.meshes.values()) expect(materialOf(m).opacity).toBe(1);
  });

  it('a new layer added while something is selected can be re-dimmed consistently', () => {
    const scene = build();
    const s = spec();
    s.layers.push(layer('e', 0.05, 'Mineral wool'));
    syncWallScene(scene, layoutOf(s), true);
    setSelection(scene, 'a');
    expect(materialOf(meshOf(scene, 'e')).opacity).toBe(DIMMED_OPACITY);
  });
});

describe('pickLayer (click to inspect)', () => {
  const build = (exploded = false) => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec(), exploded), true);
    scene.group.updateMatrixWorld(true);
    return scene;
  };
  const ray = (origin: [number, number, number], direction: [number, number, number]) =>
    new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());

  it('looking from the interior side hits the interior layer first; from the exterior, the exterior layer', () => {
    const scene = build();
    expect(pickLayer(scene, ray([-5, 0, 0], [1, 0, 0]))).toBe('a');
    expect(pickLayer(scene, ray([5, 0, 0], [-1, 0, 0]))).toBe('d');
  });

  it('looking at the cut edge hits the layer at that position along the thickness', () => {
    const scene = build(true);
    const layout = layoutOf(spec(), true);
    for (const box of layout.layers) expect(pickLayer(scene, ray([box.centerX, 0, 10], [0, 0, -1]))).toBe(box.id);
  });

  it('hits nothing in the gaps of the exploded view, or outside the wall', () => {
    const scene = build(true);
    const layout = layoutOf(spec(), true);
    const gapX = (at(layout.layers, 0).maxX + at(layout.layers, 1).minX) / 2;
    expect(pickLayer(scene, ray([gapX, 0, 10], [0, 0, -1]))).toBeNull();
    expect(pickLayer(scene, ray([0, 10, 10], [0, 0, -1]))).toBeNull();
  });
});

describe('disposeWallScene', () => {
  it('removes every box and frees the shared geometry', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    let cubeDisposed = false;
    scene.cube.addEventListener('dispose', () => (cubeDisposed = true));
    const materials = [...scene.meshes.values()].map(materialOf);
    const disposed: boolean[] = materials.map(() => false);
    materials.forEach((m, i) => m.addEventListener('dispose', () => (disposed[i] = true)));
    disposeWallScene(scene);
    expect(scene.meshes.size).toBe(0);
    expect(scene.group.children).toHaveLength(0);
    expect(cubeDisposed).toBe(true);
    expect(disposed.every(Boolean)).toBe(true);
  });

  it('removing a layer frees that layer\'s material', () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    let freed = false;
    materialOf(meshOf(scene, 'b')).addEventListener('dispose', () => (freed = true));
    const s = spec();
    s.layers.splice(1, 1);
    syncWallScene(scene, layoutOf(s), true);
    expect(freed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Thermal overlay: calculated temperatures painted on the layers
// ---------------------------------------------------------------------------
describe('thermal overlay', () => {
  // Case-A-like temperatures (°C): the insulation 'c' takes most of the drop.
  const overlay = (): ThermalOverlay => ({
    minC: 5,
    maxC: 20,
    direction: 'outward',
    layers: [
      { id: 'a', startC: 19.2, endC: 19.0 },
      { id: 'b', startC: 19.0, endC: 17.8 },
      { id: 'c', startC: 17.8, endC: 5.4 },
      { id: 'd', startC: 5.4, endC: 5.2 },
    ],
  });
  const build = () => {
    const scene = createWallScene();
    syncWallScene(scene, layoutOf(spec()), true);
    return scene;
  };
  const colourAt = (mesh: THREE.Mesh, vertex: number): string => {
    const attr = mesh.geometry.getAttribute('color');
    return '#' + new THREE.Color(attr.getX(vertex), attr.getY(vertex), attr.getZ(vertex)).getHexString(THREE.SRGBColorSpace);
  };
  /** Vertex indices of a thermal box grouped by their x position (−0.5 … +0.5). */
  const verticesAtX = (mesh: THREE.Mesh, x: number): number[] => {
    const pos = mesh.geometry.getAttribute('position');
    return Array.from({ length: pos.count }, (_, i) => i).filter((i) => Math.abs(pos.getX(i) - x) < 1e-9);
  };

  it('paints each layer with vertex colours and an UNLIT material, so on-screen colours equal the colour bar', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    for (const mesh of scene.meshes.values()) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect((mesh.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('the interior-side face gets the colour of the start temperature and the exterior-side face that of the end temperature', () => {
    const scene = build();
    const o = overlay();
    applyThermalOverlay(scene, o);
    for (const entry of o.layers) {
      const mesh = meshOf(scene, entry.id);
      const startHex = thermalCss(temperatureFraction(entry.startC, o.minC, o.maxC));
      const endHex = thermalCss(temperatureFraction(entry.endC, o.minC, o.maxC));
      for (const v of verticesAtX(mesh, -0.5)) expect(colourAt(mesh, v)).toBe(startHex);
      for (const v of verticesAtX(mesh, 0.5)) expect(colourAt(mesh, v)).toBe(endHex);
    }
  });

  it('inside a layer the temperature (and so the colour) follows the straight line between its two faces', () => {
    const scene = build();
    const o = overlay();
    applyThermalOverlay(scene, o);
    const mesh = meshOf(scene, 'c'); // 17.8 → 5.4 °C
    const entry = at(o.layers, 2);
    for (let slice = 0; slice <= THERMAL_SLICES; slice++) {
      const along = slice / THERMAL_SLICES;
      const expectedHex = thermalCss(temperatureFraction(entry.startC + (entry.endC - entry.startC) * along, o.minC, o.maxC));
      for (const v of verticesAtX(mesh, along - 0.5)) expect(colourAt(mesh, v)).toBe(expectedHex);
    }
  });

  it('warmer side is warmer in colour: the interior face of the insulation is redder than its exterior face', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    const mesh = meshOf(scene, 'c');
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const warm = rgb(colourAt(mesh, at(verticesAtX(mesh, -0.5), 0)));
    const cold = rgb(colourAt(mesh, at(verticesAtX(mesh, 0.5), 0)));
    expect((warm[0] as number) - (warm[2] as number)).toBeGreaterThan((cold[0] as number) - (cold[2] as number));
  });

  it('works for heat gain: when outside is warmer, the exterior face is the warm colour', () => {
    const scene = build();
    const o: ThermalOverlay = { minC: 24, maxC: 35, direction: 'inward', layers: [{ id: 'a', startC: 24.6, endC: 24.7 }, { id: 'b', startC: 24.7, endC: 25.6 }, { id: 'c', startC: 25.6, endC: 34.7 }, { id: 'd', startC: 34.7, endC: 34.8 }] };
    applyThermalOverlay(scene, o);
    const mesh = meshOf(scene, 'c');
    expect(colourAt(mesh, at(verticesAtX(mesh, 0.5), 0))).toBe(thermalCss(temperatureFraction(34.7, 24, 35)));
  });

  it('the box geometry is unchanged in size: only the colours are added', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    scene.group.updateMatrixWorld(true);
    const layout = layoutOf(spec());
    for (const box of layout.layers) expectClose(sizeOf(meshOf(scene, box.id)).x, box.sizeX, 1e-12);
  });

  it('removing the overlay restores the normal category-coloured boxes', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    applyThermalOverlay(scene, null);
    for (const mesh of scene.meshes.values()) {
      expect(mesh.geometry).toBe(scene.cube);
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    }
  });

  it('layers missing from the overlay keep their normal look', () => {
    const scene = build();
    const o = overlay();
    o.layers = o.layers.filter((l) => l.id !== 'b');
    applyThermalOverlay(scene, o);
    expect(meshOf(scene, 'b').material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(meshOf(scene, 'a').material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('selection highlighting works on the painted boxes and survives turning the paint on and off', () => {
    const scene = build();
    setSelection(scene, 'b');
    applyThermalOverlay(scene, overlay());
    expect((meshOf(scene, 'b').material as THREE.MeshBasicMaterial).opacity).toBe(1);
    expect((meshOf(scene, 'a').material as THREE.MeshBasicMaterial).opacity).toBe(DIMMED_OPACITY);
    applyThermalOverlay(scene, null);
    expect(materialOf(meshOf(scene, 'a')).opacity).toBe(DIMMED_OPACITY);
    expect(materialOf(meshOf(scene, 'b')).opacity).toBe(1);
  });

  it('a layer added after the overlay was set can be painted, and changing the overlay replaces the old paint', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    const s = spec();
    s.layers.push(layer('e', 0.05, 'Mineral wool'));
    syncWallScene(scene, layoutOf(s), true);
    expect(meshOf(scene, 'e').material).toBeInstanceOf(THREE.MeshStandardMaterial); // not painted until the overlay is applied again
    const o = overlay();
    o.layers.push({ id: 'e', startC: 5.2, endC: 5.1 });
    applyThermalOverlay(scene, o);
    expect(meshOf(scene, 'e').material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('frees the colour geometry when the paint is removed or the scene is disposed', () => {
    const scene = build();
    applyThermalOverlay(scene, overlay());
    const painted = meshOf(scene, 'a').geometry;
    let freed = 0;
    painted.addEventListener('dispose', () => freed++);
    applyThermalOverlay(scene, null);
    expect(freed).toBe(1);
    applyThermalOverlay(scene, overlay());
    const again = meshOf(scene, 'b').geometry;
    again.addEventListener('dispose', () => freed++);
    disposeWallScene(scene);
    expect(freed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Heat-flow arrows: direction only
// ---------------------------------------------------------------------------
describe('heat-flow arrows', () => {
  const layout = layoutOf(spec());
  const arrows = (scene: ReturnType<typeof createWallScene>) => scene.flow.children as THREE.Group[];
  const headX = (arrow: THREE.Group): number => {
    arrow.updateWorldMatrix(true, true);
    return new THREE.Vector3().setFromMatrixPosition((arrow.children[1] as THREE.Mesh).matrixWorld).x;
  };
  const shaftX = (arrow: THREE.Group): number => {
    arrow.updateWorldMatrix(true, true);
    return new THREE.Vector3().setFromMatrixPosition((arrow.children[0] as THREE.Mesh).matrixWorld).x;
  };

  it('outward heat loss: every arrow points from the interior side to the exterior side (+x)', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    expect(arrows(scene).length).toBeGreaterThan(3);
    for (const a of arrows(scene)) expect(headX(a)).toBeGreaterThan(shaftX(a));
    expect(scene.flow.userData).toMatchObject({ direction: 'outward', count: arrows(scene).length });
  });

  it('inward heat gain: every arrow points from the exterior side to the interior side (−x)', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'inward');
    for (const a of arrows(scene)) expect(headX(a)).toBeLessThan(shaftX(a));
  });

  it('no temperature difference, or null: no arrows at all', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    syncHeatFlow(scene, layout, 'none');
    expect(arrows(scene)).toHaveLength(0);
    syncHeatFlow(scene, layout, 'inward');
    syncHeatFlow(scene, layout, null);
    expect(arrows(scene)).toHaveLength(0);
  });

  it('arrows run right through the wall and a little beyond both faces', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    scene.flow.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene.flow);
    expect(box.min.x).toBeLessThan(layout.interiorFaceX);
    expect(box.max.x).toBeGreaterThan(layout.exteriorFaceX);
  });

  it('arrows stay within the wall\'s height and width, in a regular grid', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    const ys = new Set(arrows(scene).map((a) => a.position.y));
    const zs = new Set(arrows(scene).map((a) => a.position.z));
    expect(ys.size * zs.size).toBe(arrows(scene).length);
    for (const y of ys) expect(Math.abs(y)).toBeLessThan(layout.heightM / 2);
    for (const z of zs) expect(Math.abs(z)).toBeLessThan(layout.widthM / 2);
  });

  it('all arrows are identical in size: they show direction, never magnitude', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    const lengths = arrows(scene).map((a) => Math.abs(headX(a) - shaftX(a)));
    for (const l of lengths) expectClose(l, at(lengths, 0), 1e-12);
  });

  it('are kept apart from the wall group so they never change the wall\'s measured size', () => {
    const scene = createWallScene();
    syncWallScene(scene, layout, true);
    const before = new THREE.Box3().setFromObject(scene.group).getSize(new THREE.Vector3()).toArray();
    syncHeatFlow(scene, layout, 'outward');
    expect(new THREE.Box3().setFromObject(scene.group).getSize(new THREE.Vector3()).toArray()).toEqual(before);
    expect(scene.group.children.some((c) => c === scene.flow)).toBe(false);
  });

  it('are rebuilt (not accumulated) on every sync and freed on dispose', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    const n = arrows(scene).length;
    syncHeatFlow(scene, layout, 'outward');
    expect(arrows(scene)).toHaveLength(n);
    const geometry = (arrows(scene)[0]?.children[0] as THREE.Mesh).geometry;
    let freed = false;
    geometry.addEventListener('dispose', () => (freed = true));
    disposeWallScene(scene);
    expect(freed).toBe(true);
    expect(arrows(scene)).toHaveLength(0);
  });

  it('draw on top of the wall (not hidden inside it)', () => {
    const scene = createWallScene();
    syncHeatFlow(scene, layout, 'outward');
    const arrow = arrows(scene)[0] as THREE.Group;
    expect(((arrow.children[0] as THREE.Mesh).material as THREE.Material).depthTest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ground grid
// ---------------------------------------------------------------------------
describe('ground grid', () => {
  it('is a metric grid just below the bottom of the wall, wider than the wall', () => {
    const layout = layoutOf(spec());
    const g = gridSpec(layout);
    const grid = buildGround(g);
    expect(grid).toBeInstanceOf(THREE.GridHelper);
    expect(grid.position.y).toBeLessThan(-layout.heightM / 2);
    expect(grid.position.y).toBeGreaterThan(-layout.heightM / 2 - 0.01);
    const size = new THREE.Box3().setFromObject(grid).getSize(new THREE.Vector3());
    expectClose(size.x, 2 * g.halfExtentM, 1e-9);
    expect(size.x).toBeGreaterThan(layout.widthM);
  });

  it('its line spacing equals the stated step', () => {
    const g = gridSpec(layoutOf(spec()));
    const grid = buildGround(g);
    const positions = grid.geometry.getAttribute('position');
    const xs = new Set<number>();
    for (let i = 0; i < positions.count; i++) xs.add(Number(positions.getX(i).toFixed(6)));
    const sorted = [...xs].sort((a, b) => a - b);
    expectClose(at(sorted, 1) - at(sorted, 0), g.stepM, 1e-6);
  });
});
