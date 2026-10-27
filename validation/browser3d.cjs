/**
 * Real-browser check of the built app (Chromium, driven by Playwright).
 *
 * The automated tests in tests/ cannot run WebGL, so this script opens the
 * production build in a real browser and checks the 3D view: it draws, clicks
 * select layers, exploded and camera views change the picture, keyboard and
 * mouse work, invalid input keeps the last valid wall, phone width has no
 * sideways scrolling, dark mode and reduced motion work. Screenshots are saved.
 *
 * Playwright is NOT a project dependency (it is large). To run this yourself:
 *
 *   npm run build
 *   npx vite preview --port 4173 &            # serve the build
 *   npm install --no-save playwright && npx playwright install chromium
 *   OUT=./browser-check-output node validation/browser3d.cjs
 *
 * Software WebGL is used (works without a GPU). Results from this script
 * describe Chromium only; Firefox and Safari were not tested.
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const OUT = process.env.OUT || './browser-check-output';
require('fs').mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failed = [];
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed.push(label); };
const hash = (buf) => crypto.createHash('md5').update(buf).digest('hex');

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('canvas.viewer-canvas');
  await page.waitForTimeout(800);

  const stage = page.locator('.viewer-stage');
  const shot = async () => hash(await stage.screenshot());

  check('editor usable and 3D canvas present', (await page.locator('li.layer').count()) === 4 && (await page.locator('canvas.viewer-canvas').count()) === 1);
  const aria = await page.getAttribute('canvas.viewer-canvas', 'aria-label');
  check('canvas has a text alternative listing layers and true thicknesses', aria.includes('4 layers') && aria.includes('Gypsum plaster (demonstration), 15 mm') && aria.includes('Expanded polystyrene (EPS) slab (demonstration), 80 mm') && aria.includes('Colours identify material categories, not temperatures'), aria.slice(0, 90));
  check('default scale note is shown (5x)', (await page.locator('[data-role="scale-note"]').innerText()).includes('5× larger'));
  check('labels show TRUE thickness', (await page.locator('.viewer-label').first().innerText()).includes('mm'));
  const base = await shot();

  // --- click a layer in the 3D view (red brick band) ---
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.52);
  await page.waitForTimeout(300);
  const pressed = await page.locator('.legend-item[aria-pressed="true"]').count();
  const which = pressed ? await page.locator('.legend-item[aria-pressed="true"]').innerText() : '';
  check('clicking a layer in 3D selects it in the list', pressed === 1, which.replace(/\n/g, ' '));
  check('inspector shows the layer', (await page.locator('.inspector').innerText()).includes('Position'), (await page.locator('.inspector-title').innerText().catch(() => '')));
  check('selected layer card is highlighted in the editor', (await page.locator('li.layer.selected').count()) === 1);
  const selectedShot = await shot();
  check('3D picture changed on selection (others dimmed)', selectedShot !== base);
  await page.screenshot({ path: OUT + '/s5-selected.png' });

  // click empty space clears
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await page.waitForTimeout(200);
  check('clicking empty space clears selection', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);
  check('picture restored after clearing', (await shot()) === base);

  // --- legend selects too, and card Inspect button ---
  await page.locator('.legend-item').nth(2).click();
  check('legend click selects layer 3', (await page.locator('li.layer.selected .pos').innerText()) === 'Layer 3');
  await page.locator('button[aria-label="Inspect layer 1 in the 3D view"]').click();
  check('card Inspect button switches selection', (await page.locator('.legend-item[aria-pressed="true"]').innerText()).includes('1. Gypsum'));
  await page.locator('button[aria-label="Inspect layer 1 in the 3D view"]').click();
  check('Inspect toggles off', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);

  // --- exploded view ---
  await page.check('#v-exploded');
  await page.waitForTimeout(900); // animation
  const exploded = await shot();
  check('exploded view changes the picture', exploded !== base);
  check('exploded note shown', (await page.locator('[data-role="scale-note"]').innerText()).includes('not air gaps'));
  await page.locator('canvas.viewer-canvas').screenshot({ path: OUT + '/s5-exploded.png' });
  await page.locator('button[aria-label="Look at the cut edge, showing the layers side by side"]').click();
  await page.waitForTimeout(300);
  await stage.screenshot({ path: OUT + '/s5-exploded-section.png' });
  await page.uncheck('#v-exploded');
  await page.waitForTimeout(900);

  // --- camera views differ ---
  const views = {};
  for (const [name, label] of [['iso', 'Reset to the 3D view'], ['interior', 'Look at the interior face'], ['exterior', 'Look at the exterior face'], ['section', 'Look at the cut edge, showing the layers side by side']]) {
    await page.locator(`button[aria-label="${label}"]`).click();
    await page.waitForTimeout(250);
    views[name] = await shot();
  }
  check('four camera views give four different pictures', new Set(Object.values(views)).size === 4);
  await page.locator('button[aria-label="Look at the cut edge, showing the layers side by side"]').click();
  await page.waitForTimeout(300);
  await stage.screenshot({ path: OUT + '/s5-section.png' });
  await page.locator('button[aria-label="Reset to the 3D view"]').click();
  await page.waitForTimeout(250);
  check('reset returns to the original picture', (await shot()) === views.iso);

  // --- keyboard rotate & zoom ---
  await page.focus('canvas.viewer-canvas');
  const before = await shot();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const rotated = await shot();
  check('arrow keys rotate the model', rotated !== before);
  await page.keyboard.press('+');
  await page.waitForTimeout(250);
  check('+ zooms', (await shot()) !== rotated);
  await page.keyboard.press('Home');
  await page.waitForTimeout(250);
  check('Home resets the view', (await shot()) === views.iso);

  // --- mouse drag rotates, wheel zooms ---
  const dragBox = await stage.boundingBox(); // fresh: the sticky panel may have moved since earlier
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 80, dragBox.y + dragBox.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const dragged = await shot();
  check('mouse drag rotates (and does not select a layer)', dragged !== views.iso && (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(250);
  check('mouse wheel zooms', (await shot()) !== dragged);
  await page.locator('button[aria-label="Reset to the 3D view"]').click();

  // --- model follows the editor ---
  const t0 = await shot();
  await page.fill('#f-layer-layer-3-thickness', '160'); // EPS 80 -> 160 mm
  await page.waitForTimeout(900);
  const t1 = await shot();
  check('changing a thickness changes the 3D model', t1 !== t0);
  check('legend shows the new TRUE thickness', (await page.locator('.legend-item').nth(2).innerText()).includes('160 mm'));
  await page.fill('#f-width', '6');
  await page.waitForTimeout(900);
  check('changing the width changes the 3D model', (await shot()) !== t1);
  // reorder
  const order0 = await page.locator('.legend-text').allInnerTexts();
  await page.locator('[aria-label="Move layer 2 toward the exterior"]').click();
  await page.waitForTimeout(900);
  const order1 = await page.locator('.legend-text').allInnerTexts();
  check('reordering a layer reorders the legend', order0[1] !== order1[1] && order0[1].split(' — ')[0].slice(3) === order1[2].split(' — ')[0].slice(3));
  // remove and add
  await page.locator('[aria-label="Remove layer 4"]').click();
  await page.waitForTimeout(500);
  check('removing a layer removes it from the 3D list', (await page.locator('.legend-item').count()) === 3 && (await page.locator('.viewer-label').count()) === 3);
  await page.click('text=Add layer (exterior end)');
  await page.selectOption('#f-layer-layer-5-material', 'mineral-wool-slab');
  await page.fill('#f-layer-layer-5-thickness', '50');
  await page.waitForTimeout(600);
  check('adding a layer adds it to 3D', (await page.locator('.legend-item').count()) === 4 && (await page.locator('.viewer-label').count()) === 4);

  // --- invalid input: 3D keeps the last valid wall and says so ---
  await page.waitForTimeout(2500); // let any animation finish (software rendering is slow)
  const valid = await shot();
  await page.fill('#f-layer-layer-1-thickness', '-5');
  await page.waitForTimeout(500);
  check('invalid input: notice says 3D shows the last valid wall', (await page.locator('.viewer-notice').innerText()).includes('last valid wall'));
  check('invalid input: picture unchanged (no nonphysical geometry drawn)', (await shot()) === valid);
  check('invalid input: legend and inspector are kept (not wiped)', (await page.locator('.legend-item').count()) === 4);
  await page.screenshot({ path: OUT + '/s5-stale.png' });
  await page.fill('#f-layer-layer-1-thickness', '15');
  await page.waitForTimeout(500);
  check('fixing it clears the notice', (await page.locator('.viewer-notice.visible').count()) === 0);

  // --- selection survives edits, cleared when its layer is removed ---
  await page.locator('.legend-item').nth(1).click();
  await page.fill('#f-width', '5');
  await page.waitForTimeout(300);
  check('selection survives an edit', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 1);
  await page.locator('li.layer.selected [aria-label^="Remove layer"]').click();
  await page.waitForTimeout(300);
  check('selection cleared when its layer is removed', (await page.locator('.legend-item[aria-pressed="true"]').count()) === 0 && (await page.locator('li.layer.selected').count()) === 0);

  // --- labels toggle ---
  await page.uncheck('#v-labels');
  await page.waitForTimeout(300);
  const hiddenLabels = await page.locator('.viewer-label').evaluateAll((els) => els.every((e) => e.hidden));
  check('Show labels off hides layer labels but keeps the face markers', hiddenLabels && (await page.locator('.viewer-face:visible').count()) === 2);
  await page.check('#v-labels');

  // --- scale select ---
  await page.selectOption('#v-scale', '1');
  await page.waitForTimeout(900);
  check('true-proportions option removes the exaggeration note', (await page.locator('[data-role="scale-note"]').innerText()) === '');

  check('no console errors or warnings', errors.length === 0, errors.join(' | '));

  // --- phone width ---
  const phone = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await phone.goto('http://localhost:4173/');
  await phone.waitForSelector('canvas.viewer-canvas');
  await phone.waitForTimeout(800);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 375 px with the 3D view', overflow <= 0, `overflow=${overflow}`);
  const canvasBox = await phone.locator('.viewer-stage').boundingBox();
  check('3D view fits the phone width', canvasBox.width <= 375 && canvasBox.height > 150, JSON.stringify(canvasBox));
  await phone.locator('.viewer-stage').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: OUT + '/s5-phone.png' });

  // --- dark mode ---
  const dark = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' });
  await dark.goto('http://localhost:4173/');
  await dark.waitForSelector('canvas.viewer-canvas');
  await dark.waitForTimeout(800);
  await dark.locator('.legend-item').nth(2).click();
  await dark.screenshot({ path: OUT + '/s5-dark.png' });

  // --- reduced motion ---
  const rm = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  await rm.goto('http://localhost:4173/');
  await rm.waitForSelector('canvas.viewer-canvas');
  await rm.waitForTimeout(600);
  const rs = rm.locator('.viewer-stage');
  const h1 = hash(await rs.screenshot());
  await rm.check('#v-exploded');
  await rm.waitForTimeout(60);
  check('reduced motion: exploded view applies immediately (no animation)', hash(await rs.screenshot()) !== h1);

  await browser.close();
  console.log(failed.length ? `\n${failed.length} FAILED: ${failed.join('; ')}` : '\nALL 3D BROWSER CHECKS PASSED');
  process.exit(failed.length ? 1 : 0);
})();
