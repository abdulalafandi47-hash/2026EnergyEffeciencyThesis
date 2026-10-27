/**
 * Writes the report as Markdown (for notes, a repository or pasting into a
 * thesis draft). All text is escaped so it displays literally.
 */
import { escapeMarkdown } from './format';
import type { Block, ReportModel } from './types';

/** A code fence long enough that the text cannot close it early. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(longest + 1);
}

function block(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return b.emphasis ? `> ${escapeMarkdown(b.text)}` : escapeMarkdown(b.text);
    case 'subheading':
      return `### ${escapeMarkdown(b.text, false)}`;
    case 'list':
      return b.items.map((i) => `- ${escapeMarkdown(i)}`).join('\n');
    case 'code': {
      const f = fence(b.text);
      return `${f}json\n${b.text}\n${f}`;
    }
    case 'figure':
      return `*${escapeMarkdown(b.caption)} (The chart is in the HTML report; the table below holds the same numbers.)*`;
    case 'table': {
      const row = (cells: string[]): string => `| ${cells.map((c) => escapeMarkdown(c, false) || ' ').join(' | ')} |`;
      const numeric = new Set(b.numeric ?? []);
      return [`**${escapeMarkdown(b.caption, false)}**`, '', row(b.columns), `| ${b.columns.map((_, i) => (numeric.has(i) ? '---:' : '---')).join(' | ')} |`, ...b.rows.map(row)].join('\n');
    }
  }
}

export function renderMarkdown(model: ReportModel): string {
  const lines: string[] = [
    `# ${escapeMarkdown(model.title, false)}`,
    '',
    `${escapeMarkdown(model.software.name)} ${escapeMarkdown(model.software.version)} · generated ${escapeMarkdown(model.generatedAt)} · input fingerprint ${escapeMarkdown(model.fingerprint)}`,
    '',
    ...model.banners.flatMap((b) => [`> **Read first.** ${escapeMarkdown(b)}`, '']),
  ];
  if (model.notes.trim() !== '') lines.push("## Author's notes", '', ...model.notes.split(/\r?\n/).map((l) => `> ${escapeMarkdown(l)}`), '');
  for (const s of model.sections) {
    lines.push(`## ${escapeMarkdown(s.heading, false)}`, '');
    for (const b of s.blocks) lines.push(block(b), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
