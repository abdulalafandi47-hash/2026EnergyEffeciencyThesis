# Limitations (Stage 8)

This is the single list of what the application does **not** do, what that means for its results, and what would be needed to remove each limitation. It gathers the limits stated piecemeal in the other documents. If a statement here and elsewhere disagree, treat it as a defect and correct both.

Short version: the program calculates the **steady-state** thermal performance of **one multilayer wall** made of **homogeneous layers**, using the textbook ISO 6946-style series-resistance method. Its arithmetic is well tested. Its **material data are demonstration values**, its surface resistances are **unverified**, it has **not** been compared with measurements or certified software, and it makes **no compliance claim**.

Each limitation has an id (M = model, D = data, S = standards and regulation, V = verification and validation, A = application software) so the thesis can refer to it.

## 1. Physical model

| Id | Limitation | What it means for results | What would remove it |
|---|---|---|---|
| M1 | **Steady state only.** Inside and outside air temperatures are constant; no heat is stored or released over time. | Results describe a wall that has settled under fixed conditions. Daily temperature swings, thermal mass effects, time lag and decrement (important in Cyprus summers) are not represented. | A transient model, for example the dynamic characteristics of ISO 13786 or a finite-difference solution, with hourly weather. |
| M2 | **One-dimensional heat flow** through **thermally homogeneous layers**, over the whole width × height. | Thermal bridges (columns, beams, slab edges, wall ties, mortar joints, fixings, studs) are ignored. Real walls usually lose more heat than calculated. | Thermal-bridge methods (linear and point transmittances, numerical 2-D/3-D calculation) and the inhomogeneous-layer procedure of ISO 6946. |
| M3 | **No air layers or cavities**, no windows, doors, ground contact, roofs or floors. | A cavity wall cannot be modelled correctly: an air gap entered as a "material" would be wrong. | Air-layer resistances from the standard, and further building elements. |
| M4 | **One wall, not a building.** | No room or building heat balance, no heating or cooling load, no annual energy use, no comparison with a reference building. | A whole-building model, explicitly out of scope for this project stage. |
| M5 | **Surface resistances are fixed numbers.** Only a horizontal-heat-flow preset (R_si 0.13, R_se 0.04 m²·K/W) or two typed values. | Wind speed, radiation exchange and surface emissivity are not calculated. Heat flow up or down (roofs, floors) needs other values. | Choosing values per assessment purpose from the verified standard. Other presets once checked. |
| M6 | **No solar radiation, air leakage, ventilation or moisture.** | Sol-air temperature, infiltration losses, latent heat, condensation and mould risk are not assessed. | Separate methods (for example a Glaser-type or transient hygrothermal analysis for moisture), each a project of its own. |
| M7 | **Properties do not change with temperature or moisture.** λ, ρ and c_p are used exactly as entered. | A wet or hot insulation behaves differently from the entered value. | EN ISO 10456 conversion procedures plus the conditions of each value. |
| M8 | **Energy = power × duration under constant conditions.** | The kWh figure is **not** an annual energy demand and cannot be compared with energy certificates. | Weather data and a dynamic or degree-hour method. |
| M9 | **Heat capacity is a simple sum** (Σ ρ·c_p·V). | It says how much heat the wall can store per kelvin. It does not predict how the wall responds to changing temperatures, and layer order does not affect it. | A transient model (M1). |
| M10 | **No Cypriot climate data** are used. The brief's long-term aim, energy efficiency under Cyprus climatic conditions, is not started. | Boundary temperatures are whatever the user types. | Verified climate data (for example a typical meteorological year for a Cypriot location) and a dynamic model. |

## 2. Data

| Id | Limitation | What it means | What would remove it |
|---|---|---|---|
| D1 | **All 9 built-in material records are illustrative** demonstration numbers with **no source** (`status: illustrative`, `valueType: unspecified`). **No record is verified.** | Any result from built-in materials is a demonstration. The program says so on screen and on the first page of every report. | Replace values with checked ones from a named source, with table, conditions, date and checker (the validator refuses a "verified" record without them). See `docs/material-database.md`. |
| D2 | **No value is confirmed as an approved Cypriot design value.** | Do not present results as Cyprus design results. | Identify the governing document (see `docs/sources.md`, section 0) and check values against it. |
| D3 | **Custom materials are not checked** (`status: user-defined`). | They are only as good as what was typed. The report says so and prints the source note and conditions the user gave. | Users should record where every number comes from; a supervisor can review the report's source table. |
| D4 | **Measured, declared and design values are not converted.** The program records which kind a value is, but does not convert between them. | A declared (manufacturer) λ is not automatically a design λ for a Cypriot wall. | Implementing EN ISO 10456 conversions, after checking the standard. |
| D5 | **Surface-resistance preset is unverified**: three secondary sources agree, the standard itself was not read. | U-values depend on these numbers (they add 0.17 m²·K/W to R_total). | Check against ISO 6946 (`docs/sources.md`, section 2 checklist). |
| D6 | **Material data are stored by id.** A saved wall uses the built-in values of the program that opens it. | If the built-in database changes, an old wall gives new numbers. The file keeps a snapshot and the program warns about differences. | Nothing more is needed; keep the warning. |

## 3. Standards and regulation

| Id | Limitation | What it means | What would remove it |
|---|---|---|---|
| S1 | **ISO 6946 text not read.** The method follows its basic homogeneous-layer approach as commonly described, but the implementation has not been checked clause by clause. | **No compliance with ISO 6946 is claimed.** | Obtain the standard (library), check method, scope, surface resistances and rounding rules, and record the result in `docs/sources.md`. |
| S2 | **Cyprus adoption (CYS EN ISO 6946) and its edition are unconfirmed.** EN ISO 10456 edition taken from catalogue searches only. | Citations in the thesis need the confirmed editions. | Ask CYS or the university library. |
| S3 | **No regulatory check.** Cyprus energy-performance requirements (for example U-value limits) were not read or used. | The program cannot say whether a wall is acceptable. A test makes sure it never claims compliance. | Read the applicable regulation and add a clearly sourced comparison, if the thesis needs one. |

## 4. Verification and validation

| Id | Limitation | What it means | What would remove it |
|---|---|---|---|
| V1 | **Verification, not validation.** The tests show the code reproduces the documented equations, independent exact-fraction reference cases and physical relationships. | Passing tests does **not** show that the model predicts real walls. | Compare with measured data (for example a heat-flow-meter test of a real wall, or published measurements) and with certified software. |
| V2 | **The independent reference cases were written by the same developer** (exact fractions in Python, `validation/reference_cases.py`), from the same reading of the equations. | A misunderstanding of an equation would appear in both. | A worked example from the standard, a textbook or certified software, checked by someone else. |
| V3 | **Deliberate-bug (mutation) checks cover only the bugs that were tried**: 189 in total over Stages 2–8. All were eventually detected except one Stage 7 change that has no observable effect (an "equivalent" mutant). | A kind of mistake nobody thought of could still pass. | More varied mutations, or a mutation-testing tool. |
| V4 | **Coverage is high but not complete** (97.5 % of statements, 92 % of branches). The uncovered parts are browser-only file saving and printing (tested in the real-browser scripts instead) and defensive fallbacks that cannot be reached. | Lines that never run in a test could hide a defect. | `npm run test:coverage` lists them; add tests if any becomes reachable. |

## 5. Application software

| Id | Limitation | What it means | What would remove it |
|---|---|---|---|
| A1 | **Tested in Chromium only** (headless, software 3D rendering). Firefox, Safari, real phones and touch gestures were not tested. | Another browser may show layout or 3D differences. | Run `validation/*.cjs` with other Playwright browsers; try on real devices. |
| A2 | **Accessibility was checked with automated rules** (axe-core: no serious or critical findings in 18 scans, keyboard-only checks) **but not with screen-reader users.** The 3D picture itself cannot be read by a screen reader; the layer list and tables carry the same information. | Some barriers can only be found by people using assistive technology. | A session with screen-reader users (NVDA, VoiceOver). |
| A3 | **Custom materials live only in the open tab.** They are lost on reload unless the wall is saved (the wall file keeps them). | Unsaved work can be lost. | Save the wall. A future version could keep them in browser storage. |
| A4 | **No undo**, and opening a wall replaces the current inputs. | Mistakes must be corrected by hand. | Save before experimenting. |
| A5 | **English only.** A decimal comma is accepted, so "1,200" means 1.2, not 1200. The value in metres is shown next to every thickness so such a slip is visible. | Typing thousands separators gives wrong inputs. | Enter numbers without thousands separators. |
| A6 | **Results on screen show 4 significant digits.** Reports show 5–6; the JSON export holds full precision. | Hand-checking against rounded screen values can differ in the last digit. | Use the JSON export for exact numbers. |
| A7 | **The 3D view needs WebGL.** Without it, the program works in text-only mode and says so. | No 3D picture on very old devices. | None needed. |
| A8 | **Reports are not signed** and record neither the source-code revision nor the test results. The time comes from the user's computer clock. | A report shows what was calculated, not who made it or when beyond doubt. | Keep the JSON export and the wall file with the thesis data. |
| A9 | **The GitHub Pages preview is public** while the repository is public: anyone with the link can use it. The app sends no data anywhere. | Fine for a demonstration; the preview is not private. | Make the repository private again (the preview then stops), or use another host. |
| A10 | **Large walls**: tested up to 60 layers on screen and 200 in wall files. Very thin layers (micrometres) are drawn with an enlarged thickness, which the screen discloses. | None for normal walls. | None needed. |

## 6. What the program can be relied on for

Within the limits above, and with real (sourced) input values:

- the arithmetic of R = d/λ, R_total, U, Q̇ (magnitude and direction), flux, constant-condition energy, heat capacity and the steady-state temperature profile, checked against independent exact calculations (`validation/REFERENCE_CASES.md`);
- comparisons that change one thing at a time, with everything else held identical;
- a complete record of inputs, assumptions, equations and data status in every report.

It should not be relied on for design decisions, compliance, dynamic behaviour, moisture risk or annual energy use.
