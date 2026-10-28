# Building Thermal Performance & Energy Efficiency Simulator

Thesis project (Civil and Environmental Engineering): a browser application that lets a user build a multilayer wall from materials and dimensions, calculates its steady-state thermal properties, shows it in interactive 3D, compares alternatives and writes a calculation report.

## Current status: all 8 stages done (Stage 8: whole-application testing and limitations)

| Stage | Content | State |
|---|---|---|
| 1 | Repository inspection, architecture | done |
| 2 | Thermal calculation engine + tests | done |
| 3 | Material database, custom materials | done (all values illustrative) |
| 4 | Wall editor + input validation (UI) | done |
| **5** | **Interactive 3D visualisation** | **done** |
| **6** | **Temperature profile, results, comparison; dark 3D-first workspace** | **done** |
| **7** | **Calculation reports (HTML/Markdown/JSON/CSV/PDF), saved walls, source documentation** | **done** |
| **8** | **Whole-application testing, requirements audit, limitations; custom materials and the material database on screen** | **done** |

A browser workspace (`npm run dev`): a compact inputs sidebar, a dominant interactive 3D view of the wall (orbit, pan, zoom, exploded view, layer inspection, ground grid, a **temperature overlay** and **heat-flow arrows** drawn from the calculation), and a bottom results panel (U, R, Q̇ with direction, energy, heat capacity, layer table, temperature profile chart, one-change comparisons, assumptions). It models **one multilayer wall**, steady state only. A **Report** tab makes a self-contained calculation report (inputs as typed and as used, material data status, results, layer table, temperature profile, equations, assumptions, limitations, references, reproducibility record), and **Save wall / Open wall** keep the inputs in a small file. A **Materials** tab shows the whole material database (values, status, source, conditions, limitations), exports it, and lets you **add custom materials**, for example a manufacturer's declared value, which are then labelled "user-defined" everywhere. See `docs/report-format.md`, `docs/workspace.md`, `docs/wall-editor.md` and `docs/3d-viewer.md`.

## What the engine calculates

For a wall of homogeneous layers (interior → exterior): layer resistances R = d/λ, total resistance, U-value, heat-transfer rate Q̇ = U·A·|ΔT| (magnitude and direction reported separately), energy over a duration under constant conditions, heat capacity, and the steady-state temperature at every interface. See `docs/equations-and-assumptions.md`.

## Important scientific caveats

- **Read `docs/limitations.md`** before using any result. It lists every limitation with an id you can cite.
- The tests prove the code implements the documented equations (995 automated tests, 153 real-browser checks; see `docs/testing.md`). They do **not** prove the model matches real walls. See `validation/REFERENCE_CASES.md`.
- Surface resistances (R_si, R_se) presets are labelled **unverified**: they have not yet been checked against the text of ISO 6946. See `docs/sources.md`.
- The material database is **not a certified source**: all nine built-in records are `illustrative` (no source). Results built from them carry a warning. To use real data, add a custom material with its source and conditions; it is labelled `user-defined` and not checked by the program. See `docs/material-database.md`. Test numbers are separate, synthetic values.
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
validation/       Reference-value script and write-up; `mutation_check.py` (deliberate-bug check); real-browser checks: `browser-workspace.cjs` (3D view and results), `browser-reports.cjs` (reports, downloads, PDF, saved walls), `browser-e2e.cjs` (whole session, keyboard, accessibility scan, sub-folder hosting).
docs/             Documentation (see the list below).
```

`index.html` is the browser entry page.

## Documentation

| Document | What it holds |
|---|---|
| `docs/limitations.md` | **every limitation**, with ids (M, D, S, V, A) to cite |
| `docs/testing.md` | how to repeat every check, what each proves, latest results, defects found in Stage 8 |
| `docs/requirements-traceability.md` | each requirement of the project brief → implementation → evidence → status |
| `docs/equations-and-assumptions.md` | symbols, the 13 equations, assumptions, the four easily confused quantities |
| `docs/sources.md` | standards and sources with their verification status, and the open questions |
| `docs/material-database.md` | record format, data status rules, custom materials, how to verify a record |
| `docs/wall-editor.md`, `docs/3d-viewer.md`, `docs/workspace.md` | the screen: inputs, 3D view, results panel |
| `docs/report-format.md` | calculation reports and the saved-wall file |
| `validation/REFERENCE_CASES.md` | independent reference calculations and the validation log |

## Preview without installing anything

Every push to `master` runs `.github/workflows/preview-pages.yml`, which tests, builds and publishes the app to the `gh-pages` branch. With GitHub Pages switched on (repository Settings → Pages → Deploy from a branch → `gh-pages`, `/ (root)`), it is at `https://abdulalafandi47-hash.github.io/2026EnergyEffeciencyThesis/`. GitHub only serves Pages from a **public** repository on a free plan, so anyone with the link can open it. The app sends no data anywhere.
