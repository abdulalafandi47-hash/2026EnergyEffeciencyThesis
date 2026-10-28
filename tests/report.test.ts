import { describe, expect, it } from 'vitest';
import { analyzeWall, sweepOutsideTemperature } from '../src/analysis';
import { createInitialDraft, setLayerMaterial, setLayerThickness, setInsideTemperature, setOutsideTemperature, setSurfaceMode } from '../src/editor';
import type { WallDraft } from '../src/editor';
import { BUILT_IN_MATERIALS, createCustomMaterial } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import {
  buildReport,
  csvCell,
  DEFAULT_REPORT_TITLE,
  EQUATIONS,
  escapeMarkdown,
  fingerprintOf,
  fnv1a,
  LIMITATIONS,
  REFERENCES,
  renderHtml,
  renderJson,
  renderLayersCsv,
  renderMarkdown,
  SOFTWARE_NAME,
  SOFTWARE_VERSION,
  stableJson,
} from '../src/report';
import type { Block, ReportModel } from '../src/report';
import equationsDoc from '../docs/equations-and-assumptions.md?raw';
import sourcesDoc from '../docs/sources.md?raw';
import packageJson from '../package.json?raw';
import { at, expectClose } from './helpers/helpers';
import { FIXED_TIME, HOSTILE_NAME, hostileMaterials, makeReportInput } from './helpers/report';

const initial = (): WallDraft => createInitialDraft(BUILT_IN_MATERIALS);
const model = (opts: Parameters<typeof makeReportInput>[0] = {}): ReportModel => buildReport(makeReportInput(opts));

/** Every text the report prints, flattened (for "does the report say X anywhere" checks). */
function allText(m: ReportModel): string {
  const blockText = (b: Block): string[] => {
    switch (b.kind) {
      case 'paragraph': case 'subheading': case 'code': return [b.text];
      case 'list': return b.items;
      case 'figure': return [b.caption];
      case 'table': return [b.caption, ...b.columns, ...b.rows.flat()];
    }
  };
  return [m.title, m.notes, ...m.banners, ...m.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockText)])].join('\n');
}
const tableOf = (m: ReportModel, caption: string): Extract<Block, { kind: 'table' }> => {
  for (const s of m.sections) for (const b of s.blocks) if (b.kind === 'table' && b.caption.startsWith(caption)) return b;
  throw new Error(`no table "${caption}"`);
};
const rowOf = (table: Extract<Block, { kind: 'table' }>, label: string): string[] => {
  const row = table.rows.find((r) => r[0]?.trim() === label);
  if (!row) throw new Error(`no row "${label}"`);
  return row;
};

describe('fingerprint helpers', () => {
  it('fnv1a matches the published FNV-1a 32-bit test vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
  it('stableJson does not depend on key order', () => {
    expect(stableJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(stableJson({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('the report fingerprint changes when, and only when, the engine input changes', () => {
    const base = makeReportInput();
    expect(fingerprintOf(base.wall)).toBe(buildReport(base).fingerprint);
    expect(fingerprintOf(base.wall)).toBe(fingerprintOf(JSON.parse(JSON.stringify(base.wall))));
    const thicker = makeReportInput({ draft: setLayerThickness(initial(), 'layer-3', '81') });
    expect(fingerprintOf(thicker.wall)).not.toBe(fingerprintOf(base.wall));
    expect(buildReport({ ...base, title: 'Other title', notes: 'other' }).fingerprint).toBe(buildReport(base).fingerprint);
  });
});

describe('report content for the starter wall', () => {
  const input = makeReportInput({ withComparison: true });
  const m = buildReport(input);

  it('is deterministic: the same input gives identical output', () => {
    expect(buildReport(input)).toEqual(m);
    expect(renderHtml(m)).toBe(renderHtml(buildReport(input)));
  });

  it('does not change its input', () => {
    const frozen = makeReportInput({ withComparison: true });
    const text = stableJson(frozen);
    buildReport(frozen);
    expect(stableJson(frozen)).toBe(text);
  });

  it('identifies the software, schema and time (the time is injected, not read from the clock)', () => {
    expect(m.generatedAt).toBe('2026-10-27T12:30:45.000Z');
    expect(m.software).toEqual({ name: SOFTWARE_NAME, version: SOFTWARE_VERSION });
    expect(m.schema).toBe('building-thermal-simulator.report');
    expect(m.title).toBe(DEFAULT_REPORT_TITLE);
    expect(at(tableOf(m, 'Record').rows, 1)[1]).toBe(FIXED_TIME.toISOString());
  });

  it('uses the typed title and keeps notes as given', () => {
    const custom = model({ title: '  My wall  ', notes: 'line 1\nline 2' });
    expect(custom.title).toBe('My wall');
    expect(custom.notes).toBe('line 1\nline 2');
    expect(model({ title: '   ' }).title).toBe(DEFAULT_REPORT_TITLE);
  });

  it('carries the three warnings that must always be visible', () => {
    expect(m.banners.join(' ')).toMatch(/illustrative or unverified/);
    expect(m.banners.join(' ')).toMatch(/not approved Cypriot design values/);
    expect(m.banners.join(' ')).toMatch(/unverified/); // surface resistances
    expect(m.banners.join(' ')).toMatch(/not a dynamic or whole-building simulation/);
  });

  it('results table equals the engine result (formatted, never recalculated)', () => {
    const r = input.analysis.result;
    const results = tableOf(m, 'Calculated results');
    expect(Number(rowOf(results, 'Thermal transmittance U')[1])).toBeCloseTo(r.uValueWPerM2K, 5);
    expect(Number(rowOf(results, 'Total thermal resistance R_total')[1])).toBeCloseTo(r.resistance.totalM2KPerW, 5);
    expect(Number(rowOf(results, 'Heat-transfer rate Q̇ (magnitude)')[1])).toBeCloseTo(r.heatTransfer.magnitudeW, 4);
    expect(Number(rowOf(results, 'Heat flux q (magnitude)')[1])).toBeCloseTo(r.heatTransfer.fluxMagnitudeWPerM2, 4);
    expect(Number(rowOf(results, 'Energy in 24 h (magnitude)')[1])).toBeCloseTo(r.energy.magnitudeKWh, 4);
    expect(rowOf(results, 'Thermal transmittance U')[2]).toBe('W/(m²·K)');
  });

  it('matches an independent hand calculation from the material values (not from the engine)', () => {
    const lambda = (id: string): number => (BUILT_IN_MATERIALS.find((x) => x.id === id) as MaterialRecord).lambdaWPerMK;
    const rTotal = 0.13 + 0.015 / lambda('gypsum-plaster') + 0.2 / lambda('clay-brick-solid') + 0.08 / lambda('eps-slab') + 0.02 / lambda('cement-plaster') + 0.04;
    const results = tableOf(m, 'Calculated results');
    expectClose(Number(rowOf(results, 'Total thermal resistance R_total')[1]), rTotal, 1e-5);
    expectClose(Number(rowOf(results, 'Thermal transmittance U')[1]), 1 / rTotal, 1e-5);
    expectClose(Number(rowOf(results, 'Heat-transfer rate Q̇ (magnitude)')[1]), (1 / rTotal) * 7.5 * 15, 1e-5);
    expectClose(Number(rowOf(results, 'Energy in 24 h (magnitude)')[1]), ((1 / rTotal) * 7.5 * 15 * 24) / 1000, 1e-5);
  });

  it('shows what was typed next to what was used', () => {
    const inputs = tableOf(m, 'Wall and boundary conditions');
    expect(rowOf(inputs, 'Width')).toEqual(['Width', '3 m', '3 m']);
    expect(rowOf(inputs, 'Inside air temperature')).toEqual(['Inside air temperature', '20 °C', '20 °C']);
    let d = setLayerThickness(initial(), 'layer-2', '20');
    d = { ...d, layers: d.layers.map((l) => (l.key === 'layer-2' ? { ...l, thicknessUnit: 'cm' as const } : l)), temperatureUnit: 'F' as const, insideTemperatureText: '68', outsideTemperatureText: '41' };
    const f = tableOf(model({ draft: d }), 'Wall and boundary conditions');
    expectClose(Number(rowOf(f, 'Inside air temperature')[2]?.replace(' °C', '')), 20, 1e-9);
    expect(rowOf(f, 'Inside air temperature')[1]).toBe('68 °F');
    const layers = tableOf(model({ draft: d }), 'Layers');
    expect(at(layers.rows, 1)[3]).toBe('20 cm');
    expect(at(layers.rows, 1)[4]).toBe('200');
  });

  it('lists every layer with its data status and each material\'s source once', () => {
    const layers = tableOf(m, 'Layers');
    expect(layers.rows.map((r) => r[1])).toEqual(input.wall.layers.map((l) => l.name));
    expect(layers.rows.every((r) => r[8] === 'illustrative' && r[9] === 'unspecified')).toBe(true);
    expect(tableOf(m, 'Where the material values come from').rows).toHaveLength(4);
    const dup = makeReportInput({ draft: setLayerMaterial(initial(), 'layer-1', 'cement-plaster') });
    expect(tableOf(buildReport(dup), 'Where the material values come from').rows).toHaveLength(3);
  });

  it('layer table carries engine temperatures that join up', () => {
    const t = tableOf(m, 'Resistance and temperature of each layer');
    expect(t.rows).toHaveLength(input.wall.layers.length + 2);
    for (let i = 1; i < t.rows.length; i++) expect(at(t.rows, i)[6]).toBe(at(t.rows, i - 1)[7]); // start of a row = end of the previous one
  });

  it('prints the temperature profile points the engine produced', () => {
    const p = tableOf(m, 'Temperature at each point');
    expect(p.rows).toHaveLength(input.analysis.result.temperatureProfile.length);
    expect(at(p.rows, 0)[2]).toBe('20');
    expect(at(p.rows, p.rows.length - 1)[2]).toBe('5');
  });

  it('section numbers are consecutive, with and without comparisons', () => {
    for (const withComparison of [true, false]) {
      const headings = model({ withComparison }).sections.map((s) => s.heading);
      headings.forEach((h, i) => expect(h.startsWith(`${i + 1}. `), h).toBe(true));
    }
    expect(model({ withComparison: true }).sections.some((s) => s.id === 'comparisons')).toBe(true);
    expect(model({ withComparison: false }).sections.some((s) => s.id === 'comparisons')).toBe(false);
  });

  it('comparison tables hold the analysis numbers and state what was held constant', () => {
    const c = input.comparisons[0];
    const t = tableOf(m, 'Changing thickness of layer 3');
    expect(t.rows).toHaveLength(4);
    expect(at(t.rows, 0)[0]).toBe('Current');
    expect(Number(at(t.rows, 1)[2])).toBeCloseTo(at(c?.variants ?? [], 1).uValueWPerM2K, 4);
    expect(allText(m)).toMatch(/Held constant: .*Surface resistances/);
  });

  it('comparison changes are percentages of the current wall (independent check)', () => {
    const thickness = tableOf(m, 'Changing thickness of layer 3');
    const lambda = (id: string): number => (BUILT_IN_MATERIALS.find((x) => x.id === id) as MaterialRecord).lambdaWPerMK;
    const rest = 0.13 + 0.015 / lambda('gypsum-plaster') + 0.2 / lambda('clay-brick-solid') + 0.02 / lambda('cement-plaster') + 0.04;
    const u = (mm: number): number => 1 / (rest + mm / 1000 / lambda('eps-slab'));
    for (const [row, mm] of [[1, 40], [2, 80], [3, 120]] as const) {
      const expected = ((u(mm) - u(80)) / u(80)) * 100;
      expectClose(Number(at(thickness.rows, row)[3]?.replace(' %', '')), expected, 5e-3);
      expectClose(Number(at(thickness.rows, row)[2]), u(mm), 1e-4);
    }
    // Changing the outside temperature leaves U unchanged but changes Q in proportion to |T_i − T_e| (20 → 15 K, 10 K, 25 K).
    const wallInput = makeReportInput();
    const temperature = tableOf(buildReport({ ...wallInput, comparisons: [sweepOutsideTemperature(wallInput.wall, [0, 10, -5])] }), 'Changing outside air temperature');
    expect(at(temperature.rows, 1)[3]).toBe('0 %');
    expect(at(temperature.rows, 1)[6]).toBe('+33.3 %'); // 20 K vs 15 K
    expect(at(temperature.rows, 2)[6]).toBe('-33.3 %'); // 10 K vs 15 K
    expect(at(temperature.rows, 3)[6]).toBe('+66.7 %'); // 25 K vs 15 K
    expect(at(temperature.rows, 1)[5]).toMatch(/ out$/);
  });

  it('includes the equations, assumptions, limitations, references, verification and reproducibility sections', () => {
    const ids = m.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['equations', 'assumptions', 'limitations', 'references', 'verification', 'reproducibility']));
    for (const e of input.analysis.result.assumptions) expect(allText(m)).toContain(e);
    for (const l of LIMITATIONS) expect(allText(m)).toContain(l);
    const code = m.sections.find((s) => s.id === 'reproducibility')?.blocks.find((b) => b.kind === 'code');
    expect(JSON.parse((code as { text: string }).text)).toEqual(JSON.parse(JSON.stringify(input.wall)));
  });
});

describe('what the report says about data status', () => {
  const asVerified = (materials: readonly MaterialRecord[]): MaterialRecord[] => materials.map((x) => ({ ...x, status: 'verified' as const }));

  it('the illustrative-data banner appears only when some layer is illustrative or unverified', () => {
    expect(model().banners.some((b) => /illustrative or unverified/.test(b))).toBe(true);
    const verified = model({ materials: asVerified(BUILT_IN_MATERIALS) });
    expect(verified.banners.some((b) => /illustrative or unverified/.test(b))).toBe(false);
    expect(verified.banners.some((b) => /surface resistances are unverified/.test(b))).toBe(true); // still unverified
    expect(verified.banners.some((b) => /not a dynamic or whole-building/.test(b))).toBe(true); // scope statement always present
  });

  it('a user-defined (custom) material adds its own warning; all-custom walls lose the illustrative warning', () => {
    const board = createCustomMaterial({ name: 'Board', lambdaWPerMK: 0.031, sourceNote: 'datasheet' }).material;
    const materials = [...BUILT_IN_MATERIALS, board];
    const one = model({ materials, draft: setLayerMaterial(initial(), 'layer-3', board.id) });
    expect(one.banners.some((b) => /entered by the user \(user-defined\)/.test(b))).toBe(true);
    expect(one.banners.some((b) => /illustrative or unverified/.test(b))).toBe(true);
    let all = initial();
    for (const key of ['layer-1', 'layer-2', 'layer-3', 'layer-4']) all = setLayerMaterial(all, key, board.id);
    const allCustom = model({ materials, draft: all });
    expect(allCustom.banners.some((b) => /illustrative or unverified/.test(b))).toBe(false);
    expect(allCustom.banners.some((b) => /user-defined/.test(b))).toBe(true);
    expect(model().banners.some((b) => /entered by the user/.test(b))).toBe(false);
  });

  it('custom surface resistances are reported as user-defined and shown as typed', () => {
    const d = { ...setSurfaceMode(initial(), 'custom'), surfaceInsideText: '0,10', surfaceOutsideText: '0.05' };
    const m = model({ draft: d });
    expect(m.banners.join(' ')).toMatch(/surface resistances are user-defined: entered by the user/);
    const row = rowOf(tableOf(m, 'Wall and boundary conditions'), 'Internal surface resistance R_si');
    expect(row[1]).toBe('0,10 m²·K/W (custom)');
    expect(row[2]).toBe('0.1 m²·K/W');
  });

  it('reports heat capacity as unavailable (and names the layer) when a material has no density', () => {
    const materials = BUILT_IN_MATERIALS.map((x) => {
      if (x.id !== 'eps-slab') return x;
      const { densityKgPerM3: _omit, ...rest } = x;
      return rest as MaterialRecord;
    });
    const t = tableOf(model({ materials }), 'Calculated results');
    const row = rowOf(t, 'Heat capacity');
    expect(row[1]).toBe('unavailable');
    expect(row[3]).toMatch(/missing for/);
    expect(tableOf(model({ materials }), 'Layers').rows.some((r) => r[6] === '—')).toBe(true);
  });

  it('never claims compliance: every mention of "compliance" is a denial', () => {
    const text = allText(model({ withComparison: true }));
    expect(text).not.toMatch(/\b(complies|compliant with|meets the requirements|satisfies the requirements|approved design value)\b/i);
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/).filter((s) => /compliance/i.test(s))) {
      expect(sentence, sentence).toMatch(/\bno\b|\bnot\b|\bnever\b|check/i);
    }
  });

  it('the direction is stated for heat gain as well as heat loss', () => {
    const gain = setOutsideTemperature(setInsideTemperature(initial(), '24'), '35');
    expect(allText(model({ draft: gain }))).toMatch(/Direction of heat flow: Inward/);
    expect(allText(model())).toMatch(/Direction of heat flow: Outward/);
    const none = setOutsideTemperature(initial(), '20');
    expect(allText(model({ draft: none }))).toMatch(/Direction of heat flow: None/);
  });
});

describe('fixed content stays in step with the project documents', () => {
  const docsEquations = equationsDoc.replace(/\\\|/g, '|');

  it('every equation is a row of the equations table in docs/equations-and-assumptions.md', () => {
    expect(EQUATIONS).toHaveLength(13);
    for (const e of EQUATIONS) expect(docsEquations, `equation ${e.n}`).toContain(`| ${e.n} | ${e.expression} |`);
  });

  it('every reference address and edition appears in docs/sources.md', () => {
    for (const link of [...REFERENCES.surfaceResistanceSources, ...REFERENCES.materialDataLeads]) expect(sourcesDoc, link.url).toContain(link.url);
    for (const edition of ['ISO 6946:2017', 'EN ISO 10456:2007 + AC:2009', 'ISO 13786:2017']) expect(sourcesDoc, edition).toContain(edition);
    for (const std of ['ISO 6946', 'EN ISO 10456', 'ISO 13786']) expect(REFERENCES.standards.some((s) => s.name.startsWith(std)), std).toBe(true);
    expect(REFERENCES.hierarchy).toHaveLength(5);
  });

  it('the software version equals the version in package.json', () => {
    expect(JSON.parse(packageJson).version).toBe(SOFTWARE_VERSION);
  });
});

describe('HTML output', () => {
  const m = model({ withComparison: true });
  const html = renderHtml(m);

  it('is a complete page that forbids scripts and network access', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/[^"'\s<]+\.(js|css)/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<title>${DEFAULT_REPORT_TITLE}</title>`);
  });

  it('keeps hostile text inert', () => {
    const hostile = buildReport(makeReportInput({ materials: hostileMaterials(), title: '<img src=x onerror=alert(1)>', notes: '</main><script>alert(3)</script>' }));
    const out = renderHtml(hostile);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toContain('</main><script');
    expect(out.match(/<\/main>/g)).toHaveLength(1);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&quot;EPS&quot;');
  });

  it('includes the chart only if it is plain SVG from our chart code', () => {
    const good = '<svg viewBox="0 0 10 10" class="chart"><title>t</title><rect x="1" y="1" width="2" height="2"/></svg>';
    expect(renderHtml(m, { profileChartSvg: good })).toContain(good);
    expect(renderHtml(m)).toContain('Chart not included');
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><style>@import url(x)</style></svg>',
      '<div>not an svg</div>',
      '<svg></svg><script>alert(1)</script>',
      '<svg><image href="http://evil/x.png"/></svg>',
      '',
    ]) {
      const out = renderHtml(m, { profileChartSvg: bad });
      expect(out, bad).toContain('Chart not included');
      expect(out, bad).not.toMatch(/<script|onload|foreignObject|javascript:/i);
    }
  });

  it('right-aligns numeric columns and gives tables captions and header cells', () => {
    expect(html).toMatch(/<caption>Calculated results \(steady state\)<\/caption>/);
    expect(html).toMatch(/<th scope="col" class="num">Value<\/th>/);
  });
});

describe('Markdown output', () => {
  it('has one title, the warnings first, and all tables well-formed', () => {
    const md = renderMarkdown(model({ withComparison: true }));
    expect(md.startsWith(`# ${DEFAULT_REPORT_TITLE}`)).toBe(true);
    expect(md.indexOf('Read first')).toBeLessThan(md.indexOf('## 1. Inputs'));
    expect(md.endsWith('\n')).toBe(true);
    expect((md.match(/^# /gm) ?? []).length).toBe(1);
    const unescapedPipes = (line: string): number => (line.match(/(?<!\\)\|/g) ?? []).length;
    let columns = -1;
    for (const line of md.split('\n')) {
      if (line.startsWith('|')) {
        if (columns < 0) columns = unescapedPipes(line);
        expect(unescapedPipes(line), line).toBe(columns);
      } else columns = -1;
    }
  });

  it('hostile text cannot break out of a table cell or create a link, heading or tag', () => {
    const md = renderMarkdown(buildReport(makeReportInput({ materials: hostileMaterials(), title: '# injected', notes: '- item\n[x](javascript:alert(1))' })));
    const prose = md.replace(/^(`{3,})json\n[\s\S]*?\n\1$/gm, ''); // the engine-input code block is shown literally
    expect(prose).not.toMatch(/(?<!\\)<script/);
    expect(prose).not.toMatch(/(?<![\\\]])\[link\]\(/);
    expect(md).not.toMatch(/^# injected/m);
    expect(md).toContain('\\<script\\>');
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) expect(line.endsWith('|'), line).toBe(true);
  });

  it('escapeMarkdown neutralises specials and line starts', () => {
    expect(escapeMarkdown('a|b*c_d`e[f]<g>#h&i\\j')).toBe('a\\|b\\*c\\_d\\`e\\[f\\]\\<g\\>\\#h\\&i\\\\j');
    expect(escapeMarkdown('- item')).toBe('\\- item');
    expect(escapeMarkdown('1. item')).toBe('\\1. item');
    expect(escapeMarkdown('one\ntwo\r\nthree')).toBe('one two three');
  });

  it('the code block fence cannot be closed by the text inside it', () => {
    const md = renderMarkdown({ ...model(), sections: [{ id: 'x', heading: 'x', blocks: [{ kind: 'code', text: 'a ``` b ```` c' }] }] });
    expect(md).toContain('`````json\na ``` b ```` c\n`````');
  });
});

describe('JSON output', () => {
  const input = makeReportInput({ withComparison: true });
  const json = renderJson(buildReport(input), input);
  const data = JSON.parse(json);

  it('carries the raw engine result and input at full precision', () => {
    expect(data.schema).toBe('building-thermal-simulator.report');
    expect(data.data.result.uValueWPerM2K).toBe(input.analysis.result.uValueWPerM2K);
    expect(data.data.engineInput).toEqual(JSON.parse(JSON.stringify(input.wall)));
    expect(data.data.draft).toEqual(input.draft);
    expect(data.data.layerTemperatures).toHaveLength(4);
    expect(data.data.comparisons[0].variants).toHaveLength(4);
    expect(data.data.materialsUsed.map((x: { id: string }) => x.id)).toEqual(['gypsum-plaster', 'clay-brick-solid', 'eps-slab', 'cement-plaster']);
    expect(data.banners.length).toBeGreaterThan(2);
  });

  it('is deterministic and re-calculating the stored input reproduces the stored result', () => {
    expect(renderJson(buildReport(input), input)).toBe(json);
    const again = analyzeWall(data.data.engineInput);
    expect(again.ok && again.analysis.result.uValueWPerM2K).toBe(data.data.result.uValueWPerM2K);
    expect(again.ok && again.analysis.result.heatTransfer.magnitudeW).toBe(data.data.result.heatTransfer.magnitudeW);
  });
});

describe('CSV output', () => {
  /** Minimal CSV reader for the tests (handles quotes and doubled quotes). */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i] as string;
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    return rows;
  }

  it('has a header and one row per layer with full-precision numbers', () => {
    const input = makeReportInput();
    const rows = parseCsv(renderLayersCsv(input));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    expect(at(rows, 0)[2]).toBe('thickness_m');
    expect(Number(at(rows, 3)[2])).toBe(0.08);
    expect(Number(at(rows, 3)[4])).toBe(input.analysis.result.layers[2]?.resistanceM2KPerW);
    expect(at(rows, 3)[11]).toBe('illustrative');
  });

  it('neutralises formulas and quotes in text cells', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@x')).toBe(`"'@x"`);
    expect(csvCell('a "q" b')).toBe('"a ""q"" b"');
    const rows = parseCsv(renderLayersCsv(makeReportInput({ materials: hostileMaterials() })));
    expect(at(rows, 3)[1]).toBe(HOSTILE_NAME);
    const evil = hostileMaterials().map((x) => (x.id === 'eps-slab' ? { ...x, name: '=HYPERLINK("http://evil","x")' } : x));
    expect(at(parseCsv(renderLayersCsv(makeReportInput({ materials: evil }))), 3)[1]).toBe(`'=HYPERLINK("http://evil","x")`);
  });
});

describe('random walls: the report always agrees with the engine', () => {
  it('60 seeded random valid walls', () => {
    let seed = 2026;
    const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 60; i++) {
      let d = initial();
      for (const key of ['layer-1', 'layer-2', 'layer-3', 'layer-4']) {
        d = setLayerMaterial(d, key, at(BUILT_IN_MATERIALS, Math.floor(random() * BUILT_IN_MATERIALS.length)).id);
        d = setLayerThickness(d, key, String(1 + Math.floor(random() * 300)));
      }
      d = setInsideTemperature(d, String(Math.floor(random() * 40) - 5));
      d = setOutsideTemperature(d, String(Math.floor(random() * 50) - 15));
      const input = makeReportInput({ draft: d });
      const m = buildReport(input);
      const r = input.analysis.result;
      const results = tableOf(m, 'Calculated results');
      expectClose(Number(rowOf(results, 'Thermal transmittance U')[1]), r.uValueWPerM2K, 1e-5);
      expectClose(Number(rowOf(results, 'Heat-transfer rate Q̇ (magnitude)')[1]), r.heatTransfer.magnitudeW, 1e-5);
      for (const section of m.sections) for (const b of section.blocks) if (b.kind === 'table') for (const cell of b.rows.flat()) expect(cell).not.toMatch(/NaN|Infinity|^undefined$/);
      expect(renderHtml(m)).not.toMatch(/NaN|Infinity/);
      expect(renderMarkdown(m)).not.toMatch(/NaN|Infinity/);
    }
  });
});
