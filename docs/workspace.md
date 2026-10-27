# Workspace and results (UI refinement + Stage 6)

Run `npm run dev`. The window is an engineering workspace: a dark top bar, a compact **inputs sidebar** on the left, a dominant **3D viewport** and a **results panel** along the bottom.

## What the model is (and is not)

The application models **one multilayer wall**: a stack of homogeneous layers with a width and a height. It does **not** model a house. A house would need several walls, roofs, floors, windows and their connections, which the data model does not describe, and whole-building simulation is out of scope. So the viewport shows the real wall and nothing invented. The selectable components are the wall's **layers** (click in 3D, in the layer list, or with a card's Inspect button). There are no other walls to select.

## Layout

| Area | Contents |
|---|---|
| Top bar | sidebar toggle (☰ Inputs), title, "Steady-state wall analysis" chip, data-policy note (click to read) |
| Sidebar (left, collapsible) | validity badge; 1 Wall dimensions; 2 Layers (material, thickness, reorder, remove, Inspect); 3 Boundary conditions and surface resistances |
| Viewport (centre, about 74 % of the main column's height; the picture alone about 64 %) | toolbar ribbon, 3D picture with ground grid, layer list and inspector (fold-away overlay), colour bar, status bar |
| Results panel (bottom, collapsible and enlargeable) | tabs: Results · Layers & temperatures · Temperature profile · Compare · Assumptions & references · Configuration; headline numbers always visible |

Hiding the sidebar gives the picture the full window width; collapsing the results panel gives it about 710 px of height at 900 px window height. On phones the 3D view comes first, then results, then the inputs; the toolbar scrolls sideways in one row and the layer list starts folded.

## 3D controls

Toolbar: **Orbit** / **Pan** (what a left-drag does), **−** / **+** zoom, **Reset**; camera views **3D**, **Interior**, **Exterior**, **Section**; switches **Thermal overlay**, **Heat flow** (arrows), **Exploded**, **Labels**, **Grid**; **Thickness** drawing scale (1×, 2×, 5×, 10×; starts at 5×, always disclosed). Also: wheel/pinch zoom, right-drag pan, arrow keys / `+` / `−` / `Home` with the picture focused. The ground grid uses round metric spacing (shown in the status bar) so sizes can be judged.

## Thermal overlay (what the colours are)

- **Colour = the temperature the calculation gives at that point in the wall**, mapped linearly from the coldest to the warmest temperature present (blue → grey → red). The colour bar shows exactly this scale.
- Each layer's two faces are coloured with the engine's temperatures at the interior-side and exterior-side face of that layer (from `q = (T_in − T_out)/R_total`, each drop = q × R, see `docs/equations-and-assumptions.md` equations 10–13). Between the faces the temperature is a straight line (steady-state conduction), sampled at 17 points per layer.
- The overlay material is **unlit**, so shading cannot alter a colour; what you see equals the colour bar.
- The surface films have no thickness in the model, so the air-to-surface drops appear in the Layers table and the profile chart, not as 3D colour.
- Layer swatches in the list and labels switch to each layer's temperature gradient while the overlay is on. Switching it off returns the material-category colours.
- Whenever the numbers rest on illustrative data, the colour bar says so.

## Heat-flow arrows

Arrows run through the wall from the warm side to the cold side (outward for heat loss, inward for heat gain, none when there is no temperature difference). **All arrows are the same size: they show direction only.** The magnitude is the number Q̇ in the results.

## Results panel

- **Results:** U, R_total, Q̇ (magnitude) with its direction shown separately in words, heat flux, energy over the chosen duration ("constant conditions; not an annual energy demand"), heat capacity (a simple sum; "Unavailable" with the layer names if density or specific heat is missing), the basis line, and the engine's warnings.
- **Layers & temperatures:** the layer-by-layer resistance table (d, λ, R = d/λ, share of R_total), the temperature at each side of every layer, the drop across it, and the two surface-film rows.
- **Temperature profile:** SVG chart of temperature against distance from the interior face, with layer bands, plus the same numbers as a table. Straight lines inside each layer; dashed vertical drops at the two air films.
- **Compare:** three one-change comparisons starting from the current wall (A thickness of one layer, B material of one layer, C outside air temperature), each with a table (U, ΔU, R_total, Q̇ with direction, ΔQ̇, heat capacity, data status), a bar chart, and an explicit list of what is held constant. Lists are typed with spaces between values (a comma is a decimal mark).
- **Assumptions & references:** the engine's assumption list, what the overlay and arrows mean, what the results are not (not dynamic, not whole-building, not annual, not a compliance check), and the status of method and data.
- **Configuration:** the validity summary and the exact SI input given to the engine.

While the editor has errors, results, overlay and arrows keep showing the **last valid wall** and are marked as such.

## Architecture additions

| Module | Role | May import |
|---|---|---|
| `src/analysis/` | the only bridge from the screen to the engine: runs the calculation, returns plain results and comparisons | engine, materials, units |
| `src/charts/` | dependency-free SVG charts | nothing |
| `src/geometry/` | now also colour map, ground-grid spec, overlay type | nothing |
| `src/viewer3d/` | now also thermal vertex-colour overlay, arrows, grid, pan/zoom | geometry, three |
| `src/ui/` | `viewerPanel.ts` (viewport), `resultsPanel.ts` (tabs), `app.ts` (sidebar + shell) | editor, materials, geometry, analysis, charts; engine and viewer for types only |

The calculation engine itself was **not changed**. `tests/architecture.test.ts` enforces these boundaries.

## Testing

`tests/analysis.test.ts` (engine bridge vs the independent reference cases, comparisons vs hand calculations), `tests/thermalViz.test.ts` (colour map, grid, chart arithmetic), `tests/charts.test.ts`, `tests/sceneBuilder.test.ts` (overlay colours at each face, arrow directions, grid with real Three.js objects), `tests/workspace.test.ts` (layout, tabs, every number shown, overlay/arrow wiring, comparisons), and the real-browser script `validation/browser-workspace.cjs` (layout proportions, drawing, colours counted from real pixels, interaction, numbers vs hand calculation, phone width).

## Limitations

- One wall only; no house, no openings, thermal bridges, air layers or ground contact.
- Steady state only: no heat storage, solar gain, ventilation or hourly weather. The headline energy figure is power × time under constant conditions.
- Every material value is illustrative; all thermal results inherit that and carry the warning. Nothing is an approved Cypriot design value and no compliance is claimed.
- The overlay and arrows are a display of the same calculation; there is no separate "thermal simulation" behind them.
- Chromium with software rendering was tested. Firefox, Safari, real GPUs and touch devices were not. Screen-reader use was designed in (labels, roles, live regions, table equivalents of both charts) but not audited.
- The `viewer3d/WallViewer.ts` shell has no unit-test coverage; it is verified by the browser script.

## To confirm with your thesis supervisor (new questions)

1. Is a **single-wall** analysis sufficient for the thesis scope, or is a multi-wall building envelope expected (a larger model change)?
2. Is the **temperature overlay** an acceptable way to present the steady-state profile, and should it start on (as now) or off?
3. Which **comparisons** matter for the thesis (insulation thickness, material, climate conditions) so they can be made reproducible and exported in Stage 7?
