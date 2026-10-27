# Building Thermal Performance & Energy Efficiency Simulator

Thesis project (Civil and Environmental Engineering): an application that lets a user build a multilayer wall from materials and dimensions, calculates its steady-state thermal properties, and (in later stages) shows it in interactive 3D.

## Current status: Stage 2 of 8 — calculation engine

| Stage | Content | State |
|---|---|---|
| 1 | Repository inspection, architecture | done |
| **2** | **Thermal calculation engine + tests** | **done** |
| 3 | Material database, custom materials | not started |
| 4 | Wall editor + input validation (UI) | not started |
| 5 | Interactive 3D visualisation | not started |
| 6 | Temperature profile, results, comparison charts | not started |
| 7 | Reports and source documentation | not started |
| 8 | Full testing, limitations | not started |

There is **no user interface yet**. What exists is the engine (pure calculation code) and its tests.

## What the engine calculates

For a wall of homogeneous layers (interior → exterior): layer resistances R = d/λ, total resistance, U-value, heat-transfer rate Q̇ = U·A·|ΔT| (magnitude and direction reported separately), energy over a duration under constant conditions, heat capacity, and the steady-state temperature at every interface. See `docs/equations-and-assumptions.md`.

## Important scientific caveats

- The tests prove the code implements the documented equations. They do **not** prove the model matches real walls. See `validation/REFERENCE_CASES.md`.
- Surface resistances (R_si, R_se) presets are labelled **unverified**: they have not yet been checked against the text of ISO 6946. See `docs/sources.md`.
- No material database yet. All material numbers in tests are **synthetic**.
- This is a steady-state, one-dimensional model: no thermal bridges, air cavities, windows, solar gains, ventilation or dynamic effects. The energy figure is **not** an annual energy demand.

## Running it

Requires Node.js 22.12 or newer (the test tool Vitest 5 supports Node 22 and 24; 22 LTS is recommended).

```bash
npm install            # one-time: downloads the development tools
npm test               # runs all automated tests
npm run typecheck      # checks types (catches unit/field mix-ups before running)
npm run test:coverage  # tests + which lines of src/ were executed
python3 validation/reference_cases.py   # regenerate independent reference values (rarely needed)
```

## Folder map

```
src/engine/       Calculation engine (pure maths, no UI). Start with calculateWall.ts.
src/units/        Unit conversions (mm↔m, kWh↔J, °C↔K↔°F, …). The engine only sees SI.
tests/            Automated tests; tests/fixtures/ holds the independent reference values.
validation/       Script and write-up that produce/justify the reference values.
docs/             Equations, assumptions, limitations, and the register of sources.
```

Planned (later stages): `src/materials/`, `src/geometry/`, `src/viewer3d/`, `src/charts/`, `src/ui/`, `src/report/`.
