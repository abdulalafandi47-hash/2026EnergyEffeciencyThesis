/**
 * Whole-application check in a real browser (Stage 8). Chromium, driven by Playwright.
 *
 * Unlike the other two scripts, this one serves the production build from a
 * SUB-FOLDER, the way GitHub Pages does (https://<user>.github.io/<repository>/),
 * and goes through the application as one session:
 *
 *  A. loading: every file found, nothing fetched from other sites, no console errors
 *  B. a full workflow with real typing: custom material → wall → results (checked by
 *     hand calculation) → database export → report → save → reload page → open
 *  C. keyboard only: tab order reaches the main controls, focus is visible, tab list
 *     arrow keys, the custom-material form submitted with Enter, scrollable tables
 *  D. accessibility scan with axe-core on every tab, with errors on screen, at phone
 *     width, and of the downloaded report (automated rules only; a scan cannot judge everything)
 *  E. indicative speed and memory figures (software rendering; your computer differs)
 *  F. phone width
 *
 * Playwright and axe-core are NOT project dependencies. To run this yourself:
 *
 *   npm run build
 *   mkdir -p site && ln -s "$PWD/dist" site/2026EnergyEffeciencyThesis
 *   python3 -m http.server 4174 --directory site &
 *   npm install --no-save playwright axe-core && npx playwright install chromium
 *   AXE=node_modules/axe-core/axe.min.js OUT=./browser-check-output node validation/browser-e2e.cjs
 *
 * Results describe Chromium only; Firefox and Safari were not tested.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || './browser-check-output';
const URL = process.env.URL || 'http://localhost:4174/2026EnergyEffeciencyThesis/';
const AXE = process.env.AXE || '';
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'];
const failed = [];
const notes = [];
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failed.push(label);
};
const note = (label, value) => {
  console.log(`INFO  ${label}: ${value}`);
  notes.push(`${label}: ${value}`);
};

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/materials/data/builtInMaterials.json'), 'utf8'));
const lambda = (id) => (data.materials || data).find((m) => m.id === id).lambdaWPerMK;
const TABS = ['results', 'layers', 'profile', 'compare', 'materials', 'assumptions', 'report', 'configuration'];

async function axeScan(page, label) {
  if (!AXE) return null;
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'], iframes: false })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(' ') })));
  for (const v of violations) console.log(`      axe ${label}: [${v.impact}] ${v.id} ×${v.nodes} (${v.target})`);
  return violations;
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));

  // ---- A. loading from a sub-folder ------------------------------------------------------------------------
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForSelector('canvas.viewer-canvas');
  const loadMs = Date.now() - t0;
  check('app loads from a sub-folder address (as on GitHub Pages)', (await page.textContent('h1')) === 'Wall Thermal Simulator');
  check('every file it asks for is found (no 404)', responses.every((r) => r.status < 400), responses.filter((r) => r.status >= 400).map((r) => r.url).join(', '));
  const origin = new globalThis.URL(URL).origin;
  check('nothing is fetched from other sites', responses.every((r) => r.url.startsWith(origin) || r.url.startsWith('data:') || r.url.startsWith('blob:')), responses.filter((r) => !r.url.startsWith(origin)).map((r) => r.url).join(', '));
  note('time to a drawn 3D view (software rendering)', `${loadMs} ms`);

  // ---- B. a full workflow with real typing -------------------------------------------------------------------
  await page.click('[data-role="open-custom-material"]');
  check('"＋ Custom material…" opens the form with the cursor in the name field', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'cm-name');
  await page.keyboard.type('Datasheet board');
  await page.selectOption('#cm-category', 'Mineral wool');
  await page.fill('#cm-lambda', '0,034');
  await page.fill('#cm-density', '60');
  await page.fill('#cm-cp', '1030');
  await page.selectOption('#cm-valueType', 'declared');
  await page.fill('#cm-note', 'Hypothetical datasheet for this test, table 2');
  await page.fill('#cm-conditions', 'mean temperature 10 °C, dry');
  await page.click('[data-role="add-custom-material"]');
  check('custom material added', (await page.textContent('[data-role="custom-material-message"]')).startsWith('Added "Datasheet board" (user-defined)'));
  await page.selectOption('#f-layer-layer-3-material', 'custom-datasheet-board');
  await page.click('#tab-results');
  const rTotal = 0.13 + 0.015 / lambda('gypsum-plaster') + 0.2 / lambda('clay-brick-solid') + 0.08 / 0.034 + 0.02 / lambda('cement-plaster') + 0.04;
  const uShown = Number(await page.textContent('[data-kpi="u-value"] .kpi-number'));
  check('U-value with the custom material equals the hand calculation (4 significant digits)', Math.abs(uShown - 1 / rTotal) < 5e-4, `${uShown} vs ${(1 / rTotal).toFixed(6)}`);
  check('the headline still warns about illustrative data in the other layers', (await page.textContent('[data-role="headline"]')).includes('Illustrative or unverified data'));

  const download = async (selector, name) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
    const file = path.join(OUT, name);
    await d.saveAs(file);
    return { name: d.suggestedFilename(), file, text: fs.readFileSync(file, 'utf8') };
  };
  await page.click('#tab-materials');
  const db = await download('[data-role="export-materials-json"]', 'materials.json');
  const dbData = JSON.parse(db.text);
  check('database export holds the 9 built-in records and the custom one', dbData.count === 10 && dbData.materials.some((m) => m.id === 'custom-datasheet-board' && m.status === 'user-defined'), db.name);
  check('database export carries the "not a certified source" disclaimer', /NOT a certified source/.test(dbData.disclaimer));
  await page.click('#tab-report');
  const report = await download('[data-role="report-download-html"]', 'report.html');
  check('report names the custom material, its source and conditions', report.text.includes('User-entered: Hypothetical datasheet for this test, table 2') && report.text.includes('mean temperature 10 °C, dry'));
  check('report warns that user-defined values were not checked', report.text.includes('entered by the user (user-defined)'));
  const saved = await download('[data-role="save-wall"]', 'wall.json');
  check('saved wall contains the custom material', JSON.parse(saved.text).customMaterials.length === 1);

  await page.reload();
  await page.waitForSelector('canvas.viewer-canvas');
  check('after reloading the page, the custom material is gone (it lives only in the tab)', (await page.$('#f-layer-layer-3-material option[value="custom-datasheet-board"]')) === null);
  await page.setInputFiles('[data-role="open-wall-input"]', saved.file);
  await page.waitForFunction(() => document.querySelector('[data-role="file-message"]').textContent.startsWith('Opened'));
  check('opening the saved wall brings the custom material back', (await page.inputValue('#f-layer-layer-3-material')) === 'custom-datasheet-board');
  await page.click('#tab-results');
  check('…and the same U-value', Number(await page.textContent('[data-kpi="u-value"] .kpi-number')) === uShown);

  // ---- C. keyboard only -----------------------------------------------------------------------------------------
  await page.reload();
  await page.waitForSelector('canvas.viewer-canvas');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const reached = [];
  let outlineOk = true;
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const style = getComputedStyle(a);
      return { id: a.id, role: a.dataset.role || '', text: (a.textContent || '').trim().slice(0, 30), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    if (!info) continue;
    reached.push(info);
    if (info.outline === 'none' || !(info.width > 0)) outlineOk = false;
  }
  const has = (pred) => reached.some(pred);
  check('Tab reaches the sidebar toggle, Save, Open and the first inputs', has((r) => r.role === 'sidebar-toggle') && has((r) => r.role === 'save-wall') && has((r) => r.role === 'open-wall') && has((r) => r.id === 'f-width'), `${reached.length} stops`);
  check('every element reached by Tab shows a visible focus outline', outlineOk);
  await page.focus('#tab-results');
  await page.keyboard.press('ArrowRight');
  check('arrow keys move along the results tabs', (await page.getAttribute('#tab-layers', 'aria-selected')) === 'true');
  await page.keyboard.press('End');
  check('End jumps to the last tab', (await page.getAttribute('#tab-configuration', 'aria-selected')) === 'true');
  await page.keyboard.press('Home');
  check('Home jumps to the first tab', (await page.getAttribute('#tab-results', 'aria-selected')) === 'true');
  await page.click('#tab-materials');
  await page.focus('#cm-name');
  await page.keyboard.type('Keyboard board');
  await page.focus('#cm-lambda');
  await page.keyboard.type('0.04');
  await page.keyboard.press('Enter');
  check('the custom-material form can be submitted with Enter', (await page.textContent('[data-role="custom-material-message"]')).startsWith('Added "Keyboard board"'));
  await page.focus('[data-role="material-table-host"]');
  const scrollable = await page.evaluate(() => { const e = document.querySelector('[data-role="material-table-host"]'); return e.scrollWidth > e.clientWidth; });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400); // Chromium scrolls smoothly; read the position after it settles
  const scrolled = await page.evaluate(() => document.querySelector('[data-role="material-table-host"]').scrollLeft);
  check('a wide table can be scrolled with the keyboard', !scrollable || scrolled > 0, scrollable ? `scrolled ${scrolled}px` : 'not scrollable at this width');

  // ---- D. accessibility scan -------------------------------------------------------------------------------------
  if (AXE) {
    const found = [];
    for (const tab of TABS) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(150);
      found.push(...(await axeScan(page, `desktop/${tab}`)));
    }
    await page.fill('#f-width', '0');
    found.push(...(await axeScan(page, 'with an input error')));
    await page.fill('#f-width', '3');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of TABS) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(150);
      found.push(...(await axeScan(page, `phone/${tab}`)));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // The report preview frame is skipped above (it is sealed off on purpose); scan the downloaded report itself.
    // The report forbids all scripts (its Content-Security-Policy), so the scanner is injected with that rule bypassed.
    const scanContext = await browser.newContext({ bypassCSP: true });
    const reportPage = await scanContext.newPage();
    await reportPage.goto('file://' + path.resolve(report.file));
    found.push(...(await axeScan(reportPage, 'downloaded report')));
    await scanContext.close();
    const serious = found.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('axe-core: no serious or critical accessibility violations (18 scans incl. the report)', serious.length === 0, serious.map((v) => v.id).join(', '));
    const minor = [...new Set(found.filter((v) => v.impact === 'minor' || v.impact === 'moderate').map((v) => v.id))];
    note('axe-core minor/moderate findings', minor.length === 0 ? 'none' : minor.join(', '));
  } else {
    note('axe-core scan', 'skipped (set AXE=path/to/axe.min.js)');
  }

  // ---- E. speed and memory (indicative) ------------------------------------------------------------------------------
  await page.click('#tab-results');
  const editMs = await page.evaluate(async () => {
    const input = document.getElementById('f-layer-layer-3-thickness');
    const t = performance.now();
    for (let i = 0; i < 50; i++) {
      input.value = String(60 + i);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return (performance.now() - t) / 50;
  });
  note('time per edit (recalculate + redraw the results; 50 edits)', `${editMs.toFixed(1)} ms`);
  check('an edit updates the results in well under a second', editMs < 500, `${editMs.toFixed(1)} ms`);
  const heap = async () => page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : null; });
  const before = await heap();
  for (let round = 0; round < 6; round++) {
    for (const tab of TABS) await page.click(`#tab-${tab}`);
    await page.evaluate(() => {
      const input = document.getElementById('f-layer-layer-3-thickness');
      for (let i = 0; i < 40; i++) { input.value = String(40 + i); input.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  }
  const after = await heap();
  if (before !== null && after !== null) {
    const growthMb = (after - before) / 1e6;
    note('memory growth after 48 tab switches and 240 edits', `${growthMb.toFixed(1)} MB (heap ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB)`);
    check('no runaway memory growth (< 25 MB)', growthMb < 25, `${growthMb.toFixed(1)} MB`);
  }

  // ---- F. phone width ----------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-materials');
  check('phone: Materials tab causes no sideways page scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  const nameBox = await (await page.$('#cm-name')).boundingBox();
  check('phone: the form fits the screen', nameBox && nameBox.x >= 0 && nameBox.x + nameBox.width <= 392, nameBox ? `${Math.round(nameBox.width)} px wide` : '');
  await page.screenshot({ path: path.join(OUT, 'materials-phone.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('[data-role="enlarge"]');
  await page.click('#tab-materials');
  await page.screenshot({ path: path.join(OUT, 'materials-desktop.png') });

  check('no console errors or warnings during the whole session', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed.length === 0 ? '\nAll checks passed.' : `\n${failed.length} check(s) FAILED:\n - ${failed.join('\n - ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
