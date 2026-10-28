/**
 * Tiny helper for building DOM elements.
 *
 * Text is always added as TEXT (never as HTML), so a material name or any
 * other string can never inject markup into the page.
 */
export type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

/** Number for display: a few significant digits, no exponent for ordinary sizes. */
export function show(value: number, significant = 4): string {
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(significant)));
}

/**
 * A box around a wide table that scrolls sideways on narrow screens. It can take
 * keyboard focus (so the arrow keys scroll it) and is announced as a named region.
 */
export function tableRegion(label: string, ...children: Child[]): HTMLDivElement {
  return h('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': label }, ...children);
}
