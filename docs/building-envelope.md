# Building envelope workspace

The building-envelope workspace extends the single-wall calculator to a whole, simplified building shell: exterior walls, interior partitions, a roof, a floor, windows, glazed doors and opaque doors. Each element is calculated **on its own, in steady state, for one stated condition**, and the results are added up with the correct temperature difference for each element.

It is **not** an energy simulation: there is no weather, no hourly or annual calculation, no cooling demand, no solar gains, no ventilation and no thermal bridges. Nothing it shows is a compliance check. See the limitations in `docs/limitations.md` (ids M11–M17, D7–D8).

Open it with the **Building envelope** button in the top bar (or the address `…/#building`), or from the welcome page shown on the first visit (**Help** in the top bar opens it again). The single-wall calculator is one click away; switching keeps what was typed in both.

## 1. Starting a project

| Button | What you get |
|---|---|
| **New blank project** | A 10 × 8 × 3 m box with no components. Nothing is calculated until you add components and enter their data. |
| **Load example house** | A 10 × 8 × 2.8 m single-storey house with 4 walls, a flat roof, a ground floor, a partition, 5 windows, a glazed door and an entrance door. |

The example house is **illustrative**: its dimensions, layers and condition (26 °C inside, 35 °C outside) were chosen for demonstration. It is not a real or verified building, its materials are the illustrative built-in records, and its windows and doors deliberately have **no U-values**: they show as *Missing data* until you enter documented values. You can edit everything; *Load example house* again resets it. Replacing a project asks first whenever unsaved work would be lost.

### Saving, opening and keeping projects

| Control | What it does |
|---|---|
| **Project name** | The name used in the library, the file name and the report. |
| **Save** | Keeps the project in *this browser* (a library of named projects). Saving again updates the same entry; **Save as copy** makes a new one. |
| **Projects saved in this browser** | The library: open or delete (asks first) any saved project. Several independent projects can be kept. |
| **Download project file** | A `.building.json` file with the whole model, the documented window and door values with their sources, and the custom materials the project uses. Keep it with the thesis or send it to a supervisor. |
| **Open project file…** | Opens such a file. Damaged or foreign files are refused in plain words and the current project stays. A file cannot raise the trust of a value: custom materials and documented values from a file must be *user-defined*. |

The last project (and the last wall) is also kept automatically and comes back on the next visit. Browser storage belongs to this browser on this computer only and can be unavailable (private windows) or full; the program then says so and keeps working, and the project file remains the safe way to keep work (limitation A3).

### Undo, units and the layout

- **Undo / Redo** (top bar; Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y outside text fields) take back additions, deletions (a wall with its openings), layer changes, typing (one step per burst of typing), unit changes and loading another project. At most 100 steps; the history is not kept after a reload.
- **Units** (section 3): temperature in °C, K or °F and layer thickness in mm, cm or m, shared with the single-wall calculator. Only what is shown and typed changes; the model, the calculation and the reports stay in SI (°C, m). House dimensions are always in metres.
- Each sidebar section folds from its heading. The results panel can be made taller by dragging its top edge (or with the arrow keys on that handle; Home restores it); the height is remembered.

## 2. The building model

A parametric, single-zone box (`src/envelope/types.ts`, `src/envelope/geometry.ts`):

- **External dimensions** length (east–west) × depth (north–south) × storey height. Axes: x east, y up, z south.
- **Exterior walls**, one per side (north, east, south, west). Each spans its whole side, so the corners are counted in both walls (a simplification; listed in the assumptions). A wall's net area = gross area − its openings.
- **Roof**: one flat roof over the footprint. **Floor**: one floor over the footprint.
- **Partitions**: interior walls running north–south across the full depth, placed by their distance from the west face.
- **Openings** (windows, glazed doors, opaque doors) sit in an exterior wall, placed by their offset from the wall's left end **as seen from outside**, their sill height, width and height. They must fit inside the wall and must not overlap; the model check reports any that do not.

Each element has an **exposure** (what is on its other side):

| Exposure | Allowed for | Other-side temperature |
|---|---|---|
| Outdoor air | walls, roof, floor (e.g. over a pilotis/open car park) | the outdoor temperature of the condition |
| Unconditioned space | walls, roof, floor, partitions | a temperature you enter (nothing is assumed) |
| Ground | floor | — (not supported, see below) |
| Conditioned space | partitions | the inside temperature (ΔT = 0) |

## 3. What is calculated for each element

| Element | Method | Surface resistances (R_si / R_se, m²·K/W) | Status if data are incomplete |
|---|---|---|---|
| Exterior wall | layers → R = d/λ, R_total, U, Q̇, temperatures, heat capacity (the unchanged wall engine) | 0.13 / 0.04 (horizontal heat flow) | *Missing data* (no layers, material or thickness) |
| Roof (zone below) | same | 0.10 / 0.04 when the inside is warmer (heat flows up); 0.17 / 0.04 when it is cooler (heat flows down) | same |
| Floor over outdoor air (zone above) | same | 0.17 / 0.04 when the inside is warmer (heat flows down); 0.10 / 0.04 when it is cooler | same |
| Any element next to an unconditioned space | same | R_si for that heat-flow direction on **both** sides | also needs the space's temperature |
| Partition between conditioned rooms | not counted (ΔT = 0); its heat capacity is shown | — | *Not counted* |
| Ground-contact floor | **not supported**: EN ISO 13370 is not implemented. Σ d/λ and heat capacity are shown for information | — | *Unsupported*, listed under *Not included* |
| Window / glazed door | Q̇ = U_w · A · ΔT with a **documented** overall U-value | included in U_w | *Missing data* without U; *Invalid* if U has no source |
| Opaque door | documented U_D, **or** layers calculated like a wall | included in U_D / 0.13 / 0.04 | same |

All surface-resistance values are the commonly quoted ISO 6946 presets, labelled **unverified** (`docs/sources.md`, section 2). Using R_si on both sides next to an unconditioned space is a common simplification, also **unverified**.

For each element:

- ΔT = T_inside − T_other side.
- Q̇ = U · A · ΔT. A positive Q̇ means heat leaves the conditioned zone (a loss); a negative one means heat enters it (a gain).
- A is the net area: wall minus openings; opening width × height; roof and floor = footprint.

**Windows and solar gains.** The g-value and the shading reduction factor can be recorded with their sources, but they are **stored only**: solar gains need solar irradiance per orientation (weather data), which belongs to the next stage. Only conduction is calculated.

**Documented values.** A window or door U-value is entered with its value, unit, **source** (required), value type (measured / declared / design / unspecified) and test conditions. It is stored as *user-defined*: the program does not check it. A value without a source is refused (*Invalid*) and not used. No default window or door U-value exists anywhere in the program.

### Equations

These are exactly the equations listed in every building report (`BUILDING_EQUATIONS` in `src/report/content.ts`; `tests/buildingReport.test.ts` checks that both stay the same):

| # | Equation | Meaning |
|---|---|---|
| 1 | `R = d / λ` | Resistance of one homogeneous layer of thickness d and conductivity λ. |
| 2 | `R_total = R_si + Σ(d_i / λ_i) + R_se` | Resistances in series of a layered element, with the surface resistances for its heat-flow direction and exposure. |
| 3 | `U = 1 / R_total` | Thermal transmittance of a layered element. Windows and documented doors use their documented overall U-value instead. |
| 4 | `A_wall = L_side × H − Σ A_openings` | Net area of an exterior wall: its whole side minus its windows and doors. Openings: width × height; roof and floor: length × depth. |
| 5 | `ΔT_i = T_inside − T_other,i` | Temperature difference of each element, with the temperature on ITS other side (outdoor air or an unconditioned space). |
| 6 | `Q̇_i = U_i · A_i · ΔT_i` | Heat flow through one element; positive = heat leaving the conditioned zone, negative = heat entering it. |
| 7 | `Q̇_net = Σ Q̇_i (calculated elements only)` | Net conductive heat flow of the envelope. Elements that are not calculated are listed, never estimated. |
| 8 | `E = Q̇_net · t / 1000` | Energy in t hours at constant conditions, in kWh. Not an annual demand. |
| 9 | `C = Σ ρ_i · c_p,i · A · d_i` | Heat capacity of the layered elements (thermal-mass indicator, a simple sum). |

## 4. The envelope total

Results panel, *Envelope results* tab:

- **Net conductive heat flow** Σ Q̇ᵢ = Σ Uᵢ·Aᵢ·ΔTᵢ over the **calculated** elements only, each with its own ΔT, so elements facing outdoor air and unconditioned spaces are never mixed under one ΔT.
- **Gains** and **losses** separately (elements with heat flowing in and out).
- **Energy** = net heat flow × duration, under constant conditions. Not an annual energy use or cooling demand.
- **Heat capacity** Σ ρ·c_p·V of all layered elements, partitions included, as a thermal-mass indicator only.
- A table of every element: type, net area, U, R_si / R_se, ΔT, Q̇ with direction, share of Σ|Q̇| and status. Click a name to select it.
- Areas by element type.

The *Not included* tab lists every element missing from the total and why (missing data, unsupported, invalid, not counted). The *Assumptions* tab lists the eleven modelling assumptions (`ENVELOPE_ASSUMPTIONS` in `src/envelope/calculate.ts`).

Partitions are never counted as exterior losses, and an element that is not calculated is never filled with a guessed value.

## 5. The 3D view

About 70–80 % of the screen width on a 1440 × 900 screen (82 % measured). Every component is drawn from the model; walls are cut around their openings, glass is translucent, and a partition stands at its real position. The drawing thickness of an element is the sum of its layer thicknesses (0.2 m if it has none yet; the status bar says so).

- **Navigation**: orbit, pan, zoom (mouse, buttons or keys), reset.
- **Views** (the **View** menu): 3D from SE / SW / NE / NW, plan (north at the top), and the four elevations north, east, south, west. Compass letters mark the sides.
- **Selection**: click an element to select it; it is highlighted (all its pieces) and opened in the editor; the list and the results table follow. Click empty space to clear.
- **Colours**: by element type, or by the calculated steady-state heat flux |q| = |Q̇|/A on a scale from 0 to the largest element value. Elements without a result are grey.
- **Hide / show** an element with its checkbox in the component list. A hidden element keeps its data and is still calculated.
- Grid (1 m) and x/y/z axes can be switched off.

## 6. Editing components

In the sidebar: the project, the house dimensions, the condition (name, inside and outdoor air temperature, duration), the component list and the editor of the selected component.

- **Add**: choose a type and press *Add*. Types that cannot be added (a fifth wall, a second roof) are refused with the reason. A new window or door goes into the selected wall (or the first wall). New components carry no thermal data.
- **Edit**: name, side, exposure (and the space temperature), layers (material, thickness in mm, order, add/remove), position and size of openings, documented values. Invalid typing shows a message and changes nothing.
- **Duplicate**: walls go to a free side; openings are placed beside the original if they fit. A roof or floor cannot be duplicated (only one of each).
- **Delete**: always asks; deleting a wall names and deletes its openings too.
- The selected element's results: status and reasons, U, R_total, Σ d/λ, surface resistances used, other-side temperature, ΔT, Q̇, heat capacity, the layer table with interface temperatures, and the documented values with their sources. A **?** next to U, R, Q̇, q, R_si and R_se explains each in one or two sentences.
- **Missing data**: a checklist above the component list names every element that is not calculated because data are missing or invalid, with the reason. Clicking an entry selects the element and puts the cursor in the field to fill in (its U-value, the source, a layer, a space temperature). The *Not included* tab does the same. Elements that cannot be calculated in this stage (ground floors) are listed separately.

## 6a. The building report

The **Report** tab of the results panel produces a report of the current project as HTML (also opens offline), Markdown, JSON (all numbers at full precision, with the project) or CSV (one row per element), or prints it (choose *Save as PDF*). It contains: the project and condition; every component as entered; each element's result with its layer table; the documented window and door values with their sources; the totals and **what they leave out and why**; the equations (below); the assumptions and limitations; and the project itself with a fingerprint for reproducibility. Banners at the top say when the example is illustrative, when totals are incomplete, when values are illustrative or user-defined, and that surface resistances are unverified. Values that were not calculated read "not available" (empty in CSV), never 0. No number is recalculated for the report.

Custom materials defined in the single-wall calculator (*Materials* tab) appear in the layer material lists, so a manufacturer's declared value can be used with its source.

## 7. Code

| Folder / file | Role |
|---|---|
| `src/envelope/types.ts` | the building model (components, exposures, documented values) |
| `src/envelope/geometry.ts` | dimensions, areas and the model check |
| `src/envelope/calculate.ts` | per-element calculation (reusing `calculateWall`), surface resistances, totals, assumptions |
| `src/envelope/edit.ts` | blank project, example house, add / duplicate / delete / update, safeguards |
| `src/geometry/house.ts`, `fluxColor.ts` | pure 3D layout (boxes, walls cut around openings) and the flux colour scale |
| `src/envelope/persist.ts` | building project files (save / open, with the checks above) |
| `src/report/buildingReport.ts` | the building report (formats results; never calculates) |
| `src/viewer3d/houseScene.ts`, `houseViewer.ts` | Three.js scene, picking, views |
| `src/ui/buildingWorkspace.ts`, `buildingResults.ts`, `houseViewerPanel.ts`, `houseSpec.ts`, `shell.ts` | the screen and the workspace switch |
| `src/ui/storage.ts`, `history.ts`, `units.ts`, `glossary.ts`, `welcome.ts`, `layoutControls.ts` | browser storage and the project library, undo/redo, units, the "?" explanations, the welcome page, folding sections, the View menu and the results resize handle |

The architecture test enforces the layering: `envelope` may use only `engine` and `materials`; the screen may use `envelope`; only `viewer3d` imports Three.js.
