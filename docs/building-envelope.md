# Building envelope workspace

The building-envelope workspace extends the single-wall calculator to a whole, simplified building shell: exterior walls, interior partitions, a roof, a floor, windows, glazed doors and opaque doors. Each element is calculated **on its own, in steady state, for one stated condition**, and the results are added up with the correct temperature difference for each element.

It is **not** an energy simulation: there is no weather, no hourly or annual calculation, no cooling demand, no solar gains, no ventilation and no thermal bridges. Nothing it shows is a compliance check. See the limitations in `docs/limitations.md` (ids M11–M17, D7–D8).

Open it with the **Building envelope** button in the top bar (or the address `…/#building`). The single-wall calculator is unchanged and still one click away; switching keeps what was typed in both.

## 1. Starting a project

| Button | What you get |
|---|---|
| **New blank project** | A 10 × 8 × 3 m box with no components. Nothing is calculated until you add components and enter their data. |
| **Load example house** | A 10 × 8 × 2.8 m single-storey house with 4 walls, a flat roof, a ground floor, a partition, 5 windows, a glazed door and an entrance door. |

The example house is **illustrative**: its dimensions, layers and condition (26 °C inside, 35 °C outside) were chosen for demonstration. It is not a real or verified building, its materials are the illustrative built-in records, and its windows and doors deliberately have **no U-values**: they show as *Missing data* until you enter documented values. You can edit everything; *Load example house* again resets it. Replacing a non-empty project always asks first.

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
- **Views**: 3D from SE / SW / NE / NW, plan (north at the top), and the four elevations N / E / S / W. Compass letters mark the sides.
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
- The selected element's results: status and reasons, U, R_total, Σ d/λ, surface resistances used, other-side temperature, ΔT, Q̇, heat capacity, the layer table with interface temperatures, and the documented values with their sources.

Custom materials defined in the single-wall calculator (*Materials* tab) appear in the layer material lists, so a manufacturer's declared value can be used with its source.

## 7. Code

| Folder / file | Role |
|---|---|
| `src/envelope/types.ts` | the building model (components, exposures, documented values) |
| `src/envelope/geometry.ts` | dimensions, areas and the model check |
| `src/envelope/calculate.ts` | per-element calculation (reusing `calculateWall`), surface resistances, totals, assumptions |
| `src/envelope/edit.ts` | blank project, example house, add / duplicate / delete / update, safeguards |
| `src/geometry/house.ts`, `fluxColor.ts` | pure 3D layout (boxes, walls cut around openings) and the flux colour scale |
| `src/viewer3d/houseScene.ts`, `houseViewer.ts` | Three.js scene, picking, views |
| `src/ui/buildingWorkspace.ts`, `buildingResults.ts`, `houseViewerPanel.ts`, `houseSpec.ts`, `shell.ts` | the screen and the workspace switch |

The architecture test enforces the layering: `envelope` may use only `engine` and `materials`; the screen may use `envelope`; only `viewer3d` imports Three.js.
