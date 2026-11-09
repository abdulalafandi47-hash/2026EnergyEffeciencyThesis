/**
 * Steady-state heat transfer through each building element, and the envelope total.
 *
 * Reuse: every opaque layered element (wall, partition, roof, floor, layered
 * door) is calculated by the unchanged wall engine (`calculateWall`), whose
 * arithmetic (R = d/λ, R_total = R_si + Σ R + R_se, U = 1/R_total,
 * Q̇ = U·A·|ΔT|, C = Σ ρ·c_p·V, temperatures) does not depend on the element
 * being vertical. What DOES differ per element, and is decided here:
 *
 *  - the temperature on the other side (outdoor air, an unconditioned space, or
 *    the ground, which is not supported);
 *  - the surface resistances, which depend on the direction of heat flow:
 *      walls, partitions, doors      → horizontal heat flow;
 *      roof (zone below)             → upwards when the zone is warmer, downwards when it is cooler;
 *      floor (zone above)            → downwards when the zone is warmer, upwards when it is cooler;
 *    with the outside value R_se for outdoor air, and the inside value on both
 *    sides when the other side is an unconditioned space (still indoor air).
 *    All these presets are labelled UNVERIFIED (see docs/sources.md).
 *
 * Windows and opaque doors with a documented overall U-value use Q̇ = U·A·|ΔT|
 * directly; the U-value already contains the surface resistances.
 *
 * Sign convention for totals: Q̇ > 0 means heat leaves the conditioned zone,
 * Q̇ < 0 means heat enters it. Nothing here is a dynamic, annual or cooling-demand result.
 */
import { calculateWall, EngineInputError, heatFlowDirection, heatTransferRateW, iso6946Preset } from '../engine';
import type { HeatFlowDirection, Layer, SurfaceHeatFlowOrientation, SurfaceResistances, WallCalculationResult } from '../engine';
import { materialToLayer } from '../materials';
import type { MaterialRecord } from '../materials';
import { checkModel, dimensionsOf } from './geometry';
import type { ElementDimensions, ModelIssue } from './geometry';
import type { BuildingProject, Component, ComponentType, Construction, DocumentedValue } from './types';
import { COMPONENT_TYPE_LABEL, isGlazing } from './types';

export type ComponentStatus =
  /** U and Q̇ calculated and included in the total. */
  | 'calculated'
  /** Deliberately not counted (a partition between conditioned rooms at the same temperature). */
  | 'excluded'
  /** No supported method in this stage (ground-contact floors). */
  | 'unsupported'
  /** Something the calculation needs has not been entered (layers, a documented U-value, a temperature). */
  | 'missing-data'
  /** Impossible geometry or values (see the reasons). */
  | 'invalid';

export interface SurfaceUsed {
  insideM2KPerW: number;
  outsideM2KPerW: number;
  heatFlow: SurfaceHeatFlowOrientation;
  basis: string;
  status: SurfaceResistances['status'];
}

export interface ComponentResult {
  componentId: string;
  name: string;
  type: ComponentType;
  status: ComponentStatus;
  /** Why it is not calculated, or what to watch out for. */
  reasons: string[];
  dimensions: ElementDimensions;
  /** Temperature on the other side, °C (null if unknown or not applicable). */
  otherSideC: number | null;
  /** Inside minus other side, K (null if not applicable). */
  deltaTK: number | null;
  uValueWPerM2K: number | null;
  /** R_total including surface resistances (layered elements). */
  totalResistanceM2KPerW: number | null;
  /** Σ d/λ of the layers only (also shown for unsupported ground floors). */
  layersResistanceM2KPerW: number | null;
  surface: SurfaceUsed | null;
  /** Signed heat flow, W: positive out of the conditioned zone, negative into it. */
  heatFlowW: number | null;
  direction: HeatFlowDirection | null;
  /** Heat capacity of the layers (simple sum), or null if a layer lacks density or specific heat. */
  heatCapacity: { arealJPerM2K: number; totalJPerK: number } | null;
  /** Full engine result for layered elements (layer table, temperatures). */
  engine: WallCalculationResult | null;
  /** True if any value used is illustrative or unverified. */
  usesUnverifiedData: boolean;
  /** Documented values used (windows, doors), for the source table. */
  documented: Array<{ label: string; value: DocumentedValue }>;
}

export interface EnvelopeResult {
  components: ComponentResult[];
  /** Problems with the model itself (overlaps, missing host walls …). */
  issues: ModelIssue[];
  /** Net area by component type, m² (all components, whether calculated or not). */
  areaByType: Array<{ type: ComponentType; label: string; areaM2: number; count: number }>;
  /** Σ Q̇ of the calculated components, W (positive = net heat leaving the zone). */
  netHeatFlowW: number;
  /** Sum of the outward flows (≥ 0) and of the inward flows (≥ 0, as a magnitude), W. */
  outwardW: number;
  inwardW: number;
  /** Net energy over the duration at constant conditions, kWh (signed like netHeatFlowW). */
  netEnergyKWh: number;
  /** Each calculated component's |Q̇| as a share of Σ|Q̇|. */
  contributions: Array<{ componentId: string; name: string; heatFlowW: number; share: number }>;
  /** Components not in the total, with the reason. */
  notIncluded: Array<{ componentId: string; name: string; status: ComponentStatus; reasons: string[] }>;
  /** Σ heat capacity of all layered elements with complete data (thermal mass indicator), J/K. */
  heatCapacityJPerK: number;
  heatCapacityMissingFor: string[];
  usesUnverifiedData: boolean;
  assumptions: string[];
}

const VERTICAL: ReadonlySet<ComponentType> = new Set(['exterior-wall', 'partition', 'door', 'window', 'glazed-door']);

/**
 * Direction of heat flow used to choose surface resistances. For ΔT = 0 (no flow) the heat-LOSS
 * direction is used, so that a U-value can still be shown; this is stated in the result.
 */
export function heatFlowForSurfaces(type: ComponentType, deltaTK: number): SurfaceHeatFlowOrientation {
  if (VERTICAL.has(type)) return 'horizontal';
  if (type === 'roof') return deltaTK >= 0 ? 'upwards' : 'downwards';
  return deltaTK >= 0 ? 'downwards' : 'upwards'; // floor: the zone is above
}

const BOTH_SIDES_BASIS =
  'The other side is an unconditioned indoor space, so the internal surface resistance R_si (preset for this heat-flow direction) is used on BOTH sides instead of the wind-exposed external value. ' +
  'Commonly quoted practice; not yet checked against ISO 6946.';

/** Surface resistances for an element: preset for its heat-flow direction, with the inside value on both sides next to an unconditioned space. */
export function surfaceResistancesFor(type: ComponentType, deltaTK: number, otherSide: 'outside' | 'unconditioned'): SurfaceResistances {
  const preset = iso6946Preset(heatFlowForSurfaces(type, deltaTK));
  if (otherSide === 'outside') return preset;
  return { ...preset, outsideM2KPerW: preset.insideM2KPerW, basis: BOTH_SIDES_BASIS };
}

/** The layers of a construction as engine layers, or the reasons it cannot be used. */
function engineLayers(construction: Construction, materials: readonly MaterialRecord[]): { layers: Layer[]; missing: string[]; invalid: string[] } {
  const missing: string[] = [];
  const invalid: string[] = [];
  const layers: Layer[] = [];
  if (construction.layers.length === 0) missing.push('No construction layers have been entered.');
  construction.layers.forEach((layer, i) => {
    const material = layer.materialId === null ? undefined : materials.find((m) => m.id === layer.materialId);
    if (layer.materialId === null) missing.push(`Layer ${i + 1}: no material chosen.`);
    else if (!material) invalid.push(`Layer ${i + 1}: material "${layer.materialId}" is not in the material database.`);
    if (layer.thicknessM === null) missing.push(`Layer ${i + 1}: no thickness entered.`);
    else if (!(Number.isFinite(layer.thicknessM) && layer.thicknessM > 0)) invalid.push(`Layer ${i + 1}: the thickness must be greater than zero.`);
    if (material && layer.thicknessM !== null && layer.thicknessM > 0) layers.push(materialToLayer(material, layer.thicknessM));
  });
  return { layers, missing, invalid };
}

/** Heat capacity of complete layers per m² (simple sum), or null if any layer lacks ρ or c_p. */
function layersHeatCapacity(layers: Layer[], areaM2: number): { arealJPerM2K: number; totalJPerK: number } | null {
  if (layers.length === 0 || layers.some((l) => l.densityKgPerM3 === undefined || l.specificHeatJPerKgK === undefined)) return null;
  const areal = layers.reduce((sum, l) => sum + (l.densityKgPerM3 as number) * (l.specificHeatJPerKgK as number) * l.thicknessM, 0);
  return { arealJPerM2K: areal, totalJPerK: areal * areaM2 };
}

/** Problems with a documented value (a number without a source is not accepted). */
function documentedIssues(label: string, v: DocumentedValue | null, range: { min: number; max: number; inclusiveMin?: boolean }): string[] {
  if (!v) return [];
  const issues: string[] = [];
  const okMin = range.inclusiveMin ? v.value >= range.min : v.value > range.min;
  if (!Number.isFinite(v.value) || !okMin || v.value > range.max) issues.push(`${label} ${v.value} ${v.unit} is outside the possible range (${range.inclusiveMin ? '≥' : '>'} ${range.min} and ≤ ${range.max}).`);
  if (v.source.trim() === '') issues.push(`${label}: the source of the value is missing. A value without a source is not used.`);
  return issues;
}

const signed = (direction: HeatFlowDirection, magnitude: number): number => (direction === 'inward' ? -magnitude : magnitude);

export function calculateComponent(project: BuildingProject, c: Component, materials: readonly MaterialRecord[], modelIssues: ModelIssue[] = checkModel(project)): ComponentResult {
  const dimensions = dimensionsOf(project, c);
  const { insideC, outsideC, durationH } = project.conditions;
  const base: ComponentResult = {
    componentId: c.id, name: c.name, type: c.type, status: 'calculated', reasons: [], dimensions,
    otherSideC: null, deltaTK: null, uValueWPerM2K: null, totalResistanceM2KPerW: null, layersResistanceM2KPerW: null,
    surface: null, heatFlowW: null, direction: null, heatCapacity: null, engine: null, usesUnverifiedData: false, documented: [],
  };
  const done = (status: ComponentStatus, reasons: string[], extra: Partial<ComponentResult> = {}): ComponentResult => ({ ...base, ...extra, status, reasons });

  const own = modelIssues.filter((i) => i.componentId === c.id).map((i) => i.message);
  if (own.length > 0) return done('invalid', own);

  // ---- openings: windows, glazed doors, doors with a documented U-value ----------------------
  if (c.type === 'window' || c.type === 'glazed-door' || (c.type === 'door' && c.spec.kind === 'u-value')) {
    const host = project.components.find((h) => h.id === c.hostId);
    const exposure = host && host.type === 'exterior-wall' ? host.exposure : { kind: 'outside' as const };
    const otherC = exposure.kind === 'outside' ? outsideC : exposure.kind === 'unconditioned' ? exposure.temperatureC : null;
    const uValue = isGlazing(c) ? c.uValue : c.spec.kind === 'u-value' ? c.spec.uValue : null;
    const documented: ComponentResult['documented'] = [];
    if (uValue) documented.push({ label: isGlazing(c) ? 'Overall U-value U_w' : 'Overall U-value U_D', value: uValue });
    const invalid = documentedIssues('U-value', uValue, { min: 0, max: 20 });
    if (isGlazing(c)) {
      if (c.gValue) documented.push({ label: 'Solar energy transmittance g', value: c.gValue });
      if (c.shadingFactor) documented.push({ label: 'Shading reduction factor', value: c.shadingFactor });
      invalid.push(...documentedIssues('g-value', c.gValue, { min: 0, max: 1, inclusiveMin: true }), ...documentedIssues('Shading factor', c.shadingFactor, { min: 0, max: 1, inclusiveMin: true }));
    }
    const notes = isGlazing(c) ? ['Solar gains through this glazing are NOT calculated in this stage (they need solar irradiance on its orientation); only conduction is shown.'] : [];
    const usesUnverifiedData = documented.some((d) => d.value.status === 'illustrative' || d.value.status === 'unverified');
    if (invalid.length > 0) return done('invalid', invalid, { documented, usesUnverifiedData });
    if (!uValue) return done('missing-data', [`Enter a documented overall U-value (with its source) for this ${COMPONENT_TYPE_LABEL[c.type].toLowerCase()}.`, ...notes], { documented });
    if (otherC === null) return done('missing-data', ['The temperature of the unconditioned space behind its wall is not entered.', ...notes], { documented, uValueWPerM2K: uValue.value });
    const deltaTK = insideC - otherC;
    const direction = heatFlowDirection(insideC, otherC);
    const magnitude = heatTransferRateW(uValue.value, dimensions.netAreaM2, insideC, otherC);
    return done('calculated', notes, { otherSideC: otherC, deltaTK, uValueWPerM2K: uValue.value, heatFlowW: signed(direction, magnitude), direction, documented, usesUnverifiedData });
  }

  // ---- layered elements: walls, partitions, roof, floor, layered doors ----------------------------
  if (isGlazing(c)) throw new Error('unreachable: glazing is handled above'); // narrows the type for TypeScript
  const construction = c.type === 'door' ? (c.spec.kind === 'layers' ? c.spec.construction : { layers: [] }) : c.construction;
  const exposure = c.type === 'door' ? (() => {
    const host = project.components.find((h) => h.id === c.hostId);
    return host && host.type === 'exterior-wall' ? host.exposure : { kind: 'outside' as const };
  })() : c.exposure;
  const { layers, missing, invalid } = engineLayers(construction, materials);
  const heatCap = missing.length === 0 && invalid.length === 0 ? layersHeatCapacity(layers, dimensions.netAreaM2) : null;
  const layersR = missing.length === 0 && invalid.length === 0 ? layers.reduce((sum, l) => sum + l.thicknessM / l.lambdaWPerMK, 0) : null;
  const usesUnverifiedData = layers.some((l) => l.propertyStatus === 'illustrative' || l.propertyStatus === 'unverified');
  const common = { heatCapacity: heatCap, layersResistanceM2KPerW: layersR, usesUnverifiedData };
  if (invalid.length > 0) return done('invalid', invalid, { usesUnverifiedData });
  if (dimensions.netAreaM2 <= 0) return done('invalid', ['The openings fill the whole wall, so there is no opaque area left.'], common);

  if (exposure.kind === 'conditioned') {
    return done('excluded', ['Both sides are conditioned at the same temperature, so no heat exchange is counted. It is not part of the envelope (its heat capacity is still shown).', ...missing], common);
  }
  if (exposure.kind === 'ground') {
    return done('unsupported', [
      'Ground-contact heat transfer is not supported in this stage. It cannot be calculated like a wall to outdoor air: it depends on the floor size and perimeter, the soil and edge insulation (EN ISO 13370 method, not implemented).',
      ...missing,
    ], common);
  }
  if (missing.length > 0) return done('missing-data', missing, common);
  const otherC = exposure.kind === 'outside' ? outsideC : exposure.temperatureC;
  if (otherC === null) return done('missing-data', ['Enter the temperature of the unconditioned space on the other side.'], common);

  const deltaTK = insideC - otherC;
  const surfaces = surfaceResistancesFor(c.type, deltaTK, exposure.kind);
  let engine: WallCalculationResult;
  try {
    engine = calculateWall({
      layers,
      // The engine needs only the area for heat flow and heat capacity; temperatures and U do not depend on it.
      widthM: dimensions.netAreaM2,
      heightM: 1,
      surfaceResistances: surfaces,
      conditions: { insideTemperatureC: insideC, outsideTemperatureC: otherC, durationHours: durationH },
    });
  } catch (error) {
    if (error instanceof EngineInputError) return done('invalid', error.issues.map((i) => i.message), common);
    throw error;
  }
  // The engine's own wording assumes a vertical wall; for roofs and floors the non-horizontal heat flow is intended.
  if (!VERTICAL.has(c.type)) engine = { ...engine, warnings: engine.warnings.filter((w) => w.code !== 'surface-resistance-orientation') };
  const notes: string[] = [];
  if (deltaTK === 0 && !VERTICAL.has(c.type)) notes.push(`No temperature difference: surface resistances for ${surfaces.heatFlowOrientation} heat flow (the heat-loss direction) are shown.`);
  if ((c.type === 'roof' || c.type === 'exterior-wall') && exposure.kind === 'outside') notes.push('Solar radiation absorbed by the outer surface is not included (no sol-air temperature in this stage).');
  return done('calculated', notes, {
    ...common,
    otherSideC: otherC,
    deltaTK,
    uValueWPerM2K: engine.uValueWPerM2K,
    totalResistanceM2KPerW: engine.resistance.totalM2KPerW,
    surface: { insideM2KPerW: surfaces.insideM2KPerW, outsideM2KPerW: surfaces.outsideM2KPerW, heatFlow: surfaces.heatFlowOrientation, basis: surfaces.basis, status: surfaces.status },
    heatFlowW: signed(engine.heatTransfer.direction, engine.heatTransfer.magnitudeW),
    direction: engine.heatTransfer.direction,
    engine,
  });
}

/** The fixed list of assumptions behind every envelope result. */
export const ENVELOPE_ASSUMPTIONS: readonly string[] = [
  'Steady state: constant temperatures (the one stated condition), one-dimensional heat flow through each element on its own. Not an hourly, dynamic, annual or cooling-demand calculation.',
  'Conduction only. Ventilation and air infiltration are not included.',
  'Simplified parametric box: external dimensions; each exterior wall spans its whole side, so corners are counted in both walls; roof and floor cover the footprint; a partition spans the full depth and storey height. A wall\'s area is its gross area minus its openings.',
  'No thermal bridges: junctions (wall–roof, wall–floor, corners, window reveals, balconies) and their linear transmittances are not included, so real heat transfer is normally higher.',
  'Surface resistances depend on the element and the direction of heat flow (walls horizontal; roof upwards when the inside is warmer, downwards when cooler; floors the reverse). Presets are the commonly quoted ISO 6946 values, NOT yet checked against the standard. Next to an unconditioned space the internal value is used on both sides (also unverified).',
  'Windows and doors with an overall U-value use that value as documented by its source; nothing is added for installation.',
  'Solar gains through glazing and solar radiation absorbed by opaque surfaces are NOT calculated in this stage. g-values and shading factors are stored for the next stage only.',
  'Ground-contact floors are NOT calculated (EN ISO 13370 not implemented); they are excluded from the totals and listed.',
  'Partitions between conditioned rooms at the same temperature exchange no heat and are not counted.',
  'Energy = net heat flow × duration under constant conditions; it is not an annual energy use or cooling demand.',
  'No result is a compliance check against Cyprus regulations or any standard.',
];

export function calculateEnvelope(project: BuildingProject, materials: readonly MaterialRecord[]): EnvelopeResult {
  const issues = checkModel(project);
  const components = issues.some((i) => i.componentId === null)
    ? project.components.map((c) => ({ ...calculateComponentSafe(project, c, materials, issues) }))
    : project.components.map((c) => calculateComponent(project, c, materials, issues));

  const order: ComponentType[] = ['exterior-wall', 'window', 'glazed-door', 'door', 'roof', 'floor', 'partition'];
  const areaByType = order
    .map((type) => {
      const of = components.filter((r) => r.type === type);
      return { type, label: COMPONENT_TYPE_LABEL[type], areaM2: of.reduce((sum, r) => sum + Math.max(0, r.dimensions.netAreaM2), 0), count: of.length };
    })
    .filter((row) => row.count > 0);

  const calculated = components.filter((r) => r.status === 'calculated' && r.heatFlowW !== null);
  const flows = calculated.map((r) => r.heatFlowW as number);
  const netHeatFlowW = flows.reduce((a, b) => a + b, 0);
  const sumAbs = flows.reduce((a, b) => a + Math.abs(b), 0);
  // Thermal-mass indicator: every LAYERED element (whatever its exposure), not windows or U-value doors.
  const layeredIds = new Set(project.components.filter((c) => c.type !== 'window' && c.type !== 'glazed-door' && !(c.type === 'door' && c.spec.kind === 'u-value')).map((c) => c.id));
  const capacityRows = components.filter((r) => layeredIds.has(r.componentId));
  return {
    components,
    issues,
    areaByType,
    netHeatFlowW,
    outwardW: flows.filter((q) => q > 0).reduce((a, b) => a + b, 0),
    inwardW: -flows.filter((q) => q < 0).reduce((a, b) => a + b, 0),
    netEnergyKWh: (netHeatFlowW * project.conditions.durationH) / 1000,
    contributions: calculated.map((r) => ({ componentId: r.componentId, name: r.name, heatFlowW: r.heatFlowW as number, share: sumAbs > 0 ? Math.abs(r.heatFlowW as number) / sumAbs : 0 })),
    notIncluded: components.filter((r) => r.status !== 'calculated').map((r) => ({ componentId: r.componentId, name: r.name, status: r.status, reasons: r.reasons })),
    heatCapacityJPerK: capacityRows.reduce((sum, r) => sum + (r.heatCapacity?.totalJPerK ?? 0), 0),
    heatCapacityMissingFor: capacityRows.filter((r) => r.heatCapacity === null).map((r) => r.name),
    usesUnverifiedData: components.some((r) => r.usesUnverifiedData) || calculated.some((r) => r.surface?.status === 'unverified'),
    assumptions: [...ENVELOPE_ASSUMPTIONS],
  };
}

/** When the house geometry itself is invalid, nothing can be calculated. */
function calculateComponentSafe(project: BuildingProject, c: Component, _materials: readonly MaterialRecord[], issues: ModelIssue[]): ComponentResult {
  const reasons = issues.filter((i) => i.componentId === null).map((i) => i.message);
  return {
    componentId: c.id, name: c.name, type: c.type, status: 'invalid', reasons,
    dimensions: { widthM: 0, heightM: 0, grossAreaM2: 0, netAreaM2: 0, openingsAreaM2: 0 },
    otherSideC: null, deltaTK: null, uValueWPerM2K: null, totalResistanceM2KPerW: null, layersResistanceM2KPerW: null,
    surface: null, heatFlowW: null, direction: null, heatCapacity: null, engine: null, usesUnverifiedData: false, documented: [],
  };
}
