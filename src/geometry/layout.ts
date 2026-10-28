/**
 * Geometry of a multilayer wall: where each layer's box sits in 3D.
 *
 * This file is plain arithmetic. It knows nothing about Three.js, the DOM or
 * the editor, so it can be tested exactly. The 3D viewer only DRAWS what this
 * produces, and this is produced only from the validated wall the editor gives
 * to the calculation engine, so the picture always matches the real inputs.
 *
 * Coordinates (metres):
 *   x  through the wall thickness: the INTERIOR face is at the negative end,
 *      the EXTERIOR face at the positive end. Layers are stacked along x in
 *      the order given (interior → exterior).
 *   y  up (wall height)
 *   z  along the wall (wall width)
 * The whole wall is centred on the origin.
 *
 * Two display-only options exist and are always reported in the result:
 *   exploded       – layers are pulled apart along x so each can be seen;
 *   thicknessScale – the thickness (x) of every layer is multiplied for
 *                    visibility, because real layers are very thin compared
 *                    with the wall's width and height. Labels and the layer
 *                    list always show the TRUE thickness.
 */
import type { DataStatus } from '../engine';
import { colorForCategory } from './colors';
import { formatThickness } from './format';

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

export interface LayerSpec {
  /** Stable identifier (the editor's layer key). */
  id: string;
  name: string;
  /** True thickness, metres. */
  thicknessM: number;
  category: string;
  status: DataStatus;
}

/** A wall as drawn: validated SI sizes, layers from interior to exterior. */
export interface WallSpec {
  widthM: number;
  heightM: number;
  layers: LayerSpec[];
}

export interface LayoutOptions {
  /** Pull the layers apart along the thickness axis. */
  exploded: boolean;
  /** Display multiplier for layer thickness, 1 (true scale) to MAX_THICKNESS_SCALE. */
  thicknessScale: number;
}

export interface LayerBox {
  id: string;
  name: string;
  /** 0 = touching the interior face. */
  index: number;
  category: string;
  status: DataStatus;
  /** CSS colour identifying the material CATEGORY (not a temperature). */
  color: string;
  /** True thickness, metres. */
  thicknessM: number;
  /** Text such as "80 mm" built from the true thickness. */
  thicknessLabel: string;
  /** Box size along x as drawn (true thickness × thicknessScale). */
  sizeX: number;
  /** Box size along y (wall height). */
  sizeY: number;
  /** Box size along z (wall width). */
  sizeZ: number;
  minX: number;
  maxX: number;
  centerX: number;
}

export interface WallLayout {
  widthM: number;
  heightM: number;
  layers: LayerBox[];
  /** x of the interior face (min x of the first layer). */
  interiorFaceX: number;
  /** x of the exterior face (max x of the last layer). */
  exteriorFaceX: number;
  /** Sum of the TRUE layer thicknesses, metres. */
  totalThicknessM: number;
  exploded: boolean;
  thicknessScale: number;
  /** Gap between neighbouring layers when exploded (0 otherwise), metres. */
  gapM: number;
  /** Radius of a sphere around the origin that contains everything drawn. */
  boundingRadius: number;
}

export const MAX_THICKNESS_SCALE = 20;

/** Gap used between layers in the exploded view: a tenth of the wall's smaller side, at least 5 cm. */
export function explodedGap(widthM: number, heightM: number): number {
  return Math.max(0.05, 0.1 * Math.min(widthM, heightM));
}

function positive(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new GeometryError(`${label} must be a finite number greater than zero (got ${String(value)}).`);
  }
}

/** Computes the box of every layer. Throws GeometryError for impossible input. */
export function layoutWall(spec: WallSpec, options: LayoutOptions): WallLayout {
  positive(spec.widthM, 'Wall width');
  positive(spec.heightM, 'Wall height');
  if (spec.layers.length === 0) throw new GeometryError('A wall needs at least one layer.');
  if (
    typeof options.thicknessScale !== 'number' ||
    !Number.isFinite(options.thicknessScale) ||
    options.thicknessScale < 1 ||
    options.thicknessScale > MAX_THICKNESS_SCALE
  ) {
    throw new GeometryError(`Thickness scale must be between 1 and ${MAX_THICKNESS_SCALE} (got ${String(options.thicknessScale)}).`);
  }
  const ids = new Set<string>();
  spec.layers.forEach((layer, i) => {
    positive(layer.thicknessM, `Thickness of layer ${i + 1}`);
    if (ids.has(layer.id)) throw new GeometryError(`Duplicate layer id "${layer.id}".`);
    ids.add(layer.id);
  });

  const gapM = options.exploded ? explodedGap(spec.widthM, spec.heightM) : 0;
  const scale = options.thicknessScale;

  // Stack along x starting at 0, then shift so the whole wall is centred on the origin.
  let cursor = 0;
  const raw = spec.layers.map((layer) => {
    const sizeX = layer.thicknessM * scale;
    const box = { layer, sizeX, minX: cursor };
    cursor += sizeX + gapM;
    return box;
  });
  const extent = cursor - gapM; // no gap after the last layer
  const shift = -extent / 2;

  const layers: LayerBox[] = raw.map(({ layer, sizeX, minX }, index) => {
    const min = minX + shift;
    return {
      id: layer.id,
      name: layer.name,
      index,
      category: layer.category,
      status: layer.status,
      color: colorForCategory(layer.category),
      thicknessM: layer.thicknessM,
      thicknessLabel: formatThickness(layer.thicknessM),
      sizeX,
      sizeY: spec.heightM,
      sizeZ: spec.widthM,
      minX: min,
      maxX: min + sizeX,
      centerX: min + sizeX / 2,
    };
  });

  const first = layers[0] as LayerBox;
  const last = layers[layers.length - 1] as LayerBox;
  return {
    widthM: spec.widthM,
    heightM: spec.heightM,
    layers,
    interiorFaceX: first.minX,
    exteriorFaceX: last.maxX,
    totalThicknessM: spec.layers.reduce((sum, l) => sum + l.thicknessM, 0),
    exploded: options.exploded,
    thicknessScale: scale,
    gapM,
    boundingRadius: Math.hypot(extent / 2, spec.heightM / 2, spec.widthM / 2),
  };
}
