// @vitest-environment happy-dom
/**
 * Workspace refinement (after Stage 8): coordinate axes, the Top view, selecting
 * the whole wall, and the texts that say what the colours mean.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeWall } from '../src/analysis';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import { show } from '../src/ui/dom';
import { click, makeFake, setChecked, type } from './helpers/ui';

let root: HTMLElement;
let editor: WallEditorHandle;
let fake: ReturnType<typeof makeFake>;

beforeEach(async () => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  fake = makeFake();
  editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: fake.factory });
  await editor.ready;
});
afterEach(() => editor.destroy());

const q = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
const statusText = (): string => q('[data-role="statusbar"]').textContent ?? '';
const result = () => {
  const wall = editor.getResult().wall;
  if (!wall) throw new Error('wall expected');
  const outcome = analyzeWall(wall);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.analysis.result;
};

describe('coordinate axes', () => {
  it('are switched on when the viewer starts, and the status bar explains them', () => {
    expect(fake.viewer().axes).toEqual([true]);
    expect(q<HTMLInputElement>('#v-axes').checked).toBe(true);
    expect(statusText()).toContain('Axes x: thickness, int→ext (drawn 5×) · y: height · z: width');
    const legend = [...root.querySelectorAll('[data-role="statusbar"] span')].find((s) => s.textContent?.startsWith('Axes'));
    expect(legend?.getAttribute('title')).toBe('Axes: x through the wall, interior → exterior · y up (height) · z along the wall (width)');
  });

  it('can be switched off and on', () => {
    setChecked(q('#v-axes'), false);
    expect(fake.viewer().axes.at(-1)).toBe(false);
    expect(statusText()).not.toContain('Axes');
    setChecked(q('#v-axes'), true);
    expect(fake.viewer().axes.at(-1)).toBe(true);
  });

  it('the legend says when x is drawn enlarged, and stops saying so at true scale', () => {
    const scale = q<HTMLSelectElement>('#v-scale');
    scale.value = '1';
    scale.dispatchEvent(new Event('change', { bubbles: true }));
    expect(statusText()).toContain('Axes x: thickness, int→ext · y: height');
    expect(statusText()).not.toContain('drawn');
  });
});

describe('camera views', () => {
  it('offers 3D, Interior, Exterior, Section and Top (plan)', () => {
    const labels = [...root.querySelectorAll('[aria-label="Camera views"] button')].map((b) => b.textContent);
    expect(labels).toEqual(['3D', 'Interior', 'Exterior', 'Section', 'Top']);
    click(q('[aria-label="Plan view from above"]'));
    expect(fake.viewer().views.at(-1)).toBe('top');
  });
});

describe('selecting the whole wall', () => {
  const wallItem = (): HTMLElement => q('[data-role="select-wall"]');

  it('the wall is selected to begin with, and the inspector shows its calculated results', () => {
    const r = result();
    expect(wallItem().getAttribute('aria-pressed')).toBe('true');
    expect(wallItem().textContent).toBe('Whole wall — 3 × 2.5 m, 315 mm');
    const summary = q('[data-role="wall-summary"]').textContent ?? '';
    expect(summary).toContain('3 × 2.5 m = 7.5 m²');
    expect(summary).toContain('315 mm in 4 layers');
    expect(summary).toContain(`${show(r.uValueWPerM2K, 4)} W/(m²·K)`);
    expect(summary).toContain(`${show(r.resistance.totalM2KPerW, 4)} m²·K/W`);
    expect(summary).toContain(`${show(r.heatTransfer.magnitudeW, 4)} W, outward (heat loss)`);
    expect(q('.inspector').textContent).toContain('Steady state, constant air temperatures');
  });

  it('selecting a layer, then the whole wall, moves the selection back to the wall', () => {
    click(q('.legend-item[data-layer-id="layer-2"]'));
    expect(wallItem().getAttribute('aria-pressed')).toBe('false');
    expect(q('.inspector').textContent).toContain('Layer 2: Clay brick');
    click(wallItem());
    expect(wallItem().getAttribute('aria-pressed')).toBe('true');
    expect(fake.viewer().selections.at(-1)).toBeNull();
    expect(q('[data-role="wall-summary"]')).not.toBeNull();
  });

  it('a click on empty space in the 3D view selects the whole wall', () => {
    fake.viewer().handlers.onSelect?.('layer-3');
    expect(wallItem().getAttribute('aria-pressed')).toBe('false');
    fake.viewer().handlers.onSelect?.(null);
    expect(wallItem().getAttribute('aria-pressed')).toBe('true');
  });

  it('the summary follows edits, shows heat gain, and never shows numbers for an invalid wall', () => {
    type('outsideTemperature', '35');
    expect(q('[data-role="wall-summary"]').textContent).toContain('inward (heat gain)');
    type('width', '0'); // invalid: the panel keeps the LAST VALID wall and says so
    expect(q('[data-role="wall-summary"]').textContent).toContain('3 × 2.5 m');
    expect(q('.viewer-notice').textContent).toContain('Showing the last valid wall');
  });
});

describe('what the colours mean', () => {
  it('the screen-reader description and the canvas text say colours are temperatures with the overlay on', () => {
    const hidden = [...root.querySelectorAll('#viewer .visually-hidden')].map((e) => e.textContent).join(' ');
    expect(hidden).toContain('With the thermal overlay on, colours are the calculated steady-state temperatures');
    expect(hidden).not.toContain('they are not temperatures');
  });
});

describe('compact results panel', () => {
  it('keeps every formula as the tile tooltip, since the compact strip hides the formula lines', () => {
    for (const key of ['u-value', 'r-total', 'heat-transfer', 'flux', 'energy', 'heat-capacity']) {
      const tile = q(`[data-kpi="${key}"]`);
      expect(tile.getAttribute('title'), key).toBe(tile.querySelector('.kpi-sub')?.textContent);
    }
    expect(q('[data-kpi="energy"]').getAttribute('title')).toContain('Not an annual energy demand');
  });
});
