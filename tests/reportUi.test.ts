// @vitest-environment happy-dom
/**
 * The Report tab and the Save / Open wall buttons, driven like a user would,
 * with a fake file system (downloads are recorded instead of saved).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialDraft, parseDraft } from '../src/editor';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import type { FileIo } from '../src/ui/io';
import { at } from './helpers/helpers';
import { click, makeFake, setChecked, type } from './helpers/ui';
import { FIXED_TIME } from './helpers/report';

interface Saved { filename: string; mime: string; text: string }
let root: HTMLElement;
let editor: WallEditorHandle;
let downloads: Saved[];
let prints: string[];

const io: FileIo = {
  download: (filename, mime, text) => void downloads.push({ filename, mime, text }),
  print: (html) => void prints.push(html),
  now: () => FIXED_TIME,
};

async function mount(): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  downloads = [];
  prints = [];
  editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: makeFake().factory, io });
  await editor.ready;
}
beforeEach(() => mount());
afterEach(() => editor.destroy());

const q = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
const role = <T extends HTMLElement>(name: string): T => q<T>(`[data-role="${name}"]`);
const openReportTab = (): void => click(q('#tab-report'));
const download = (format: string): Saved => {
  const before = downloads.length;
  click(role(`report-download-${format}`));
  expect(downloads.length, `${format} download`).toBe(before + 1);
  return downloads[before] as Saved;
};
const preview = (): string => role<HTMLIFrameElement>('report-preview').getAttribute('srcdoc') ?? '';

describe('the Report tab', () => {
  it('sits after "Assumptions & references" and offers every format', () => {
    const labels = [...root.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(labels.indexOf('Report')).toBe(labels.indexOf('Assumptions & references') + 1);
    openReportTab();
    expect(q('#panel-report').hidden).toBe(false);
    for (const name of ['html', 'markdown', 'json', 'csv']) expect(role<HTMLButtonElement>(`report-download-${name}`).disabled).toBe(false);
    expect(role<HTMLButtonElement>('report-print').disabled).toBe(false);
    expect(q('#report-title').getAttribute('placeholder')).toBe('Wall thermal calculation report');
  });

  it('shows the report in an inert preview frame (no scripts, no same-origin access)', () => {
    openReportTab();
    const frame = role<HTMLIFrameElement>('report-preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('title')).toBe('Report preview');
    expect(preview()).toMatch(/^<!doctype html>/);
    expect(preview()).toContain('Read first');
    expect(preview()).toContain('Calculated results (steady state)');
    expect(preview()).toContain('<svg'); // the temperature-profile chart
    expect(preview()).not.toMatch(/<script/i);
  });

  it('downloads the HTML report with a traceable file name', () => {
    openReportTab();
    const file = download('html');
    expect(file.filename).toMatch(/^wall-report-20261027-123045-[0-9a-f]{8}\.html$/);
    expect(file.mime).toBe('text/html');
    expect(file.text).toBe(preview()); // what you saw is what you get
    expect(file.text).toContain('<svg');
    expect(role('report-message').textContent).toContain(file.filename);
  });

  it('downloads Markdown, JSON and CSV that agree with the screen', () => {
    openReportTab();
    const md = download('markdown');
    expect(md.filename).toMatch(/\.md$/);
    expect(md.text.startsWith('# Wall thermal calculation report')).toBe(true);

    const json = download('json');
    expect(json.filename).toMatch(/\.json$/);
    expect(json.mime).toBe('application/json');
    const data = JSON.parse(json.text);
    expect(data.data.draft).toEqual(editor.getDraft());
    expect(data.data.engineInput).toEqual(JSON.parse(JSON.stringify(editor.getResult().wall)));
    const screenU = q('[data-kpi="u-value"] .kpi-number');
    click(q('#tab-results'));
    expect(Number(q('[data-kpi="u-value"] .kpi-number').textContent)).toBeCloseTo(data.data.result.uValueWPerM2K, 3);
    expect(screenU).not.toBeNull();

    const csv = download('csv');
    expect(csv.filename).toMatch(/\.csv$/);
    expect(csv.text.split('\n').filter(Boolean)).toHaveLength(5);
  });

  it('all downloads of one state share the same fingerprint, and a changed wall gets a different one', () => {
    openReportTab();
    const a = download('html').filename.split('-').pop();
    const b = download('markdown').filename.split('-').pop()?.replace('.md', '.html');
    expect(a).toBe(b);
    click(q('#tab-layers')); // (leave the tab to prove state is kept when it is re-opened)
    type('f-layer-layer-3-thickness'.replace('f-layer-layer-3-thickness', 'layer:layer-3:thickness'), '120');
    openReportTab();
    expect(download('html').filename.split('-').pop()).not.toBe(a);
  });

  it('uses the typed title and notes, in the preview and in the saved file, and escapes them', () => {
    openReportTab();
    const title = q<HTMLInputElement>('#report-title');
    title.value = 'Wall A <script>alert(1)</script>';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const notes = q<HTMLTextAreaElement>('#report-notes');
    notes.value = 'Checked by "me" & </main><img src=x onerror=alert(2)>';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    for (const html of [preview(), download('html').text]) {
      expect(html).toContain('<title>Wall A &lt;script&gt;alert(1)&lt;/script&gt;</title>');
      expect(html).toContain('Checked by &quot;me&quot; &amp; &lt;/main&gt;&lt;img');
      expect(html).not.toMatch(/<script|<img/i);
    }
    expect(download('markdown').text).toContain('Wall A');
  });

  it('keeps the title and notes when the wall is edited meanwhile', () => {
    openReportTab();
    const title = q<HTMLInputElement>('#report-title');
    title.value = 'Kept title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    type('width', '4');
    expect(q<HTMLInputElement>('#report-title').value).toBe('Kept title');
    expect(preview()).toContain('Kept title');
    expect(preview()).toContain('Wall area (derived)');
  });

  it('the report describes the wall as it is NOW in the editor (draft, wall and fingerprint all follow edits)', () => {
    type('width', '5');
    type('layer:layer-2:thickness', '17,5');
    openReportTab();
    const data = JSON.parse(download('json').text);
    expect(data.data.draft.widthText).toBe('5');
    expect(data.data.draft.layers[1].thicknessText).toBe('17,5');
    expect(data.data.draft).toEqual(editor.getDraft());
    expect(data.data.engineInput.widthM).toBe(5);
    expect(data.data.engineInput.layers[1].thicknessM).toBeCloseTo(0.0175, 12);
    const html = download('html').text;
    expect(html).toContain('<td>5 m</td>');
    expect(html).toContain('17,5 mm');
  });

  it('the preview follows edits to the wall', () => {
    openReportTab();
    const before = preview();
    type('width', '6');
    expect(preview()).not.toBe(before);
    expect(preview()).toContain('15 m²'); // 6 m × 2.5 m
  });

  it('comparisons are included only when asked, and follow the Compare tab settings', () => {
    openReportTab();
    expect(preview()).not.toContain('Comparisons</h2>');
    setChecked(q<HTMLInputElement>('#report-comparisons'), true);
    expect(preview()).toContain('6. Comparisons');
    expect(preview()).toContain('Changing thickness of layer 3 (Expanded polystyrene (EPS) slab (demonstration)) only');
    expect(preview()).toContain('Outside air temperature');

    click(q('#tab-compare'));
    const input = q<HTMLInputElement>('#cmp-thicknesses');
    input.value = '11 22';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    openReportTab();
    const json = JSON.parse(download('json').text);
    const sweep = json.data.comparisons.find((c: { title: string }) => c.title.startsWith('Thickness'));
    expect(sweep.variants.map((v: { label: string }) => v.label)).toEqual(['Current', '11 mm', '22 mm']);

    setChecked(q<HTMLInputElement>('#report-comparisons'), false);
    expect(JSON.parse(download('json').text).data.comparisons).toEqual([]);
  });

  it('an invalid comparison setting is left out instead of breaking the report', () => {
    click(q('#tab-compare'));
    const input = q<HTMLInputElement>('#cmp-thicknesses');
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    openReportTab();
    setChecked(q<HTMLInputElement>('#report-comparisons'), true);
    const titles = JSON.parse(download('json').text).data.comparisons.map((c: { title: string }) => c.title);
    expect(titles).toEqual(['Material of layer 3', 'Outside air temperature']);
  });

  it('is switched off while the editor has errors, and says why', () => {
    type('width', '0');
    openReportTab();
    for (const name of ['html', 'markdown', 'json', 'csv']) expect(role<HTMLButtonElement>(`report-download-${name}`).disabled).toBe(true);
    expect(role<HTMLButtonElement>('report-print').disabled).toBe(true);
    expect(role('report-blocked').textContent).toMatch(/always describes the inputs shown in the sidebar/);
    expect(preview()).not.toContain('Calculated results');
    expect(preview()).toContain('No report available');
    click(role('report-download-html'));
    click(role('report-print'));
    expect(downloads).toEqual([]);
    expect(prints).toEqual([]);

    type('width', '3');
    expect(role<HTMLButtonElement>('report-download-html').disabled).toBe(false);
    expect(preview()).toContain('Calculated results');
  });

  it('prints through the browser with the same document', () => {
    openReportTab();
    click(role('report-print'));
    expect(prints).toHaveLength(1);
    expect(at(prints, 0)).toBe(preview());
    expect(role('report-message').textContent).toMatch(/Save as PDF/);
  });

  it('never claims verified data: the first thing in every export is the warning', () => {
    openReportTab();
    expect(download('markdown').text.indexOf('Read first')).toBeLessThan(download('markdown').text.indexOf('## 1. Inputs'));
    expect(preview().indexOf('Read first')).toBeLessThan(preview().indexOf('<h2>1. Inputs</h2>'));
  });
});

describe('Save wall / Open wall', () => {
  const message = (): HTMLElement => role('file-message');

  it('saves the draft as a dated JSON file', () => {
    click(role('save-wall'));
    expect(downloads).toHaveLength(1);
    const file = at(downloads, 0);
    expect(file.filename).toBe('wall-20261027-123045.json');
    expect(file.mime).toBe('application/json');
    const parsed = parseDraft(file.text, BUILT_IN_MATERIALS);
    expect(parsed.ok && parsed.draft).toEqual(editor.getDraft());
    expect(message().textContent).toContain('wall-20261027-123045.json');
    expect(message().classList.contains('ok')).toBe(true);
  });

  it('can save a wall that has errors (work in progress), exactly as typed', () => {
    type('width', '3,');
    type('height', 'abc');
    click(role('save-wall'));
    const parsed = parseDraft(at(downloads, 0).text, BUILT_IN_MATERIALS);
    expect(parsed.ok && parsed.draft.widthText).toBe('3,');
    expect(parsed.ok && parsed.draft.heightText).toBe('abc');
  });

  it('saving then opening restores the inputs, the results and the 3D view', async () => {
    type('width', '5');
    type('layer:layer-2:thickness', '150');
    click(role('save-wall'));
    const saved = at(downloads, 0).text;
    const resultBefore = JSON.stringify(editor.getResult().wall);
    const draftBefore = editor.getDraft();

    click(q('button[data-focus-id="reset"]'));
    expect(editor.getDraft().widthText).toBe('3');
    expect(JSON.stringify(editor.getResult().wall)).not.toBe(resultBefore);

    const outcome = editor.openWallText(saved, 'wall.json');
    expect(outcome).toEqual({ ok: true, warnings: [] });
    expect(editor.getDraft()).toEqual(draftBefore);
    expect(JSON.stringify(editor.getResult().wall)).toBe(resultBefore);
    expect(q<HTMLInputElement>('#f-width').value).toBe('5');
    expect(q<HTMLInputElement>('#f-layer-layer-2-thickness').value).toBe('150');
    expect(message().textContent).toBe('Opened wall.json.');
    expect(q('[data-role="validity"]').textContent).toBe('✔ Valid wall');
    expect(Number(q('[data-kpi="u-value"] .kpi-number')?.textContent ?? 'x')).toBeGreaterThan(0);
  });

  it('a wall saved in one editor opens in another and gives identical results', async () => {
    type('layer:layer-3:thickness', '60');
    click(role('save-wall'));
    const resultA = JSON.stringify(editor.getResult().wall);
    const saved = at(downloads, 0).text;
    editor.destroy();
    await mount();
    expect(JSON.stringify(editor.getResult().wall)).not.toBe(resultA);
    expect(editor.openWallText(saved).ok).toBe(true);
    expect(JSON.stringify(editor.getResult().wall)).toBe(resultA);
  });

  it('refuses a bad file, says why, and leaves the current wall untouched', () => {
    type('width', '4');
    const before = editor.getDraft();
    for (const text of ['', 'not json', '{"schema":"other"}', '[]']) {
      const outcome = editor.openWallText(text, 'bad.json');
      expect(outcome.ok).toBe(false);
      expect(editor.getDraft()).toBe(before);
      expect(message().classList.contains('bad')).toBe(true);
      expect(message().textContent).toContain('Could not open bad.json');
      expect(message().textContent).toContain('The current wall was not changed');
    }
    expect(q<HTMLInputElement>('#f-width').value).toBe('4');
  });

  it('opens a wall that names an unknown material, warns, and shows the editor error for that layer', () => {
    const file = JSON.parse((click(role('save-wall')), at(downloads, 0).text));
    file.draft.layers[1].materialId = 'unobtainium';
    const outcome = editor.openWallText(JSON.stringify(file), 'x.json');
    expect(outcome.ok && outcome.warnings.join(' ')).toMatch(/unobtainium/);
    expect(message().classList.contains('warn')).toBe(true);
    expect(message().textContent).toMatch(/1 warning/);
    expect(editor.getResult().ok).toBe(false);
    expect(q('[data-role="validity"]').classList.contains('bad')).toBe(true);
  });

  it('opening replaces results: a previously valid wall that is replaced by an invalid one keeps the "last valid" behaviour', () => {
    const file = JSON.parse((click(role('save-wall')), at(downloads, 0).text));
    file.draft.widthText = '0';
    expect(editor.openWallText(JSON.stringify(file)).ok).toBe(true);
    expect(editor.getResult().ok).toBe(false);
    click(q('#tab-report'));
    expect(role<HTMLButtonElement>('report-download-html').disabled).toBe(true);
  });

  it('the Open button forwards a chosen file to the same code', async () => {
    type('width', '4.5');
    click(role('save-wall'));
    const text = at(downloads, 0).text;
    click(q('button[data-focus-id="reset"]'));
    const input = role<HTMLInputElement>('open-wall-input');
    const file = new File([text], 'mine.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.getDraft().widthText).toBe('4.5');
    expect(message().textContent).toBe('Opened mine.json.');
  });

  it('the initial draft is unchanged by merely mounting (guards the default wall)', () => {
    expect(editor.getDraft()).toEqual(createInitialDraft(BUILT_IN_MATERIALS));
  });
});
