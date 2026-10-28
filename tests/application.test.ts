// @vitest-environment happy-dom
/**
 * Whole-application tests (Stage 8).
 *
 * 1. One complete session, done the way a thesis user would: start from an empty
 *    wall, build it layer by layer, add a custom material, compare, make a report,
 *    save and reopen. Every number is checked against a hand calculation written
 *    here from the material values (not taken from the program).
 * 2. A stress run: extreme but legal walls (one layer, sixty layers, micrometre and
 *    ten-metre layers, zero temperature difference, absolute zero, zero surface
 *    resistances, …) are opened and every tab is drawn. Nothing may ever show
 *    "NaN", "Infinity" or "undefined", and the 3D viewer must only receive
 *    finite numbers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialDraft, layerField, serializeDraft } from '../src/editor';
import type { LayerDraft, WallDraft } from '../src/editor';
import { BUILT_IN_MATERIALS, createCustomMaterial } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import type { FileIo } from '../src/ui/io';
import { at, expectClose } from './helpers/helpers';
import { FIXED_TIME } from './helpers/report';
import { chooseValue, click, makeFake, type } from './helpers/ui';

interface Saved { filename: string; text: string }
let root: HTMLElement;
let editor: WallEditorHandle;
let fake: ReturnType<typeof makeFake>;
let downloads: Saved[] = [];
const io: FileIo = { download: (filename, _mime, text) => void downloads.push({ filename, text }), print: () => undefined, now: () => FIXED_TIME };

async function mount(): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  downloads = [];
  fake = makeFake();
  editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: fake.factory, io });
  await editor.ready;
}
afterEach(() => editor?.destroy());

const q = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
const role = <T extends HTMLElement>(name: string): T => q<T>(`[data-role="${name}"]`);
const kpi = (key: string): number => Number(q(`[data-kpi="${key}"] .kpi-number`).textContent);
const λ = (id: string): number => (BUILT_IN_MATERIALS.find((m) => m.id === id) as MaterialRecord).lambdaWPerMK;
const TABS = ['results', 'layers', 'profile', 'compare', 'materials', 'assumptions', 'report', 'configuration'];

describe('a complete session, as a thesis user would do it', () => {
  it('empty wall → build → custom material → compare → report → save → reopen, all matching hand calculations', async () => {
    await mount();

    // 1. Start from nothing: remove the four example layers.
    for (let i = 0; i < 4; i++) click(q('li.layer [aria-label^="Remove layer"]'));
    expect(editor.getDraft().layers).toEqual([]);
    expect(role('validity').textContent).toMatch(/problem/);
    expect(q('#summary').textContent).toContain('Add at least one layer.');

    // 2. Build: 3.5 × 2.7 m (typed with a decimal comma), inside 22 °C, outside 8 °C, 10 h.
    type('width', '3,5');
    type('height', '2,7');
    type('insideTemperature', '22');
    type('outsideTemperature', '8');
    type('duration', '10');
    const addLayer = (materialId: string, thickness: string, unit: 'mm' | 'cm' | 'm' = 'mm'): void => {
      click(q('button[data-focus-id="add-layer"]'));
      const key = editor.getDraft().layers.at(-1)?.key ?? '';
      chooseValue(q(`#f-layer-${key}-material`), materialId);
      if (unit !== 'mm') chooseValue(q(`li.layer[data-key="${key}"] select.unit`), unit);
      type(layerField(key, 'thickness'), thickness);
    };
    addLayer('gypsum-plaster', '12');
    addLayer('concrete-block-medium', '20', 'cm');
    // 3. A custom insulation with "datasheet" values (the program does not check them).
    const board = editor.addCustomMaterial({ name: 'Test board', category: 'Mineral wool', lambdaWPerMK: 0.034, densityKgPerM3: 60, specificHeatJPerKgK: 1030, valueType: 'declared', sourceNote: 'hypothetical test datasheet' });
    if (!board.ok) throw new Error('custom material refused');
    addLayer(board.material.id, '100');
    addLayer('cement-plaster', '0.02', 'm');
    expect(role('validity').textContent).toBe('✔ Valid wall');

    // Hand calculation (independent of the program's code).
    const R = [0.012 / λ('gypsum-plaster'), 0.2 / λ('concrete-block-medium'), 0.1 / 0.034, 0.02 / λ('cement-plaster')];
    const rTotal = 0.13 + R.reduce((a, b) => a + b, 0) + 0.04;
    const U = 1 / rTotal;
    const A = 3.5 * 2.7;
    const Q = U * A * 14;
    const q_ = 14 / rTotal;
    expectClose(kpi('u-value'), U, 5e-4);
    expectClose(kpi('r-total'), rTotal, 5e-4);
    expectClose(kpi('heat-transfer'), Q, 5e-4);
    expectClose(kpi('flux'), q_, 5e-4);
    expectClose(kpi('energy'), (Q * 10) / 1000, 5e-4);
    expect(role('direction').textContent).toBe('Direction: Outward · loss');

    // Temperatures at every interface: T = T_i − q·(R_si + Σ R up to that point).
    const expected = [22, 22 - q_ * 0.13];
    let cumulative = 0.13;
    for (const r of R) {
      cumulative += r;
      expected.push(22 - q_ * cumulative);
    }
    expected.push(8);
    click(q('#tab-profile'));
    const shown = [...root.querySelectorAll('[data-role="profile-table"] tbody tr td:nth-child(3)')].map((td) => Number(td.textContent));
    expect(shown).toHaveLength(expected.length);
    shown.forEach((t, i) => expect(Math.abs(t - (expected[i] as number)), `point ${i}`).toBeLessThan(5e-3));
    expectClose(at(expected, expected.length - 2), 8 + q_ * 0.04, 1e-9); // the outside surface, from the other side

    // 4. Compare the custom insulation at 40 / 80 / 120 mm.
    click(q('#tab-compare'));
    chooseValue(q('#cmp-layer'), '2');
    const input = q<HTMLInputElement>('#cmp-thicknesses');
    input.value = '40 80 120';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const us = [...root.querySelectorAll('[data-role="sweep-thickness"] tbody tr')].map((tr) => Number(tr.children[2]?.textContent));
    const uAt = (mm: number): number => 1 / (rTotal - R[2]! + mm / 1000 / 0.034);
    expect(us).toHaveLength(4);
    [U, uAt(40), uAt(80), uAt(120)].forEach((u, i) => expectClose(at(us, i), u, 5e-4));
    expect(us[1]! > us[2]! && us[2]! > us[3]!).toBe(true); // more insulation, lower U
    expect(us[1]! - us[2]!).toBeGreaterThan(us[2]! - us[3]!); // with diminishing returns

    // 5. The report agrees and states the data status.
    click(q('#tab-report'));
    click(role('report-download-json'));
    const report = JSON.parse(at(downloads, 0).text);
    expectClose(report.data.result.uValueWPerM2K, U, 1e-12);
    expect(report.data.engineInput.layers.map((l: { propertyStatus: string }) => l.propertyStatus)).toEqual(['illustrative', 'illustrative', 'user-defined', 'illustrative']);
    expect(report.banners.join(' ')).toMatch(/illustrative or unverified/);
    expect(report.banners.join(' ')).toMatch(/user-defined/);

    // 6. Save, reopen in a fresh program, get the same numbers.
    click(role('save-wall'));
    const saved = at(downloads, 1).text;
    const before = JSON.stringify(editor.getResult().wall);
    editor.destroy();
    await mount();
    expect(editor.openWallText(saved)).toEqual({ ok: true, warnings: [] });
    expect(JSON.stringify(editor.getResult().wall)).toBe(before);
    expectClose(kpi('u-value'), U, 5e-4);
  });
});

// ---------------------------------------------------------------------------
/** Every number inside a value, recursively. */
function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/** Text a person can see, with one known harmless phrase removed (a material's conditions say "… are undefined."). */
const visibleText = (): string => (root.textContent ?? '').replace(/are undefined/g, '');

function drawEveryTabAndCheck(label: string): void {
  for (const id of TABS) {
    click(q(`#tab-${id}`));
    const text = visibleText();
    expect(text, `${label}: tab ${id}`).not.toMatch(/NaN|Infinity|undefined/);
  }
  const preview = role<HTMLIFrameElement>('report-preview')?.getAttribute('srcdoc') ?? '';
  expect(preview.replace(/are undefined/g, ''), `${label}: report`).not.toMatch(/NaN|Infinity|undefined/);
  const viewer = fake.viewer();
  for (const n of numbersIn([viewer.layouts.at(-1), viewer.overlays.at(-1)])) expect(Number.isFinite(n), `${label}: 3D numbers`).toBe(true);
}

const layer = (n: number, materialId: string, thickness: string, unit: LayerDraft['thicknessUnit'] = 'mm'): LayerDraft => ({ key: `layer-${n}`, materialId, thicknessText: thickness, thicknessUnit: unit });
function wall(overrides: Partial<WallDraft>, layers?: LayerDraft[]): WallDraft {
  const base = createInitialDraft(BUILT_IN_MATERIALS);
  const ls = layers ?? base.layers;
  const highest = Math.max(0, ...ls.map((l) => Number(l.key.slice(6))));
  return { ...base, ...overrides, layers: ls, nextLayerNumber: highest + 1 };
}

describe('stress: extreme but legal walls never show NaN, Infinity or undefined', () => {
  const extreme = createCustomMaterial({ name: 'Extreme', lambdaWPerMK: 1000 }).material;
  const superInsulator = createCustomMaterial({ name: 'Near vacuum', lambdaWPerMK: 0.001, densityKgPerM3: 5, specificHeatJPerKgK: 1000 }).material;
  const noDensity = createCustomMaterial({ name: 'No density', lambdaWPerMK: 0.05 }).material;
  const customs = [extreme, superInsulator, noDensity];
  const ids = BUILT_IN_MATERIALS.map((m) => m.id);

  const cases: Array<[string, WallDraft, (e: WallEditorHandle) => void]> = [
    ['no temperature difference', wall({ insideTemperatureText: '20', outsideTemperatureText: '20' }), (e) => {
      expect(e.getResult().ok).toBe(true);
      expect(kpi('heat-transfer')).toBe(0);
      expect(role('direction').textContent).toBe('Direction: None');
      const overlay = fake.viewer().overlays.at(-1);
      expect(overlay?.minC).toBe(overlay?.maxC);
    }],
    ['heat gain (outside hotter)', wall({ insideTemperatureText: '24', outsideTemperatureText: '40' }), () => expect(role('direction').textContent).toBe('Direction: Inward · gain')],
    ['zero duration', wall({ durationText: '0' }), () => expect(kpi('energy')).toBe(0)],
    ['inside air at absolute zero', wall({ insideTemperatureText: '-273,15' }), (e) => expect(e.getResult().ok).toBe(true)],
    ['kelvin, 0 K inside', wall({ temperatureUnit: 'K', insideTemperatureText: '0', outsideTemperatureText: '300' }), (e) => expect(e.getResult().ok).toBe(true)],
    ['very hot', wall({ insideTemperatureText: '1000', outsideTemperatureText: '-50' }), (e) => expect(e.getResult().ok).toBe(true)],
    ['single layer', wall({}, [layer(1, 'concrete-normal-weight', '200')]), (e) => expect(e.getResult().wall?.layers).toHaveLength(1)],
    ['sixty layers', wall({}, Array.from({ length: 60 }, (_, i) => layer(i + 1, ids[i % ids.length] as string, '5'))), (e) => {
      expect(e.getResult().wall?.layers).toHaveLength(60);
      const layout = fake.viewer().layouts.at(-1);
      expect(layout?.layers).toHaveLength(60); // all sixty are drawn
      expectClose(layout?.totalThicknessM ?? 0, 0.3, 1e-12);
    }],
    ['micrometre layer next to a 10 m layer', wall({}, [layer(1, 'gypsum-plaster', '0.001'), layer(2, 'concrete-normal-weight', '10', 'm')]), (e) => expect(e.getResult().ok).toBe(true)],
    ['tiny and huge wall', wall({ widthText: '0.01', heightText: '1000' }), (e) => expect(e.getResult().ok).toBe(true)],
    ['zero surface resistances', wall({ surfaceMode: 'custom', surfaceInsideText: '0', surfaceOutsideText: '0' }), () => {
      click(q('#tab-profile'));
      const temps = [...root.querySelectorAll('[data-role="profile-table"] tbody tr td:nth-child(3)')].map((td) => Number(td.textContent));
      expect(temps[1]).toBe(temps[0]); // surface = air when R_si = 0
      expect(temps.at(-2)).toBe(temps.at(-1));
    }],
    ['extreme conductivities (custom)', wall({}, [layer(1, extreme.id, '100'), layer(2, superInsulator.id, '100')]), (e) => expect(e.getResult().ok).toBe(true)],
    ['heat capacity unavailable', wall({}, [layer(1, noDensity.id, '100'), layer(2, 'eps-slab', '80')]), () => expect(q('[data-kpi="heat-capacity"] .kpi-number').textContent).toBe('Unavailable')],
    ['many digits', wall({ widthText: '3.123456789012345', heightText: '2.000000000000001' }), (e) => expect(e.getResult().ok).toBe(true)],
  ];

  for (const [label, draft, extra] of cases) {
    it(label, async () => {
      await mount();
      const outcome = editor.openWallText(serializeDraft(draft, [...BUILT_IN_MATERIALS, ...customs], customs));
      expect(outcome.ok, label).toBe(true);
      expect(editor.getResult().ok, `${label}: ${editor.getResult().errors.map((x) => x.message).join('; ')}`).toBe(true);
      drawEveryTabAndCheck(label);
      click(q('#tab-results'));
      extra(editor);
    });
  }

  it('invalid walls (errors) also never show NaN and keep the last valid results', async () => {
    await mount();
    const uBefore = kpi('u-value');
    for (const bad of [wall({ widthText: '0' }), wall({ insideTemperatureText: '-300' }), wall({}, []), wall({}, [layer(1, 'eps-slab', 'abc')]), wall({ durationText: '-1' }), wall({}, [layer(1, 'unknown-material', '10')])]) {
      editor.openWallText(serializeDraft(bad, BUILT_IN_MATERIALS));
      expect(editor.getResult().ok).toBe(false);
      drawEveryTabAndCheck('invalid wall');
      click(q('#tab-results'));
      expect(kpi('u-value')).toBe(uBefore); // still the last valid wall
      expect(q('.stale-note').textContent).toMatch(/last valid wall/);
    }
  });

  it('50 seeded random walls: the screen always matches an independent calculation of U', async () => {
    await mount();
    let seed = 8;
    const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const units: Array<LayerDraft['thicknessUnit']> = ['mm', 'cm', 'm'];
    const factor = { mm: 1e-3, cm: 1e-2, m: 1 };
    for (let n = 0; n < 50; n++) {
      const count = 1 + Math.floor(random() * 8);
      const layers = Array.from({ length: count }, (_, i) => {
        const unit = units[Math.floor(random() * 3)] as LayerDraft['thicknessUnit'];
        const metres = 0.001 + random() * 0.3;
        return layer(i + 1, ids[Math.floor(random() * ids.length)] as string, String(Number((metres / factor[unit]).toPrecision(6))), unit);
      });
      const draft = wall({ insideTemperatureText: String(Math.round(random() * 40 - 5)), outsideTemperatureText: String(Math.round(random() * 60 - 20)) }, layers);
      expect(editor.openWallText(serializeDraft(draft, BUILT_IN_MATERIALS)).ok).toBe(true);
      const rTotal = 0.17 + layers.reduce((sum, l) => sum + (Number(l.thicknessText) * factor[l.thicknessUnit]) / λ(l.materialId as string), 0);
      click(q('#tab-results'));
      expectClose(kpi('u-value'), 1 / rTotal, 5e-4);
      expect(visibleText()).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
