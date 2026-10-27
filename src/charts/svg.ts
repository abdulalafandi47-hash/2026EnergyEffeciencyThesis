const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined>;

/** Creates an SVG element. Text is always inserted as text, never as markup. */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) element.setAttribute(name, String(value));
  }
  for (const child of children) if (child !== null && child !== undefined) element.append(child);
  return element;
}

/** Trims a label to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}
