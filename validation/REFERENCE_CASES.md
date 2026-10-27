# Reference cases and validation record

## What these cases are (and are not)

The cases below test that the code **implements the stated equations correctly**. They are *verification* of the software against its own mathematical specification.

They do **not** validate the physical model against reality. That would need measurements (for example a guarded hot-box result or monitored wall data) or comparison with independent, established software. Passing these tests therefore must not be described as "scientifically validated".

All inputs are **synthetic** numbers chosen to give clean arithmetic. They are not real material data.

## How the expected values were produced

`validation/reference_cases.py` solves each case with Python's `fractions.Fraction` (exact rational arithmetic, no rounding) and writes `tests/fixtures/reference-cases.json`. The TypeScript tests feed the same inputs to the engine and compare. Different language, different arithmetic, no shared code.

The script also checks itself with **Fourier's law applied layer by layer**: λ·(T_hot − T_cold)/d must equal the wall's heat flux in every layer, exactly. It also checks that the outside surface temperature is the same whether reached from the inside or the outside.

To reproduce: `python3 validation/reference_cases.py` (rewrites the JSON; review the Git diff afterwards).

## Case A — four-layer wall, winter heat loss (hand derivation)

Layers interior → exterior, 3.0 m × 2.5 m, T_i = 20 °C, T_e = 5 °C, 24 h, R_si = 0.13, R_se = 0.04 m²·K/W.

| Layer | d (m) | λ (W/(m·K)) | R = d/λ | ρ (kg/m³) | c_p (J/(kg·K)) | ρ·c_p·d (J/(m²·K)) |
|---|---|---|---|---|---|---|
| Plaster (test) | 0.015 | 0.50 | 0.030 | 1200 | 1000 | 18 000 |
| Masonry (test) | 0.200 | 1.00 | 0.200 | 2000 | 1000 | 400 000 |
| Insulation (test) | 0.080 | 0.040 | 2.000 | 30 | 1500 | 3 600 |
| Render (test) | 0.020 | 0.80 | 0.025 | 1800 | 1000 | 36 000 |

- ΣR = 0.030 + 0.200 + 2.000 + 0.025 = 2.255
- R_total = 0.13 + 2.255 + 0.04 = **2.425 m²·K/W** (= 97/40)
- U = 1/2.425 = **40/97 ≈ 0.41237 W/(m²·K)**
- A = 3.0 × 2.5 = 7.5 m²; ΔT = 15 K
- Q̇ = (40/97) × 7.5 × 15 = **4500/97 ≈ 46.392 W**, outward
- E = 4500/97 × 24 / 1000 = **108/97 ≈ 1.1134 kWh**
- C_A = 18 000 + 400 000 + 3 600 + 36 000 = **457 600 J/(m²·K)**; C = 457 600 × 7.5 = **3 432 000 J/K**
- Heat flux q = 15/2.425 = 600/97 ≈ 6.1856 W/m². Temperatures:
  - inside surface 20 − 6.1856 × 0.13 = 19.1959 °C
  - after plaster 19.1959 − 6.1856 × 0.03 = 19.0103 °C
  - after masonry − 6.1856 × 0.2 = 17.7732 °C
  - after insulation − 6.1856 × 2.0 = 5.4021 °C
  - after render (outside surface) − 6.1856 × 0.025 = 5.2474 °C
  - check: 5 + 6.1856 × 0.04 = 5.2474 °C ✓
  - the insulation takes 12.37 K of the 15 K total drop (82 %).

## Case B — one layer, no surface films (checkable in your head)

0.30 m thick, λ = 0.60, R_si = R_se = 0, 5.0 m × 2.0 m, 21 °C inside, 1 °C outside, 10 h.
R = 0.5; U = λ/d = **2 W/(m²·K)**; Q̇ = 2 × 10 × 20 = **400 W**; E = 400 × 10/1000 = **4 kWh**.

## Case C — same wall as A, heat gain

Inside 24 °C, outside 35 °C, 12 h. Same U. Q̇ = (40/97) × 7.5 × 11 = 3300/97 ≈ 34.02 W, direction **inward**. The temperature rises from inside to outside in reverse, so the inside surface is *warmer* than the inside air.

## Case D — three layers, outside below zero

Board / brick / foam (synthetic), 4.0 m × 2.7 m, 21 °C inside, −3 °C outside, 8 h. R_total = 93/25 = 3.72, U = 25/93 ≈ 0.26882, Q̇ = 2160/31 ≈ 69.68 W outward, outside surface −2.74 °C.

## Other checks in the test suite (not reference numbers)

Physical relationships that must hold for any correct calculation, checked on named examples and on 500 seeded random walls: more insulation → lower U; higher λ → more heat transfer; double area → double Q̇; double ΔT → double Q̇; layer resistances sum to R_total; temperature drops proportional to resistance; temperatures between the two air temperatures; Fourier's law in every layer; changing display units (mm/cm/m, °C/K/°F, kWh/Wh/J) does not change the physical result.

## Validation log

| Date | Activity | Result |
|---|---|---|
| 2026-10-27 | Engine vs. exact-arithmetic reference cases A–D (`tests/calculateWall.test.ts`) | Agree to a relative tolerance of 1e-12 |
| 2026-10-27 | 281 automated tests, strict TypeScript typecheck | All pass; 100 % line coverage of `src/` |
| 2026-10-27 | Mutation check: 14 deliberate bugs injected one at a time (wrong formula, dropped term, sign error, wrong unit factor, accepting zero thickness, …) | All 14 detected by the test suite |
| — | Comparison with measured data or certified software | **Not done.** Needed before any claim of physical validation. |
| — | Check of surface-resistance presets and method against ISO 6946:2017 text | **Not done.** See `docs/sources.md`. |
| 2026-10-27 | Stage 3: 385 automated tests in total (material integrity, validation rules, search, export, custom materials, database→engine); 14 further deliberate bugs injected in the material code | All tests pass; all 14 bugs detected |
| 2026-10-27 | Stage 4: 581 automated tests in total (editor logic, 2000-draft editor/engine consistency fuzz, UI in a simulated browser, module-boundary rules); 16 further deliberate bugs injected in editor/UI code. Built app also driven in real Chromium (typing, keyboard reordering, unit changes, 375 px layout, dark mode). | All pass; all 16 bugs detected; the browser run found two layout/readability defects, now fixed |
| 2026-10-27 | Stage 5: 709 automated tests in total (geometry arithmetic, Three.js scene in Node, page behaviour with a fake viewer, module boundaries); 17 further deliberate bugs injected in geometry/viewer/UI code (one initially survived, exposing that scene tests only used true scale; test added, then caught). Real Chromium run (`validation/browser-workspace.cjs`, software WebGL): 40 checks incl. click-to-inspect, exploded/camera views, keyboard, mouse, invalid-input behaviour, phone width, dark mode, reduced motion. | All pass. The browser run found and led to fixes for: sliver-thin layers at true scale (default now 5x, disclosed), labels clipped at phone width, canvas jumping when messages appeared, last valid wall being dropped on invalid input. Firefox/Safari/GPU/touch hardware not tested. |
| 2026-10-27 | Workspace refinement + Stage 6: 866 automated tests in total (analysis vs the independent reference cases and hand calculations, colour map, grid, charts, real Three.js overlay/arrow/grid objects, workspace and results panel, comparisons); 32 further deliberate bugs injected in analysis/geometry/viewer/UI/chart code. Real Chromium run (`validation/browser-workspace.cjs`, software WebGL): 70+ checks incl. layout proportions (viewport 74 % of the main column), overlay colours counted from real pixels, arrows, results numbers vs hand calculation, interaction, phone width. | All pass; all 32 bugs detected. The browser run found and led to fixes for: a stage that was only ~55 % of the area, oversized arrows, an overcrowded phone toolbar and layer overlay, a unit shown inside a number tile, percentages wrapping in table cells, and brittle exact-pixel comparisons (now tolerance-based). Firefox/Safari/GPU/touch not tested. |
| 2026-10-27 | Stage 7 (reports and saved walls): 949 automated tests in total in 25 files (report content against the engine and against an independent hand calculation; drift of equations and references against the documents; HTML/Markdown/CSV escaping with hostile text; wall-file round trip and 400 random corruptions; Report tab and Save/Open driven in a simulated browser); 64 further deliberate bugs injected in report, wall-file and screen code. Real Chromium run (`validation/browser-reports.cjs`): 52 checks incl. all five downloads, the JSON U-value against an independent hand calculation (relative difference below 1e-9), the downloaded HTML opened from disk (no network, no script), a PDF made with the print layout, `print()` called once on the report, hostile title/notes, save → change → open, refused files, phone width; the older `browser-workspace.cjs` still passes (73 checks). Clean `npm ci`, build and test run. | All pass. 61 bugs were caught at once; 2 survived at first (comparison percentage columns; report following the edited draft), tests were added, then both were caught; 1 is an equivalent change with no observable effect. Looking at the PDF pages (not an automated check) found narrow table columns breaking words letter by letter and table captions separated from their tables; both fixed. Firefox/Safari not tested; headless Chromium cannot show a print dialog, so `print()` is recorded rather than executed. |
