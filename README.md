# Building Thermal Performance & Energy Efficiency Simulator

Thesis project (Civil and Environmental Engineering): an application that lets a user build a multilayer wall from materials and dimensions, calculates its steady-state thermal properties, and (in later stages) shows it in interactive 3D.

## Current status: Stage 7 of 8 — calculation reports and saved walls

| Stage | Content | State |
|---|---|---|
| 1 | Repository inspection, architecture | done |
| 2 | Thermal calculation engine + tests | done |
| 3 | Material database, custom materials | done (all values illustrative) |
| 4 | Wall editor + input validation (UI) | done |
| **5** | **Interactive 3D visualisation** | **done** |
| **6** | **Temperature profile, results, comparison; dark 3D-first workspace** | **done** |
| **7** | **Calculation reports (HTML/Markdown/JSON/CSV/PDF), saved walls, source documentation** | **done** |
| 8 | Full testing, limitations | not started |

A browser workspace (`npm run dev`): a compact inputs sidebar, a dominant interactive 3D view of the wall (orbit, pan, zoom, exploded view, layer inspection, ground grid, a **temperature overlay** and **heat-flow arrows** drawn from the calculation), and a bottom results panel (U, R, Q̇ with direction, energy, heat capacity, layer table, temperature profile chart, one-change comparisons, assumptions). It models **one multilayer wall**, steady state only. A **Report** tab makes a self-contained calculation report (inputs as typed and as used, material data status, results, layer table, temperature profile, equations, assumptions, limitations, references, reproducibility record), and **Save wall / Open wall** keep the inputs in a small file. See `docs/report-format.md`, `docs/workspace.md`, `docs/wall-editor.md` and `docs/3d-viewer.md`.

## What the engine calculates

For a wall of homogeneous layers (interior → exterior): layer resistances R = d/λ, total resistance, U-value, heat-transfer rate Q̇ = U·A·|ΔT| (magnitude and direction reported separately), energy over a duration under constant conditions, heat capacity, and the steady-state temperature at every interface. See `docs/equations-and-assumptions.md`.

## Important scientific caveats

- The tests prove the code implements the documented equations. They do **not** prove the model matches real walls. See `validation/REFERENCE_CASES.md`.
- Surface resistances (R_si, R_se) presets are labelled **unverified**: they have not yet been checked against the text of ISO 6946. See `docs/sources.md`.
- The material database is **not a certified source**: all nine built-in records are `illustrative` (no source). Results built from them carry a warning. See `docs/material-database.md`. Test numbers are separate, synthetic values.
- The temperature overlay, arrows and charts display the engine's steady-state numbers; they are not a separate or dynamic simulation. Results built on illustrative materials say so on screen.
- A report documents what was calculated and on what basis. It is as reliable as its inputs and is **not** a compliance document: a test checks that the report never claims compliance.
- This is a steady-state, one-dimensional model: no thermal bridges, air cavities, windows, solar gains, ventilation or dynamic effects. The energy figure is **not** an annual energy demand.

## Running it

Requires Node.js 22.12 or newer (the test tool Vitest 5 supports Node 22 and 24; 22 LTS is recommended).

```bash
npm install            # one-time: downloads the development tools
npm test               # runs all automated tests
npm run dev            # start the editor in your browser (http://localhost:5173)
npm run build          # type-check and build the app into dist/
npm run typecheck      # checks types (catches unit/field mix-ups before running)
npm run test:coverage  # tests + which lines of src/ were executed
python3 validation/reference_cases.py   # regenerate independent reference values (rarely needed)
```

## Folder map

```
src/engine/       Calculation engine (pure maths, no UI). Start with calculateWall.ts.
src/analysis/     The only bridge from the screen to the engine: results and comparisons.
src/charts/       Dependency-free SVG charts (profile, bars).
src/geometry/     Pure drawing arithmetic: box positions, colour map, grid (no 3D library).
src/viewer3d/     Three.js scene and viewer (the only place that imports the 3D library).
src/editor/       Wall editor logic: draft, unit conversion, validation, save/open of wall files (no screen code).
src/report/       Calculation report: builds a plain document from existing results, writes HTML/Markdown/JSON/CSV (no calculation, no screen code).
src/ui/           The browser screen (only displays the editor state).
src/materials/    Material database (data in a JSON file), search, custom materials, export.
src/units/        Unit conversions (mm↔m, kWh↔J, °C↔K↔°F, …). The engine only sees SI.
tests/            Automated tests; tests/fixtures/ holds the independent reference values.
validation/       Reference-value script and write-up; `browser-workspace.cjs` (3D view and results) and `browser-reports.cjs` (reports, downloads, PDF, saved walls) real-browser checks.
docs/             Equations, assumptions, limitations, and the register of sources.
```

`index.html` is the browser entry page.

Stage 8 (full application test and a consolidated list of limitations) is not started.
