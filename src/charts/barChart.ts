/**
 * Horizontal bar chart for comparing variants (e.g. U-values).
 * Bars start at zero so lengths are honest; a missing value is shown as "n/a", never as a zero-length bar.
 */
import { formatTick, linearScale, niceTicks } from './scales';
import { svg, truncate } from './svg';

export interface BarItem {
  label: string;
  /** null when the variant could not be calculated. */
  value: number | null;
  /** The current wall is highlighted. */
  highlight?: boolean;
}

export interface BarChartOptions {
  /** Accessible title, also shown as a caption inside the chart. */
  title: string;
  unit: string;
  /** Digits after the decimal point for the value labels. Default 3. */
  decimals?: number;
}

const W = 640;
const LABEL_W = 170;
const ROW = 30;

export function buildBarChart(items: readonly BarItem[], options: BarChartOptions): SVGSVGElement {
  const decimals = options.decimals ?? 3;
  const H = items.length * ROW + 56;
  const values = items.map((i) => i.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const ticks = niceTicks(0, Math.max(...values, 0) || 1, 4);
  const xScale = linearScale([0, ticks[ticks.length - 1] as number], [LABEL_W, W - 70]);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart bar-chart', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  root.setAttribute(
    'aria-label',
    `${options.title}. ` + items.map((i) => `${i.label}: ${i.value === null ? 'not available' : `${i.value.toFixed(decimals)} ${options.unit}`}`).join('; ') + '.',
  );
  root.append(svg('title', {}, options.title), svg('text', { x: 4, y: 16, class: 'chart-note' }, `${options.title} (${options.unit})`));

  for (const t of ticks) {
    root.append(
      svg('line', { x1: xScale(t), x2: xScale(t), y1: 26, y2: H - 22, class: 'grid-line' }),
      svg('text', { x: xScale(t), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, formatTick(t)),
    );
  }
  items.forEach((item, i) => {
    const y = 32 + i * ROW;
    root.append(svg('text', { x: LABEL_W - 8, y: y + 15, class: `bar-label${item.highlight ? ' bar-label-current' : ''}`, 'text-anchor': 'end' }, truncate(item.label, 24), svg('title', {}, item.label)));
    if (item.value === null || !Number.isFinite(item.value)) {
      root.append(svg('text', { x: LABEL_W + 4, y: y + 15, class: 'bar-na' }, 'n/a'));
      return;
    }
    root.append(
      svg('rect', { x: LABEL_W, y, width: Math.max(1, xScale(item.value) - LABEL_W), height: ROW - 10, class: item.highlight ? 'bar bar-current' : 'bar' }, svg('title', {}, `${item.label}: ${item.value.toFixed(decimals)} ${options.unit}`)),
      svg('text', { x: xScale(item.value) + 6, y: y + 15, class: 'bar-value' }, item.value.toFixed(decimals)),
    );
  });
  root.append(svg('line', { x1: LABEL_W, x2: LABEL_W, y1: 26, y2: H - 22, class: 'axis-line' }));
  return root;
}
