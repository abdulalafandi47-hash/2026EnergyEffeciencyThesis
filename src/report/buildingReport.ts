/**
 * The BUILDING report: the building-envelope model and the results the envelope
 * module has already calculated, as a format-neutral document that the same
 * renderers as the wall report write as HTML or Markdown.
 *
 * No number is calculated here. Every value is read from the project (inputs) or
 * from the envelope result (outputs) and only formatted. Elements that were not
 * calculated are reported as such, with their reasons, and never estimated.
 */
import type { BuildingProject, ComponentResult, ComponentType, EnvelopeResult } from '../envelope';
import { BUILDING_EQUATIONS, BUILDING_LIMITATIONS } from './content';
import { csvCell, fnv1a, num, stableJson } from './format';
import type { Block, ReportModel, ReportSection } from './types';
import { REPORT_SCHEMA, REPORT_SCHEMA_VERSION, SOFTWARE_NAME, SOFTWARE_VERSION } from './version';

export const DEFAULT_BUILDING_REPORT_TITLE = 'Building envelope calculation report';

export interface BuildingReportInput {
  title: string;
  notes: string;
  generatedAt: Date;
  project: BuildingProject;
  /** The envelope result for exactly this project (calculated by the envelope module). */
  result: EnvelopeResult;
  /** Display names of the component types (passed in, so this module stays free of envelope code). */
  typeLabels: Record<ComponentType, string>;
}

const STATUS_WORDS: Record<ComponentResult['status'], string> = {
  calculated: 'calculated',
  excluded: 'not counted',
  unsupported: 'unsupported',
  'missing-data': 'missing data',
  invalid: 'invalid',
};
const SIDE_WORDS = { north: 'north', east: 'east', south: 'south', west: 'west' } as const;

const flow = (w: number | null): string => (w === null ? '—' : Math.abs(w) < 1e-12 ? '0' : `${num(Math.abs(w), 5)} ${w > 0 ? 'out' : 'in'}`);
const orDash = (v: number | null, significant = 5): string => (v === null ? '—' : num(v, significant));

/** Short checksum of the project (identifies identical inputs; not a security feature). */
export function projectFingerprint(project: BuildingProject): string {
  return fnv1a(stableJson(project));
}

function section(id: string, heading: string, ...blocks: Block[]): ReportSection {
  return { id, heading, blocks };
}

export function buildBuildingReport(input: BuildingReportInput): ReportModel {
  const { project, result, typeLabels } = input;
  const title = input.title.trim() === '' ? DEFAULT_BUILDING_REPORT_TITLE : input.title.trim();
  const c = project.conditions;
  const g = project.geometry;
  const byId = new Map(result.components.map((r) => [r.componentId, r]));
  const nameOf = (id: string): string => project.components.find((x) => x.id === id)?.name ?? id;

  // ---- banners (always at the top) -------------------------------------------------------------------------
  const banners: string[] = [];
  if (project.isExample || project.name.startsWith('Example house')) {
    banners.push('This is the ILLUSTRATIVE example house of the program: dimensions, layers and conditions chosen for demonstration. It is not a real or verified building.');
  }
  if (result.notIncluded.length > 0) {
    banners.push(`${result.notIncluded.length} of ${result.components.length} elements are NOT in the totals (missing data, unsupported such as ground floors, not counted, or invalid). The totals are therefore incomplete; section 5 lists each element and why.`);
  }
  if (result.usesUnverifiedData) {
    banners.push('Some values used are illustrative or unverified (built-in material values are demonstration numbers, not approved Cypriot design values). The results must not be used as design values or as evidence of compliance.');
  }
  const userDefined = result.components.some((r) => r.documented.length > 0) || result.components.some((r) => r.engine?.layers.some((l) => l.propertyStatus === 'user-defined'));
  if (userDefined) {
    banners.push('Some values were entered by the user (user-defined: documented window or door values, or custom materials). This program has not checked them; the source given for each is listed in section 4.');
  }
  if (result.components.some((r) => r.surface && r.surface.status !== 'verified')) {
    banners.push('Surface resistances are presets that have not been checked against ISO 6946.');
  }
  banners.push('Steady-state calculation of each element under one constant condition. It is not a dynamic or whole-building simulation, not a cooling-load or energy-demand prediction, and not a compliance check.');

  // ---- 1. project and condition ----------------------------------------------------------------------------
  const projectSection = section(
    'project',
    '1. Project and condition',
    {
      kind: 'table',
      caption: 'Project',
      columns: ['Item', 'Value'],
      rows: [
        ['Project name', project.name],
        ['Model', 'Simplified single-storey, single-zone box with a flat roof (external dimensions)'],
        ['Length east–west', `${num(g.lengthM, 6)} m`],
        ['Depth north–south', `${num(g.depthM, 6)} m`],
        ['Storey height', `${num(g.heightM, 6)} m`],
        ['Number of components', String(project.components.length)],
      ],
    },
    {
      kind: 'table',
      caption: 'Condition (steady state, one constant condition for every element)',
      columns: ['Item', 'Value'],
      rows: [
        ['Name of the condition', c.label],
        ['Inside air temperature', `${num(c.insideC, 6)} °C`],
        ['Outdoor air temperature', `${num(c.outsideC, 6)} °C`],
        ['Duration of the energy figure', `${num(c.durationH, 6)} h`],
      ],
    },
    { kind: 'paragraph', text: 'The condition is chosen by the user. It is not Cyprus climate data and not a design condition from a standard.', emphasis: 'note' },
  );

  // ---- 2. components (inputs) ------------------------------------------------------------------------------
  const describeOther = (comp: BuildingProject['components'][number]): string => {
    if (!('exposure' in comp)) {
      const host = project.components.find((w) => w.id === comp.hostId);
      return host ? `in ${host.name}` : 'host wall missing';
    }
    const e = comp.exposure;
    return e.kind === 'outside' ? 'outdoor air' : e.kind === 'ground' ? 'ground' : e.kind === 'conditioned' ? 'conditioned space (same temperature)' : `unconditioned space at ${e.temperatureC === null ? '(not entered)' : `${num(e.temperatureC, 6)} °C`}`;
  };
  const construction = (comp: BuildingProject['components'][number]): string => {
    const layers = 'construction' in comp ? comp.construction.layers : comp.type === 'door' && comp.spec.kind === 'layers' ? comp.spec.construction.layers : null;
    if (layers) return layers.length === 0 ? 'no layers entered' : layers.map((l) => `${l.thicknessM === null ? '?' : num(l.thicknessM * 1000, 5)} mm ${l.materialId ?? '(no material)'}`).join(' | ');
    if (comp.type === 'door') return comp.spec.kind === 'u-value' ? (comp.spec.uValue ? `documented U ${num(comp.spec.uValue.value, 5)} ${comp.spec.uValue.unit}` : 'no documented U-value') : '';
    if (comp.type === 'window' || comp.type === 'glazed-door') return comp.uValue ? `documented U_w ${num(comp.uValue.value, 5)} ${comp.uValue.unit}` : 'no documented U-value';
    return '';
  };
  const componentsSection = section(
    'components',
    '2. Components (as entered)',
    {
      kind: 'table',
      caption: 'Every component of the model, in the order of the project',
      columns: ['Component', 'Type', 'Position', 'Other side / host', 'Size (m)', 'Net area (m²)', 'Construction or documented value'],
      numeric: [5],
      rows: project.components.map((comp) => {
        const r = byId.get(comp.id);
        const d = r?.dimensions;
        const position = comp.type === 'exterior-wall' ? `${SIDE_WORDS[comp.side]} side` : comp.type === 'partition' ? `${num(comp.positionM, 5)} m from the west face` : 'hostId' in comp ? `offset ${num(comp.offsetM, 5)} m${'sillM' in comp ? `, sill ${num(comp.sillM, 5)} m` : ''}` : 'whole footprint';
        return [comp.name, typeLabels[comp.type], position, describeOther(comp), d ? `${num(d.widthM, 5)} × ${num(d.heightM, 5)}` : '—', d ? num(d.netAreaM2, 5) : '—', construction(comp)];
      }),
    },
    { kind: 'paragraph', text: 'Layers are listed from the inside (conditioned side) outwards, as thickness and material id. Section 3 gives each layered element\'s layer table with names and data status.' },
  );

  // ---- 3. results per element ---------------------------------------------------------------------------
  const share = (id: string): string => {
    const s = result.contributions.find((x) => x.componentId === id)?.share;
    return s === undefined ? '—' : `${num(s * 100, 4)} %`;
  };
  const resultBlocks: Block[] = [
    {
      kind: 'table',
      caption: 'Each element under the stated condition: Q̇ = U · A · ΔT, ΔT = T_inside − T_other side (positive Q̇ = heat leaving the zone)',
      columns: ['Element', 'Type', 'Net area (m²)', 'U (W/(m²·K))', 'R_total (m²·K/W)', 'R_si / R_se (m²·K/W)', 'Other side (°C)', 'ΔT (K)', 'Q̇ (W)', 'Share of Σ|Q̇|', 'Status'],
      numeric: [2, 3, 4, 6, 7, 8, 9],
      rows: result.components.map((r) => [
        r.name,
        typeLabels[r.type],
        num(r.dimensions.netAreaM2, 5),
        orDash(r.uValueWPerM2K),
        orDash(r.totalResistanceM2KPerW),
        r.surface ? `${num(r.surface.insideM2KPerW, 3)} / ${num(r.surface.outsideM2KPerW, 3)} (${r.surface.heatFlow}, ${r.surface.status})` : '—',
        orDash(r.otherSideC, 6),
        orDash(r.deltaTK, 6),
        flow(r.heatFlowW),
        share(r.componentId),
        STATUS_WORDS[r.status],
      ]),
    },
  ];
  for (const r of result.components) {
    if (!r.engine) continue;
    const t = r.engine.temperatureProfile;
    resultBlocks.push({ kind: 'subheading', text: `${r.name}: layers (inside → outside)` });
    resultBlocks.push({
      kind: 'table',
      caption: `${r.name}: R_si ${num(r.engine.resistance.insideSurfaceM2KPerW, 3)}, Σ d/λ ${num(r.engine.resistance.layersM2KPerW, 5)}, R_se ${num(r.engine.resistance.outsideSurfaceM2KPerW, 3)}, R_total ${num(r.engine.resistance.totalM2KPerW, 5)} m²·K/W`,
      columns: ['Layer', 'd (mm)', 'λ (W/(m·K))', 'R (m²·K/W)', 'T inside face (°C)', 'T outside face (°C)', 'Data status'],
      numeric: [1, 2, 3, 4, 5],
      rows: r.engine.layers.map((l, i) => [l.name, num(l.thicknessM * 1000, 5), num(l.lambdaWPerMK, 5), num(l.resistanceM2KPerW, 5), num(t[1 + i]?.temperatureC ?? Number.NaN, 5), num(t[2 + i]?.temperatureC ?? Number.NaN, 5), l.propertyStatus ?? '—']),
    });
  }
  const resultsSection = section('results', '3. Results per element', ...resultBlocks);

  // ---- 4. documented values (sources) --------------------------------------------------------------------
  const documentedRows = result.components.flatMap((r) => r.documented.map((d) => [r.name, d.label, `${num(d.value.value, 5)} ${d.value.unit}`, d.value.source || '(missing)', d.value.valueType, d.value.conditions ?? '', d.value.status]));
  const sourcesSection = section(
    'sources',
    '4. Documented window and door values',
    documentedRows.length === 0
      ? { kind: 'paragraph', text: 'No window or door value has been entered. Windows and doors without a documented value are not calculated (section 5).' }
      : { kind: 'table', caption: 'Values entered by the user with their sources (not checked by this program)', columns: ['Element', 'Property', 'Value', 'Source', 'Value type', 'Conditions', 'Status'], numeric: [], rows: documentedRows },
    { kind: 'paragraph', text: 'g-values and shading factors are recorded for the next stage only: solar gains are not calculated in this report.', emphasis: 'note' },
  );

  // ---- 5. totals, and what is not included ------------------------------------------------------------------
  const none = result.contributions.length === 0;
  const allCapacityMissing = result.components.every((r) => r.heatCapacity === null);
  const totalsSection = section(
    'totals',
    '5. Envelope totals and what they leave out',
    {
      kind: 'table',
      caption: 'Totals over the calculated elements only, each with its own ΔT',
      columns: ['Quantity', 'Value'],
      rows: [
        ['Net conductive heat flow Σ Q̇_i', none ? 'not available (no element calculated)' : `${flow(result.netHeatFlowW)} W`],
        ['Heat flowing out (losses)', none ? 'not available' : `${num(result.outwardW, 5)} W`],
        ['Heat flowing in (gains)', none ? 'not available' : `${num(result.inwardW, 5)} W`],
        [`Net energy in ${num(c.durationH, 6)} h (constant conditions)`, none ? 'not available' : `${num(Math.abs(result.netEnergyKWh), 5)} kWh ${result.netEnergyKWh > 0 ? 'out' : result.netEnergyKWh < 0 ? 'in' : ''}`],
        ['Heat capacity of layered elements (simple sum)', allCapacityMissing ? 'not available' : `${num(result.heatCapacityJPerK / 1e6, 5)} MJ/K${result.heatCapacityMissingFor.length > 0 ? ` (not available for: ${result.heatCapacityMissingFor.join(', ')})` : ''}`],
      ],
    },
    { kind: 'table', caption: 'Net area by element type (walls without their openings)', columns: ['Type', 'Count', 'Area (m²)'], numeric: [1, 2], rows: result.areaByType.map((a) => [a.label, String(a.count), num(a.areaM2, 5)]) },
    { kind: 'subheading', text: 'Not included in the totals' },
    result.notIncluded.length === 0
      ? { kind: 'paragraph', text: 'Every element is calculated and included.' }
      : { kind: 'list', items: result.notIncluded.map((n) => `${n.name} (${STATUS_WORDS[n.status]}): ${n.reasons.join(' ')}`) },
    ...(result.issues.length > 0 ? [{ kind: 'subheading', text: 'Problems in the model' } as Block, { kind: 'list', items: result.issues.map((i) => (i.componentId ? `${nameOf(i.componentId)}: ${i.message}` : i.message)) } as Block] : []),
  );

  // ---- 6–8. method, assumptions, limitations, reproducibility ---------------------------------------------
  const methodSection = section(
    'method',
    '6. Equations',
    { kind: 'table', caption: 'Equations used (steady state)', columns: ['#', 'Equation', 'Meaning'], numeric: [], rows: BUILDING_EQUATIONS.map((e) => [String(e.n), e.expression, e.meaning]) },
  );
  const assumptionsSection = section('assumptions', '7. Assumptions and limitations', { kind: 'subheading', text: 'Assumptions of the envelope calculation' }, { kind: 'list', items: [...result.assumptions] }, { kind: 'subheading', text: 'Limitations' }, { kind: 'list', items: [...BUILDING_LIMITATIONS] });
  const fingerprint = projectFingerprint(project);
  const reproSection = section(
    'reproducibility',
    '8. Reproducibility',
    {
      kind: 'table',
      caption: 'Record',
      columns: ['Item', 'Value'],
      rows: [
        ['Software', `${SOFTWARE_NAME} ${SOFTWARE_VERSION}`],
        ['Report generated', input.generatedAt.toISOString()],
        ['Project fingerprint (FNV-1a, 32-bit)', fingerprint],
      ],
    },
    { kind: 'paragraph', text: 'The fingerprint is a short checksum of the project below; two reports with the same fingerprint were made from identical projects. It is not a security feature. Keep the project file (Download project file) with this report to reproduce it.' },
    { kind: 'subheading', text: 'Project (as calculated)' },
    { kind: 'code', text: stableJson(project, 2) },
  );

  return {
    schema: REPORT_SCHEMA,
    schemaVersion: REPORT_SCHEMA_VERSION,
    title,
    generatedAt: input.generatedAt.toISOString(),
    software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION },
    fingerprint,
    notes: input.notes,
    banners,
    sections: [projectSection, componentsSection, resultsSection, sourcesSection, totalsSection, methodSection, assumptionsSection, reproSection],
  };
}

/** JSON export: the formatted document and the raw numbers (project and full envelope result). */
export function renderBuildingJson(model: ReportModel, input: BuildingReportInput): string {
  return (
    stableJson(
      {
        schema: model.schema,
        schemaVersion: model.schemaVersion,
        kind: 'building-envelope',
        title: model.title,
        generatedAt: model.generatedAt,
        software: model.software,
        fingerprint: model.fingerprint,
        notes: model.notes,
        banners: model.banners,
        data: { project: input.project, result: input.result },
        report: { sections: model.sections },
      },
      2,
    ) + '\n'
  );
}

const ELEMENT_CSV_COLUMNS = [
  'id', 'name', 'type', 'status', 'net_area_m2', 'U_W_per_m2K', 'R_total_m2K_per_W', 'R_si_m2K_per_W', 'R_se_m2K_per_W',
  'other_side_C', 'delta_T_K', 'heat_flow_W_positive_out', 'share_of_sum_abs', 'heat_capacity_J_per_K', 'uses_unverified_data', 'reasons',
] as const;

/** CSV of the element table (comma-separated, UTF-8). Numbers at full precision; empty = not available. */
export function renderElementsCsv(input: BuildingReportInput): string {
  const full = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '' : String(v));
  const rows = input.result.components.map((r) => [
    csvCell(r.componentId), csvCell(r.name), csvCell(r.type), csvCell(r.status), full(r.dimensions.netAreaM2), full(r.uValueWPerM2K), full(r.totalResistanceM2KPerW),
    full(r.surface?.insideM2KPerW), full(r.surface?.outsideM2KPerW), full(r.otherSideC), full(r.deltaTK), full(r.heatFlowW),
    full(input.result.contributions.find((x) => x.componentId === r.componentId)?.share), full(r.heatCapacity?.totalJPerK), r.usesUnverifiedData ? 'yes' : 'no', csvCell(r.reasons.join(' ')),
  ].join(','));
  return [ELEMENT_CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

/** File name without extension, e.g. "building-report-20261109-103000-1a2b3c4d" (time is UTC). */
export function buildingReportFileBase(model: Pick<ReportModel, 'generatedAt' | 'fingerprint'>): string {
  const stamp = model.generatedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `building-report-${stamp}-${model.fingerprint}`;
}
