"""
Deliberate-bug ("mutation") check for the code added or changed in Stage 8.

Each entry below breaks the program in one small, realistic way (a check removed,
a value ignored, a wrong list used, ...). The script applies one change at a time,
runs the relevant tests, and reports whether the tests noticed. Every file is
restored afterwards, even if the script is interrupted by an error.

A "SURVIVED" line means the tests did not notice that bug: either a test is
missing, or the change has no observable effect (an "equivalent" mutant).

Run from anywhere:  python3 validation/mutation_check.py   (takes a few minutes)
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ["tests/materialsUi.test.ts", "tests/application.test.ts", "tests/persist.test.ts", "tests/customMaterial.test.ts", "tests/report.test.ts", "tests/reportUi.test.ts", "tests/workspace.test.ts", "tests/architecture.test.ts", "tests/geometry.test.ts", "tests/thermalViz.test.ts"]

M = [
 ('remove allowed while used', 'src/ui/app.ts', "    if (used.length > 0) {\n      return { ok: false, message:", "    if (false) {\n      return { ok: false, message:"),
 ('custom materials not used by the calculation', 'src/ui/app.ts', 'result = buildWall(draft, allMaterials());', 'result = buildWall(draft, materials);'),
 ('save omits custom materials', 'src/ui/app.ts', 'serializeDraft(draft, allMaterials(), customMaterials)', 'serializeDraft(draft, allMaterials())'),
 ('open replaces session customs instead of merging', 'src/ui/app.ts', 'customMaterials = [...customMaterials.filter((m) => !fromFile.has(m.id)), ...parsed.customMaterials];', 'customMaterials = parsed.customMaterials;'),
 ("open keeps the session's version over the file's", 'src/ui/app.ts', 'customMaterials = [...customMaterials.filter((m) => !fromFile.has(m.id)), ...parsed.customMaterials];', 'customMaterials = [...customMaterials, ...parsed.customMaterials.filter((m) => !customMaterials.some((c) => c.id === m.id))];'),
 ('used-by positions off by one', 'src/ui/app.ts', 'usedBy: (id) => draft.layers.flatMap((layer, i) => (layer.materialId === id ? [i + 1] : [])),', 'usedBy: (id) => draft.layers.flatMap((layer, i) => (layer.materialId === id ? [i] : [])),'),
 ('shortcut does not focus the form', 'src/ui/app.ts', '    materialsPanel.focusForm();\n', ''),
 ('layer lists not refreshed after adding', 'src/ui/app.ts', "    customMaterials = [...customMaterials, created.material];\n    renderLayers();", "    customMaterials = [...customMaterials, created.material];"),
 ('file may add non-user-defined records', 'src/editor/persist.ts', "if (m.status !== 'user-defined')", 'if (false)'),
 ('file may use any id', 'src/editor/persist.ts', "if (!m.id.startsWith('custom-'))", 'if (false)'),
 ('file may reuse a built-in id', 'src/editor/persist.ts', 'if (builtIn.some((b) => b.id === m.id) || seen.has(m.id))', 'if (seen.has(m.id))'),
 ("file's customs ignored for unknown-material check", 'src/editor/persist.ts', 'const known = [...materials, ...customMaterials];', 'const known = [...materials];'),
 ('conditions lost in the file', 'src/editor/persist.ts', "    ...optional('conditions'),\n", ''),
 ('version-1 files refused', 'src/editor/persist.ts', 'export const OLDEST_WALL_FILE_VERSION = 1;', 'export const OLDEST_WALL_FILE_VERSION = 2;'),
 ('custom-material count limit off', 'src/editor/persist.ts', 'raw.length > MAX_CUSTOM_MATERIALS', 'false'),
 ('custom conditions ignored', 'src/materials/customMaterial.ts', '    ...(conditions ? { conditions } : {}),\n', ''),
 ('custom text length unlimited', 'src/materials/customMaterial.ts', 'if (text.length > max)', 'if (false)'),
 ('form: optional density required', 'src/ui/materialsPanel.ts', "readNumber('density', densityInput, 'the density', false)", "readNumber('density', densityInput, 'the density', true)"),
 ('form: value type ignored', 'src/ui/materialsPanel.ts', 'valueType: valueTypeSelect.value as ThermalValueType,', "valueType: 'unspecified',"),
 ('form: source note ignored', 'src/ui/materialsPanel.ts', 'sourceNote: noteInput.value,', "sourceNote: '',"),
 ('form: category ignored', 'src/ui/materialsPanel.ts', 'category: categorySelect.value as MaterialCategory,', "category: 'Other',"),
 ('form: errors not sorted (focus on wrong field)', 'src/ui/materialsPanel.ts', '    errors.sort((a, b) => FIELD_ORDER.indexOf(a[0]) - FIELD_ORDER.indexOf(b[0]));\n', ''),
 ('form: messages not cleared on resubmit', 'src/ui/materialsPanel.ts', "    for (const key of messages.keys()) setFieldMessage(key, '', '');\n", ''),
 ('export leaves out custom materials', 'src/ui/materialsPanel.ts', "      const all = options.getMaterials();\n      const filename", "      const all = options.getMaterials().filter((m) => m.status !== 'user-defined');\n      const filename"),
 ('limitations not shown', 'src/ui/materialsPanel.ts', '[...m.assumptionsAndLimitations, NOT_APPROVED_NOTICE]', '[NOT_APPROVED_NOTICE]'),
 ('status filter ignored', 'src/ui/materialsPanel.ts', "...(status ? { status: status as MaterialRecord['status'] } : {})", ''),
 ('built-in records removable', 'src/ui/materialsPanel.ts', "m.status === 'user-defined' ? h('button'", "true ? h('button'"),
 ('comparison choices leave out custom materials', 'src/ui/resultsPanel.ts', 'const materialBoxes = materials().map((m) => {', "const materialBoxes = materials().filter((m) => m.status !== 'user-defined').map((m) => {"),
 ('user-defined banner missing from reports', 'src/report/buildReport.ts', "if (wall.layers.some((l) => l.propertyStatus === 'user-defined')) {", 'if (false) {'),
 ('glossary wording drifts from the docs', 'src/ui/resultsPanel.ts', 'Lower is better insulation.', 'Lower means better insulation.'),
 ('a colour-map division by zero (both guards removed)', 'src/geometry/colormap.ts', "const clamp01 = (x: number): number => (Number.isNaN(x) ? 0.5 : Math.min(1, Math.max(0, x)));", "const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));"),
 ('stale results replaced by NaN', 'src/ui/resultsPanel.ts', "input = valid ? { wall: valid.wall, views: valid.views, analysis: valid.analysis, draft: valid.draft, editorWarnings: valid.editorWarnings, stale: editorHasErrors } : { ...input, stale: editorHasErrors };", "input = valid ? { wall: valid.wall, views: valid.views, analysis: valid.analysis, draft: valid.draft, editorWarnings: valid.editorWarnings, stale: editorHasErrors } : { wall: null, views: [], analysis: null, draft: null, editorWarnings: [], stale: editorHasErrors };"),
]


def run_tests():
    proc = subprocess.run(["npx", "vitest", "run", *FILES], cwd=ROOT, capture_output=True, text=True, timeout=170)
    text = proc.stdout + proc.stderr
    match = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", text)
    failed = int(match.group(1) or 0) if match else -1
    return proc.returncode, failed


def main():
    code, failed = run_tests()
    print(f"baseline: exit={code} failed={failed}")
    if code != 0:
        sys.exit("baseline must pass before mutating")
    survivors = []
    for description, rel, old, new in M:
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        count = original.count(old)
        if count != 1:
            print(f"SKIP  {description}: pattern found {count} times in {rel}")
            survivors.append(description + " (pattern problem)")
            continue
        try:
            path.write_text(original.replace(old, new), encoding="utf-8")
            code, failed = run_tests()
        finally:
            path.write_text(original, encoding="utf-8")
        status = "CAUGHT  " if code != 0 else "SURVIVED"
        print(f"{status} {description}  (failing tests: {failed})", flush=True)
        if code == 0:
            survivors.append(description)
    code, failed = run_tests()
    print(f"after restore: exit={code} failed={failed}")
    print("survivors:", survivors if survivors else "none")

main()
