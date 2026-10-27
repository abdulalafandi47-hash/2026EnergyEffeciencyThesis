/**
 * Builds the calculation report from results the program has already produced.
 * Every number is read from the engine result (through the analysis module) and
 * only formatted here; nothing is recalculated.
 */
import type { Comparison } from '../analysis';
import type { Block, ReportInput, ReportModel, ReportSection } from './types';
import { EQUATIONS, LIMITATIONS, REFERENCES } from './content';
import { fnv1a, num, percent, stableJson } from './format';
import { REPORT_SCHEMA, REPORT_SCHEMA_VERSION, SOFTWARE_NAME, SOFTWARE_VERSION } from './version';

const TEMPERATURE_LABEL = { C: '°C', K: 'K', F: '°F' } as const;
const DIRECTION_TEXT = { outward: 'Outward (inside → outside, heat loss)', inward: 'Inward (outside → inside, heat gain)', none: 'None (no temperature difference)' } as const;

/** Checksum identifying the engine input. Equal inputs give equal text. */
export function fingerprintOf(wall: unknown): string {
  return fnv1a(stableJson(wall));
}

/** The engine input as text, key order fixed so the same wall always prints the same. */
export function engineInputJson(wall: unknown): string {
  return stableJson(wall, 2);
}

export const DEFAULT_REPORT_TITLE = 'Wall thermal calculation report';

function section(id: string, heading: string, ...blocks: Block[]): ReportSection {
  return { id, heading, blocks };
}

export function buildReport(input: ReportInput): ReportModel {
  const { draft, wall, views, analysis } = input;
  const r = analysis.result;
  const sr = wall.surfaceResistances;
  const title = input.title.trim() === '' ? DEFAULT_REPORT_TITLE : input.title.trim();
  const tUnit = TEMPERATURE_LABEL[draft.temperatureUnit];
  const profile = r.temperatureProfile;

  // ---- banners ------------------------------------------------------------------------------------
  const banners: string[] = [];
  if (analysis.usesUnverifiedData) {
    banners.push('This report uses material values that are illustrative or unverified. They are demonstration numbers, not approved Cypriot design values, and the results must not be used as evidence of compliance or as design values.');
  }
  if (sr.status !== 'verified') {
    banners.push(`The surface resistances are ${sr.status}: ${sr.status === 'user-defined' ? 'entered by the user' : 'not yet checked against the standard'}.`);
  }
  banners.push('Steady-state calculation for a single wall under constant conditions. It is not a dynamic or whole-building simulation, not an annual energy-demand prediction, and not a compliance check.');

  // ---- 1. inputs ----------------------------------------------------------------------------------------
  const inputsSection = section(
    'inputs',
    '1. Inputs',
    {
      kind: 'table',
      caption: 'Wall and boundary conditions',
      columns: ['Quantity', 'As entered', 'Used in the calculation'],
      numeric: [],
      rows: [
        ['Width', `${draft.widthText} ${draft.dimensionUnit}`, `${num(wall.widthM, 8)} m`],
        ['Height', `${draft.heightText} ${draft.dimensionUnit}`, `${num(wall.heightM, 8)} m`],
        ['Wall area (derived)', '—', `${num(r.geometry.areaM2, 8)} m²`],
        ['Inside air temperature', `${draft.insideTemperatureText} ${tUnit}`, `${num(wall.conditions.insideTemperatureC, 8)} °C`],
        ['Outside air temperature', `${draft.outsideTemperatureText} ${tUnit}`, `${num(wall.conditions.outsideTemperatureC, 8)} °C`],
        ['Duration of the energy estimate', `${draft.durationText} h`, `${num(wall.conditions.durationHours, 8)} h`],
        [
          'Internal surface resistance R_si',
          draft.surfaceMode === 'custom' ? `${draft.surfaceInsideText} m²·K/W (custom)` : 'preset for horizontal heat flow',
          `${num(sr.insideM2KPerW, 6)} m²·K/W`,
        ],
        [
          'External surface resistance R_se',
          draft.surfaceMode === 'custom' ? `${draft.surfaceOutsideText} m²·K/W (custom)` : 'preset for horizontal heat flow',
          `${num(sr.outsideM2KPerW, 6)} m²·K/W`,
        ],
      ],
    },
    { kind: 'paragraph', text: `Surface resistances: ${sr.basis} Status: ${sr.status}. Heat-flow orientation: ${sr.heatFlowOrientation}.` },
    ...(input.editorWarnings && input.editorWarnings.length > 0 ? [{ kind: 'list', items: input.editorWarnings.map((w) => `Editor warning: ${w}`) } as Block] : []),
  );

  // ---- 2. layers and materials ------------------------------------------------------------------------------
  const layerRows = wall.layers.map((layer, i) => {
    const view = views[i];
    const material = view?.material;
    const entered = draft.layers[i];
    return [
      String(i + 1),
      layer.name,
      material?.category ?? '—',
      entered ? `${entered.thicknessText} ${entered.thicknessUnit}` : '—',
      num(layer.thicknessM * 1000, 6),
      num(layer.lambdaWPerMK, 6),
      num(layer.densityKgPerM3, 6),
      num(layer.specificHeatJPerKgK, 6),
      layer.propertyStatus ?? '—',
      material?.valueType ?? '—',
    ];
  });
  const seen = new Set<string>();
  const sourceRows: string[][] = [];
  for (const view of views) {
    const m = view.material;
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    sourceRows.push([m.name, m.status, m.valueType, m.sourceType, m.sourceCitation, m.conditions ?? '—', m.notices.join(' ')]);
  }
  const materialsSection = section(
    'layers-materials',
    '2. Layers and material data',
    { kind: 'paragraph', text: 'Layers are listed from the interior face to the exterior face.' },
    {
      kind: 'table',
      caption: 'Layers',
      columns: ['#', 'Layer', 'Category', 'Thickness as entered', 'd (mm)', 'λ (W/(m·K))', 'ρ (kg/m³)', 'c_p (J/(kg·K))', 'Data status', 'Value type'],
      numeric: [0, 4, 5, 6, 7],
      rows: layerRows,
    },
    { kind: 'paragraph', text: 'A dash in ρ or c_p means the material does not provide that property; heat capacity is then reported as unavailable, never guessed.' },
    {
      kind: 'table',
      caption: 'Where the material values come from',
      columns: ['Material', 'Data status', 'Value type', 'Source type', 'Citation', 'Conditions', 'Notes'],
      rows: sourceRows,
    },
  );

  // ---- 3. results ---------------------------------------------------------------------------------------------
  const hc = r.heatCapacity;
  const resultsSection = section(
    'results',
    '3. Results',
    {
      kind: 'table',
      caption: 'Calculated results (steady state)',
      columns: ['Quantity', 'Value', 'Unit', 'Equation'],
      numeric: [1],
      rows: [
        ['Thermal transmittance U', num(r.uValueWPerM2K, 6), 'W/(m²·K)', '3'],
        ['Total thermal resistance R_total', num(r.resistance.totalM2KPerW, 6), 'm²·K/W', '2'],
        ['  of which inside surface R_si', num(r.resistance.insideSurfaceM2KPerW, 6), 'm²·K/W', ''],
        ['  of which layers Σ d/λ', num(r.resistance.layersM2KPerW, 6), 'm²·K/W', '1'],
        ['  of which outside surface R_se', num(r.resistance.outsideSurfaceM2KPerW, 6), 'm²·K/W', ''],
        ['Temperature difference T_i − T_e', num(r.heatTransfer.temperatureDifferenceK, 6), 'K', ''],
        ['Heat-transfer rate Q̇ (magnitude)', num(r.heatTransfer.magnitudeW, 6), 'W', '5'],
        ['Heat flux q (magnitude)', num(r.heatTransfer.fluxMagnitudeWPerM2, 6), 'W/m²', '10'],
        [`Energy in ${num(r.energy.durationHours, 6)} h (magnitude)`, num(r.energy.magnitudeKWh, 6), 'kWh', '7'],
        ...(hc.available
          ? [
              ['Heat capacity C (total)', num(hc.totalJPerK, 6), 'J/K', '8'],
              ['Areal heat capacity C_A', num(hc.arealJPerM2K, 6), 'J/(m²·K)', '9'],
            ]
          : [['Heat capacity', 'unavailable', '', `density and/or specific heat missing for: ${hc.missingFor.join(', ')}`]]),
      ],
    },
    { kind: 'paragraph', text: `Direction of heat flow: ${DIRECTION_TEXT[r.heatTransfer.direction]}. ${r.energy.note}` },
  );

  // ---- 4. layer by layer ---------------------------------------------------------------------------------------
  const temperaturesRows: string[][] = [];
  const film = (name: string, resistance: number, share: number | undefined, from: number | undefined, to: number | undefined): string[] => [
    '—', name, '', '', num(resistance, 5), share === undefined ? '—' : `${num(share * 100, 4)} %`, num(from, 6), num(to, 6), from === undefined || to === undefined ? '—' : num(from - to, 4),
  ];
  temperaturesRows.push(film('Inside surface film (air → surface)', r.resistance.insideSurfaceM2KPerW, r.resistanceBreakdown[0]?.fractionOfTotal, profile[0]?.temperatureC, profile[1]?.temperatureC));
  r.layers.forEach((layer, i) => {
    const t = analysis.layerTemperatures[i];
    temperaturesRows.push([String(i + 1), layer.name, num(layer.thicknessM * 1000, 6), num(layer.lambdaWPerMK, 5), num(layer.resistanceM2KPerW, 5), `${num(layer.fractionOfTotal * 100, 4)} %`, num(t?.startC, 6), num(t?.endC, 6), num(t?.dropK, 4)]);
  });
  temperaturesRows.push(film('Outside surface film (surface → air)', r.resistance.outsideSurfaceM2KPerW, r.resistanceBreakdown[r.resistanceBreakdown.length - 1]?.fractionOfTotal, profile[profile.length - 2]?.temperatureC, profile[profile.length - 1]?.temperatureC));
  const layerSection = section(
    'layer-temperatures',
    '4. Layer by layer',
    {
      kind: 'table',
      caption: 'Resistance and temperature of each layer, interior → exterior',
      columns: ['#', 'Layer', 'd (mm)', 'λ (W/(m·K))', 'R (m²·K/W)', 'Share of R_total', `T interior side (°C)`, 'T exterior side (°C)', 'ΔT across (K)'],
      numeric: [2, 3, 4, 5, 6, 7, 8],
      rows: temperaturesRows,
    },
    { kind: 'paragraph', text: 'The same heat flux crosses every row, so each temperature drop equals the flux times that row\'s resistance (equations 10 to 13). For the two surface films, the "interior side" column is the air temperature (inside film) or the surface temperature (outside film).' },
  );

  // ---- 5. temperature profile --------------------------------------------------------------------------------------
  const profileSection = section(
    'temperature-profile',
    '5. Temperature profile',
    { kind: 'figure', id: 'temperature-profile', caption: 'Calculated steady-state temperature through the wall. Straight lines inside each layer; dashed vertical lines are the drops across the surface films.' },
    {
      kind: 'table',
      caption: 'Temperature at each point',
      columns: ['Point', 'Distance from interior face (mm)', 'Temperature (°C)'],
      numeric: [1, 2],
      rows: profile.map((p) => [p.label, num(p.positionM * 1000, 6), num(p.temperatureC, 6)]),
    },
  );

  // ---- 6. comparisons (optional) ----------------------------------------------------------------------------------------
  const sections: ReportSection[] = [inputsSection, materialsSection, resultsSection, layerSection, profileSection];
  if (input.comparisons.length > 0) sections.push(comparisonSection(input.comparisons));

  // ---- equations, assumptions, limitations, references ---------------------------------------------------------------------
  const n = sections.length;
  sections.push(
    section(
      'equations',
      `${n + 1}. Equations used`,
      { kind: 'table', caption: 'Equations (all quantities in SI units inside the engine)', columns: ['#', 'Equation', 'Meaning'], rows: EQUATIONS.map((e) => [String(e.n), e.expression, e.meaning]), numeric: [0] },
      { kind: 'paragraph', text: 'Symbols: d thickness (m), λ conductivity (W/(m·K)), R resistance (m²·K/W), U transmittance (W/(m²·K)), A area (m²), T temperature (°C), Q̇ heat-transfer rate (W), q heat flux (W/m²), t duration (h), E energy (kWh), ρ density (kg/m³), c_p specific heat (J/(kg·K)), C heat capacity (J/K). Subscripts: i inside air, e outside air, si/se inside/outside surface.' },
    ),
    section(
      'assumptions',
      `${n + 2}. Assumptions and warnings`,
      { kind: 'subheading', text: 'Assumptions behind these numbers (from the calculation engine)' },
      { kind: 'list', items: r.assumptions },
      ...(r.warnings.length > 0 ? ([{ kind: 'subheading', text: 'Warnings raised by the calculation' }, { kind: 'list', items: r.warnings.map((w) => w.message) }] as Block[]) : []),
    ),
    section('limitations', `${n + 3}. Limitations and what is not claimed`, { kind: 'list', items: [...LIMITATIONS] }),
    section(
      'references',
      `${n + 4}. References and data status`,
      { kind: 'paragraph', text: 'Order of precedence set for this project (when sources disagree, the higher one governs):' },
      { kind: 'list', items: REFERENCES.hierarchy.map((t, i) => `${i + 1}. ${t}`) },
      { kind: 'table', caption: 'Standards considered', columns: ['Standard', 'Edition', 'Role in this project', 'Status'], rows: REFERENCES.standards.map((s) => [s.name, s.edition, s.role, s.status]) },
      { kind: 'table', caption: 'Secondary sources that agree with the preset surface resistances (none is the standard)', columns: ['Source', 'Address', 'Status'], rows: REFERENCES.surfaceResistanceSources.map((s) => [s.title, s.url, s.status]) },
      { kind: 'table', caption: 'Leads for material data (found by search, not read, support no value)', columns: ['Source', 'Address', 'Status'], rows: REFERENCES.materialDataLeads.map((s) => [s.title, s.url, s.status]) },
      { kind: 'paragraph', text: 'The full register, with the checklist of what still has to be verified, is in docs/sources.md of the project. Every built-in material value is an illustrative demonstration number with no source.', emphasis: 'note' },
    ),
    section(
      'verification',
      `${n + 5}. Verification of the calculation`,
      {
        kind: 'paragraph',
        text: 'The calculation engine is covered by automated tests, including independent reference calculations done in exact fractions (validation/REFERENCE_CASES.md in the project lists them). Passing these tests shows that the code reproduces the equations above for those cases. It is not a validation against measurements, and it is not evidence that this wall meets any requirement. The number of tests and the date of the last run are not recorded in this report; run "npm test" in the project to repeat them.',
      },
    ),
    section(
      'reproducibility',
      `${n + 6}. Reproducibility`,
      {
        kind: 'table',
        caption: 'Record',
        columns: ['Item', 'Value'],
        rows: [
          ['Software', `${SOFTWARE_NAME} ${SOFTWARE_VERSION}`],
          ['Report generated', input.generatedAt.toISOString()],
          ['Input fingerprint (FNV-1a, 32-bit)', fingerprintOf(wall)],
        ],
      },
      { kind: 'paragraph', text: 'The fingerprint is a short checksum of the engine input below. Two reports with the same fingerprint were made from identical inputs. It is not a security feature. Calculating this input with the same software version gives the same results.' },
      { kind: 'subheading', text: 'Engine input (SI units)' },
      { kind: 'code', text: engineInputJson(wall) },
    ),
  );

  return {
    schema: REPORT_SCHEMA,
    schemaVersion: REPORT_SCHEMA_VERSION,
    title,
    generatedAt: input.generatedAt.toISOString(),
    software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION },
    fingerprint: fingerprintOf(wall),
    notes: input.notes,
    banners,
    sections,
  };
}

function comparisonSection(comparisons: Comparison[]): ReportSection {
  const blocks: Block[] = [
    { kind: 'paragraph', text: 'Each comparison changes ONE thing in the wall above and keeps everything else identical. Percentages are relative to the current wall.' },
  ];
  for (const c of comparisons) {
    blocks.push({ kind: 'subheading', text: c.title });
    blocks.push({
      kind: 'table',
      caption: `Changing ${c.parameter} only`,
      columns: ['Variant', 'What changed', 'U (W/(m²·K))', 'ΔU', 'R_total (m²·K/W)', 'Q̇ (W)', 'ΔQ̇', 'Heat capacity (kJ/(m²·K))', 'Data'],
      numeric: [2, 3, 4, 5, 6, 7],
      rows: c.variants.map((v, i) =>
        v.ok
          ? [
              i === 0 ? 'Current' : v.label,
              i === 0 ? '—' : v.changed,
              num(v.uValueWPerM2K, 5),
              i === 0 ? '—' : percent(v.deltaUPercent),
              num(v.totalResistanceM2KPerW, 5),
              `${num(v.heatTransferW, 5)}${v.direction === 'none' ? '' : v.direction === 'outward' ? ' out' : ' in'}`,
              i === 0 ? '—' : percent(v.deltaHeatTransferPercent),
              v.arealHeatCapacityJPerM2K === null ? 'n/a' : num(v.arealHeatCapacityJPerM2K / 1000, 5),
              v.usesUnverifiedData ? 'not verified' : '',
            ]
          : [v.label, v.changed, `cannot be calculated: ${v.error ?? 'invalid input'}`, '', '', '', '', '', ''],
      ),
    });
    blocks.push({ kind: 'paragraph', text: `Held constant: ${c.heldConstant.join('; ')}.` });
  }
  return { id: 'comparisons', heading: '6. Comparisons', blocks };
}

/** File name without extension, e.g. "wall-report-20261027-123045-12b478f0" (time is UTC). */
export function reportFileBase(model: Pick<ReportModel, 'generatedAt' | 'fingerprint'>): string {
  const stamp = model.generatedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `wall-report-${stamp}-${model.fingerprint}`;
}

/** File name without extension for a saved wall, e.g. "wall-20261027-123045" (time is UTC). */
export function wallFileBase(time: Date): string {
  return `wall-${time.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
}
