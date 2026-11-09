/**
 * The building-envelope RESULTS panel (bottom of the building workspace).
 * Shows what the envelope module calculated, per element and in total, and
 * everything that is NOT included. No calculation happens here.
 */
import type { BuildingProject, ComponentStatus, EnvelopeResult } from '../envelope';
import { COMPONENT_TYPE_LABEL } from '../envelope';
import { h, show, tableRegion } from './dom';
import { helpTip } from './glossary';
import type { GlossaryTerm } from './glossary';

export interface BuildingResultsPanel {
  element: HTMLElement;
  setResult(project: BuildingProject, result: EnvelopeResult, selectedId: string | null): void;
  selectTab(id: BuildingTab): void;
}

export type BuildingTab = 'envelope' | 'not-included' | 'assumptions' | 'report';

/** What the Report tab asks the workspace to produce. */
export type BuildingReportFormat = 'html' | 'markdown' | 'json' | 'csv' | 'print';

export const STATUS_LABEL: Record<ComponentStatus, string> = {
  calculated: 'Calculated',
  excluded: 'Not counted',
  unsupported: 'Unsupported',
  'missing-data': 'Missing data',
  invalid: 'Invalid',
};

const NOTHING_YET = 'No element is calculated yet: add components and enter their data (see the Not included tab).';
const kWh = (v: number): string => `${show(Math.abs(v), 4)} kWh`;
/** A signed heat flow in words: positive = out of the conditioned zone. */
export function flowWords(w: number): string {
  if (Math.abs(w) < 1e-9) return '0 W';
  return `${show(Math.abs(w), 4)} W ${w > 0 ? 'out (loss)' : 'in (gain)'}`;
}

export function createBuildingResultsPanel(options: { onSelect: (id: string) => void; onFix?: (id: string) => void; onReport?: (format: BuildingReportFormat, title: string, notes: string) => void }): BuildingResultsPanel {
  let active: BuildingTab = 'envelope';
  let collapsed = false;
  let last: { project: BuildingProject; result: EnvelopeResult; selectedId: string | null } | null = null;

  const tabs: Array<[BuildingTab, string]> = [['envelope', 'Envelope results'], ['not-included', 'Not included'], ['assumptions', 'Assumptions'], ['report', 'Report']];
  const panels = new Map<BuildingTab, HTMLElement>();
  const buttons = new Map<BuildingTab, HTMLButtonElement>();
  const tablist = h('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Building results' });
  for (const [id, label] of tabs) {
    const b = h('button', { type: 'button', role: 'tab', id: `btab-${id}`, 'aria-controls': `bpanel-${id}`, 'aria-selected': 'false', tabindex: '-1', class: 'tab' }, label);
    b.addEventListener('click', () => selectTab(id));
    buttons.set(id, b);
    tablist.append(b);
    panels.set(id, h('div', { role: 'tabpanel', id: `bpanel-${id}`, 'aria-labelledby': `btab-${id}`, class: 'tabpanel', hidden: true, tabindex: '0' }));
  }
  tablist.addEventListener('keydown', (e) => {
    const ids = tabs.map(([id]) => id);
    const at = ids.indexOf(active);
    const next = e.key === 'ArrowRight' ? ids[(at + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(at - 1 + ids.length) % ids.length] : undefined;
    if (next) {
      e.preventDefault();
      selectTab(next);
      buttons.get(next)?.focus();
    }
  });
  const headline = h('span', { class: 'headline', 'data-role': 'b-headline' });
  const collapse = h('button', { type: 'button', class: 'tool', 'aria-expanded': 'true', 'aria-controls': 'b-results-body' }, 'Collapse ▾');
  const enlarge = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'false' }, 'Enlarge');
  const body = h('div', { class: 'results-body', id: 'b-results-body' }, ...panels.values());
  const element = h('section', { id: 'b-results', class: 'results-panel', 'aria-label': 'Building envelope results' }, h('div', { class: 'results-head' }, tablist, headline, h('span', { class: 'results-actions' }, enlarge, collapse)), body);
  collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.textContent = collapsed ? 'Show ▸' : 'Collapse ▾';
    body.hidden = collapsed;
    element.classList.toggle('collapsed', collapsed);
  });
  enlarge.addEventListener('click', () => {
    const on = !element.classList.contains('enlarged');
    element.classList.toggle('enlarged', on);
    enlarge.setAttribute('aria-pressed', String(on));
    enlarge.textContent = on ? 'Shrink' : 'Enlarge';
  });

  function selectTab(id: BuildingTab): void {
    active = id;
    for (const [tab, b] of buttons) {
      b.setAttribute('aria-selected', String(tab === id));
      b.tabIndex = tab === id ? 0 : -1;
      const panel = panels.get(tab);
      if (panel) panel.hidden = tab !== id;
    }
    if (collapsed) collapse.click();
    render();
  }

  const tile = (key: string, label: string, value: string, sub: string, term?: GlossaryTerm): HTMLElement =>
    h('div', { class: 'kpi', 'data-bkpi': key, title: sub }, h('div', { class: 'kpi-label' }, label, term ? helpTip(term) : null), h('div', { class: 'kpi-value' }, h('span', { class: 'kpi-number' }, value)), h('div', { class: 'kpi-sub' }, sub));
  const TERM_OF_COLUMN: Record<string, GlossaryTerm> = { 'U (W/(m²·K))': 'u-value', 'R_si / R_se (m²·K/W)': 'r-si', 'Q̇': 'heat-flow' };

  function render(): void {
    if (!last) return;
    const { project, result, selectedId } = last;
    const included = result.components.filter((r) => r.status === 'calculated').length;
    const c = project.conditions;
    headline.textContent = `Steady state · ${c.label}: inside ${show(c.insideC, 4)} °C, outside ${show(c.outsideC, 4)} °C · ${included} of ${result.components.length} elements calculated`;

    // ---- envelope tab ----
    const envelope = panels.get('envelope') as HTMLElement;
    const net = result.netHeatFlowW;
    // "—" means "not calculated"; 0 would claim a calculated zero. Nothing calculated → every total is "—".
    const none = result.contributions.length === 0;
    const noCapacity = result.components.every((r) => r.heatCapacity === null);
    const rows = result.components.map((r) => {
      const share = result.contributions.find((x) => x.componentId === r.componentId)?.share;
      const tr = h(
        'tr',
        { class: r.componentId === selectedId ? 'variant-current' : '', 'data-component': r.componentId },
        h('td', {}, h('button', { type: 'button', class: 'link-button', 'aria-label': `Select ${r.name}` }, r.name)),
        h('td', {}, COMPONENT_TYPE_LABEL[r.type]),
        h('td', { class: 'num' }, r.dimensions.netAreaM2 > 0 ? show(r.dimensions.netAreaM2, 4) : '—'),
        h('td', { class: 'num' }, r.uValueWPerM2K === null ? '—' : show(r.uValueWPerM2K, 4)),
        h('td', { class: 'num' }, r.surface ? `${show(r.surface.insideM2KPerW, 3)} / ${show(r.surface.outsideM2KPerW, 3)}` : '—'),
        h('td', { class: 'num' }, r.deltaTK === null ? '—' : show(r.deltaTK, 4)),
        h('td', { class: 'num' }, r.heatFlowW === null ? '—' : flowWords(r.heatFlowW)),
        h('td', { class: 'num' }, share === undefined ? '—' : `${show(share * 100, 3)} %`),
        h('td', {}, h('span', { class: `status status-${r.status}` }, STATUS_LABEL[r.status])),
      );
      tr.querySelector('button')?.addEventListener('click', () => options.onSelect(r.componentId));
      return tr;
    });
    envelope.replaceChildren(
      ...([h(
        'div',
        { class: 'kpis' },
        tile('net', 'Net conductive heat flow Σ U·A·ΔT', none ? '—' : flowWords(net), none ? NOTHING_YET : 'Sum over the calculated elements only, each with its own ΔT. Positive = heat leaving the conditioned zone.', 'heat-flow'),
        tile('gains', 'Heat gains through elements', none ? '—' : `${show(result.inwardW, 4)} W`, none ? NOTHING_YET : 'Sum of the elements where heat flows INTO the zone.'),
        tile('losses', 'Heat losses through elements', none ? '—' : `${show(result.outwardW, 4)} W`, none ? NOTHING_YET : 'Sum of the elements where heat flows OUT of the zone.'),
        tile('energy', `Energy in ${show(c.durationH, 4)} h`, none ? '—' : `${kWh(result.netEnergyKWh)} ${result.netEnergyKWh > 0 ? 'out' : result.netEnergyKWh < 0 ? 'in' : ''}`, none ? NOTHING_YET : 'Net heat flow × duration at constant conditions. Not an annual energy use or cooling demand.'),
        tile('mass', 'Heat capacity of layered elements', noCapacity ? '—' : `${show(result.heatCapacityJPerK / 1e6, 4)} MJ/K`, noCapacity ? 'No layered element has complete layer data (thickness, density and specific heat) yet.' : `Simple sum Σ ρ·c_p·V (thermal-mass indicator, not a dynamic result)${result.heatCapacityMissingFor.length > 0 ? `; not available for: ${result.heatCapacityMissingFor.join(', ')}` : ''}.`),
      ),
      result.issues.length > 0 ? h('ul', { class: 'warnings', 'data-role': 'model-issues' }, ...result.issues.map((i) => h('li', {}, i.message))) : null,
      tableRegion(
        'Envelope elements table',
        h(
          'table',
          { class: 'data-table', 'data-role': 'envelope-table' },
          h('caption', {}, 'Each element under the stated condition (steady state). Q̇ = U·A·ΔT, ΔT = T_inside − T_other side'),
          h('thead', {}, h('tr', {}, ...['Element', 'Type', 'Area (m²)', 'U (W/(m²·K))', 'R_si / R_se (m²·K/W)', 'ΔT (K)', 'Q̇', 'Share of Σ|Q̇|', 'Status'].map((t) => h('th', { scope: 'col' }, t, TERM_OF_COLUMN[t] ? helpTip(TERM_OF_COLUMN[t] as GlossaryTerm) : null)))),
          h('tbody', {}, ...rows),
        ),
      ),
      tableRegion(
        'Area by element type',
        h(
          'table',
          { class: 'data-table compact', 'data-role': 'area-table' },
          h('caption', {}, 'Area by element type (net: walls without their openings)'),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Count'), h('th', { scope: 'col', class: 'num' }, 'Area (m²)'))),
          h('tbody', {}, ...result.areaByType.map((a) => h('tr', {}, h('td', {}, a.label), h('td', { class: 'num' }, String(a.count)), h('td', { class: 'num' }, show(a.areaM2, 4))))),
        ),
      )].filter(Boolean) as Node[]),
    );

    // ---- not included ----
    panels.get('not-included')?.replaceChildren(
      result.notIncluded.length === 0
        ? h('p', { class: 'note' }, 'Every element is calculated and included.')
        : h('ul', { class: 'not-included', 'data-role': 'not-included' }, ...result.notIncluded.map((n) => {
            const go = h('button', { type: 'button', class: 'link-button', 'data-component': n.componentId }, `${n.name} — ${STATUS_LABEL[n.status]}`);
            go.addEventListener('click', () => (options.onFix ?? options.onSelect)(n.componentId));
            return h('li', {}, go, ': ', n.reasons.join(' '));
          })),
      h('p', { class: 'caption' }, 'Elements listed here are NOT in the totals. Missing data is never filled in with guessed values.'),
    );

    // ---- report ----
    const reportPanel = panels.get('report') as HTMLElement;
    if (!reportPanel.contains(document.activeElement)) reportPanel.replaceChildren(reportForm(result));

    // ---- assumptions ----
    panels.get('assumptions')?.replaceChildren(h('ul', { 'data-role': 'envelope-assumptions' }, ...result.assumptions.map((a) => h('li', {}, a))));
  }

  // The report form keeps what was typed when the results change.
  const reportTitle = h('input', { type: 'text', id: 'b-report-title', autocomplete: 'off', maxlength: '200', placeholder: 'Building envelope calculation report' });
  const reportNotes = h('textarea', { id: 'b-report-notes', rows: '3', maxlength: '4000', placeholder: 'Optional: purpose of this calculation, assumptions you made, data sources you checked …' });
  function reportForm(result: EnvelopeResult): HTMLElement {
    const fire = (format: BuildingReportFormat): void => options.onReport?.(format, reportTitle.value, reportNotes.value);
    const button = (text: string, role: string, format: BuildingReportFormat, cls = ''): HTMLButtonElement => {
      const b = h('button', { type: 'button', 'data-role': role, class: cls }, text);
      b.addEventListener('click', () => fire(format));
      return b;
    };
    const calculated = result.components.filter((r) => r.status === 'calculated').length;
    return h('div', { class: 'report-layout b-report' },
      h('div', { class: 'report-controls' },
        h('div', { class: 'field' }, h('label', { for: 'b-report-title' }, 'Report title'), reportTitle),
        h('div', { class: 'field' }, h('label', { for: 'b-report-notes' }, 'Your notes (printed at the top)'), reportNotes),
        h('div', { class: 'report-buttons' },
          button('Download HTML report', 'b-report-html', 'html', 'primary'),
          button('Print / save as PDF', 'b-report-print', 'print'),
          button('Markdown', 'b-report-md', 'markdown'),
          button('JSON (all numbers)', 'b-report-json', 'json'),
          button('CSV (element table)', 'b-report-csv', 'csv'),
        ),
      ),
      h('div', { class: 'note', 'data-role': 'b-report-summary' },
        h('p', {}, `The report holds the project and condition, every component as entered, the results of each element with its layer table, the documented window and door values with their sources, the totals, what is not included and why, the equations, assumptions and limitations, and the project itself for reproducibility.`),
        h('p', {}, `${calculated} of ${result.components.length} elements are calculated now${result.notIncluded.length > 0 ? `; the report lists the other ${result.notIncluded.length} and says that the totals are incomplete` : ''}.`),
      ),
    );
  }

  selectTab('envelope');
  return {
    element,
    setResult(project, result, selectedId): void {
      last = { project, result, selectedId };
      render();
    },
    selectTab,
  };
}
