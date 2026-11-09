/**
 * The building report: it shows exactly what the envelope module calculated,
 * says plainly what is missing, keeps its equations equal to the documentation,
 * escapes user text, and never claims compliance.
 */
import { describe, expect, it } from 'vitest';
import { calculateEnvelope, COMPONENT_TYPE_LABEL, createBlankProject, createExampleHouse, updateComponent } from '../src/envelope';
import type { BuildingProject, Glazing } from '../src/envelope';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { BUILDING_EQUATIONS, buildBuildingReport, buildingReportFileBase, renderBuildingJson, renderElementsCsv, renderHtml, renderMarkdown } from '../src/report';
import type { BuildingReportInput, ReportModel } from '../src/report';
import buildingDoc from '../docs/building-envelope.md?raw';
import { expectClose } from './helpers/helpers';

const at = new Date('2026-11-09T10:30:00Z');
function inputFor(project: BuildingProject, title = '', notes = ''): BuildingReportInput {
  return { title, notes, generatedAt: at, project, result: calculateEnvelope(project, BUILT_IN_MATERIALS), typeLabels: COMPONENT_TYPE_LABEL };
}
const textOf = (model: ReportModel): string => JSON.stringify(model);
const sectionOf = (model: ReportModel, id: string) => model.sections.find((s) => s.id === id);
const tableIn = (model: ReportModel, id: string, n = 0) => (sectionOf(model, id)?.blocks.filter((b) => b.kind === 'table')[n] as { rows: string[][]; columns: string[] });

describe('building report content', () => {
  it('the example house: every component is listed, and the report says it is illustrative and incomplete', () => {
    const input = inputFor(createExampleHouse(BUILT_IN_MATERIALS));
    const model = buildBuildingReport(input);
    expect(model.title).toBe('Building envelope calculation report');
    expect(model.banners.join(' ')).toMatch(/ILLUSTRATIVE example house/);
    expect(model.banners.join(' ')).toMatch(/9 of 14 elements are NOT in the totals/);
    expect(model.banners.join(' ')).toMatch(/not approved Cypriot design values/);
    const components = tableIn(model, 'components');
    expect(components.rows.map((r) => r[0])).toEqual(input.project.components.map((c) => c.name));
    // The ground floor appears under "not included" with its reason.
    const notIncluded = sectionOf(model, 'totals')?.blocks.find((b) => b.kind === 'list') as { items: string[] };
    expect(notIncluded.items.join(' ')).toMatch(/Ground floor slab \(unsupported\).*13370/);
  });

  it('numbers are the envelope result, unchanged (south wall checked against a hand calculation)', () => {
    const input = inputFor(createExampleHouse(BUILT_IN_MATERIALS));
    const model = buildBuildingReport(input);
    const results = tableIn(model, 'results');
    const southRow = results.rows.find((r) => r[0] === 'South wall') as string[];
    const r = input.result.components.find((x) => x.componentId === 'c3');
    // Hand calculation: R_total = 0.13 + Σ d/λ + 0.04; A = 10 × 2.8 − openings; Q̇ = U·A·(26 − 35).
    const lam = (id: string): number => BUILT_IN_MATERIALS.find((m) => m.id === id)?.lambdaWPerMK as number;
    const rTotal = 0.13 + 0.015 / lam('gypsum-plaster') + 0.2 / lam('clay-brick-solid') + 0.05 / lam('eps-slab') + 0.02 / lam('cement-plaster') + 0.04;
    const area = 10 * 2.8 - (1.5 * 1.2 + 1.8 * 2.2 + 1.5 * 1.2);
    expectClose(r?.uValueWPerM2K as number, 1 / rTotal, 1e-12);
    expectClose(r?.heatFlowW as number, (1 / rTotal) * area * -9, 1e-9);
    expect(Number(southRow[3])).toBeCloseTo(1 / rTotal, 4);
    expect(southRow[8]).toMatch(/ in$/); // 26 °C inside, 35 °C outside: heat flows in
    expect(southRow[10]).toBe('calculated');
    // Each calculated layered element has its own layer table.
    expect(sectionOf(model, 'results')?.blocks.some((b) => b.kind === 'subheading' && b.text.startsWith('South wall'))).toBe(true);
  });

  it('documented window values appear with their source, and the user-defined banner appears', () => {
    let p = createExampleHouse(BUILT_IN_MATERIALS);
    const w = p.components.find((c) => c.id === 'c8') as Glazing;
    p = updateComponent(p, { ...w, uValue: { value: 1.6, unit: 'W/(m²·K)', source: 'Datasheet ABC-123 (test)', valueType: 'declared', status: 'user-defined' } });
    const model = buildBuildingReport(inputFor(p));
    const sources = tableIn(model, 'sources');
    expect(sources.rows[0]).toEqual(['South window 1', 'Overall U-value U_w', '1.6 W/(m²·K)', 'Datasheet ABC-123 (test)', 'declared', '', 'user-defined']);
    expect(model.banners.join(' ')).toMatch(/entered by the user/);
    expect(model.banners.join(' ')).toMatch(/8 of 14 elements/);
  });

  it('a blank project: totals are "not available", never a calculated zero', () => {
    const model = buildBuildingReport(inputFor(createBlankProject()));
    const totals = tableIn(model, 'totals');
    for (const row of totals.rows) expect(row[1]).toMatch(/not available/);
    expect(model.banners.join(' ')).not.toMatch(/example house/);
  });

  it('equations are the same as in docs/building-envelope.md', () => {
    for (const e of BUILDING_EQUATIONS) expect(buildingDoc, e.expression).toContain(`| ${e.n} | \`${e.expression}\` | ${e.meaning} |`);
  });

  it('never claims compliance', () => {
    const text = renderMarkdown(buildBuildingReport(inputFor(createExampleHouse(BUILT_IN_MATERIALS))));
    expect(text).not.toMatch(/\b(complies|compliant with|meets the requirements|satisfies the requirements|approved design value)\b/i);
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/).filter((s) => /compliance/i.test(s))) expect(sentence, sentence).toMatch(/\b(not|no|never)\b/i);
  });
});

describe('building report output', () => {
  it('user text is escaped in HTML and Markdown', () => {
    const p = { ...createExampleHouse(BUILT_IN_MATERIALS), name: '<img src=x onerror=alert(1)> House' };
    const model = buildBuildingReport(inputFor(p, '<script>alert(1)</script>', '**bold** <b>x</b>'));
    const html = renderHtml(model);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(renderMarkdown(model)).not.toMatch(/^<script>/m);
  });

  it('JSON carries the project and the full result; CSV has one row per element with the signed heat flow', () => {
    const input = inputFor(createExampleHouse(BUILT_IN_MATERIALS));
    const model = buildBuildingReport(input);
    const json = JSON.parse(renderBuildingJson(model, input));
    expect(json.kind).toBe('building-envelope');
    expect(json.data.project).toEqual(JSON.parse(JSON.stringify(input.project)));
    expect(json.data.result.netHeatFlowW).toBe(input.result.netHeatFlowW);
    // A small CSV reader: quoted cells may contain commas; "" is a quote.
    const cells = (line: string): string[] => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].slice(0, -1).map((m) => (m[1] as string).replace(/^"|"$/g, '').replace(/""/g, '"'));
    const lines = renderElementsCsv(input).trim().split('\n');
    expect(lines).toHaveLength(1 + input.project.components.length);
    const header = cells(lines[0] as string);
    const rows = lines.slice(1).map(cells);
    rows.forEach((r) => expect(r).toHaveLength(header.length));
    const southRow = rows.find((r) => r[0] === 'c3') as string[];
    expect(Number(southRow[header.indexOf('heat_flow_W_positive_out')])).toBe(input.result.components.find((r) => r.componentId === 'c3')?.heatFlowW);
    expect(southRow[header.indexOf('U_W_per_m2K')]).not.toBe('');
    const floorRow = rows.find((r) => r[0] === 'c6') as string[];
    expect(floorRow[header.indexOf('heat_flow_W_positive_out')]).toBe(''); // not calculated: empty, not 0
  });

  it('file names carry the time and the project fingerprint; the same project gives the same fingerprint', () => {
    const a = buildBuildingReport(inputFor(createExampleHouse(BUILT_IN_MATERIALS)));
    const b = buildBuildingReport(inputFor(createExampleHouse(BUILT_IN_MATERIALS)));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(buildingReportFileBase(a)).toBe(`building-report-20261109-103000-${a.fingerprint}`);
    const c = buildBuildingReport(inputFor({ ...createExampleHouse(BUILT_IN_MATERIALS), name: 'Other' }));
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });
});
