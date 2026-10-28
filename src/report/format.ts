/** Number and text formatting shared by the report renderers. */

/** A number with `significant` digits and no exponent for ordinary sizes; "—" if it is not a finite number. */
export function num(value: number | null | undefined, significant = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(significant)));
}

/** A signed percentage change; differences below floating-point noise print as 0 %. */
export function percent(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 1e-9) return '0 %';
  return `${value > 0 ? '+' : ''}${num(value, 3)} %`;
}

/** Escapes text for use inside HTML (element content and quoted attributes). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Escapes text so Markdown shows it literally. Newlines become spaces
 * (so a value can never start a new Markdown block or table row).
 * Set `atLineStart` to false where the text cannot begin a line (inside a heading,
 * a table cell or bold text), so ordinary numbering such as "1. Inputs" stays readable.
 */
export function escapeMarkdown(text: string, atLineStart = true): string {
  const flat = text.replace(/\s*[\r\n]+\s*/g, ' ');
  const escaped = flat.replace(/[\\`*_{}[\]<>#|~&]/g, (c) => `\\${c}`);
  return atLineStart ? escaped.replace(/^(\s*)([-+]|\d+[.)])(?=\s|$)/, '$1\\$2') : escaped;
}

/** One CSV cell: quoted, and a leading = + - @ (or tab / carriage return) neutralised so spreadsheets do not run it as a formula. */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Characters allowed in an HTML anchor. */
export const safeId = (text: string): string => text.replace(/[^A-Za-z0-9-]/g, '-');

/**
 * FNV-1a 32-bit checksum of a text, as 8 hex digits. Used only to tell whether two
 * reports were made from identical inputs; it is NOT a security feature.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** JSON with object keys sorted, so equal data always gives equal text. */
export function stableJson(value: unknown, indent?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}
