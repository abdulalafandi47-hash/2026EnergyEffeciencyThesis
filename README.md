# Building Thermal Performance & Energy Efficiency Simulator

Thesis project (Civil and Environmental Engineering): an application that lets a user build a multilayer wall from materials and dimensions, calculates its steady-state thermal properties, and (in later stages) shows it in interactive 3D.

## Current status: Stage 5 of 8 — interactive 3D view

| Stage | Content | State |
|---|---|---|
| 1 | Repository inspection, architecture | done |
| 2 | Thermal calculation engine + tests | done |
| 3 | Material database, custom materials | done (all values illustrative) |
| 4 | Wall editor + input validation (UI) | done |
| **5** | **Interactive 3D visualisation** | **done** |
| 6 | Temperature profile, results, comparison charts | not started |
| 7 | Reports and source documentation | not started |
| 8 | Full testing, limitations | not started |

A browser editor exists (`npm run dev`): build a multilayer wall, choose materials, enter thicknesses and conditions, with live validation. Beside it, a 3D view draws the validated wall (rotate, zoom, inspect layers, exploded view). It does **not** show calculation results yet (Stage 6). See `docs/wall-editor.md` and `docs/3d-viewer.md`.

## What the engine calculates

For a wall of homogeneous layers (interior → exterior): layer resistances R = d/λ, total resistance, U-value, heat-transfer rate Q̇ = U·A·|ΔT| (magnitude and direction reported separately), energy over a duration under constant conditions, heat capacity, and the steady-state temperature at every interface. See `docs/equations-and-assumptions.md`.

## Important scientific caveats

- The tests prove the code implements the documented equations. They do **not** prove the model matches real walls. See `validation/REFERENCE_CASES.md`.
- Surface resistances (R_si, R_se) presets are labelled **unverified**: they have not yet been checked against the text of ISO 6946. See `docs/sources.md`.
- The material database is **not a certified source**: all nine built-in records are `illustrative` (no source). Results built from them carry a warning. See `docs/material-database.md`. Test numbers are separate, synthetic values.
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
src/geometry/     Pure drawing arithmetic: where each layer's box sits (no 3D library).
src/viewer3d/     Three.js scene and viewer (the only place that imports the 3D library).
src/editor/       Wall editor logic: draft, unit conversion, validation (no screen code).
src/ui/           The browser screen (only displays the editor state).
src/materials/    Material database (data in a JSON file), search, custom materials, export.
src/units/        Unit conversions (mm↔m, kWh↔J, °C↔K↔°F, …). The engine only sees SI.
tests/            Automated tests; tests/fixtures/ holds the independent reference values.
validation/       Reference-value script and write-up; `browser3d.cjs` real-browser check of the 3D view.
docs/             Equations, assumptions, limitations, and the register of sources.
```

`index.html` is the browser entry page.

Planned (later stages): `src/charts/`, `src/ui/`, `src/report/`.
