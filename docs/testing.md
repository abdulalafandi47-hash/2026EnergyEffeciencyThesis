# Testing and verification (Stage 8)

How the application is tested, how to repeat every check, what each kind of test shows, and what none of them shows.

## Results at the end of Stage 8 (2026-10-28)

| Check | Result |
|---|---|
| Automated tests (`npm test`) | **1010 tests in 29 files, all pass** (after the workspace refinement) |
| Strict type check (`npm run typecheck`) | no errors |
| Production build (`npm run build`) | builds; main bundle 46 kB, 3D part 142 kB (compressed); the 3D part loads after the page is usable |
| Code coverage (`npm run test:coverage`) | 97.5 % of statements, 92.1 % of branches, 98.0 % of functions, 97.8 % of lines |
| Deliberate-bug (mutation) checks, Stages 2–8 | 189 bugs injected one at a time; all detected except 1 equivalent change (Stage 7) |
| Real-browser checks (Chromium, 3 scripts) | **158 checks, all pass** (78 + 52 + 28) |
| Accessibility scan (axe-core 4.10, 18 scans) | no serious or critical findings; no minor ones after the fixes below |
| Dependency audit (`npm audit`) | 0 known vulnerabilities |

### Building-envelope stage (2026-10-28)

| Check | Result |
|---|---|
| Automated tests (`npm test`) | **1093 tests in 33 files, all pass** (83 new: `envelope` 34, `house` 11, `houseScene` 6, `buildingUi` 29, `architecture` +3; the single-wall tests are unchanged and still pass) |
| Strict type check, production build | no errors; builds |
| Code coverage | 96.4 % of statements, 89.3 % of branches over all of `src/` (`src/envelope`: 95.2 % / 91.6 %) |
| Deliberate-bug check of the envelope code (`validation/mutation_check_envelope.py`) | 27 bugs injected one at a time; **all 27 detected** |
| Real-browser check (`validation/browser-building.cjs`, Chromium) | **18 checks, all pass**: workspace switch, 3D share of the screen, example house drawn, click-to-select in 3D, camera views, heat-flux colours, hide/show, a window U-value typed for real, axe-core scan (0 violations), phone width, no console errors |

Every element type is compared with a hand calculation in `tests/envelope.test.ts` (wall, roof with heat flowing up and down, floor over outdoor air, element next to an unconditioned space, window, layered door, and an envelope total with gains and losses mixed).

These numbers describe this commit on this machine. Run the checks again after any change.

## How to repeat the checks

```bash
npm ci                    # exact versions from package-lock.json
npm test                  # all automated tests
npm run typecheck         # strict TypeScript check
npm run build             # type check + production build into dist/
npm run test:coverage     # tests plus a coverage table (coverage/index.html)
python3 validation/reference_cases.py   # regenerate the independent reference values
python3 validation/mutation_check.py    # deliberate-bug check of the Stage 8 code (a few minutes)
python3 validation/mutation_check_envelope.py   # deliberate-bug check of the building-envelope code
```

The real-browser scripts need Playwright and a Chromium browser, which are not project dependencies (each script's header has the exact commands):

| Script | Serves | Checks |
|---|---|---|
| `validation/browser-workspace.cjs` | `npx vite preview --port 4173` | layout share of the workspace, 3D view, overlay colours counted from real pixels, arrows, coordinate axes, five camera views, results numbers against hand calculation, interaction, phone width, dark mode, reduced motion (78 checks) |
| `validation/browser-reports.cjs` | same | report tab, all downloads, report opened from disk, PDF, print, hostile text, save/open (52 checks) |
| `validation/browser-e2e.cjs` | the build in a **sub-folder** (as on GitHub Pages) | a whole session with real typing including a custom material; keyboard-only use; axe-core accessibility scans; speed and memory figures; phone layout (28 checks) |
| `validation/browser-building.cjs` | `npx vite preview --port 4173` | the building-envelope workspace: switch, 3D share, example house, picking, views, heat-flux colours, hide/show, documented window U-value, accessibility scan, phone width (18 checks) |

## What each kind of test shows

| Kind | Files | What it shows |
|---|---|---|
| Formula tests | `formulas`, `calculateWall`, `temperatureProfile`, `surfaceResistance` | each equation of `docs/equations-and-assumptions.md` gives the right number, including signs, zero and negative input handling |
| Independent reference cases | `calculateWall` + `validation/reference_cases.py` | the engine agrees (relative 1e-12) with four walls calculated separately in exact fractions; derivation in `validation/REFERENCE_CASES.md` |
| Physical relationships | `relationships` | the six relationships required by the brief (thicker insulation → lower U; higher λ → more heat; double area or ΔT → double Q̇; resistances add; units do not change results), plus layer order, Fourier's law per layer, and invariants on 500 random walls |
| Input validation | `validateWallInput`, `editorBuild`, `editorDraft`, `units` | zero, negative, missing, non-numeric and below-absolute-zero inputs are refused with a clear message; unit conversions are exact |
| Material data | `materialDatabase`, `materialValidation`, `materialNotices`, `customMaterial` | every record is complete and honest (an illustrative record cannot carry a link; a verified one needs a full source trail); custom materials are validated |
| Screen (simulated browser) | `ui`, `ui3d`, `workspace`, `materialsUi`, `reportUi` | the screen shows what the engine calculated, keeps the last valid wall on errors, and labels data status |
| 3D scene | `geometry`, `sceneBuilder`, `thermalViz` | the 3D model is built from the real geometry; colours equal the calculated temperatures |
| Reports and files | `report`, `persist` | report numbers equal the engine's and an independent hand calculation; text is escaped; wall files survive corruption and cannot inject data |
| Whole application | `application` | a complete session from an empty wall, checked against hand calculations; 14 extreme walls and 50 random walls drawn on every tab without "NaN", "Infinity" or "undefined" |
| Architecture | `architecture` | modules only use what they are allowed to (for example, the screen cannot do physics; the report cannot calculate) |
| Building envelope | `envelope`, `house`, `houseScene`, `buildingUi` | each element type against a hand calculation; correct ΔT and surface resistances per element; ground floors unsupported and partitions not counted; missing or source-less data never used; areas and model checks (openings fit, no overlaps); add / duplicate / delete with safeguards; 3D layout (walls cut around openings) and picking; the screen keeps the model, results and 3D view in step |
| Mutation checks | `validation/mutation_check.py` (the 32 Stage 8 bugs; run `python3 validation/mutation_check.py`). The scripts for Stages 2–7 were run during development but not kept in the project; their results are in the validation log. | the tests notice deliberately injected bugs |

## Defects found in Stage 8

The Stage 8 audit and tests found these defects, and each was fixed before this commit:

1. **The brief asked for custom materials and for inspecting/exporting the material database, but neither was on screen** (the code existed since Stage 3). Added the Materials tab, the custom-material form, export buttons, and custom materials in wall files (version 2).
2. **The difference between λ, R, U and C was explained only in the documentation.** Added a "Four quantities that are easy to confuse" section to the Assumptions tab, with a test that keeps its wording equal to the documentation.
3. **Accessibility (axe-core, real browser):** a wide table could not be scrolled with the keyboard; an empty table header; a role not allowed on the data-policy element. Fixed: wide tables are now focusable named regions.
4. **Phone layout:** the Materials tab made the whole page scroll sideways. A hidden table label was positioned relative to the page instead of its table, and the grid column could grow as wide as the table. Fixed in CSS; checked again at 390 px.
5. **Form usability:** after a failed submit, the cursor went to the conductivity field even when the name field (first on screen) was also wrong. Errors are now ordered as on screen.
6. **Two persistence tests were too loose** (each of two safety rules was covered only by the other). Found by the mutation check; the tests now check each rule on its own.

## What the tests do not show

- That the model predicts real walls. This needs measurements or certified software (`docs/limitations.md`, V1).
- That the built-in material values are right: they are demonstration numbers (D1).
- That the program complies with ISO 6946, EN ISO 10456 or Cyprus regulations: not checked, not claimed (S1–S3).
- That it works in Firefox, Safari or on real phones (A1), or for screen-reader users (A2).

## Indicative speed (software rendering, this machine)

Measured by `validation/browser-e2e.cjs`; a normal computer with a graphics card will differ:

- page load to a drawn 3D view: about 0.5–0.7 s;
- one edit (recalculate and redraw the results): about 6–8 ms;
- memory after 48 tab switches and 240 edits: no measurable growth (heap about 18–29 MB).
