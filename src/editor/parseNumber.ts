export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'not-a-number' };

/**
 * Strict reading of a number typed by a person.
 *
 * Accepted: optional sign, digits, and ONE decimal separator that may be a dot
 * or a comma (Greek/Cypriot users often type a comma): "12.5", "12,5", ".5", "-3".
 *
 * Rejected (never guessed at): empty text, letters, units ("80mm"), exponent
 * notation ("1e3"), thousands separators ("1 200", "1.200,5"), and anything
 * that does not become a finite number.
 *
 * Note: "1,200" is read as 1.2 (a comma is a decimal separator here), not 1200.
 * The interface shows the converted value in metres next to every thickness
 * so such a slip is visible.
 */
export function parseNumberInput(text: string): ParsedNumber {
  const trimmed = text.trim().replace(/−/g, '-'); // typographic minus → hyphen-minus
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return { ok: false, reason: 'not-a-number' };
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'not-a-number' };
}

/**
 * Text for a number after a unit change: removes floating-point noise
 * (0.08 m → 80 mm, not 80.00000000000001) and never uses exponent notation,
 * so the result can be parsed again by `parseNumberInput`.
 */
export function formatNumber(value: number): string {
  const rounded = parseFloat(value.toPrecision(10));
  const text = String(rounded);
  if (!/e/i.test(text)) return text;
  // toFixed() itself switches to exponent notation from 1e21, but such a value is a whole number.
  if (Math.abs(rounded) >= 1e21) return BigInt(rounded).toString();
  return rounded.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}
