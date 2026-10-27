/**
 * Writes the report as ONE self-contained HTML page for reading, printing or
 * "Save as PDF" from the browser.
 *
 * Safety: every piece of text goes through `escapeHtml`; the page contains no
 * script, and a Content-Security-Policy meta tag forbids scripts, external
 * resources and network requests even if something slipped through.
 * The only markup that is not escaped is the chart, which must be an <svg> text
 * made by the program's own chart code; anything else is dropped.
 */
import { escapeHtml, safeId } from './format';
import type { Block, ReportModel } from './types';

export interface HtmlOptions {
  /** The temperature-profile chart as SVG text (from the charts module). Optional. */
  profileChartSvg?: string;
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1b1f24; font: 11pt/1.45 "Segoe UI", system-ui, -apple-system, Arial, sans-serif; }
main { max-width: 190mm; margin: 0 auto; padding: 14mm 10mm; }
h1 { font-size: 20pt; margin: 0 0 4px; }
h2 { font-size: 14pt; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #1b1f24; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14px 0 4px; break-after: avoid; }
p, li { margin: 4px 0; }
ul { padding-left: 20px; }
.meta { color: #444; font-size: 9.5pt; margin: 0 0 10px; }
.banner { border: 1.5px solid #8a5a00; background: #fff6e0; padding: 6px 10px; margin: 6px 0; font-size: 10pt; break-inside: avoid; }
.note { color: #333; font-size: 10pt; }
.notes { border-left: 3px solid #888; padding: 2px 10px; white-space: pre-wrap; background: #f4f5f6; }
.table-wrap { overflow-x: auto; margin: 8px 0; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
caption { text-align: left; font-weight: 600; padding: 0 0 3px; }
th, td { border: 1px solid #9aa1a9; padding: 2px 5px; vertical-align: top; text-align: left; overflow-wrap: break-word; }
td.wrap { overflow-wrap: anywhere; }
th { background: #e9ecef; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr { break-inside: avoid; }
pre { background: #f4f5f6; border: 1px solid #c7ccd1; padding: 8px; font: 8.5pt/1.35 ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
figure { margin: 10px 0; break-inside: avoid; }
figcaption { font-size: 9pt; color: #333; }
svg.chart { width: 100%; height: auto; max-height: 90mm; display: block; }
.band-a { fill: #fff; } .band-b { fill: #eef0f2; } .band-label { fill: #555; font-size: 11px; }
.grid-line { stroke: #d5d9dd; stroke-width: 1; } .axis-line { stroke: #444; stroke-width: 1; }
.tick { fill: #333; font-size: 11px; } .axis-title { fill: #111; font-size: 12px; }
.zone-label, .chart-note { fill: #555; font-size: 11px; }
.profile-line { fill: none; stroke: #b3261e; stroke-width: 2.5; stroke-linejoin: round; }
.air-line { stroke: #666; stroke-width: 1.5; stroke-dasharray: 5 4; }
.film-drop { stroke: #b3261e; stroke-width: 1.5; stroke-dasharray: 3 3; }
.marker { fill: #b3261e; stroke: #fff; stroke-width: 1.5; } .marker-inside-air { fill: #8a5a00; } .marker-outside-air { fill: #1f5fa8; }
@media print { main { padding: 0; max-width: none; } h2 { break-after: avoid; } .banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@page { size: A4; margin: 14mm 12mm; }
`;

/** Accepts only text that looks like one of our own charts. */
function trustedSvg(svg: string | undefined): string | null {
  if (!svg) return null;
  const text = svg.trim();
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) return null;
  if (/<\s*(script|foreignObject|iframe|object|embed|link|style)\b/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /javascript:/i.test(text)) return null;
  if (/<\s*(a|image|use)\b/i.test(text)) return null;
  return text;
}

function block(b: Block, options: HtmlOptions): string {
  switch (b.kind) {
    case 'paragraph':
      return `<p${b.emphasis ? ` class="${b.emphasis}"` : ''}>${escapeHtml(b.text)}</p>`;
    case 'subheading':
      return `<h3>${escapeHtml(b.text)}</h3>`;
    case 'list':
      return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'code':
      return `<pre>${escapeHtml(b.text)}</pre>`;
    case 'figure': {
      const svg = trustedSvg(options.profileChartSvg);
      return svg
        ? `<figure>${svg}<figcaption>${escapeHtml(b.caption)}</figcaption></figure>`
        : `<p class="note">(Chart not included in this copy. The table below holds the same numbers.)</p>`;
    }
    case 'table': {
      const numeric = new Set(b.numeric ?? []);
      const headClass = (i: number): string => (numeric.has(i) ? ' class="num"' : '');
      // Very long unbroken text (web addresses) may be broken anywhere; ordinary words are kept whole.
      const cellClass = (i: number, cell: string): string => (numeric.has(i) ? ' class="num"' : /\S{28,}/.test(cell) ? ' class="wrap"' : '');
      return (
        `<div class="table-wrap"><table><caption>${escapeHtml(b.caption)}</caption>` +
        `<thead><tr>${b.columns.map((c, i) => `<th scope="col"${headClass(i)}>${escapeHtml(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${b.rows.map((row) => `<tr>${row.map((cell, i) => `<td${cellClass(i, cell)}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      );
    }
  }
}

export function renderHtml(model: ReportModel, options: HtmlOptions = {}): string {
  const head =
    `<h1>${escapeHtml(model.title)}</h1>` +
    `<p class="meta">${escapeHtml(model.software.name)} ${escapeHtml(model.software.version)} · generated ${escapeHtml(model.generatedAt)} · input fingerprint ${escapeHtml(model.fingerprint)}</p>` +
    model.banners.map((b) => `<div class="banner" role="note"><strong>Read first. </strong>${escapeHtml(b)}</div>`).join('') +
    (model.notes.trim() !== '' ? `<h2>Author's notes</h2><p class="notes">${escapeHtml(model.notes)}</p>` : '');
  const body = model.sections.map((s) => `<section id="${safeId(s.id)}"><h2>${escapeHtml(s.heading)}</h2>${s.blocks.map((b) => block(b, options)).join('')}</section>`).join('\n');
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(model.title)}</title><style>${STYLE}</style></head>\n<body><main>\n${head}\n${body}\n</main></body></html>\n`
  );
}
