// @vitest-environment happy-dom
/**
 * The workspace shell and the results panel: layout, tabs, the numbers shown,
 * and how the calculated temperatures reach the 3D viewport.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeWall } from '../src/analysis';
import { layerField } from '../src/editor';
import type { ThermalOverlay } from '../src/geometry';
import { temperatureFraction, thermalCss } from '../src/geometry';
import { BUILT_IN_MATERIALS, createCustomMaterial, mergeMaterials } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import { createViewerPanel } from '../src/ui/viewerPanel';
import type { WallEditorHandle } from '../src/ui/app';
import { show } from '../src/ui/dom';
import { thermalOverlayFromAnalysis } from '../src/ui/wallSpec';
import { describeLayers, createInitialDraft } from '../src/editor';
import { at, expectClose } from './helpers/helpers';
import { chooseValue, click, el, makeFake, setChecked, type } from './helpers/ui';

let root: HTMLElement;
let editor: WallEditorHandle;
let fake: ReturnType<typeof makeFake>;

async function mount(materials = BUILT_IN_MATERIALS): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  fake = makeFake();
  editor = mountWallEditor(root, materials, { viewerFactory: fake.factory });
  await editor.ready;
}
beforeEach(() => mount());
afterEach(() => editor.destroy());

const text = (selector: string): string => root.querySelector(selector)?.textContent ?? '';
const kpi = (key: string): string => text(`[data-kpi="${key}"] .kpi-number`);
const tab = (id: string): void => click(root.querySelector(`#tab-${id}`));
const panel = (id: string): HTMLElement => root.querySelector(`#panel-${id}`) as HTMLElement;
const lastOverlay = (): ThermalOverlay | null => fake.viewer().overlays.at(-1) ?? null;
const checkbox = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const wallOf = () => {
  const wall = editor.getResult().wall;
  if (!wall) throw new Error('wall expected');
  return wall;
};
const analysisOf = () => {
  const outcome = analyzeWall(wallOf());
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.analysis;
};

// ---------------------------------------------------------------------------
describe('workspace layout', () => {
  it('has a top bar, an input sidebar, a 3D viewport and a results panel', () => {
    expect(root.querySelector('header.topbar h1')?.textContent).toBe('Wall Thermal Simulator');
    expect(root.querySelector('aside#sidebar')).not.toBeNull();
    expect(root.querySelector('main.stage-column #viewer')).not.toBeNull();
    expect(root.querySelector('main.stage-column #results')).not.toBeNull();
  });

  it('the sidebar holds the inputs: dimensions, layers and boundary conditions (not the viewport or the results)', () => {
    const sidebar = root.querySelector('#sidebar') as HTMLElement;
    for (const id of ['h-dimensions', 'h-layers', 'h-boundary']) expect(sidebar.querySelector(`#${id}`)).not.toBeNull();
    expect(sidebar.querySelector('#viewer')).toBeNull();
    expect(sidebar.querySelector('#results')).toBeNull();
    expect(sidebar.querySelectorAll('li.layer')).toHaveLength(4);
  });

  it('the viewport comes before the results panel in the main column, and the 3D stage lives in the viewport', () => {
    const column = root.querySelector('main.stage-column') as HTMLElement;
    expect([...column.children].map((c) => c.id)).toEqual(['viewer', 'results']);
    expect(root.querySelector('#viewer .viewer-stage')).not.toBeNull();
  });

  it('the sidebar can be hidden and shown again, with the state exposed to assistive technology', () => {
    const toggle = root.querySelector('[data-role="sidebar-toggle"]') as HTMLElement;
    const workspace = root.querySelector('.workspace') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(workspace.classList.contains('sidebar-collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('announcer')?.textContent).toBe('Input sidebar hidden.');
    click(toggle);
    expect(workspace.classList.contains('sidebar-collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('hiding the sidebar does not remove or reset the inputs', () => {
    type('width', '4.5');
    click(root.querySelector('[data-role="sidebar-toggle"]'));
    expect(editor.getDraft().widthText).toBe('4.5');
    expect(root.querySelector('#sidebar')).not.toBeNull();
  });

  it('shows whether the wall is valid at the top of the sidebar', () => {
    expect(text('[data-role="validity"]')).toBe('✔ Valid wall');
    type('width', '0');
    expect(text('[data-role="validity"]')).toBe('✖ 1 problem to fix (see the messages)');
    expect(root.querySelector('[data-role="validity"]')?.classList.contains('bad')).toBe(true);
    type('width', '3');
    expect(root.querySelector('[data-role="validity"]')?.classList.contains('ok')).toBe(true);
  });

  it('keeps the data policy one click away at all times', () => {
    const policy = root.querySelector('details.policy') as HTMLElement;
    expect(policy.querySelector('summary')?.textContent).toContain('illustrative values, not approved Cypriot design values');
    expect(policy.textContent).toContain('nothing shown here demonstrates compliance with any standard or regulation');
  });

  it('says the analysis is steady state', () => {
    expect(text('.mode-chip')).toBe('Steady-state wall analysis');
    expect(text('[data-role="statusbar"]')).toContain('Steady state');
  });
});

// ---------------------------------------------------------------------------
describe('results panel: tabs', () => {
  const tabs = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="tab"]')];

  it('is a proper tab list: one selected tab, one visible panel, each panel labelled by its tab', () => {
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs().map((t) => t.textContent)).toEqual(['Results', 'Layers & temperatures', 'Temperature profile', 'Compare', 'Assumptions & references', 'Configuration']);
    expect(tabs().filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(root.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    for (const t of tabs()) {
      const p = document.getElementById(t.getAttribute('aria-controls') ?? '');
      expect(p?.getAttribute('aria-labelledby')).toBe(t.id);
    }
  });

  it('clicking a tab shows only its panel; only the selected tab is in the tab order', () => {
    tab('profile');
    expect(editor.results.getActiveTab()).toBe('profile');
    expect(panel('profile').hidden).toBe(false);
    expect(panel('results').hidden).toBe(true);
    expect(tabs().filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect((root.querySelector('#tab-profile') as HTMLElement).tabIndex).toBe(0);
  });

  it('arrow keys, Home and End move between tabs (wrapping around)', () => {
    const list = root.querySelector('[role="tablist"]') as HTMLElement;
    const press = (key: string) => list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press('ArrowRight');
    expect(editor.results.getActiveTab()).toBe('layers');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(editor.results.getActiveTab()).toBe('configuration'); // wrapped
    press('Home');
    expect(editor.results.getActiveTab()).toBe('results');
    press('End');
    expect(editor.results.getActiveTab()).toBe('configuration');
  });

  it('the headline stays visible whichever tab is open', () => {
    const headline = text('[data-role="headline"]');
    expect(headline).toContain(`U ${show(analysisOf().result.uValueWPerM2K, 4)} W/(m²·K)`);
    tab('compare');
    expect(text('[data-role="headline"]')).toBe(headline);
  });

  it('can be collapsed to just the tab bar and headline, and enlarged', () => {
    const results = root.querySelector('#results') as HTMLElement;
    click(root.querySelector('[data-role="collapse"]'));
    expect(results.classList.contains('collapsed')).toBe(true);
    expect((results.querySelector('#results-body') as HTMLElement).hidden).toBe(true);
    expect(results.querySelector('[data-role="collapse"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(text('[data-role="headline"]')).toContain('U ');
    click(root.querySelector('#tab-layers')); // choosing a tab re-opens it
    expect(results.classList.contains('collapsed')).toBe(false);
    click(root.querySelector('[data-role="enlarge"]'));
    expect(results.classList.contains('enlarged')).toBe(true);
    expect(results.querySelector('[data-role="enlarge"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the configuration tab holds the editor\'s validity summary and the engine input', () => {
    tab('configuration');
    expect(panel('configuration').querySelector('#summary')).not.toBeNull();
    expect(panel('configuration').textContent).toContain('Valid configuration');
    expect(panel('configuration').querySelector('pre')?.textContent).toContain('"thicknessM": 0.015');
  });
});

// ---------------------------------------------------------------------------
describe('results panel: the numbers', () => {
  it('shows the engine\'s U-value, total resistance, heat transfer and flux, matching a hand calculation', () => {
    // R_total = R_si + Σ d/λ + R_se with the (illustrative) database values, hand-written here.
    const rTotal = 0.13 + 0.015 / 0.43 + 0.2 / 0.7 + 0.08 / 0.035 + 0.02 / 1.0 + 0.04;
    const u = 1 / rTotal;
    const q = u * 7.5 * 15;
    expect(kpi('u-value')).toBe(show(u, 4));
    expect(kpi('r-total')).toBe(show(rTotal, 4));
    expect(kpi('heat-transfer')).toBe(show(q, 4));
    expect(kpi('flux')).toBe(show(q / 7.5, 4));
    expect(kpi('energy')).toBe(show((q * 24) / 1000, 4));
  });

  it('labels every number with its unit', () => {
    expect(text('[data-kpi="u-value"] .kpi-unit')).toBe('W/(m²·K)');
    expect(text('[data-kpi="r-total"] .kpi-unit')).toBe('m²·K/W');
    expect(text('[data-kpi="heat-transfer"] .kpi-unit')).toBe('W');
    expect(text('[data-kpi="flux"] .kpi-unit')).toBe('W/m²');
    expect(text('[data-kpi="energy"] .kpi-unit')).toBe('kWh');
  });

  it('shows the formulas behind the numbers', () => {
    expect(text('[data-kpi="u-value"] .kpi-sub')).toBe('U = 1 / R_total');
    expect(text('[data-kpi="r-total"] .kpi-sub')).toContain('R_si + Σ d/λ + R_se');
    expect(text('[data-kpi="heat-transfer"] .kpi-sub')).toContain('Q̇ = U · A · |ΔT|');
  });

  it('keeps the magnitude of the heat transfer separate from its direction, in words', () => {
    expect(text('[data-role="direction"]')).toBe('Direction: Outward · loss');
    type('outsideTemperature', '35');
    expect(text('[data-role="direction"]')).toBe('Direction: Inward · gain');
    expect(Number(kpi('heat-transfer'))).toBeGreaterThan(0); // never a negative number
    type('outsideTemperature', '20');
    expect(text('[data-role="direction"]')).toBe('Direction: None');
    expect(kpi('heat-transfer')).toBe('0');
  });

  it('states that the energy figure is not an annual demand and the result is not a dynamic simulation', () => {
    expect(text('[data-kpi="energy"] .kpi-sub')).toContain('Not an annual energy demand');
    expect(text('#panel-results .caption')).toContain('Not a dynamic or whole-building simulation');
    expect(text('#panel-results .caption')).toContain('constant air temperatures (20 °C inside, 5 °C outside)');
  });

  it('shows the surface resistances used and their status', () => {
    expect(text('#panel-results .caption')).toContain('R_si 0.13 / R_se 0.04 m²·K/W (unverified)');
  });

  it('shows heat capacity as a simple sum with a unit that scales', () => {
    const hc = analysisOf().result.heatCapacity;
    if (!hc.available) throw new Error('available expected');
    expect(kpi('heat-capacity')).toBe(show(hc.totalJPerK / 1e6, 4));
    expect(text('[data-kpi="heat-capacity"] .kpi-unit')).toBe('MJ/K');
    expect(text('[data-kpi="heat-capacity"]')).toContain(`${show(hc.arealJPerM2K / 1000, 4)} kJ/(m²·K) per m² of wall`);
    expect(text('[data-kpi="heat-capacity"] .kpi-sub')).toContain('not a dynamic response');
  });

  it('says "Unavailable" and names the layers when density or specific heat is missing, instead of showing a number', async () => {
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.3 });
    await mount(mergeMaterials(BUILT_IN_MATERIALS, [material]));
    chooseValue(el<HTMLSelectElement>(layerField('layer-1', 'material')), material.id);
    expect(kpi('heat-capacity')).toBe('Unavailable');
    expect(text('[data-kpi="heat-capacity"] .kpi-sub')).toContain('missing for: Only lambda');
    expect(kpi('u-value')).not.toBe(''); // everything else still works
  });

  it('passes on the engine\'s warnings, including the unverified-data one', () => {
    expect(text('[data-role="engine-warnings"]')).toContain('Material properties are not verified reference data');
    expect(text('[data-role="engine-warnings"]')).toContain('not for design or compliance');
  });

  it('updates when an input changes: thicker insulation lowers U and Q̇', () => {
    const u0 = Number(kpi('u-value'));
    const q0 = Number(kpi('heat-transfer'));
    type(layerField('layer-3', 'thickness'), '160');
    expect(Number(kpi('u-value'))).toBeLessThan(u0);
    expect(Number(kpi('heat-transfer'))).toBeLessThan(q0);
  });

  it('doubling the width doubles Q̇ and leaves U unchanged', () => {
    const u0 = kpi('u-value');
    const q0 = Number(kpi('heat-transfer'));
    type('width', '6');
    expect(kpi('u-value')).toBe(u0);
    expectClose(Number(kpi('heat-transfer')), 2 * q0, 1e-3);
  });

  it('uses the same SI wall the editor validated (no separate calculation path)', () => {
    expectClose(Number(kpi('u-value')), Number(show(analysisOf().result.uValueWPerM2K, 4)), 1e-12);
  });
});

describe('results panel: invalid input', () => {
  it('keeps the last valid results, marks them as belonging to the last valid wall, and recovers', () => {
    const u = kpi('u-value');
    type('width', '-3');
    expect(kpi('u-value')).toBe(u);
    expect(text('#panel-results .stale-note')).toContain('last valid wall');
    expect(text('[data-role="headline"]')).toContain('last valid wall');
    type('width', '6');
    expect(root.querySelector('#panel-results .stale-note')).toBeNull();
    expect(text('[data-role="headline"]')).not.toContain('last valid wall');
  });
});

// ---------------------------------------------------------------------------
describe('layers & temperatures tab', () => {
  beforeEach(() => tab('layers'));
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-role="layer-table"] tbody tr')];
  const cells = (row: HTMLElement): string[] => [...row.children].map((c) => c.textContent ?? '');

  it('lists the inside film, every layer in order, and the outside film', () => {
    expect(rows()).toHaveLength(6);
    expect(cells(at(rows(), 0))[1]).toContain('Inside surface film');
    expect(rows().slice(1, 5).map((r) => cells(r)[1])).toEqual([
      'Gypsum plaster (demonstration)',
      'Clay brick, solid (demonstration)',
      'Expanded polystyrene (EPS) slab (demonstration)',
      'Cement plaster / render (demonstration)',
    ]);
    expect(cells(at(rows(), 5))[1]).toContain('Outside surface film');
  });

  it('each layer\'s row shows d in mm, λ, R = d/λ and its share, as the engine computed them', () => {
    const a = analysisOf();
    a.result.layers.forEach((layer, i) => {
      const c = cells(at(rows(), i + 1));
      expect(c[2]).toBe(show(layer.thicknessM * 1000, 4));
      expect(c[3]).toBe(show(layer.lambdaWPerMK, 3));
      expect(c[4]).toBe(show(layer.resistanceM2KPerW, 4));
      expect(c[5]).toBe(`${show(layer.fractionOfTotal * 100, 3)} %`);
    });
  });

  it('shows the calculated temperature at each side of every layer, and the drop across it', () => {
    const a = analysisOf();
    a.layerTemperatures.forEach((t, i) => {
      const c = cells(at(rows(), i + 1));
      expect(c[6]).toBe(show(t.startC, 4));
      expect(c[7]).toBe(show(t.endC, 4));
      expect(c[8]).toBe(show(t.dropK, 3));
    });
  });

  it('the insulation takes the biggest temperature drop and the biggest share of the resistance', () => {
    const drops = rows().slice(1, 5).map((r) => Number(cells(r)[8]));
    expect(drops.indexOf(Math.max(...drops))).toBe(2);
    const shares = rows().slice(1, 5).map((r) => Number((cells(r)[5] ?? '').replace(' %', '')));
    expect(shares.indexOf(Math.max(...shares))).toBe(2);
  });

  it('the footer totals the resistance and the full air-to-air temperature difference', () => {
    const foot = root.querySelector('[data-role="layer-table"] tfoot tr') as HTMLElement;
    expect(foot.textContent).toContain(show(analysisOf().result.resistance.totalM2KPerW, 4));
    expect(foot.textContent).toContain('100 %');
    expect(foot.textContent).toContain('15'); // 20 − 5
  });

  it('flags the data status of each layer', () => {
    expect(rows().slice(1, 5).every((r) => cells(r)[9] === 'Illustrative')).toBe(true);
  });
});

describe('temperature profile tab', () => {
  beforeEach(() => tab('profile'));

  it('draws the chart with one marker per calculated point and lists them in a table', () => {
    expect(panel('profile').querySelectorAll('svg.profile-chart circle.marker')).toHaveLength(7);
    const rows = [...panel('profile').querySelectorAll('[data-role="profile-table"] tbody tr')].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toHaveLength(7);
    expect(at(rows, 0)).toEqual(['Inside air', '0', '20']);
    expect(at(rows, 6)).toEqual(['Outside air', '315', '5']);
  });

  it('the table\'s temperatures are the engine\'s', () => {
    const a = analysisOf();
    const cellsT = [...panel('profile').querySelectorAll('[data-role="profile-table"] tbody tr td:nth-child(3)')].map((c) => c.textContent);
    expect(cellsT).toEqual(a.result.temperatureProfile.map((p) => show(p.temperatureC, 4)));
  });

  it('states the heat-flow direction and how the profile is calculated', () => {
    expect(panel('profile').textContent).toContain('Heat flow: Outward: inside → outside (heat loss from the building).');
    expect(panel('profile').textContent).toContain('the same heat flux q = (T_in − T_out) / R_total crosses every layer');
    expect(panel('profile').textContent).toContain('Steady state only');
  });

  it('follows the inputs: a higher outside temperature changes the chart text', () => {
    const before = panel('profile').querySelector('svg')?.getAttribute('aria-label');
    type('outsideTemperature', '10');
    expect(panel('profile').querySelector('svg')?.getAttribute('aria-label')).not.toBe(before);
    expect(panel('profile').querySelector('svg')?.getAttribute('aria-label')).toContain('Outside air 10 °C');
  });
});

describe('assumptions & references tab', () => {
  beforeEach(() => tab('assumptions'));
  it('lists the engine\'s assumptions verbatim', () => {
    const items = [...panel('assumptions').querySelectorAll('[data-role="engine-assumptions"] li')].map((li) => li.textContent);
    expect(items).toEqual(analysisOf().result.assumptions);
  });
  it('explains the overlay and arrows, what this is not, and the status of method and data', () => {
    const t = panel('assumptions').textContent ?? '';
    expect(t).toContain('Arrows show only the DIRECTION');
    expect(t).toContain('Not a dynamic or hourly simulation');
    expect(t).toContain('Not a whole-building energy simulation');
    expect(t).toContain('Not a compliance check');
    expect(t).toContain('The standard text has NOT been checked against this implementation; no compliance is claimed');
    expect(t).toContain('none is an approved Cypriot design value');
    expect(t).toContain('EN ISO 10456 condition conversions are not implemented');
  });
});

// ---------------------------------------------------------------------------
describe('thermal overlay and heat-flow arrows reach the 3D viewport', () => {
  it('sends the engine\'s temperatures for every layer, with the colour range from coldest to warmest', () => {
    const overlay = lastOverlay();
    const a = analysisOf();
    expect(overlay?.minC).toBe(5);
    expect(overlay?.maxC).toBe(20);
    expect(overlay?.direction).toBe('outward');
    expect(overlay?.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3', 'layer-4']);
    overlay?.layers.forEach((l, i) => {
      expect(l.startC).toBe(a.layerTemperatures[i]?.startC);
      expect(l.endC).toBe(a.layerTemperatures[i]?.endC);
    });
  });

  it('the warm side of the wall is the interior side for heat loss, and the exterior side for heat gain', () => {
    const loss = lastOverlay();
    expect((loss?.layers[0]?.startC ?? 0) > (loss?.layers[3]?.endC ?? 99)).toBe(true);
    type('outsideTemperature', '35');
    const gain = lastOverlay();
    expect(gain?.direction).toBe('inward');
    expect((gain?.layers[0]?.startC ?? 99) < (gain?.layers[3]?.endC ?? 0)).toBe(true);
    expect(gain?.minC).toBeLessThan(gain?.maxC ?? 0);
  });

  it('arrows follow the direction of heat flow: outward, inward, none', () => {
    expect(fake.viewer().flows.at(-1)).toBe('outward');
    type('outsideTemperature', '35');
    expect(fake.viewer().flows.at(-1)).toBe('inward');
    type('outsideTemperature', '20');
    expect(fake.viewer().flows.at(-1)).toBe('none');
  });

  it('the overlay updates when the wall changes (thicker insulation → colder outer layers)', () => {
    const before = lastOverlay()?.layers[3]?.startC ?? 0;
    type(layerField('layer-3', 'thickness'), '200');
    expect(lastOverlay()?.layers[3]?.startC ?? 99).toBeLessThan(before);
  });

  it('the Thermal overlay switch removes and restores the paint; the Heat flow switch the arrows', () => {
    setChecked(checkbox('v-thermal'), false);
    expect(lastOverlay()).toBeNull();
    expect(fake.viewer().flows.at(-1)).toBe('outward'); // arrows are independent
    setChecked(checkbox('v-thermal'), true);
    expect(lastOverlay()).not.toBeNull();
    setChecked(checkbox('v-arrows'), false);
    expect(fake.viewer().flows.at(-1)).toBeNull();
    expect(lastOverlay()).not.toBeNull();
    setChecked(checkbox('v-arrows'), true);
    expect(fake.viewer().flows.at(-1)).toBe('outward');
  });

  it('invalid input sends nothing new: the picture keeps the last valid temperatures', () => {
    const overlays = fake.viewer().overlays.length;
    const flows = fake.viewer().flows.length;
    type('width', '-1');
    type('outsideTemperature', 'abc');
    expect(fake.viewer().overlays).toHaveLength(overlays);
    expect(fake.viewer().flows).toHaveLength(flows);
  });

  it('typing that does not change the wall does not resend the overlay', () => {
    const overlays = fake.viewer().overlays.length;
    type(layerField('layer-1', 'thickness'), '15.0');
    expect(fake.viewer().overlays).toHaveLength(overlays);
  });

  it('with no temperature difference the overlay is one colour and there are no arrows', () => {
    type('outsideTemperature', '20');
    const overlay = lastOverlay();
    expect(overlay?.minC).toBe(overlay?.maxC);
    expect(fake.viewer().flows.at(-1)).toBe('none');
    expect(text('[data-role="colorbar"]')).toContain('No temperature difference: one colour');
  });

  it('the overlay and arrow switches are disabled while there is no calculated wall to show', () => {
    const panelOnly = createViewerPanel();
    document.body.append(panelOnly.element);
    expect((panelOnly.element.querySelector('#v-thermal') as HTMLInputElement).disabled).toBe(true);
    expect((panelOnly.element.querySelector('#v-arrows') as HTMLInputElement).disabled).toBe(true);
    panelOnly.element.remove();
    expect(checkbox('v-thermal').disabled).toBe(false); // enabled in the real page, which has a calculated wall
  });

  it('thermalOverlayFromAnalysis only rearranges the analysis: it adds no numbers of its own', () => {
    const draft = createInitialDraft(BUILT_IN_MATERIALS);
    const views = describeLayers(draft, BUILT_IN_MATERIALS);
    const a = analysisOf();
    const o = thermalOverlayFromAnalysis(a, views);
    expect(o.layers.map((l) => [l.startC, l.endC])).toEqual(a.layerTemperatures.map((t) => [t.startC, t.endC]));
    expect([o.minC, o.maxC]).toEqual([a.temperatureRangeC.minC, a.temperatureRangeC.maxC]);
    expect(() => thermalOverlayFromAnalysis(a, views.slice(1))).toThrow('4 layers but 3 layer views');
  });
});

describe('viewport: colour bar, legend swatches, status bar, navigation', () => {
  it('shows a colour bar for exactly the scale used, in °C, with a plain statement of what it is', () => {
    const bar = root.querySelector('[data-role="colorbar"]') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('Temperature (°C): calculated, steady state');
    expect(bar.querySelector('.colorbar-scale')?.textContent).toBe('512.520');
    expect(bar.textContent).toContain('Linear scale from the coldest to the warmest temperature in the wall');
    expect(bar.textContent).toContain('Uses illustrative or unverified material data: not a design value');
    expect(bar.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Colour scale from 5 °C (blue) to 20 °C (red)');
  });

  it('hides the colour bar when the overlay is switched off', () => {
    setChecked(checkbox('v-thermal'), false);
    expect((root.querySelector('[data-role="colorbar"]') as HTMLElement).hidden).toBe(true);
  });

  it('layer swatches show each layer\'s temperature gradient while the overlay is on, and its category colour when off', () => {
    const swatch = (i: number) => root.querySelectorAll('.legend-item .swatch')[i]?.getAttribute('style') ?? '';
    const overlay = lastOverlay() as ThermalOverlay;
    const start = thermalCss(temperatureFraction(overlay.layers[2]?.startC ?? 0, overlay.minC, overlay.maxC));
    const end = thermalCss(temperatureFraction(overlay.layers[2]?.endC ?? 0, overlay.minC, overlay.maxC));
    expect(swatch(2)).toContain(`linear-gradient(to right, ${start}, ${end})`);
    setChecked(checkbox('v-thermal'), false);
    expect(swatch(2)).toContain('background:#8ecae6'); // EPS category colour
  });

  it('the inspector adds the calculated temperatures of the selected layer', () => {
    click(root.querySelectorAll('.legend-item')[2]);
    const a = analysisOf();
    const t = a.layerTemperatures[2];
    expect(text('.inspector')).toContain(`${show(t?.startC ?? 0, 4)} °C at the interior-side face → ${show(t?.endC ?? 0, 4)} °C at the exterior-side face (calculated, steady state)`);
  });

  it('the status bar gives units, the wall\'s size, the grid spacing, the drawing scale and the mode', () => {
    const bar = text('[data-role="statusbar"]');
    for (const part of ['Units: m · mm · °C · W/(m²·K)', 'Wall 3 × 2.5 m', 'thickness 315 mm', '4 layers', 'Grid: 1 m', 'thickness scale 5×', 'Mode: orbit']) expect(bar).toContain(part);
  });

  it('Orbit and Pan are exclusive modes passed to the viewer, with their state exposed', () => {
    const [orbit, pan] = ['Orbit mode: dragging rotates the model', 'Pan mode: dragging moves the view'].map((l) => root.querySelector(`[aria-label="${l}"]`) as HTMLElement);
    expect(orbit?.getAttribute('aria-pressed')).toBe('true');
    click(pan);
    expect(fake.viewer().modes.at(-1)).toBe('pan');
    expect([orbit?.getAttribute('aria-pressed'), pan?.getAttribute('aria-pressed')]).toEqual(['false', 'true']);
    expect(text('[data-role="statusbar"]')).toContain('Mode: pan');
    click(orbit);
    expect(fake.viewer().modes.at(-1)).toBe('orbit');
  });

  it('zoom buttons move the camera in and out; Reset restores the 3D view', () => {
    click(root.querySelector('[aria-label="Zoom in"]'));
    click(root.querySelector('[aria-label="Zoom out"]'));
    expect(fake.viewer().zooms).toEqual([0.8, 1 / 0.8]);
    click(root.querySelector('[aria-label="Reset to the 3D view"]'));
    expect(fake.viewer().views.at(-1)).toBe('iso');
  });

  it('the Grid switch is passed on and removes the grid spacing from the status bar', () => {
    setChecked(checkbox('v-grid'), false);
    expect(fake.viewer().grids.at(-1)).toBe(false);
    expect(text('[data-role="statusbar"]')).not.toContain('Grid:');
  });

  it('the layers overlay can be folded away to free the picture', () => {
    const toggle = root.querySelector('.layer-panel-toggle') as HTMLElement;
    const layerPanel = root.querySelector('#layer-panel-body') as HTMLElement;
    click(toggle);
    expect(layerPanel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(layerPanel.hidden).toBe(false);
  });

  it('text-only mode (no 3D): results still work, and there is no colour bar or toolbar', async () => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    editor = mountWallEditor(root);
    await editor.ready;
    expect(kpi('u-value')).not.toBe('');
    expect((root.querySelector('[data-role="colorbar"]') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('[data-role="viewer-controls"]') as HTMLElement).hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('compare tab', () => {
  beforeEach(() => tab('compare'));
  const rowsIn = (role: string): string[][] => [...panel('compare').querySelectorAll(`[data-role="${role}"] [data-role="comparison-table"] tbody tr`)].map((r) => [...r.children].map((c) => c.textContent ?? ''));
  const typeCmp = (id: string, value: string): void => {
    const input = document.getElementById(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('starts with the layer that has the most resistance (the insulation) and 40 / 80 / 120 mm', () => {
    expect((document.getElementById('cmp-layer') as HTMLSelectElement).value).toBe('2');
    const rows = rowsIn('sweep-thickness');
    expect(rows.map((r) => r[0])).toEqual(['Current', '40 mm', '80 mm', '120 mm']);
  });

  it('more insulation lowers U and Q̇; the change is shown relative to the current wall', () => {
    const rows = rowsIn('sweep-thickness');
    const u = rows.map((r) => Number(r[2]));
    expect(u[1]).toBeGreaterThan(u[2] as number);
    expect(u[2]).toBeGreaterThan(u[3] as number);
    expect(at(rows, 1)[3]).toMatch(/^\+\d/); // thinner insulation: U goes up
    expect(at(rows, 3)[3]).toMatch(/^-\d/); // thicker: down
    expect(at(rows, 2)[3]).toBe('0 %'); // 80 mm equals the current wall
  });

  it('matches the engine for the 120 mm variant (hand calculation)', () => {
    const rTotal = 0.13 + 0.015 / 0.43 + 0.2 / 0.7 + 0.12 / 0.035 + 0.02 / 1.0 + 0.04;
    expect(at(rowsIn('sweep-thickness'), 3)[2]).toBe(show(1 / rTotal, 4));
    expect(at(rowsIn('sweep-thickness'), 3)[4]).toBe(show(rTotal, 4));
  });

  it('names what changed in each variant, and what is held constant', () => {
    expect(at(rowsIn('sweep-thickness'), 1)[1]).toContain('thickness 40 mm (instead of 80 mm)');
    expect(panel('compare').querySelector('[data-role="sweep-thickness"] .caption')?.textContent).toContain('Held constant: Wall width, height and area');
  });

  it('draws a bar chart of the U-values with the current wall highlighted', () => {
    const chart = panel('compare').querySelector('[data-role="sweep-thickness"] svg.bar-chart') as SVGElement;
    expect(chart.querySelectorAll('rect.bar')).toHaveLength(4);
    expect(chart.querySelectorAll('rect.bar-current')).toHaveLength(1);
  });

  it('typing new thicknesses updates the table at once; commas are decimal marks', () => {
    typeCmp('cmp-thicknesses', '50 100,5');
    expect(rowsIn('sweep-thickness').map((r) => r[0])).toEqual(['Current', '50 mm', '100.5 mm']);
  });

  it('a bad value gives a clear error and no table; fixing it brings the table back', () => {
    typeCmp('cmp-thicknesses', '40 abc');
    expect(text('#cmp-thicknesses-msg')).toContain('"abc" is not a number');
    expect(document.getElementById('cmp-thicknesses')?.getAttribute('aria-invalid')).toBe('true');
    expect(rowsIn('sweep-thickness')).toHaveLength(0);
    typeCmp('cmp-thicknesses', '40');
    expect(text('#cmp-thicknesses-msg')).toBe('');
    expect(rowsIn('sweep-thickness')).toHaveLength(2);
    typeCmp('cmp-thicknesses', '');
    expect(text('#cmp-thicknesses-msg')).toContain('Enter at least one value');
    typeCmp('cmp-thicknesses', '1 2 3 4 5 6 7 8 9');
    expect(text('#cmp-thicknesses-msg')).toContain('at most 8');
  });

  it('an impossible variant (zero or negative thickness) is reported on its own row; the others still work', () => {
    typeCmp('cmp-thicknesses', '60 0 -10');
    const rows = rowsIn('sweep-thickness');
    expect(rows).toHaveLength(4);
    expect(at(rows, 1)[2]).not.toBe('');
    expect(at(rows, 2)[2]).toContain('Cannot be calculated');
    expect(at(rows, 3)[2]).toContain('Cannot be calculated');
  });

  it('changing which layer to vary re-runs the comparison for that layer', () => {
    chooseValue(document.getElementById('cmp-layer') as HTMLSelectElement, '1');
    expect(at(rowsIn('sweep-thickness'), 1)[1]).toContain('Clay brick, solid (demonstration): thickness 40 mm (instead of 200 mm)');
  });

  it('compares materials for one layer at equal thickness: lower conductivity gives lower U (open section B)', () => {
    const rows = rowsIn('swap-material');
    expect(rows.map((r) => (r[0] ?? '').slice(0, 5))).toEqual(['Curre', 'Expan', 'Extru', 'Miner', 'Polyu']);
    const u = (name: string) => Number(rows.find((r) => (r[0] ?? '').startsWith(name))?.[2]);
    expect(u('Polyu')).toBeLessThan(u('Extru'));
    expect(u('Extru')).toBeLessThan(u('Expan'));
    expect(u('Expan')).toBeLessThan(u('Miner'));
  });

  it('ticking and unticking materials changes the rows; with none ticked it asks for one', () => {
    setChecked(document.getElementById('cmp-m-xps-board') as HTMLInputElement, false);
    expect(rowsIn('swap-material').map((r) => r[0]).some((n) => (n ?? '').startsWith('Extru'))).toBe(false);
    for (const id of ['eps-slab', 'mineral-wool-slab', 'polyurethane-board']) setChecked(document.getElementById(`cmp-m-${id}`) as HTMLInputElement, false);
    expect(text('[data-role="swap-material"]')).toContain('Tick at least one material to compare');
    setChecked(document.getElementById('cmp-m-concrete-normal-weight') as HTMLInputElement, true);
    expect(rowsIn('swap-material')).toHaveLength(2);
  });

  it('marks variants that use illustrative data as not verified, and says to use them for trends', () => {
    expect(panel('compare').querySelector('[data-role="swap-material"]')?.textContent).toContain('Not verified');
    expect(panel('compare').querySelector('[data-role="swap-material"] .caption')?.textContent).toContain('use the comparison to see trends, not as design values');
  });

  it('compares outside temperatures: Q̇ scales with ΔT, direction is shown, U is unchanged (section C)', () => {
    const rows = rowsIn('sweep-temperature');
    expect(rows.map((r) => r[0])).toEqual(['Current', '-5 °C', '0 °C', '5 °C', '10 °C']);
    const q = (i: number) => Number((at(rows, i)[5] ?? '').split(' ')[0]);
    expectClose(q(1) / q(0), 25 / 15, 1e-3);
    expectClose(q(4) / q(0), 10 / 15, 1e-3);
    expect(new Set(rows.map((r) => r[2])).size).toBe(1);
    expect(at(rows, 1)[5]).toContain('out');
    typeCmp('cmp-temperatures', '30');
    expect(at(rowsIn('sweep-temperature'), 1)[5]).toContain('in'); // heat gain
    expect(at(rowsIn('sweep-temperature'), 1)[5]).not.toContain('-');
  });

  it('never changes the wall being edited', () => {
    const before = JSON.stringify(editor.getDraft());
    typeCmp('cmp-thicknesses', '10 20 30');
    chooseValue(document.getElementById('cmp-swap-layer') as HTMLSelectElement, '0');
    typeCmp('cmp-temperatures', '-20');
    expect(JSON.stringify(editor.getDraft())).toBe(before);
    expect(editor.getResult().ok).toBe(true);
  });

  it('while the editor has errors it compares the last valid wall and says so', () => {
    type('width', '-1');
    tab('compare');
    expect(text('#panel-compare .stale-note')).toContain('last valid wall');
    expect(rowsIn('sweep-thickness')).toHaveLength(4);
  });
});
