/**
 * Real-browser check of reports and saved walls (Chromium, driven by Playwright).
 *
 * The automated tests in tests/ simulate a browser, so they cannot show that a
 * downloaded report really opens, lays out, prints to PDF and stays inert in a
 * real browser. This script does, using the production build:
 *
 *  - the Report tab and its sandboxed preview frame
 *  - real file downloads (HTML, Markdown, JSON, CSV, saved wall) and their content
 *  - the downloaded HTML report opened from disk: text, chart, no network access, no scripts
 *  - a PDF made from the report with the browser's print layout
 *  - hostile text typed into the title and notes
 *  - Save wall -> change the wall -> Open wall (and a refused bad file)
 *  - reports switched off while the editor has errors
 *  - phone width
 *
 * Playwright is NOT a project dependency. To run this yourself:
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm install --no-save playwright && npx playwright install chromium
 *   OUT=./browser-check-output node validation/browser-reports.cjs
 *
 * Results describe Chromium only; Firefox and Safari were not tested.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || './browser-check-output';
const URL = process.env.URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const failed = [];
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failed.push(label);
};
const MATERIALS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/materials/data/builtInMaterials.json'), 'utf8'));
const lambda = (id) => (MATERIALS.materials || MATERIALS).find((m) => m.id === id).lambdaWPerMK;

/** U of the starter wall by hand: R_si 0.13, R_se 0.04, layers 15/200/80/20 mm. */
function handU() {
  const r = 0.13 + 0.015 / lambda('gypsum-plaster') + 0.2 / lambda('clay-brick-solid') + 0.08 / lambda('eps-slab') + 0.02 / lambda('cement-plaster') + 0.04;
  return { r, u: 1 / r };
}

async function saveDownload(download, name) {
  const target = path.join(OUT, name);
  await download.saveAs(target);
  return { file: target, name: download.suggestedFilename(), text: fs.readFileSync(target, 'utf8') };
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.print = function () {
      try { window.top.__printCalls = (window.top.__printCalls || 0) + 1; window.top.__printedTitle = document.title; } catch (e) { /* cross-origin frame */ }
    };
  });
  const page = await context.newPage();
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  await page.goto(URL);
  await page.waitForSelector('canvas.viewer-canvas');

  // ---- the Report tab ------------------------------------------------------------------------------------
  await page.click('#tab-report');
  check('Report tab opens', await page.isVisible('#panel-report'));
  for (const name of ['html', 'markdown', 'json', 'csv']) check(`download button "${name}" enabled`, await page.isEnabled(`[data-role="report-download-${name}"]`));
  const frameElement = await page.$('[data-role="report-preview"]');
  check('preview frame is sandboxed without any permission', (await frameElement.getAttribute('sandbox')) === '');
  const frame = await frameElement.contentFrame();
  await frame.waitForSelector('h1');
  check('preview shows the report title', (await frame.textContent('h1')) === 'Wall thermal calculation report');
  check('preview starts with the "read first" warnings', (await frame.textContent('.banner')).includes('illustrative or unverified'));
  const chart = await frame.$('svg.chart');
  const box = chart && (await chart.boundingBox());
  check('preview draws the temperature chart', !!box && box.width > 300 && box.height > 100, box ? `${Math.round(box.width)}×${Math.round(box.height)} px` : '');
  check('chart has its own styling (profile line is red, not default black)', await frame.evaluate(() => getComputedStyle(document.querySelector('.profile-line')).stroke.includes('179')));
  const headings = await frame.$$eval('h2', (hs) => hs.map((h) => h.textContent));
  check('preview has all numbered sections in order', headings.filter((h) => /^\d+\./.test(h)).every((h, i) => h.startsWith(`${i + 1}.`)) && headings.length >= 11, headings.length + ' headings');
  await page.screenshot({ path: path.join(OUT, 'report-tab-desktop.png') });

  // ---- downloads ----------------------------------------------------------------------------------------
  const { u, r } = handU();
  const dl = async (role, name) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`[data-role="${role}"]`)]);
    return saveDownload(download, name);
  };
  const html = await dl('report-download-html', 'report.html');
  check('HTML download has a traceable name', /^wall-report-\d{8}-\d{6}-[0-9a-f]{8}\.html$/.test(html.name), html.name);
  const md = await dl('report-download-markdown', 'report.md');
  check('Markdown download', /\.md$/.test(md.name) && md.text.startsWith('# Wall thermal calculation report'));
  const jsonFile = await dl('report-download-json', 'report.json');
  const data = JSON.parse(jsonFile.text);
  check('JSON U-value equals the independent hand calculation (1e-9 relative)', Math.abs(data.data.result.uValueWPerM2K - u) / u < 1e-9, `${data.data.result.uValueWPerM2K} vs ${u}`);
  check('JSON R_total equals the hand calculation', Math.abs(data.data.result.resistance.totalM2KPerW - r) / r < 1e-9);
  const csv = await dl('report-download-csv', 'layers.csv');
  check('CSV has a header and four layer rows', csv.text.trim().split('\n').length === 5);
  check('file names share one fingerprint', [html.name, md.name, jsonFile.name, csv.name].map((n) => n.match(/-([0-9a-f]{8})\./)[1]).every((f, _, all) => f === all[0]) && data.fingerprint === html.name.match(/-([0-9a-f]{8})\./)[1]);
  await page.click('#tab-results');
  const uShown = Number(await page.textContent('[data-kpi="u-value"] .kpi-number'));
  check('number on screen equals the number in the file (4 significant digits)', Math.abs(uShown - data.data.result.uValueWPerM2K) < 5e-4, `${uShown}`);

  // ---- the downloaded report opened from disk -----------------------------------------------------------------
  const reportPage = await context.newPage();
  const requested = [];
  reportPage.on('request', (req) => requested.push(req.url()));
  const reportErrors = [];
  reportPage.on('console', (m) => ['error', 'warning'].includes(m.type()) && reportErrors.push(m.text()));
  await reportPage.goto('file://' + path.resolve(html.file));
  check('report opens from disk with its title', (await reportPage.title()) === 'Wall thermal calculation report');
  check('report makes no network requests', requested.every((u2) => u2.startsWith('file://') || u2.startsWith('data:')), requested.join(',') || 'none');
  check('report contains no script element', (await reportPage.$$('script')).length === 0);
  check('report chart is drawn', !!(await reportPage.$('svg.chart')) && (await (await reportPage.$('svg.chart')).boundingBox()).width > 300);
  check('report shows the engine input and fingerprint', (await reportPage.textContent('body')).includes(data.fingerprint) && (await reportPage.textContent('pre')).includes('"widthM": 3'));
  check('report prints "not a compliance check"', (await reportPage.textContent('.banner:last-of-type')).includes('not a compliance check'));
  check('no page errors opening the report', reportErrors.length === 0, reportErrors.join(' | '));
  await reportPage.screenshot({ path: path.join(OUT, 'report-opened.png'), fullPage: false });
  await reportPage.pdf({ path: path.join(OUT, 'report.pdf'), format: 'A4', printBackground: true });
  const pdf = fs.readFileSync(path.join(OUT, 'report.pdf'));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('browser print layout makes a PDF', pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 20000, `${pdf.length} bytes, ${pages} pages`);
  check('PDF has several A4 pages (not one giant page)', pages >= 3 && pages <= 12, `${pages} pages`);
  const wide = await reportPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('report page has no sideways scrolling at desktop width', !wide);
  await reportPage.setViewportSize({ width: 390, height: 800 });
  check('report stays readable at phone width (tables scroll inside their frame, page does not)', await reportPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  await reportPage.close();

  // ---- the Print button ----------------------------------------------------------------------------------------
  // Headless Chromium cannot show a print dialog, so window.print is replaced (in every frame, by the init script
  // above) with a function that records the call. This proves the button prints the REPORT, from a script-less frame.
  await page.click('#tab-report');
  await page.click('[data-role="report-print"]');
  await page.waitForFunction(() => window.__printCalls >= 1, null, { timeout: 5000 }).catch(() => {});
  check('Print button calls print() exactly once', (await page.evaluate(() => window.__printCalls)) === 1, String(await page.evaluate(() => window.__printCalls)));
  check('what is printed is the report, not the app', (await page.evaluate(() => window.__printedTitle)) === 'Wall thermal calculation report', await page.evaluate(() => window.__printedTitle));
  const msg = await page.textContent('[data-role="report-message"]');
  check('Print button says how to make a PDF', msg.includes('Save as PDF'), msg);
  check('the print frame is invisible (zero size, hidden from assistive technology)', await page.evaluate(() => [...document.querySelectorAll('iframe[aria-hidden="true"]')].every((f) => f.getBoundingClientRect().width === 0 && f.getAttribute('sandbox') === 'allow-modals allow-same-origin')));

  // ---- hostile title and notes ----------------------------------------------------------------------------------
  await page.fill('#report-title', '<script>window.__pwned=1</script> Wall "A" & <b>B</b>');
  await page.fill('#report-notes', '</main><img src=x onerror="window.__pwned=2"><svg onload="window.__pwned=3">');
  const hostile = await dl('report-download-html', 'hostile.html');
  const hostilePage = await context.newPage();
  await hostilePage.goto('file://' + path.resolve(hostile.file));
  await hostilePage.waitForTimeout(300);
  check('hostile text: nothing ran', (await hostilePage.evaluate(() => window.__pwned)) === undefined);
  check('hostile text: no script, image or extra svg-with-handler elements', (await hostilePage.$$('script, img, [onerror], [onload]')).length === 0);
  check('hostile text is shown literally', (await hostilePage.textContent('h1')).includes('<script>window.__pwned=1</script>'));
  await hostilePage.close();
  const hostileFrame = await (await page.$('[data-role="report-preview"]')).contentFrame();
  check('hostile text is inert in the preview too', (await hostileFrame.evaluate(() => window.__pwned)) === undefined && (await hostileFrame.$$('script, img')).length === 0);
  await page.fill('#report-title', '');
  await page.fill('#report-notes', '');

  // ---- comparisons -----------------------------------------------------------------------------------------------
  await page.check('#report-comparisons');
  const withComparisons = await dl('report-download-html', 'with-comparisons.html');
  check('comparisons appear when ticked', withComparisons.text.includes('6. Comparisons') && withComparisons.text.includes('Changing outside air temperature only'));
  await page.uncheck('#report-comparisons');

  // ---- save, change, open ---------------------------------------------------------------------------------------------
  const [saveDownload2] = await Promise.all([page.waitForEvent('download'), page.click('[data-role="save-wall"]')]);
  const saved = await saveDownload(saveDownload2, 'wall.json');
  check('saved wall has a dated name', /^wall-\d{8}-\d{6}\.json$/.test(saved.name), saved.name);
  check('saved wall holds the draft as typed', JSON.parse(saved.text).draft.widthText === '3');
  await page.fill('#f-width', '7');
  await page.selectOption('#f-layer-layer-3-material', 'xps-board');
  const changedU = await page.textContent('[data-kpi="u-value"] .kpi-number').catch(() => null);
  await page.setInputFiles('[data-role="open-wall-input"]', saved.file);
  await page.waitForFunction(() => document.querySelector('[data-role="file-message"]').textContent.startsWith('Opened'));
  check('opening restores the width', (await page.inputValue('#f-width')) === '3');
  check('opening restores the material', (await page.inputValue('#f-layer-layer-3-material')) === 'eps-slab');
  await page.click('#tab-results');
  const uAfter = Number(await page.textContent('[data-kpi="u-value"] .kpi-number'));
  check('opening restores the result', Math.abs(uAfter - u) < 5e-4, `${uAfter} vs ${u}`);
  void changedU;
  const badFile = path.join(OUT, 'not-a-wall.json');
  fs.writeFileSync(badFile, '{"hello": "world"}');
  await page.fill('#f-width', '4');
  await page.setInputFiles('[data-role="open-wall-input"]', badFile);
  await page.waitForFunction(() => document.querySelector('[data-role="file-message"]').textContent.startsWith('Could not open'));
  check('a refused file leaves the wall alone', (await page.inputValue('#f-width')) === '4' && (await page.getAttribute('[data-role="file-message"]', 'class')).includes('bad'));
  const bigFile = path.join(OUT, 'big.json');
  fs.writeFileSync(bigFile, 'x'.repeat(2_500_000));
  await page.setInputFiles('[data-role="open-wall-input"]', bigFile);
  await page.waitForFunction(() => document.querySelector('[data-role="file-message"]').textContent.includes('too large'));
  check('an oversized file is refused before reading', (await page.inputValue('#f-width')) === '4');
  await page.fill('#f-width', '3');

  // ---- errors switch reports off ------------------------------------------------------------------------------------------
  await page.fill('#f-width', '0');
  await page.click('#tab-report');
  check('reports are switched off while the editor has errors', (await page.isDisabled('[data-role="report-download-html"]')) && (await page.isDisabled('[data-role="report-print"]')));
  check('the reason is shown', (await page.textContent('[data-role="report-blocked"]')).includes('always describes the inputs shown in the sidebar'));
  await page.fill('#f-width', '3');
  check('and back on when the error is fixed', await page.isEnabled('[data-role="report-download-html"]'));

  // ---- phone width --------------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-report');
  check('phone: no sideways page scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  const button = await page.$('[data-role="report-download-html"]');
  await button.scrollIntoViewIfNeeded();
  const bb = await button.boundingBox();
  check('phone: download buttons are visible and inside the screen', bb && bb.x >= 0 && bb.x + bb.width <= 392, bb ? JSON.stringify(bb) : '');
  const pf = await (await page.$('[data-role="report-preview"]')).boundingBox();
  check('phone: preview is as wide as the screen content', pf && pf.width > 300 && pf.x + pf.width <= 392, pf ? Math.round(pf.width) + ' px' : '');
  await page.screenshot({ path: path.join(OUT, 'report-tab-phone.png'), fullPage: false });

  check('no console errors or warnings in the app', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed.length === 0 ? '\nAll checks passed.' : `\n${failed.length} check(s) FAILED:\n - ${failed.join('\n - ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
