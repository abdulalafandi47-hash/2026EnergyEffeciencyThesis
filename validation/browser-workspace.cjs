/**
 * Real-browser check of the built app (Chromium, driven by Playwright).
 *
 * The automated tests in tests/ cannot run WebGL, so this script opens the
 * production build in a real browser and checks the workspace: layout and
 * sidebar, the 3D view (draws, clicking, exploded and camera views, keyboard,
 * mouse), the thermal overlay and heat-flow arrows, the results tabs and the
 * numbers they show, comparison tables, invalid-input behaviour, phone width,
 * dark theme and reduced motion. Screenshots are saved.
 *
 * Pictures are compared with a TOLERANCE (a pixel counts as different only if
 * a colour channel differs by more than 24/255), because software rendering is
 * not bit-for-bit repeatable.
 *
 * Playwright is NOT a project dependency (it is large). To run this yourself:
 *
 *   npm run build
 *   npx vite preview --port 4173 &            # serve the build
 *   npm install --no-save playwright && npx playwright install chromium
 *   OUT=./browser-check-output node validation/browser-workspace.cjs
 *
 * Software WebGL is used (works without a GPU). Results describe Chromium only;
 * Firefox and Safari were not tested.
 */
const { chromium } = require('playwright');
const OUT = process.env.OUT || './browser-check-output';
const URL = process.env.URL || 'http://localhost:4173/';
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
/** Counts pixels matching a colour test, inside the page. */
async function countPixels(page, buf, testSrc) {
  return page.evaluate(async ([b64, src]) => {
    const test = new Function('r', 'g', 'b', `return ${src}`);
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2])) n++;
    return n;
  }, [buf.toString('base64'), testSrc]);
}
const SAME = 0.002; // < 0.2 % of pixels changed = "the same picture"
const CHANGED = 0.004; // > 0.4 % = "a different picture"

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  await page.goto(URL);
  await page.waitForSelector('canvas.viewer-canvas');
  await page.waitForTimeout(1200);
  const stage = page.locator('.viewer-stage');
  const shot = () => stage.screenshot();
  const settle = (ms = 700) => page.waitForTimeout(ms);

  // ---------- layout ----------
  const g = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { col: r('.stage-column'), vp: r('#viewer'), stage: r('.viewer-stage'), sidebar: r('#sidebar'), results: r('#results'), top: r('.topbar') }; });
  check('dark theme by default', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 15, 20)'));
  check('3D viewport takes 70-80 % of the main column height', g.vp.height / g.col.height >= 0.7 && g.vp.height / g.col.height <= 0.82, `${(100 * g.vp.height / g.col.height).toFixed(0)} %`);
  check('3D picture alone is at least 60 % of the main column height', g.stage.height / g.col.height >= 0.6, `${(100 * g.stage.height / g.col.height).toFixed(0)} %`);
  check('sidebar is a compact left column (<= 380 px)', g.sidebar.width <= 380 && g.sidebar.left === 0);
  check('results panel is a compact bottom panel (<= 30 % of the height)', g.results.height / g.col.height <= 0.3, `${(100 * g.results.height / g.col.height).toFixed(0)} %`);
  check('page itself does not scroll (workspace fills the window)', await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));
  await page.screenshot({ path: OUT + '/workspace.png' });

  // sidebar collapse gives the viewport the full width
  await page.click('[data-role="sidebar-toggle"]');
  await settle(500);
  const wide = await stage.boundingBox();
  check('hiding the sidebar widens the 3D picture to the full window', wide.width >= 1430, `${Math.round(wide.width)} px`);
  await page.screenshot({ path: OUT + '/workspace-sidebar-hidden.png' });
  await page.click('[data-role="sidebar-toggle"]');
  await settle(500);
  check('showing the sidebar restores it', (await page.locator('#sidebar').boundingBox()).width > 300);

  // collapse the results panel
  await page.click('[data-role="collapse"]');
  await settle(400);
  const tall = await stage.boundingBox();
  check('collapsing the results panel gives the picture more height', tall.height > g.stage.height + 150, `${Math.round(tall.height)} px`);
  check('headline numbers stay visible when collapsed', (await page.locator('[data-role="headline"]').innerText()).includes('W/(m²·K)'));
  await page.click('[data-role="collapse"]');
  await settle(400);

  // ---------- 3D drawing and interaction ----------
  check('editor usable and 3D canvas present', (await page.locator('#sidebar li.layer').count()) === 4 && (await page.locator('canvas.viewer-canvas').count()) === 1);
  const aria = await page.getAttribute('canvas.viewer-canvas', 'aria-label');
  check('canvas has a text alternative listing layers and true thicknesses', aria.includes('4 layers') && aria.includes('80 mm') && aria.includes('not temperatures'));
  check('thickness exaggeration is disclosed on screen', (await page.locator('[data-role="scale-note"]').innerText()).includes('5× larger'));
  check('ground grid is on, with its spacing in the status bar', (await page.locator('[data-role="statusbar"]').innerText()).includes('Grid: 1 m'));
  const base = await shot();

  // thermal overlay: real colours on the canvas
  const warmOn = await countPixels(page, base, 'r > 150 && g < 90 && b < 100');
  const coldOn = await countPixels(page, base, 'b > 170 && r < 120');
  check('thermal overlay paints the wall: large warm (red) area and a cold (blue) edge', warmOn > 5000 && coldOn > 200, `warm ${warmOn}, cold ${coldOn}`);
  check('colour bar is shown with the calculated range', (await page.locator('[data-role="colorbar"]').innerText()).includes('calculated, steady state') && (await page.locator('.colorbar-scale').innerText()).replace(/\s/g, '') === '512.520');
  await page.uncheck('#v-thermal'); await settle(600);
  const plain = await shot();
  check('switching the overlay off changes the picture to material colours', (await diff(page, base, plain)) > CHANGED);
  const coldOff = await countPixels(page, plain, 'b > 170 && r < 120');
  check('without the overlay the cold-blue edge is gone', coldOff < coldOn / 3, `cold ${coldOff}`);
  check('colour bar hides with the overlay', await page.locator('[data-role="colorbar"]').isHidden());
  await page.check('#v-thermal'); await settle(600);

  // heat-flow arrows
  const arrowsAmber = (b) => countPixels(page, b, 'r > 235 && g > 140 && g < 190 && b > 40 && b < 120');
  const withArrows = await arrowsAmber(await shot());
  await page.uncheck('#v-arrows'); await settle(500);
  const noArrows = await arrowsAmber(await shot());
  check('heat-flow arrows draw (amber) and the switch removes them', withArrows > 800 && noArrows < withArrows / 4, `with ${withArrows}, without ${noArrows}`);
  await page.check('#v-arrows'); await settle(500);

  // grid
  const withGrid = await shot();
  await page.uncheck('#v-grid'); await settle(500);
  check('grid switch changes the picture and the status bar', (await diff(page, withGrid, await shot())) > 0.0005 && !(await page.locator('[data-role="statusbar"]').innerText()).includes('Grid:'));
  await page.check('#v-grid'); await settle(500);

  // selection
  let box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await settle(400);
  check('clicking a layer in 3D selects it in the list', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 1, (await page.locator('.legend-item[aria-pressed="true"]').innerText().catch(() => '')).replace(/\n/g, ' '));
  check('inspector shows its calculated temperatures', (await page.locator('.inspector').innerText()).includes('calculated, steady state'));
  check('selected layer card is highlighted in the sidebar', (await page.locator('#sidebar li.layer.selected').count()) === 1);
  check('selection changes the 3D picture', (await diff(page, base, await shot())) > CHANGED);
  await page.screenshot({ path: OUT + '/selected.png' });
  await page.locator('.legend-item[aria-pressed="true"]').click(); await settle(400);
  check('deselecting restores the picture', (await diff(page, base, await shot())) < SAME);
  await page.locator('.legend-item').nth(2).click();
  check('legend click selects layer 3', (await page.locator('#sidebar li.layer.selected .pos').innerText()) === 'Layer 3');
  await page.locator('[aria-label="Inspect layer 1 in the 3D view"]').click();
  check('card Inspect button switches selection', (await page.locator('.legend-item[aria-pressed="true"]').innerText()).includes('1. Gypsum'));
  await page.locator('[aria-label="Inspect layer 1 in the 3D view"]').click();
  check('Inspect toggles off', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);

  // exploded, views
  await page.check('#v-exploded'); await settle(1200);
  const exploded = await shot();
  check('exploded view changes the picture', (await diff(page, base, exploded)) > CHANGED);
  check('exploded note shown', (await page.locator('[data-role="scale-note"]').innerText()).includes('not air gaps'));
  await page.screenshot({ path: OUT + '/exploded.png' });
  await page.uncheck('#v-exploded'); await settle(1200);
  const views = {};
  for (const [name, label] of [['iso', 'Show the oblique 3D view'], ['interior', 'Look at the interior face'], ['exterior', 'Look at the exterior face'], ['section', 'Look at the cut edge, showing the layers side by side']]) {
    await page.locator(`button[aria-label="${label}"]`).click(); await settle(450); views[name] = await shot();
  }
  const names = Object.keys(views); let allDifferent = true;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if ((await diff(page, views[names[i]], views[names[j]])) < CHANGED) allDifferent = false;
  check('four camera views give four different pictures', allDifferent);
  await page.screenshot({ path: OUT + '/section.png' });
  await page.locator('button[aria-label="Reset to the 3D view"]').click(); await settle(450);
  check('Reset returns to the original view', (await diff(page, views.iso, await shot())) < SAME);

  // navigation: keyboard, mouse, zoom buttons, pan mode
  await page.focus('canvas.viewer-canvas');
  const before = await shot();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await settle(400);
  const rotated = await shot();
  check('arrow keys rotate the model', (await diff(page, before, rotated)) > CHANGED);
  await page.keyboard.press('+'); await settle(400);
  check('+ zooms', (await diff(page, rotated, await shot())) > CHANGED);
  await page.keyboard.press('Home'); await settle(400);
  check('Home resets the view', (await diff(page, views.iso, await shot())) < SAME);
  box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35 + 90, box.y + box.height * 0.5 + 10, { steps: 6 }); await page.mouse.up(); await settle(400);
  const dragged = await shot();
  check('mouse drag rotates and does not select a layer', (await diff(page, views.iso, dragged)) > CHANGED && (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);
  await page.mouse.wheel(0, -400); await settle(400);
  check('mouse wheel zooms', (await diff(page, dragged, await shot())) > CHANGED);
  await page.click('[aria-label="Reset to the 3D view"]'); await settle(450);
  await page.click('[aria-label="Zoom in"]'); await settle(400);
  const zoomedIn = await shot();
  check('Zoom in button zooms', (await diff(page, views.iso, zoomedIn)) > CHANGED);
  await page.click('[aria-label="Zoom out"]'); await page.click('[aria-label="Zoom out"]'); await settle(400);
  check('Zoom out button zooms out', (await diff(page, zoomedIn, await shot())) > CHANGED);
  await page.click('[aria-label="Reset to the 3D view"]'); await settle(450);
  await page.click('[aria-label="Pan mode: dragging moves the view"]');
  check('Pan mode is shown as active', (await page.getAttribute('[aria-label="Pan mode: dragging moves the view"]', 'aria-pressed')) === 'true' && (await page.locator('[data-role="statusbar"]').innerText()).includes('Mode: pan'));
  box = await stage.boundingBox();
  const panStart = await shot();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4 - 120, box.y + box.height * 0.6 - 20, { steps: 6 }); await page.mouse.up(); await settle(400);
  check('in Pan mode a drag moves the view (and still does not select)', (await diff(page, panStart, await shot())) > CHANGED && (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);
  await page.click('[aria-label="Orbit mode: dragging rotates the model"]');
  await page.click('[aria-label="Reset to the 3D view"]'); await settle(450);

  // ---------- results panel ----------
  check('results tabs present and Results selected', (await page.locator('[role="tab"]').count()) === 8 && (await page.getAttribute('#tab-results', 'aria-selected')) === 'true');
  const kpi = async (k) => (await page.locator(`[data-kpi="${k}"] .kpi-number`).innerText()).trim();
  const rTotal = 0.13 + 0.015 / 0.43 + 0.2 / 0.7 + 0.08 / 0.035 + 0.02 / 1 + 0.04;
  const fmt = (n) => String(Number(n.toPrecision(4)));
  check('U-value equals the hand calculation 1 / R_total', (await kpi('u-value')) === fmt(1 / rTotal), `${await kpi('u-value')} vs ${fmt(1 / rTotal)}`);
  check('R_total equals the hand calculation', (await kpi('r-total')) === fmt(rTotal));
  check('Q equals U·A·ΔT', (await kpi('heat-transfer')) === fmt((1 / rTotal) * 7.5 * 15));
  check('direction is shown in words', (await page.locator('[data-role="direction"]').innerText()).includes('Outward'));
  check('results state the basis and that it is not a dynamic simulation', (await page.locator('#panel-results .caption').innerText()).includes('Not a dynamic or whole-building simulation'));
  await page.screenshot({ path: OUT + '/results.png' });
  await page.keyboard.press('Tab'); // keyboard focus is somewhere sane
  await page.click('#tab-layers'); await settle(200);
  check('layer table has 6 rows (2 films + 4 layers)', (await page.locator('[data-role="layer-table"] tbody tr').count()) === 6);
  await page.click('#tab-profile'); await settle(200);
  check('profile chart draws 7 markers and a table of 7 points', (await page.locator('svg.profile-chart circle.marker').count()) === 7 && (await page.locator('[data-role="profile-table"] tbody tr').count()) === 7);
  await page.locator('#results').evaluate((e) => e.classList.add('enlarged')); await settle(300);
  await page.screenshot({ path: OUT + '/profile.png' });
  await page.click('#tab-compare'); await settle(300);
  check('compare: thickness sweep shows Current + 3 variants and a bar chart', (await page.locator('[data-role="sweep-thickness"] tbody tr').count()) === 4 && (await page.locator('[data-role="sweep-thickness"] svg.bar-chart').count()) === 1);
  await page.fill('#cmp-thicknesses', '40 abc'); await settle(200);
  check('compare: invalid list gives a clear error', (await page.locator('#cmp-thicknesses-msg').innerText()).includes('is not a number'));
  await page.fill('#cmp-thicknesses', '40 80 120'); await settle(200);
  await page.screenshot({ path: OUT + '/compare.png' });
  await page.locator('#results').evaluate((e) => e.classList.remove('enlarged'));
  await page.click('#tab-assumptions'); await settle(200);
  check('assumptions tab lists the engine assumptions and what this is not', (await page.locator('[data-role="engine-assumptions"] li').count()) >= 6 && (await page.locator('#panel-assumptions').innerText()).includes('Not a compliance check'));
  await page.click('#tab-configuration'); await settle(200);
  check('configuration tab shows the validity summary and engine input', (await page.locator('#summary .status.ok').count()) === 1 && (await page.locator('#summary pre').count()) === 1);
  await page.click('#tab-results');
  // keyboard on tabs
  await page.focus('#tab-results'); await page.keyboard.press('ArrowRight'); await settle(150);
  check('arrow keys switch tabs', (await page.getAttribute('#tab-layers', 'aria-selected')) === 'true');
  await page.click('#tab-results');

  // ---------- the model follows the editor ----------
  const t0 = await shot();
  const u0 = await kpi('u-value');
  await page.fill('#f-layer-layer-3-thickness', '160'); await settle(1300);
  check('changing a thickness changes the 3D model', (await diff(page, t0, await shot())) > CHANGED);
  check('...and the results (thicker insulation lowers U)', Number(await kpi('u-value')) < Number(u0));
  check('...and the legend shows the new TRUE thickness', (await page.locator('.legend-item').nth(2).innerText()).includes('160 mm'));
  await page.fill('#f-layer-layer-3-thickness', '80'); await settle(1300);
  await page.fill('#f-outsideTemperature', '35'); await settle(900);
  check('heat gain: direction flips to inward and the numbers stay positive', (await page.locator('[data-role="direction"]').innerText()).includes('Inward') && Number(await kpi('heat-transfer')) > 0);
  check('heat gain: colour bar range follows (20 to 35)', (await page.locator('.colorbar-scale').innerText()).replace(/\s/g, '') === '2027.535');
  await page.fill('#f-outsideTemperature', '5'); await settle(900);
  const order0 = await page.locator('.legend-text').allInnerTexts();
  await page.locator('[aria-label="Move layer 2 toward the exterior"]').click(); await settle(1000);
  const order1 = await page.locator('.legend-text').allInnerTexts();
  check('reordering a layer reorders the 3D legend and changes U? (it must not)', order0[1] !== order1[1] && (await kpi('u-value')) === u0);

  // ---------- invalid input ----------
  await page.click('[aria-label="Move layer 3 toward the interior"]'); await settle(1000); // restore order
  await settle(1200); // let any layout animation finish before taking the reference picture
  const valid = await shot();
  const validU = await kpi('u-value');
  await page.fill('#f-layer-layer-1-thickness', '-5'); await settle(600);
  check('invalid input: 3D notice says it shows the last valid wall', (await page.locator('.viewer-notice').innerText()).includes('last valid wall'));
  await page.locator('.viewer-notice').evaluate((e) => (e.style.visibility = 'hidden')); // the banner is drawn over the picture; compare the picture itself
  check('invalid input: 3D picture unchanged (no impossible geometry drawn)', (await diff(page, valid, await shot())) < SAME);
  await page.locator('.viewer-notice').evaluate((e) => (e.style.visibility = ''));
  check('invalid input: results keep the last valid numbers and are marked', (await kpi('u-value')) === validU && (await page.locator('#panel-results .stale-note').count()) === 1);
  check('invalid input: sidebar shows the problem count', (await page.locator('[data-role="validity"]').innerText()).includes('1 problem'));
  await page.screenshot({ path: OUT + '/invalid.png' });
  await page.fill('#f-layer-layer-1-thickness', '15'); await settle(600);
  check('fixing it clears the notice and the warning', (await page.locator('.viewer-notice.visible').count()) === 0 && (await page.locator('#panel-results .stale-note').count()) === 0);

  check('no console errors or warnings', errors.length === 0, errors.join(' | '));

  // ---------- phone width ----------
  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await phone.goto(URL);
  await phone.waitForSelector('canvas.viewer-canvas'); await phone.waitForTimeout(900);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 375 px', overflow <= 0, `overflow=${overflow}px`);
  const pv = await phone.locator('.viewer-stage').boundingBox();
  const sideTop = (await phone.locator('#sidebar').boundingBox()).y;
  check('phone: 3D view comes before the inputs, fits the width and is tall enough', pv.y < sideTop && pv.width <= 375 && pv.height >= 330, JSON.stringify(pv));
  check('phone: toolbar is one scrollable row (does not eat the picture)', (await phone.locator('.toolbar').boundingBox()).height < 60);
  check('phone: layer list starts folded so it does not cover the picture', (await phone.locator('#layer-panel-body').isHidden()));
  check('phone: results and inputs are reachable below', (await phone.locator('#results').count()) === 1 && (await phone.locator('#sidebar li.layer').count()) === 4);
  await phone.screenshot({ path: OUT + '/phone.png' });

  // ---------- tablet-ish and reduced motion ----------
  const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await rm.goto(URL); await rm.waitForSelector('canvas.viewer-canvas'); await rm.waitForTimeout(800);
  const rs = rm.locator('.viewer-stage');
  const r1 = await rs.screenshot();
  await rm.check('#v-exploded'); await rm.waitForTimeout(80);
  check('reduced motion: exploded view applies immediately (no animation)', (await diff(rm, r1, await rs.screenshot())) > CHANGED);

  await browser.close();
  console.log(failed.length ? `\n${failed.length} FAILED: ${failed.join('; ')}` : '\nALL BROWSER CHECKS PASSED');
  process.exit(failed.length ? 1 : 0);
})();
