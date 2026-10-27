/**
 * Builds the Three.js objects for a wall layout. No renderer, camera or DOM is
 * needed here, so it is fully testable in Node.
 *
 * Every layer is ONE box: a shared 1×1×1 cube geometry scaled to the layer's
 * size and moved to its position. Nothing is hand-drawn or static; change the
 * layout and the boxes change.
 *
 * Animation: each box stores its TARGET position/size. `stepWallScene` moves
 * the current values a fraction of the way to the target each frame (used for
 * the exploded-view transition and for thickness edits).
 */
import * as THREE from 'three';
import { temperatureFraction, thermalRgb } from '../geometry';
import type { FlowDirection, GridSpec, ThermalOverlay, WallLayout } from '../geometry';

interface Target {
  x: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface LayerMeshData {
  layerId: string;
  target: Target;
  /** The normal (category-coloured, lit) material. */
  standardMaterial: THREE.MeshStandardMaterial;
  /** Unlit vertex-colour material used while the thermal overlay is on. */
  thermalMaterial?: THREE.MeshBasicMaterial;
  /** Box with per-vertex temperature colours, while the overlay is on. */
  thermalGeometry?: THREE.BoxGeometry;
}

export interface WallScene {
  group: THREE.Group;
  /** Heat-flow arrows live here, separate from the wall so they never affect its size. */
  flow: THREE.Group;
  /** layer id → its box. */
  meshes: Map<string, THREE.Mesh>;
  cube: THREE.BoxGeometry;
  cubeEdges: THREE.EdgesGeometry;
  /** The layer currently highlighted, kept so highlighting survives material changes. */
  selectedId: string | null;
}

export const EDGE_COLOR = 0x3a424b;
export const SELECTED_EDGE_COLOR = 0xff9f0a;
/** Opacity of layers that are NOT selected while another layer is highlighted. */
export const DIMMED_OPACITY = 0.18;

export function createWallScene(): WallScene {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  return { group: new THREE.Group(), flow: new THREE.Group(), meshes: new Map(), cube, cubeEdges: new THREE.EdgesGeometry(cube), selectedId: null };
}

const dataOf = (mesh: THREE.Mesh): LayerMeshData => mesh.userData as LayerMeshData;

function disposeMesh(mesh: THREE.Mesh): void {
  const data = dataOf(mesh);
  data.standardMaterial.dispose();
  data.thermalMaterial?.dispose();
  data.thermalGeometry?.dispose();
  for (const child of mesh.children) {
    if (child instanceof THREE.LineSegments) (child.material as THREE.Material).dispose();
  }
}

/**
 * Makes the scene match `layout`: creates boxes for new layers, removes boxes
 * of layers that no longer exist, and sets every box's target.
 * With `immediate` the boxes jump straight to their targets.
 * Returns true if layers were added or removed.
 */
export function syncWallScene(scene: WallScene, layout: WallLayout, immediate: boolean): boolean {
  let structural = false;
  const wanted = new Set(layout.layers.map((l) => l.id));

  for (const [id, mesh] of scene.meshes) {
    if (!wanted.has(id)) {
      scene.group.remove(mesh);
      disposeMesh(mesh);
      scene.meshes.delete(id);
      structural = true;
    }
  }

  for (const box of layout.layers) {
    let mesh = scene.meshes.get(box.id);
    let created = false;
    if (!mesh) {
      mesh = new THREE.Mesh(scene.cube, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
      mesh.userData = { layerId: box.id, standardMaterial: mesh.material as THREE.MeshStandardMaterial } as Partial<LayerMeshData>;
      mesh.add(new THREE.LineSegments(scene.cubeEdges, new THREE.LineBasicMaterial({ color: EDGE_COLOR })));
      scene.meshes.set(box.id, mesh);
      scene.group.add(mesh);
      structural = true;
      created = true;
    }
    const target: Target = { x: box.centerX, sx: box.sizeX, sy: box.sizeY, sz: box.sizeZ };
    (mesh.userData as LayerMeshData).target = target;
    mesh.name = box.name;
    mesh.renderOrder = box.index;
    dataOf(mesh).standardMaterial.color.set(box.color);
    if (created || immediate) {
      mesh.position.set(target.x, 0, 0);
      mesh.scale.set(target.sx, target.sy, target.sz);
    }
  }
  return structural;
}

/**
 * Moves every box a fraction `factor` (0–1) of the way to its target.
 * Returns true while anything is still moving.
 */
export function stepWallScene(scene: WallScene, factor: number): boolean {
  let moving = false;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
  for (const mesh of scene.meshes.values()) {
    const { target } = dataOf(mesh);
    const arrived =
      near(mesh.position.x, target.x) && near(mesh.scale.x, target.sx) && near(mesh.scale.y, target.sy) && near(mesh.scale.z, target.sz);
    if (arrived) {
      mesh.position.x = target.x;
      mesh.scale.set(target.sx, target.sy, target.sz);
      continue;
    }
    mesh.position.x += (target.x - mesh.position.x) * factor;
    mesh.scale.x += (target.sx - mesh.scale.x) * factor;
    mesh.scale.y += (target.sy - mesh.scale.y) * factor;
    mesh.scale.z += (target.sz - mesh.scale.z) * factor;
    moving = true;
  }
  return moving;
}

/** Highlights one layer (full opacity, orange outline) and dims the rest; null restores everything. */
export function setSelection(scene: WallScene, selectedId: string | null): void {
  scene.selectedId = selectedId;
  const anySelected = selectedId !== null && scene.meshes.has(selectedId);
  for (const [id, mesh] of scene.meshes) {
    const data = dataOf(mesh);
    const isSelected = anySelected && id === selectedId;
    const dimmed = anySelected && !isSelected;
    for (const material of [data.standardMaterial, data.thermalMaterial]) {
      if (!material) continue;
      material.opacity = dimmed ? DIMMED_OPACITY : 1;
      material.transparent = dimmed;
      material.depthWrite = !dimmed;
      material.needsUpdate = true;
    }
    for (const child of mesh.children) {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).color.setHex(isSelected ? SELECTED_EDGE_COLOR : EDGE_COLOR);
      }
    }
  }
}

/** Number of slices along the thickness; temperature is sampled at each slice boundary. */
export const THERMAL_SLICES = 16;

/**
 * A box whose vertex colours show the calculated temperature across the layer:
 * the interior-side face gets `startC`, the exterior-side face `endC`, and
 * between them the temperature varies linearly (steady-state conduction).
 */
function makeThermalGeometry(startC: number, endC: number, overlay: ThermalOverlay): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1, THERMAL_SLICES, 1, 1);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const along = position.getX(i) + 0.5; // 0 at the interior-side face, 1 at the exterior-side face
    const temperatureC = startC + (endC - startC) * along;
    const [r, g, b] = thermalRgb(temperatureFraction(temperatureC, overlay.minC, overlay.maxC));
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace); // converts to the working colour space
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Paints the calculated temperatures on the layers (or removes the paint when
 * `overlay` is null). The overlay material is UNLIT so the colours on screen
 * are exactly the colours of the colour bar, with no shading altering them.
 * Layers missing from the overlay keep their normal look.
 */
export function applyThermalOverlay(scene: WallScene, overlay: ThermalOverlay | null): void {
  for (const [id, mesh] of scene.meshes) {
    const data = dataOf(mesh);
    const entry = overlay?.layers.find((l) => l.id === id);
    data.thermalGeometry?.dispose();
    delete data.thermalGeometry;
    if (overlay && entry) {
      data.thermalGeometry = makeThermalGeometry(entry.startC, entry.endC, overlay);
      data.thermalMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true });
      mesh.geometry = data.thermalGeometry;
      mesh.material = data.thermalMaterial;
    } else {
      mesh.geometry = scene.cube;
      mesh.material = data.standardMaterial;
    }
  }
  setSelection(scene, scene.selectedId); // keep the highlight on whichever material is now showing
}

const ARROW_COLOR = 0xffa94d;

/**
 * Heat-flow arrows through the wall: they point from the warm side to the cold
 * side. All arrows are the same size: they show the DIRECTION of the
 * steady-state flow only. Their length or thickness is NOT a magnitude (the
 * magnitude is a number in the results panel). Pass null or 'none' for no arrows.
 */
export function syncHeatFlow(scene: WallScene, layout: WallLayout, direction: FlowDirection | null): void {
  for (const child of [...scene.flow.children]) {
    scene.flow.remove(child);
    child.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
  }
  scene.flow.userData = { direction: direction ?? 'none', count: 0 };
  if (direction === null || direction === 'none') return;

  const longest = Math.max(layout.widthM, layout.heightM);
  const reach = 0.18 * longest;
  const length = layout.exteriorFaceX - layout.interiorFaceX + 2 * reach;
  const radius = Math.max(0.004, 0.0055 * longest);
  const headLength = 7 * radius;
  const rows = Math.min(4, Math.max(2, Math.round(layout.heightM / 0.9)));
  const cols = Math.min(4, Math.max(2, Math.round(layout.widthM / 0.9)));
  const sign = direction === 'outward' ? 1 : -1; // outward = interior → exterior = +x

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const y = (((r + 0.5) / rows) - 0.5) * layout.heightM * 0.8;
      const z = (((c + 0.5) / cols) - 0.5) * layout.widthM * 0.8;
      const material = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, depthTest: false, transparent: true, opacity: 0.85 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length - headLength, 10), material);
      const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.8, headLength, 14), material);
      shaft.position.y = -headLength / 2; // arrow along +y first, then turned onto x
      head.position.y = (length - headLength) / 2;
      const arrow = new THREE.Group();
      arrow.add(shaft, head);
      arrow.rotation.z = -sign * (Math.PI / 2); // +y → ±x
      arrow.position.set((layout.interiorFaceX + layout.exteriorFaceX) / 2, y, z);
      arrow.renderOrder = 999;
      shaft.renderOrder = head.renderOrder = 999;
      arrow.userData = { direction };
      scene.flow.add(arrow);
    }
  }
  scene.flow.userData = { direction, count: rows * cols };
}

/** A subtle ground grid under the wall (metric spacing from `gridSpec`). */
export function buildGround(spec: GridSpec): THREE.GridHelper {
  const size = spec.halfExtentM * 2;
  const grid = new THREE.GridHelper(size, Math.round(size / spec.stepM), 0x4b5663, 0x2c343d);
  grid.position.y = spec.groundY - 0.002; // just below the wall's bottom face, to avoid flicker
  const material = grid.material as THREE.LineBasicMaterial;
  material.transparent = true;
  material.opacity = 0.85;
  return grid;
}

/** The layer id under a ray (nearest box hit), or null. */
export function pickLayer(scene: WallScene, raycaster: THREE.Raycaster): string | null {
  const hits = raycaster.intersectObjects([...scene.meshes.values()], false);
  const first = hits[0];
  return first ? dataOf(first.object as THREE.Mesh).layerId : null;
}

export function disposeWallScene(scene: WallScene): void {
  syncHeatFlow(scene, { interiorFaceX: 0, exteriorFaceX: 0, widthM: 1, heightM: 1 } as WallLayout, null);
  for (const mesh of scene.meshes.values()) {
    scene.group.remove(mesh);
    disposeMesh(mesh);
  }
  scene.meshes.clear();
  scene.cube.dispose();
  scene.cubeEdges.dispose();
}
