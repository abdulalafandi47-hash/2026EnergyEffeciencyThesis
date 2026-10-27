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
import type { WallLayout } from '../geometry';

interface Target {
  x: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface LayerMeshData {
  layerId: string;
  target: Target;
}

export interface WallScene {
  group: THREE.Group;
  /** layer id → its box. */
  meshes: Map<string, THREE.Mesh>;
  cube: THREE.BoxGeometry;
  cubeEdges: THREE.EdgesGeometry;
}

export const EDGE_COLOR = 0x3a424b;
export const SELECTED_EDGE_COLOR = 0xff9f0a;
/** Opacity of layers that are NOT selected while another layer is highlighted. */
export const DIMMED_OPACITY = 0.18;

export function createWallScene(): WallScene {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  return { group: new THREE.Group(), meshes: new Map(), cube, cubeEdges: new THREE.EdgesGeometry(cube) };
}

const dataOf = (mesh: THREE.Mesh): LayerMeshData => mesh.userData as LayerMeshData;

function disposeMesh(mesh: THREE.Mesh): void {
  (mesh.material as THREE.Material).dispose();
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
      mesh.add(new THREE.LineSegments(scene.cubeEdges, new THREE.LineBasicMaterial({ color: EDGE_COLOR })));
      scene.meshes.set(box.id, mesh);
      scene.group.add(mesh);
      structural = true;
      created = true;
    }
    const target: Target = { x: box.centerX, sx: box.sizeX, sy: box.sizeY, sz: box.sizeZ };
    mesh.userData = { layerId: box.id, target } satisfies LayerMeshData;
    mesh.name = box.name;
    mesh.renderOrder = box.index;
    (mesh.material as THREE.MeshStandardMaterial).color.set(box.color);
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
  const anySelected = selectedId !== null && scene.meshes.has(selectedId);
  for (const [id, mesh] of scene.meshes) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const isSelected = anySelected && id === selectedId;
    const dimmed = anySelected && !isSelected;
    material.opacity = dimmed ? DIMMED_OPACITY : 1;
    material.transparent = dimmed;
    material.depthWrite = !dimmed;
    material.needsUpdate = true;
    for (const child of mesh.children) {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).color.setHex(isSelected ? SELECTED_EDGE_COLOR : EDGE_COLOR);
      }
    }
  }
}

/** The layer id under a ray (nearest box hit), or null. */
export function pickLayer(scene: WallScene, raycaster: THREE.Raycaster): string | null {
  const hits = raycaster.intersectObjects([...scene.meshes.values()], false);
  const first = hits[0];
  return first ? dataOf(first.object as THREE.Mesh).layerId : null;
}

export function disposeWallScene(scene: WallScene): void {
  for (const mesh of scene.meshes.values()) {
    scene.group.remove(mesh);
    disposeMesh(mesh);
  }
  scene.meshes.clear();
  scene.cube.dispose();
  scene.cubeEdges.dispose();
}
