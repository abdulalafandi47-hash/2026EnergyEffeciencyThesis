/**
 * Real-browser check of the BUILDING ENVELOPE workspace (Chromium, driven by Playwright).
 *
 * The automated tests in tests/ use a fake 3D viewer, so this script opens the
 * production build in a real browser with software WebGL and checks: the
 * workspace switch, the share of the screen used by the 3D view, the example
 * house being drawn, clicking an element in 3D to select it, the camera views,
 * the heat-flux colours, hiding an element, entering a documented window
 * U-value, phone width, an accessibility scan (axe-core) and console errors.
 * Screenshots are saved.
 *
 * Pictures are compared with a TOLERANCE (a pixel counts as different only if
 * a colour channel differs by more than 24/255), because software rendering is
 * not bit-for-bit repeatable.
 *
 * Playwright and axe-core are NOT project dependencies. To run this yourself:
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm install --no-save playwright axe-core && npx playwright install chromium
 *   AXE=node_modules/axe-core/axe.min.js OUT=./browser-check-output node validation/browser-building.cjs
 *
 * Results describe Chromium only; Firefox and Safari were not tested.
 */
const { chromium } = require('playwright');
const OUT = process.env.OUT || './browser-check-output';
const URL = process.env.URL || 'http://localhost:4173/';
const AXE = process.env.AXE || '';
require('fs').mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const failed = [];
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failed.push(label);
};

/** Fraction of pixels that differ noticeably between two PNG buffers (computed inside the page). */
async function diff(page, a, b) {
  return page.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return 1;
    const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const da = read(ia), db = read(ib);
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) n++;
    return n / (da.length / 4);
  }, [a.toString('base64'), b.toString('base64')]);
}

async function axeScan(page, label) {
  if (!AXE) return null;
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'], iframes: false })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(' ') })));
  for (const v of violations) console.log(`      axe ${label}: [${v.impact}] ${v.id} ×${v.nodes} (${v.target})`);
  return violations;
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));

  // ---- switch ----------------------------------------------------------------------------------
  await page.goto(URL);
  await page.waitForSelector('[data-workspace="wall"] .viewer-canvas');
  check('opens on the single-wall calculator', (await page.textContent('[data-workspace="wall"] h1')) === 'Wall Thermal Simulator');
  await page.click('[data-workspace="wall"] [data-mode="building"]');
  await page.waitForSelector('[data-workspace="building"] .viewer-canvas');
  check('switch opens the building workspace', await page.isVisible('[data-workspace="building"] h1'));
  check('address remembers the workspace (#building)', new globalThis.URL(page.url()).hash === '#building');
  const B = '[data-workspace="building"] ';
  const canvas = B + '.viewer-canvas';

  // ---- 3D share of the screen ------------------------------------------------------------------
  const share = await page.evaluate(() => {
    const r = document.querySelector('#house-viewer').getBoundingClientRect();
    return { w: r.width / innerWidth, area: (r.width * r.height) / (innerWidth * innerHeight) };
  });
  check('3D viewport takes at least 70 % of the screen width (target 70–80 %; up to 85 % accepted)', share.w >= 0.7 && share.w <= 0.85, `width ${(share.w * 100).toFixed(1)} %, area ${(share.area * 100).toFixed(1)} %`);

  // ---- example house ---------------------------------------------------------------------------
  const blank = await page.locator(canvas).screenshot();
  await page.click(B + '[data-role="b-example"]');
  await page.waitForTimeout(400);
  const example = await page.locator(canvas).screenshot();
  await page.screenshot({ path: `${OUT}/building-example.png` });
  check('example house is drawn (picture changes)', (await diff(page, blank, example)) > 0.05);
  check('example is labelled illustrative', (await page.isVisible(B + '[data-role="b-example-note"]')) && /illustrative/i.test(await page.textContent(B + '[data-role="b-example-note"]')));
  const rows = await page.locator(B + '[data-role="envelope-table"] tbody tr').count();
  check('results table lists all 14 elements', rows === 14, `${rows} rows`);

  // ---- picking in 3D ---------------------------------------------------------------------------
  await page.click(B + 'button[aria-label="South elevation"]');
  await page.waitForTimeout(300);
  const box = await page.locator(canvas).boundingBox();
  // The south elevation is centred; a point a little left of the middle at mid-height is on the south wall or one of its openings.
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  const pickedName = await page.inputValue(B + '#b-name').catch(() => '');
  check('clicking the house in 3D selects an element of the south facade', /south/i.test(pickedName), `selected "${pickedName}"`);
  await page.screenshot({ path: `${OUT}/building-selected.png` });

  // ---- views -----------------------------------------------------------------------------------
  const pics = {};
  for (const [label, file] of [['Plan view from above (north at the top)', 'plan'], ['North elevation', 'north'], ['3D view from the north-west', 'iso-nw'], ['3D view from the south-east', 'iso-se']]) {
    await page.click(`${B}button[aria-label="${label}"]`);
    await page.waitForTimeout(300);
    pics[file] = await page.locator(canvas).screenshot();
    await page.locator(canvas).screenshot({ path: `${OUT}/building-view-${file}.png` });
  }
  check('plan, north and NW views each show a different picture', (await diff(page, pics.plan, pics.north)) > 0.05 && (await diff(page, pics.north, pics['iso-nw'])) > 0.05);

  // ---- heat-flux colours -----------------------------------------------------------------------
  await page.selectOption(B + '#h-colour', 'flux');
  await page.waitForTimeout(300);
  const flux = await page.locator(canvas).screenshot();
  await page.screenshot({ path: `${OUT}/building-flux.png` });
  check('heat-flux colour mode recolours the house and shows a legend', (await diff(page, pics['iso-se'], flux)) > 0.02 && (await page.isVisible(B + '[data-role="flux-legend"]')));
  await page.selectOption(B + '#h-colour', 'type');

  // ---- hide / show -----------------------------------------------------------------------------
  await page.waitForTimeout(200);
  const withRoof = await page.locator(canvas).screenshot();
  await page.uncheck(B + '[data-component="c5"] input[type="checkbox"]');
  await page.waitForTimeout(300);
  const noRoof = await page.locator(canvas).screenshot();
  await page.screenshot({ path: `${OUT}/building-no-roof.png` });
  check('hiding the roof changes the picture (inside visible)', (await diff(page, withRoof, noRoof)) > 0.02);
  check('the hidden roof is still calculated', /Calculated/.test(await page.textContent(B + '[data-role="envelope-table"] tr[data-component="c5"]')));
  await page.check(B + '[data-component="c5"] input[type="checkbox"]');

  // ---- documented window U-value, typed for real ----------------------------------------------
  await page.click(B + '[data-role="envelope-table"] tr[data-component="c8"] button');
  await page.locator(B + '#b-u-value').pressSequentially('1.8');
  await page.locator(B + '#b-u-source').pressSequentially('Manufacturer datasheet (browser check)');
  const status = await page.textContent(B + '[data-role="envelope-table"] tr[data-component="c8"] .status');
  check('window with a documented U-value and source becomes calculated', status === 'Calculated', status);
  check('typing was not interrupted', (await page.inputValue(B + '#b-u-source')) === 'Manufacturer datasheet (browser check)' && (await page.inputValue(B + '#b-u-value')) === '1.8');

  // ---- accessibility ---------------------------------------------------------------------------
  const v = await axeScan(page, 'building workspace');
  if (v) check('axe: no violations in the building workspace', v.length === 0, `${v.length} rule(s)`);

  // ---- phone width -----------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await page.screenshot({ path: `${OUT}/building-phone.png` });
  check('phone width: no sideways page scrolling', overflow <= 1, `${overflow}px`);

  // ---- back to the wall calculator -------------------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click(B + '[data-mode="wall"]');
  check('switching back shows the wall calculator', await page.isVisible('[data-workspace="wall"] h1'));

  check('no console errors or warnings', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} FAILED: ${failed.join('; ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
