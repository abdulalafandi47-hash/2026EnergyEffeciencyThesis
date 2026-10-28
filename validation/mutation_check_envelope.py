"""
Deliberate-bug ("mutation") check for the BUILDING-ENVELOPE code (model, calculation,
editing, 3D colours and the screen).

Each entry below breaks the program in one small, realistic way. The script applies
one change at a time, runs the envelope tests, and reports whether they noticed.
Every file is restored afterwards, even if the script is interrupted by an error.

A "SURVIVED" line means the tests did not notice that bug: either a test is
missing, or the change has no observable effect (an "equivalent" mutant).

Run from anywhere:  python3 validation/mutation_check_envelope.py   (takes a few minutes)
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ["tests/envelope.test.ts", "tests/house.test.ts", "tests/houseScene.test.ts", "tests/buildingUi.test.ts", "tests/architecture.test.ts"]

C = 'src/envelope/calculate.ts'
M = [
 ('roof surface resistances for the wrong heat-flow direction', C, "if (type === 'roof') return deltaTK >= 0 ? 'upwards' : 'downwards';", "if (type === 'roof') return deltaTK >= 0 ? 'downwards' : 'upwards';"),
 ('floor surface resistances for the wrong heat-flow direction', C, "return deltaTK >= 0 ? 'downwards' : 'upwards'; // floor", "return deltaTK >= 0 ? 'upwards' : 'downwards'; // floor"),
 ('unconditioned space treated as wind-exposed outdoor air', C, "return { ...preset, outsideM2KPerW: preset.insideM2KPerW, basis: BOTH_SIDES_BASIS };", "return preset;"),
 ('a documented value without a source is accepted', C, "if (v.source.trim() === '') issues.push", "if (false) issues.push"),
 ('heat gains counted as losses (sign lost)', C, "(direction === 'inward' ? -magnitude : magnitude)", "magnitude"),
 ('ground floor calculated like a wall', C, "if (exposure.kind === 'ground') {", "if (false) {"),
 ('partition between conditioned rooms counted', C, "if (exposure.kind === 'conditioned') {", "if (false) {"),
 ('window behind an unconditioned space uses the outdoor temperature', C, "const otherC = exposure.kind === 'outside' ? outsideC : exposure.kind === 'unconditioned' ? exposure.temperatureC : null;", "const otherC = outsideC;"),
 ('gains total has the wrong sign', C, "inwardW: -flows.filter((q) => q < 0)", "inwardW: flows.filter((q) => q < 0)"),
 ('energy ignores the duration', C, "(netHeatFlowW * project.conditions.durationH) / 1000", "netHeatFlowW / 1000"),
 ('missing layer data ignored', C, "if (missing.length > 0) return done('missing-data', missing, common);", ""),
 ('wall area not reduced by its openings', 'src/envelope/geometry.ts', "netAreaM2: gross - openings,", "netAreaM2: gross,"),
 ('overlapping openings allowed', 'src/envelope/geometry.ts', "if (overlapU > 1e-9 && overlapV > 1e-9) issues.push", "if (false) issues.push"),
 ('deleting a wall leaves its openings', 'src/envelope/edit.ts', "const gone = new Set([id, ...dependentsOf(p, id).map((o) => o.id)]);", "const gone = new Set([id]);"),
 ('a second roof can be added', 'src/envelope/edit.ts', "if ((type === 'roof' || type === 'floor') && hasType(p, type))", "if (type === 'floor' && hasType(p, type))"),
 ('a duplicated opening overlaps the original', 'src/envelope/edit.ts', "copy.offsetM = Number((copy.offsetM + copy.widthM + 0.3).toFixed(6));", "copy.offsetM = copy.offsetM;"),
 ('edited example still flagged as the example', 'src/envelope/edit.ts', "return { ...p, isExample: false, components: p.components.map((c) => (c.id === updated.id ? updated : c)) };", "return { ...p, components: p.components.map((c) => (c.id === updated.id ? updated : c)) };"),
 ('flux colour scale stretched from min to max', 'src/ui/houseSpec.ts', "for (const f of fluxes) colours[f.id] = fluxColor(max > 0 ? f.q / max : 0);", "const min = Math.min(...fluxes.map((f) => f.q));\n  for (const f of fluxes) colours[f.id] = fluxColor(max > min ? (f.q - min) / (max - min) : 0.5);"),
 ('elements without a result not greyed in the flux view', 'src/ui/houseSpec.ts', "for (const r of result.components) colours[r.componentId] = NOT_CALCULATED_COLOR;", ""),
 ('invalid typing committed to the model', 'src/ui/buildingWorkspace.ts', "if (!error) onValid(parsed.ok ? parsed.value : null);", "onValid(parsed.ok ? parsed.value : null);"),
 ('delete does not ask first', 'src/ui/buildingWorkspace.ts', "if (!confirmAction(message)) return;", ""),
 ('hidden components dropped from the calculation', 'src/ui/buildingWorkspace.ts', "result = calculateEnvelope(project, materials());", "result = calculateEnvelope({ ...project, components: project.components.filter((c) => c.visible) }, materials());"),
 ('exposure change reverts a name typed since the editor was drawn', 'src/ui/buildingWorkspace.ts', "        const latest = current();\n        if (latest && 'exposure' in latest) commitComponent({ ...latest, exposure } as Component, true);", "        commitComponent({ ...c, exposure } as Component, true);"),
 ('editor not refreshed after the list visibility checkbox', 'src/ui/buildingWorkspace.ts', "commit(setVisible(project, c.id, box.checked), true);", "commit(setVisible(project, c.id, box.checked));"),
 ('3D click does not select', 'src/ui/buildingWorkspace.ts', "onSelect: (id) => select(id), announce", "onSelect: () => undefined, announce"),
 ('custom materials not offered in the building workspace', 'src/ui/shell.ts', "getMaterials: () => [...BUILT_IN_MATERIALS, ...wall.getCustomMaterials()],", "getMaterials: () => BUILT_IN_MATERIALS,"),
 ('wall pieces leave no hole for the window', 'src/geometry/house.ts', "const inHole = holes.some((h) => cu > h.u0 && cu < h.u1 && cv > h.v0 && cv < h.v1);", "const inHole = false;"),
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
