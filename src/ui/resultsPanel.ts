/**
 * The RESULTS panel (bottom of the workspace): headline numbers, layer table,
 * temperature profile, comparisons, assumptions and the configuration summary.
 *
 * Every number shown comes from the `analysis` module (which calls the
 * calculation engine). This file only formats and arranges them; it contains no
 * physics. Everything is a steady-state result under constant conditions, never
 * a dynamic or whole-building simulation, and the panel says so.
 */
import { describeDirection, profileForChart, swapLayerMaterial, sweepLayerThickness, sweepOutsideTemperature } from '../analysis';
import type { Analysis, Comparison, VariantResult } from '../analysis';
import { buildBarChart, buildProfileChart } from '../charts';
import { parseNumberInput } from '../editor';
import type { LayerView } from '../editor';
import type { WallInput } from '../engine';
import type { MaterialRecord } from '../materials';
import { h, show } from './dom';
import type { Child } from './dom';

/** Results for one valid wall. */
export interface ResultsData {
  /** The wall in SI units, exactly as given to the calculation engine. */
  wall: WallInput;
  views: LayerView[];
  analysis: Analysis;
}

interface ResultsInput {
  wall: WallInput | null;
  views: LayerView[];
  analysis: Analysis | null;
  /** True while the editor has errors: the numbers belong to the last valid wall. */
  stale: boolean;
}

export type TabId = 'results' | 'layers' | 'profile' | 'compare' | 'assumptions' | 'configuration';

export interface ResultsPanel {
  element: HTMLElement;
  /** Container for the configuration summary (the editor puts its summary here). */
  configurationHost: HTMLElement;
  /**
   * Gives the panel the latest VALID results, or null while the editor's inputs are invalid
   * (the panel then keeps showing the last valid results and says so).
   */
  setState(valid: ResultsData | null, editorHasErrors: boolean): void;
  selectTab(id: TabId): void;
  getActiveTab(): TabId;
}

const TABS: Array<[TabId, string]> = [
  ['results', 'Results'],
  ['layers', 'Layers & temperatures'],
  ['profile', 'Temperature profile'],
  ['compare', 'Compare'],
  ['assumptions', 'Assumptions & references'],
  ['configuration', 'Configuration'],
];

/** Heat capacity as [number, unit] with a sensible unit prefix. */
function capacity(joulesPerK: number): [string, string] {
  if (joulesPerK >= 1e6) return [show(joulesPerK / 1e6, 4), 'MJ/K'];
  if (joulesPerK >= 1e3) return [show(joulesPerK / 1e3, 4), 'kJ/K'];
  return [show(joulesPerK, 4), 'J/K'];
}
const arealCapacity = (jPerM2K: number): string => `${show(jPerM2K / 1000, 4)} kJ/(m²·K)`;
/** A percentage change with its sign. Differences below floating-point noise print as 0 %, never as "-1e-14 %". */
const signed = (value: number | null): string => (value === null ? '—' : Math.abs(value) < 1e-9 ? '0 %' : `${value > 0 ? '+' : ''}${show(value, 3)} %`);
const DIRECTION_WORD = { outward: 'Outward · loss', inward: 'Inward · gain', none: 'None' } as const;

export function createResultsPanel(options: { materials: readonly MaterialRecord[]; announce?: (text: string) => void }): ResultsPanel {
  let input: ResultsInput = { wall: null, views: [], analysis: null, stale: false };
  let active: TabId = 'results';
  let collapsed = false;
  let expanded = false;

  // ---- compare tab state (kept between redraws) ---------------------------------------------------
  const compareState = {
    layerIndex: null as number | null, // null = choose automatically (the layer with most resistance)
    thicknessesText: '40 80 120',
    swapLayerIndex: null as number | null,
    swapIds: new Set<string>(['eps-slab', 'xps-board', 'mineral-wool-slab', 'polyurethane-board']),
    temperaturesText: '-5 0 5 10',
  };

  // ---- shell ---------------------------------------------------------------------------------------------
  const headline = h('span', { class: 'headline', 'data-role': 'headline' });
  const panels = new Map<TabId, HTMLElement>();
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  const configurationHost = h('div', { 'data-role': 'configuration-host' });

  const tablist = h('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Results sections' });
  for (const [id, label] of TABS) {
    const tab = h('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': 'false', tabindex: '-1', class: 'tab' }, label);
    tab.addEventListener('click', () => selectTab(id, true));
    tabButtons.set(id, tab);
    tablist.append(tab);
    panels.set(id, h('div', { role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, class: 'tabpanel', hidden: true, tabindex: '0' }));
  }
  tablist.addEventListener('keydown', (event) => {
    const ids = TABS.map(([id]) => id);
    const at = ids.indexOf(active);
    const target = event.key === 'ArrowRight' ? ids[(at + 1) % ids.length] : event.key === 'ArrowLeft' ? ids[(at - 1 + ids.length) % ids.length] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[ids.length - 1] : undefined;
    if (target) {
      event.preventDefault();
      selectTab(target, true);
    }
  });
  panels.get('configuration')?.append(configurationHost);

  const collapseButton = h('button', { type: 'button', class: 'tool', 'aria-expanded': 'true', 'aria-controls': 'results-body', 'data-role': 'collapse' }, 'Collapse ▾');
  const sizeButton = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'data-role': 'enlarge' }, 'Enlarge');
  const body = h('div', { class: 'results-body', id: 'results-body' }, ...[...panels.values()]);
  const element = h(
    'section',
    { id: 'results', class: 'results-panel', 'aria-label': 'Calculation results' },
    h('div', { class: 'results-head' }, tablist, headline, h('span', { class: 'results-actions' }, sizeButton, collapseButton)),
    body,
  );
  collapseButton.addEventListener('click', () => {
    collapsed = !collapsed;
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    collapseButton.textContent = collapsed ? 'Show ▸' : 'Collapse ▾';
    body.hidden = collapsed;
    element.classList.toggle('collapsed', collapsed);
  });
  sizeButton.addEventListener('click', () => {
    expanded = !expanded;
    sizeButton.setAttribute('aria-pressed', String(expanded));
    sizeButton.textContent = expanded ? 'Shrink' : 'Enlarge';
    element.classList.toggle('enlarged', expanded);
    if (expanded && collapsed) collapseButton.click();
  });

  function selectTab(id: TabId, focus = false): void {
    active = id;
    for (const [tabId, tab] of tabButtons) {
      const on = tabId === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = panels.get(tabId);
      if (panel) panel.hidden = !on;
    }
    if (focus) tabButtons.get(id)?.focus();
    if (collapsed) collapseButton.click();
    render();
  }

  // ---- shared pieces -------------------------------------------------------------------------------------------
  const empty = (text: string): HTMLElement => h('p', { class: 'note empty-note' }, text);
  const stale = (): HTMLElement | null => (input.stale ? h('p', { class: 'stale-note' }, 'The editor has errors. These results belong to the last valid wall.') : null);
  const badge = (status: string): HTMLElement => h('span', { class: `badge badge-${status}` }, { verified: 'Verified', unverified: 'Unverified', illustrative: 'Illustrative', 'user-defined': 'User-defined' }[status] ?? status);

  function kpi(key: string, label: string, value: string, unit: string, sub: Child, extra?: Child): HTMLElement {
    return h('div', { class: 'kpi', 'data-kpi': key }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, h('span', { class: 'kpi-number' }, value), ' ', h('span', { class: 'kpi-unit' }, unit)), extra ?? null, h('div', { class: 'kpi-sub' }, sub));
  }

  // ---- results tab ------------------------------------------------------------------------------------------------
  function renderResults(): void {
    const panel = panels.get('results') as HTMLElement;
    const a = input.analysis;
    if (!a || !input.wall) {
      panel.replaceChildren(empty('Enter a valid wall in the sidebar to see results.'));
      return;
    }
    const r = a.result;
    const hc = r.heatCapacity;
    const sr = input.wall.surfaceResistances;
    const area = r.geometry.areaM2;
    panel.replaceChildren(
      ...([
        stale(),
        h(
          'div',
          { class: 'kpis' },
          kpi('u-value', 'Thermal transmittance U', show(r.uValueWPerM2K, 4), 'W/(m²·K)', 'U = 1 / R_total'),
          kpi('r-total', 'Total thermal resistance R_total', show(r.resistance.totalM2KPerW, 4), 'm²·K/W', `R_si + Σ d/λ + R_se = ${show(r.resistance.insideSurfaceM2KPerW)} + ${show(r.resistance.layersM2KPerW, 4)} + ${show(r.resistance.outsideSurfaceM2KPerW)}`),
          kpi('heat-transfer', 'Heat-transfer rate Q̇ (magnitude)', show(r.heatTransfer.magnitudeW, 4), 'W', `Q̇ = U · A · |ΔT| = ${show(r.uValueWPerM2K, 3)} × ${show(area, 4)} m² × ${show(Math.abs(r.heatTransfer.temperatureDifferenceK), 4)} K`, h('div', { class: `direction direction-${r.heatTransfer.direction}`, 'data-role': 'direction' }, `Direction: ${DIRECTION_WORD[r.heatTransfer.direction]}`)),
          kpi('flux', 'Heat flux q', show(r.heatTransfer.fluxMagnitudeWPerM2, 4), 'W/m²', 'q = Q̇ / A'),
          kpi('energy', `Energy in ${show(r.energy.durationHours, 4)} h`, show(r.energy.magnitudeKWh, 4), 'kWh', 'E = Q̇ · t / 1000, constant conditions. Not an annual energy demand.'),
          hc.available
            ? kpi('heat-capacity', 'Heat capacity (stored per kelvin)', capacity(hc.totalJPerK)[0], capacity(hc.totalJPerK)[1], `${arealCapacity(hc.arealJPerM2K)} per m² of wall. A simple sum Σ ρ·c_p·V: not a dynamic response.`)
            : kpi('heat-capacity', 'Heat capacity', 'Unavailable', '', `Density and/or specific heat missing for: ${hc.missingFor.join(', ')}.`),
        ),
        h('p', { class: 'caption' }, h('strong', {}, 'Basis: '), `steady state, one-dimensional, constant air temperatures (${show(input.wall.conditions.insideTemperatureC, 4)} °C inside, ${show(input.wall.conditions.outsideTemperatureC, 4)} °C outside); homogeneous layers; surface resistances R_si ${show(sr.insideM2KPerW)} / R_se ${show(sr.outsideM2KPerW)} m²·K/W (${sr.status}). Not a dynamic or whole-building simulation.`),
        r.warnings.length > 0 ? h('ul', { class: 'warnings', 'data-role': 'engine-warnings' }, ...r.warnings.map((w) => h('li', {}, w.message))) : null,
      ].filter(Boolean) as Node[]),
    );
  }

  // ---- layers tab ------------------------------------------------------------------------------------------------------
  function renderLayers(): void {
    const panel = panels.get('layers') as HTMLElement;
    const a = input.analysis;
    if (!a) {
      panel.replaceChildren(empty('Enter a valid wall in the sidebar to see the layer table.'));
      return;
    }
    const r = a.result;
    const profile = r.temperatureProfile;
    const num = (v: number, sig = 4): HTMLElement => h('td', { class: 'num' }, show(v, sig));
    const filmRow = (name: string, resistance: number, share: number, fromC: number, toC: number): HTMLElement =>
      h('tr', { class: 'film-row' }, h('td', {}, '—'), h('td', {}, name), h('td', {}, ''), h('td', {}, ''), num(resistance, 3), h('td', { class: 'num' }, `${show(share * 100, 3)} %`), num(fromC), num(toC), num(fromC - toC, 3), h('td', {}, ''));
    const rows: HTMLElement[] = [
      filmRow('Inside surface film (air → surface)', r.resistance.insideSurfaceM2KPerW, r.resistanceBreakdown[0]?.fractionOfTotal ?? 0, profile[0]?.temperatureC ?? NaN, profile[1]?.temperatureC ?? NaN),
      ...r.layers.map((layer, i) => {
        const t = a.layerTemperatures[i];
        return h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, layer.name), num(layer.thicknessM * 1000, 4), num(layer.lambdaWPerMK, 3), num(layer.resistanceM2KPerW, 4), h('td', { class: 'num' }, `${show(layer.fractionOfTotal * 100, 3)} %`), num(t?.startC ?? NaN), num(t?.endC ?? NaN), num(t?.dropK ?? NaN, 3), h('td', {}, layer.propertyStatus ? badge(layer.propertyStatus) : ''));
      }),
      filmRow('Outside surface film (surface → air)', r.resistance.outsideSurfaceM2KPerW, r.resistanceBreakdown[r.resistanceBreakdown.length - 1]?.fractionOfTotal ?? 0, profile[profile.length - 2]?.temperatureC ?? NaN, profile[profile.length - 1]?.temperatureC ?? NaN),
    ];
    panel.replaceChildren(
      ...([
        stale(),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data-table', 'data-role': 'layer-table' },
            h('caption', {}, 'Layer by layer, interior → exterior (calculated, steady state)'),
            h('thead', {}, h('tr', {}, ...['#', 'Layer', 'd (mm)', 'λ (W/(m·K))', 'R = d/λ (m²·K/W)', 'Share of R_total', 'T interior side (°C)', 'T exterior side (°C)', 'ΔT across (K)', 'Data'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, ...rows),
            h('tfoot', {}, h('tr', {}, h('td', { colspan: '4' }, 'Total'), num(r.resistance.totalM2KPerW, 4), h('td', { class: 'num' }, '100 %'), num(profile[0]?.temperatureC ?? NaN), num(profile[profile.length - 1]?.temperatureC ?? NaN), num((profile[0]?.temperatureC ?? NaN) - (profile[profile.length - 1]?.temperatureC ?? NaN), 3), h('td', {}, ''))),
          ),
        ),
        h('p', { class: 'caption' }, 'For films, "T interior side" is the air temperature and "T exterior side" the surface temperature (inside film), and the reverse order for the outside film. The same heat flux crosses every row, so each temperature drop is q × its resistance.'),
      ].filter(Boolean) as Node[]),
    );
  }

  // ---- profile tab -------------------------------------------------------------------------------------------------------
  function renderProfile(): void {
    const panel = panels.get('profile') as HTMLElement;
    const a = input.analysis;
    if (!a) {
      panel.replaceChildren(empty('Enter a valid wall in the sidebar to see the temperature profile.'));
      return;
    }
    const data = profileForChart(a);
    const chart = buildProfileChart({
      points: data.points.map((p) => ({ kind: p.kind, label: p.label, xMm: p.xM * 1000, temperatureC: p.temperatureC })),
      bands: data.bands.map((b) => ({ name: b.name, x0Mm: b.x0M * 1000, x1Mm: b.x1M * 1000 })),
    });
    const r = a.result;
    panel.replaceChildren(
      ...([
        stale(),
        h(
          'div',
          { class: 'profile-layout' },
          h('div', { class: 'chart-box' }, chart),
          h(
            'div',
            {},
            h(
              'table',
              { class: 'data-table compact', 'data-role': 'profile-table' },
              h('caption', {}, 'Calculated temperatures'),
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Point'), h('th', { scope: 'col' }, 'Distance (mm)'), h('th', { scope: 'col' }, 'T (°C)'))),
              h('tbody', {}, ...data.points.map((p) => h('tr', {}, h('td', {}, p.label), h('td', { class: 'num' }, show(p.xM * 1000, 4)), h('td', { class: 'num' }, show(p.temperatureC, 4))))),
            ),
            h('p', { class: 'caption' }, `Heat flow: ${describeDirection(r.heatTransfer.direction)}.`),
          ),
        ),
        h('p', { class: 'caption' }, h('strong', {}, 'How these were calculated: '), 'the same heat flux q = (T_in − T_out) / R_total crosses every layer and surface film, so each temperature drop is q × that element\'s resistance (inside surface = T_in − q·R_si; each interface follows by subtracting q·R of the layer; outside surface = T_out + q·R_se). Inside each homogeneous layer the temperature is a straight line. Steady state only: no heat storage, no changing weather.'),
      ].filter(Boolean) as Node[]),
    );
  }

  // ---- compare tab -------------------------------------------------------------------------------------------------------
  /** Reads a list like "40 80 120" (separated by spaces or semicolons; a comma is a decimal mark). */
  function parseList(text: string): { values: number[]; error: string | null } {
    const tokens = text.split(/[\s;]+/).filter(Boolean);
    if (tokens.length === 0) return { values: [], error: 'Enter at least one value.' };
    if (tokens.length > 8) return { values: [], error: 'Enter at most 8 values.' };
    const values: number[] = [];
    for (const token of tokens) {
      const parsed = parseNumberInput(token);
      if (!parsed.ok) return { values: [], error: `"${token}" is not a number. Separate values with spaces or semicolons; use a point or comma as the decimal mark.` };
      values.push(parsed.value);
    }
    return { values, error: null };
  }

  function comparisonView(comparison: Comparison, title: string, valueLabel: string): HTMLElement {
    const rows = comparison.variants.map((v, i) => comparisonRow(v, i === 0));
    const chart = buildBarChart(comparison.variants.map((v, i) => ({ label: v.label, value: v.ok ? v.uValueWPerM2K : null, highlight: i === 0 })), { title: `U-value by variant`, unit: 'W/(m²·K)', decimals: 3 });
    const anyUnverified = comparison.variants.some((v) => v.usesUnverifiedData);
    return h(
      'div',
      { class: 'comparison', 'data-role': 'comparison' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table', 'data-role': 'comparison-table' }, h('caption', {}, `${title}: changing ${valueLabel} only`), h('thead', {}, h('tr', {}, ...['Variant', 'What changed', 'U (W/(m²·K))', 'ΔU', 'R_total (m²·K/W)', 'Q̇ (W)', 'ΔQ̇', 'Heat capacity (kJ/(m²·K))', 'Data'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, ...rows))),
      h('div', { class: 'chart-box small' }, chart),
      h('p', { class: 'caption' }, h('strong', {}, 'Held constant: '), comparison.heldConstant.join('; '), '. Percentages are relative to the current wall.', anyUnverified ? ' Some variants use illustrative or unverified material data: use the comparison to see trends, not as design values.' : ''),
    );
  }

  function comparisonRow(v: VariantResult, baseline: boolean): HTMLElement {
    if (!v.ok) return h('tr', { class: 'variant-error' }, h('td', {}, v.label), h('td', {}, v.changed), h('td', { colspan: '7' }, `Cannot be calculated: ${v.error ?? 'invalid input'}`));
    return h(
      'tr',
      { class: baseline ? 'variant-current' : '' },
      h('td', {}, baseline ? h('strong', {}, 'Current') : v.label),
      h('td', {}, baseline ? '—' : v.changed),
      h('td', { class: 'num' }, show(v.uValueWPerM2K, 4)),
      h('td', { class: 'num' }, baseline ? '—' : signed(v.deltaUPercent)),
      h('td', { class: 'num' }, show(v.totalResistanceM2KPerW, 4)),
      h('td', { class: 'num' }, `${show(v.heatTransferW, 4)}${v.direction === 'none' ? '' : v.direction === 'outward' ? ' out' : ' in'}`),
      h('td', { class: 'num' }, baseline ? '—' : signed(v.deltaHeatTransferPercent)),
      h('td', { class: 'num' }, v.arealHeatCapacityJPerM2K === null ? 'n/a' : show(v.arealHeatCapacityJPerM2K / 1000, 4)),
      h('td', {}, v.usesUnverifiedData ? h('span', { class: 'badge badge-illustrative' }, 'Not verified') : ''),
    );
  }

  function layerSelect(id: string, label: string, value: number, onChange: (index: number) => void): HTMLElement {
    const select = h('select', { id });
    input.analysis?.result.layers.forEach((layer, i) => select.append(h('option', { value: String(i) }, `Layer ${i + 1}: ${layer.name}`)));
    select.value = String(value);
    select.addEventListener('change', () => onChange(Number(select.value)));
    return h('div', { class: 'field' }, h('label', { for: id }, label), select);
  }

  function renderCompare(): void {
    const panel = panels.get('compare') as HTMLElement;
    const a = input.analysis;
    const wall = input.wall;
    if (!a || !wall) {
      panel.replaceChildren(empty('Enter a valid wall in the sidebar to compare alternatives.'));
      return;
    }
    // Default layer: the one with the largest thermal resistance (normally the insulation).
    const resistances = a.result.layers.map((l) => l.resistanceM2KPerW);
    const best = resistances.indexOf(Math.max(...resistances));
    const thicknessLayer = Math.min(compareState.layerIndex ?? best, wall.layers.length - 1);
    const swapLayer = Math.min(compareState.swapLayerIndex ?? best, wall.layers.length - 1);

    // 1. thickness sweep
    const thicknessInput = h('input', { type: 'text', id: 'cmp-thicknesses', autocomplete: 'off', value: compareState.thicknessesText, 'aria-describedby': 'cmp-thicknesses-msg' });
    const thicknessMsg = h('div', { id: 'cmp-thicknesses-msg', class: 'msg' });
    const thicknessResult = h('div', { 'data-role': 'sweep-thickness' });
    const runThickness = (): void => {
      compareState.thicknessesText = thicknessInput.value;
      const parsed = parseList(thicknessInput.value);
      thicknessMsg.textContent = parsed.error ? `Error: ${parsed.error}` : '';
      thicknessMsg.className = `msg ${parsed.error ? 'error' : ''}`;
      thicknessInput.setAttribute('aria-invalid', String(Boolean(parsed.error)));
      thicknessResult.replaceChildren(...(parsed.error ? [] : [comparisonView(sweepLayerThickness(wall, thicknessLayer, parsed.values.map((mm) => mm / 1000)), `Thickness of layer ${thicknessLayer + 1}`, 'its thickness')]));
    };
    thicknessInput.addEventListener('input', runThickness);

    // 2. material swap
    const materialBoxes = options.materials.map((m) => {
      const box = h('input', { type: 'checkbox', id: `cmp-m-${m.id}`, value: m.id });
      box.checked = compareState.swapIds.has(m.id);
      box.addEventListener('change', () => {
        if (box.checked) compareState.swapIds.add(m.id);
        else compareState.swapIds.delete(m.id);
        runSwap();
      });
      return h('label', { class: 'chip', for: `cmp-m-${m.id}` }, box, ` ${m.name}`);
    });
    const swapResult = h('div', { 'data-role': 'swap-material' });
    const runSwap = (): void => {
      const chosen = options.materials.filter((m) => compareState.swapIds.has(m.id));
      swapResult.replaceChildren(chosen.length === 0 ? h('p', { class: 'note' }, 'Tick at least one material to compare.') : comparisonView(swapLayerMaterial(wall, swapLayer, chosen), `Material of layer ${swapLayer + 1}`, 'its material (same thickness)'));
    };

    // 3. outside temperature
    const tempInput = h('input', { type: 'text', id: 'cmp-temperatures', autocomplete: 'off', value: compareState.temperaturesText, 'aria-describedby': 'cmp-temperatures-msg' });
    const tempMsg = h('div', { id: 'cmp-temperatures-msg', class: 'msg' });
    const tempResult = h('div', { 'data-role': 'sweep-temperature' });
    const runTemps = (): void => {
      compareState.temperaturesText = tempInput.value;
      const parsed = parseList(tempInput.value);
      tempMsg.textContent = parsed.error ? `Error: ${parsed.error}` : '';
      tempMsg.className = `msg ${parsed.error ? 'error' : ''}`;
      tempInput.setAttribute('aria-invalid', String(Boolean(parsed.error)));
      tempResult.replaceChildren(...(parsed.error ? [] : [comparisonView(sweepOutsideTemperature(wall, parsed.values), 'Outside air temperature', 'the outside air temperature')]));
    };
    tempInput.addEventListener('input', runTemps);

    panel.replaceChildren(
      ...([
        stale(),
        h('p', { class: 'caption' }, 'Each comparison changes ONE thing in the current wall and keeps everything else identical, so differences are caused only by that change. Steady state, constant conditions.'),
        h('details', { open: true, class: 'cmp-section' }, h('summary', {}, 'A. Thickness of one layer (e.g. insulation 40 / 80 / 120 mm)'), h('div', { class: 'cmp-controls' }, layerSelect('cmp-layer', 'Layer to vary', thicknessLayer, (i) => { compareState.layerIndex = i; renderCompare(); }), h('div', { class: 'field' }, h('label', { for: 'cmp-thicknesses' }, 'Thicknesses to try (mm, separated by spaces)'), thicknessInput, thicknessMsg)), thicknessResult),
        h('details', { class: 'cmp-section' }, h('summary', {}, 'B. Material of one layer (e.g. EPS vs mineral wool vs XPS)'), h('div', { class: 'cmp-controls' }, layerSelect('cmp-swap-layer', 'Layer to replace', swapLayer, (i) => { compareState.swapLayerIndex = i; renderCompare(); })), h('div', { class: 'chips', role: 'group', 'aria-label': 'Materials to compare' }, ...materialBoxes), swapResult),
        h('details', { class: 'cmp-section' }, h('summary', {}, 'C. Outside air temperature (heat transfer under different conditions)'), h('div', { class: 'cmp-controls' }, h('div', { class: 'field' }, h('label', { for: 'cmp-temperatures' }, 'Outside temperatures to try (°C, separated by spaces)'), tempInput, tempMsg)), tempResult),
      ].filter(Boolean) as Node[]),
    );
    runThickness();
    runSwap();
    runTemps();
  }

  // ---- assumptions tab -----------------------------------------------------------------------------------------------------
  function renderAssumptions(): void {
    const panel = panels.get('assumptions') as HTMLElement;
    const a = input.analysis;
    panel.replaceChildren(
      h('div', { class: 'assumptions' },
        h('h3', {}, 'Assumptions behind these numbers'),
        a ? h('ul', { 'data-role': 'engine-assumptions' }, ...a.result.assumptions.map((t) => h('li', {}, t))) : h('p', { class: 'note' }, 'Shown once a valid wall has been calculated.'),
        h('h3', {}, 'What the temperature overlay and arrows mean'),
        h('ul', {},
          h('li', {}, 'Colour = the temperature the calculation gives at that point in the wall, mapped linearly from the coldest to the warmest temperature in the wall (see the colour bar). It is a display of calculated numbers, not a separate model.'),
          h('li', {}, 'Inside each layer the temperature varies linearly across its thickness, so the colour changes steadily from one face to the other.'),
          h('li', {}, 'Arrows show only the DIRECTION of the steady-state heat flow (warm side → cold side). Their size is not a magnitude; read Q̇ in the results.'),
        ),
        h('h3', {}, 'What this is not'),
        h('ul', {},
          h('li', {}, 'Not a dynamic or hourly simulation: there is no heat storage, solar gain, ventilation or changing weather in these results.'),
          h('li', {}, 'Not a whole-building energy simulation, and not an annual energy-demand prediction.'),
          h('li', {}, 'Not a compliance check: no result has been compared with any Cyprus regulation or standard requirement.'),
        ),
        h('h3', {}, 'Method and data references (status)'),
        h('ul', {},
          h('li', {}, 'Method: the basic homogeneous-layer approach of ISO 6946 (R = d/λ, R_total = R_si + ΣR + R_se, U = 1/R_total). The standard text has NOT been checked against this implementation; no compliance is claimed.'),
          h('li', {}, 'Surface resistances: commonly quoted values for horizontal heat flow, labelled unverified until checked against the standard.'),
          h('li', {}, 'Material values: every built-in value is an illustrative demonstration number with no source; none is an approved Cypriot design value. Measured, declared and design values are different, and EN ISO 10456 condition conversions are not implemented.'),
          h('li', {}, 'Sources register, open questions and verification checklist: docs/sources.md and docs/wall-editor.md in the project.'),
        ),
      ),
    );
  }

  // ---- drawing -----------------------------------------------------------------------------------------------------------------
  function renderHeadline(): void {
    const a = input.analysis;
    if (!a) {
      headline.textContent = 'No valid wall yet';
      return;
    }
    const r = a.result;
    headline.textContent = `U ${show(r.uValueWPerM2K, 4)} W/(m²·K) · R ${show(r.resistance.totalM2KPerW, 4)} m²·K/W · Q̇ ${show(r.heatTransfer.magnitudeW, 4)} W ${r.heatTransfer.direction === 'none' ? '' : r.heatTransfer.direction}${input.stale ? ' · last valid wall' : ''}${a.usesUnverifiedData ? ' · illustrative data' : ''}`;
  }

  function render(): void {
    renderHeadline();
    // Only the visible tab is built (the comparison tab is the most expensive).
    ({
      results: renderResults,
      layers: renderLayers,
      profile: renderProfile,
      compare: renderCompare,
      assumptions: renderAssumptions,
      configuration: () => undefined,
    })[active]();
  }

  selectTab('results');

  return {
    element,
    configurationHost,
    setState(valid, editorHasErrors): void {
      input = valid ? { wall: valid.wall, views: valid.views, analysis: valid.analysis, stale: editorHasErrors } : { ...input, stale: editorHasErrors };
      render();
    },
    selectTab: (id) => selectTab(id),
    getActiveTab: () => active,
  };
}
