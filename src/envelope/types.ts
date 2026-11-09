/**
 * The building-envelope model (Stage "building envelope").
 *
 * A project is a simplified PARAMETRIC house: one conditioned zone in a
 * rectangular box (length along east–west, depth along north–south, one storey
 * height), plus a list of components. Each component is one building element
 * whose heat transfer is calculated on its own, in steady state.
 *
 * All numbers are SI and already validated by the screen before they reach the
 * model (the screen keeps half-typed text to itself). Everything that is not
 * known is stored as null, never as a guessed default.
 */
import type { DataStatus } from '../engine';
import type { ThermalValueType } from '../materials';

export type ComponentType = 'exterior-wall' | 'partition' | 'roof' | 'floor' | 'window' | 'glazed-door' | 'door';

/** Compass side of the rectangular house. North is −z, south +z, east +x, west −x in the 3D view. */
export type Side = 'north' | 'east' | 'south' | 'west';

/**
 * What is on the other side of an element (the conditioned zone is always on the first side):
 *  - outside:      outdoor air (temperature from the project's conditions);
 *  - unconditioned: an unheated/uncooled space (garage, storage, ventilated attic) at a temperature the user enters;
 *  - ground:       soil (ground-coupled heat transfer is NOT supported in this stage);
 *  - conditioned:  another conditioned room at the same temperature (no heat exchange is counted).
 */
export type Exposure =
  | { kind: 'outside' }
  | { kind: 'unconditioned'; temperatureC: number | null }
  | { kind: 'ground' }
  | { kind: 'conditioned' };

/** One layer of an opaque construction, from the conditioned side outwards. */
export interface ConstructionLayer {
  /** Material id in the material database; null = not chosen yet. */
  materialId: string | null;
  /** Thickness in metres; null = not entered yet. */
  thicknessM: number | null;
}

/** An opaque construction: layers from the conditioned (inside) face to the other face. */
export interface Construction {
  layers: ConstructionLayer[];
}

/**
 * A property value that must be traceable: a number with its unit and where it comes from.
 * Used for window U-values, g-values and shading factors, and door U-values.
 */
export interface DocumentedValue {
  value: number;
  unit: string;
  /** Where the number comes from (datasheet, test report, standard table …). Required, never empty. */
  source: string;
  /** Measured, declared or design value (or not stated). */
  valueType: ThermalValueType;
  /** Test or reference conditions, if known. */
  conditions?: string;
  /** How far the value can be trusted. Values typed by the user are "user-defined". */
  status: DataStatus;
}

interface ComponentBase {
  id: string;
  name: string;
  /** Hidden components are not drawn but keep all their data and are still calculated. */
  visible: boolean;
}

export interface ExteriorWall extends ComponentBase {
  type: 'exterior-wall';
  side: Side;
  /** "outside" or "unconditioned" (a wall to an unconditioned space). */
  exposure: Exposure;
  construction: Construction;
}

export interface Partition extends ComponentBase {
  type: 'partition';
  /** Distance of the partition from the WEST face of the house, metres (it runs north–south, full storey height). */
  positionM: number;
  /** "conditioned" (no heat exchange counted) or "unconditioned" (with that space's temperature). */
  exposure: Exposure;
  construction: Construction;
}

export interface Roof extends ComponentBase {
  type: 'roof';
  /** Only a flat roof over the whole footprint is modelled in this stage. */
  form: 'flat';
  exposure: Exposure;
  construction: Construction;
}

export interface Floor extends ComponentBase {
  type: 'floor';
  /** "ground" (unsupported), "outside" (e.g. on pilotis) or "unconditioned" (e.g. over a garage). */
  exposure: Exposure;
  construction: Construction;
}

/** A window or glazed door, placed in an exterior wall. */
export interface Glazing extends ComponentBase {
  type: 'window' | 'glazed-door';
  /** Id of the exterior wall that holds it. */
  hostId: string;
  /** Distance from the wall's left end as seen from OUTSIDE, metres. */
  offsetM: number;
  /** Height of the bottom edge above the floor, metres (0 for doors). */
  sillM: number;
  widthM: number;
  heightM: number;
  /** Overall U-value of the window (U_w), W/(m²·K), from a documented source. */
  uValue: DocumentedValue | null;
  /** Total solar energy transmittance g (0–1). Stored only: solar gains are not calculated in this stage. */
  gValue: DocumentedValue | null;
  /** Shading reduction factor (0–1). Stored only. */
  shadingFactor: DocumentedValue | null;
}

/** An opaque exterior door, placed in an exterior wall. */
export interface Door extends ComponentBase {
  type: 'door';
  hostId: string;
  offsetM: number;
  widthM: number;
  heightM: number;
  /** A documented overall U-value, or a layered construction calculated like a wall. */
  spec: { kind: 'u-value'; uValue: DocumentedValue | null } | { kind: 'layers'; construction: Construction };
}

export type Component = ExteriorWall | Partition | Roof | Floor | Glazing | Door;
export type Opening = Glazing | Door;
export type OpaqueLayered = ExteriorWall | Partition | Roof | Floor;

export interface BuildingGeometry {
  /** East–west length of the house, metres (external dimension). */
  lengthM: number;
  /** North–south depth of the house, metres (external dimension). */
  depthM: number;
  /** Storey height used for walls and partitions, metres. */
  heightM: number;
}

/** The single set of boundary conditions all results are calculated for. */
export interface Conditions {
  /** Air temperature of the conditioned zone, °C. */
  insideC: number;
  /** Outdoor air temperature, °C. */
  outsideC: number;
  /** Duration for the constant-condition energy figure, hours. */
  durationH: number;
  /** What the user calls this condition, e.g. "Illustrative summer afternoon". */
  label: string;
}

export interface BuildingProject {
  name: string;
  /** True for the built-in example; it is illustrative, not a real or verified building. */
  isExample: boolean;
  geometry: BuildingGeometry;
  conditions: Conditions;
  components: Component[];
  /** Counter for new component ids (keeps ids unique and deterministic). */
  nextId: number;
}

export const COMPONENT_TYPE_LABEL: Record<ComponentType, string> = {
  'exterior-wall': 'Exterior wall',
  partition: 'Interior partition',
  roof: 'Roof',
  floor: 'Floor',
  window: 'Window',
  'glazed-door': 'Glazed door',
  door: 'Opaque door',
};

export const isOpening = (c: Component): c is Opening => c.type === 'window' || c.type === 'glazed-door' || c.type === 'door';
export const isGlazing = (c: Component): c is Glazing => c.type === 'window' || c.type === 'glazed-door';
