/**
 * Architecture rules, checked by reading the source files.
 *
 *   engine     ← knows nothing about the other modules
 *   units      ← may use the engine's error type only
 *   materials  ← may use the engine (types, validation helpers) only
 *   editor     ← may use engine, materials, units; never the user interface
 *   ui         ← may use editor and materials; may import the engine for TYPES only
 *
 * Keeping the screen code away from the engine means the user interface can
 * never bypass validation or do its own physics.
 */
import { describe, expect, it } from 'vitest';

/** All TypeScript sources under src/, as text, keyed by path relative to src/ (e.g. "ui/app.ts"). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../src/**/*.ts', '!../src/**/*.d.ts'], { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.replace('../src/', ''), text]),
);

const sourceFiles = (module: string): string[] => Object.keys(SOURCES).filter((file) => file.startsWith(`${module}/`));

/** Source text with comments removed, so words in comments are not mistaken for code. */
const codeOf = (file: string): string => (SOURCES[file] ?? '').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

/** Every module specifier imported (statically) by a file, with whether it is type-only. */
function imports(file: string): Array<{ from: string; typeOnly: boolean }> {
  const text = SOURCES[file] ?? '';
  const found: Array<{ from: string; typeOnly: boolean }> = [];
  for (const match of text.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
    found.push({ from: match[2] ?? '', typeOnly: Boolean(match[1]) });
  }
  for (const match of text.matchAll(/import\s+'([^']+)'/g)) found.push({ from: match[1] ?? '', typeOnly: false });
  for (const match of text.matchAll(/import\(\s*'([^']+)'\s*\)/g)) found.push({ from: match[1] ?? '', typeOnly: false }); // dynamic import()
  return found;
}

/** Which top-level module (src/<name>) an import points to, or null for packages. */
function targetModule(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const parts = file.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts[0] ?? null;
}

const RULES: Record<string, { allowed: string[]; typeOnlyAllowed?: string[]; fileExceptions?: Record<string, string[]> }> = {
  engine: { allowed: ['engine'] },
  units: { allowed: ['units', 'engine'] },
  materials: { allowed: ['materials', 'engine'] },
  // Pure drawing arithmetic: no 3D library, no editor, no screen code.
  geometry: { allowed: ['geometry'], typeOnlyAllowed: ['engine'] },
  // The 3D library lives here and nowhere else. It knows only the geometry.
  viewer3d: { allowed: ['viewer3d', 'geometry'] },
  editor: { allowed: ['editor', 'engine', 'materials', 'units'] },
  // The screen shows what the editor and geometry produce. It may import the engine and the viewer only for TYPES,
  // except the entry file, which loads the viewer on demand.
  ui: { allowed: ['ui', 'editor', 'materials', 'geometry'], typeOnlyAllowed: ['engine', 'viewer3d'], fileExceptions: { 'ui/main.ts': ['viewer3d'] } },
};

describe('module boundaries', () => {
  for (const [module, rule] of Object.entries(RULES)) {
    it(`${module}/ only imports from: ${[...rule.allowed, ...(rule.typeOnlyAllowed ?? []).map((m) => `${m} (types)`)].join(', ')}`, () => {
      const violations: string[] = [];
      for (const file of sourceFiles(module)) {
        for (const { from, typeOnly } of imports(file)) {
          const target = targetModule(file, from);
          if (target === null) continue; // packages and CSS side-effect files are not module boundaries
          const ok =
            rule.allowed.includes(target) ||
            (typeOnly && (rule.typeOnlyAllowed ?? []).includes(target)) ||
            (rule.fileExceptions?.[file] ?? []).includes(target);
          if (!ok) violations.push(`${file} imports ${typeOnly ? 'type ' : ''}'${from}'`);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('the checker really sees imports (guards against a silently empty check)', () => {
    expect(sourceFiles('engine').length).toBeGreaterThan(5);
    expect(sourceFiles('ui').length).toBeGreaterThan(2);
    expect(imports('ui/app.ts').some((i) => i.from === '../editor')).toBe(true);
    expect(imports('ui/app.ts').some((i) => i.from === '../engine')).toBe(false);
    expect(imports('editor/buildWall.ts').some((i) => i.from === '../engine' && !i.typeOnly)).toBe(true);
  });
});

describe('no screen code outside src/ui', () => {
  for (const module of ['engine', 'units', 'materials', 'editor', 'geometry']) {
    it(`${module}/ does not touch the DOM, window or document`, () => {
      const offenders = sourceFiles(module).filter((file) => /\b(document|window|localStorage|HTMLElement)\b/.test(codeOf(file)));
      expect(offenders).toEqual([]);
    });
  }

  it('the UI contains no engineering formulas (no division of thickness by conductivity, no U-value maths)', () => {
    for (const file of sourceFiles('ui')) {
      expect(codeOf(file), file).not.toMatch(/lambda\w*\s*[/*]|thickness\w*\s*\/\s*\w*lambda/i);
    }
  });
});

describe('the 3D library is confined to src/viewer3d', () => {
  it('no other module imports "three"', () => {
    const offenders = Object.keys(SOURCES).filter((file) => !file.startsWith('viewer3d/') && imports(file).some((i) => i.from === 'three' || i.from.startsWith('three/')));
    expect(offenders).toEqual([]);
  });
  it('viewer3d does import it (guards against a silently empty check)', () => {
    expect(sourceFiles('viewer3d').some((file) => imports(file).some((i) => i.from === 'three'))).toBe(true);
  });
  it('the dynamic import in ui/main.ts is detected by the checker', () => {
    expect(imports('ui/main.ts').some((i) => i.from === '../viewer3d' && !i.typeOnly)).toBe(true);
  });
});
