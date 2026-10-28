# Requirements traceability (Stage 8)

Every requirement of the project brief, where it is implemented, how it is checked, and its status. Statuses:

- **Met**: implemented and tested.
- **Met, with limits**: implemented and tested, but with a stated limitation (see `docs/limitations.md`).
- **Partly met**: part is done; the rest is listed.
- **Not started**: deliberately out of scope so far.

File names in the "Evidence" column are in `tests/` unless stated.

## 2. Objective

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Define a wall by choosing materials and entering dimensions; calculate thermal properties; show it in interactive 3D | `src/editor`, `src/engine`, `src/viewer3d`, `src/ui` | `application`, `workspace`, `ui3d`; `validation/browser-*.cjs` | Met |
| First version focuses on multilayer walls (plaster, masonry, insulation, render) | starter wall has exactly these four layers | `editorDraft`, `application` | Met |
| A complete engineering calculation report and a 3D representation | Report tab (`src/report`), 3D viewport | `report`, `reportUi`, `browser-reports.cjs` | Met |
| Eventually: energy efficiency under Cyprus climatic conditions (no full-building simulation yet) | — | — | Not started (limitation M10) |

## 4. Core engineering calculations

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| A. R = d/λ per layer, and its contribution to the total | `formulas.ts` `layerResistance`; share column in the Layers tab and report | `formulas`, `calculateWall`, `relationships` | Met |
| B. R_total = R_si + Σ d/λ + R_se; U = 1/R_total | `totalResistance`, `uValueFromResistance` | `formulas`, reference cases A–D | Met |
| B. Surface resistances configurable; standard and boundary conditions documented; never applied silently | preset (labelled unverified) or custom values; basis printed in every result | `surfaceResistance`, `editorBuild`; `docs/sources.md` | Met, with limits (D5, S1: standard text not read) |
| B. Display layer resistances, total resistance, U, assumptions | Results, Layers, Assumptions tabs; report | `workspace`, `report` | Met |
| C. Q̇ = U·A·\|ΔT\|; magnitude separate from direction | `heatTransferRateW`, `heatFlowDirection` | `formulas`, `relationships`, `workspace` | Met |
| C. Changing area or temperatures updates results automatically | every keystroke recalculates | `workspace`, `application` | Met |
| D. E = Q̇·t/1000, stated as constant-condition estimate, not annual demand | `energyKWh`; note on screen and in reports | `formulas`, `report` | Met |
| E. C = Σ ρ·c_p·V and areal heat capacity | `heatCapacity`, `arealHeatCapacity`; "unavailable" when ρ or c_p missing | `formulas`, `calculateWall`, `application` | Met |
| E. Explain the difference between heat capacity, resistance, conductivity and transmittance | Assumptions tab "Four quantities…"; `docs/equations-and-assumptions.md` §6 | `materialsUi` (wording kept equal to the docs) | Met (added in Stage 8) |
| E. Do not imply heat capacity predicts dynamic performance | caption on the heat-capacity tile, assumptions, limitations | `report` | Met |

## 5. Material database

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Searchable, maintainable database | `src/materials`, data in `builtInMaterials.json`; search in the editor and in the Materials tab | `materialDatabase`, `materialsUi` | Met |
| Record fields: name, category, λ, ρ, c_p, optional properties, units, source, URL/publication, assumptions and limitations | `MaterialRecord` type and validator | `materialValidation` | Met |
| Categories: concrete, cement plaster, gypsum plaster, clay brick, concrete block, EPS, XPS, mineral wool, polyurethane | 9 built-in records, one per category | `materialDatabase` | Met (values illustrative, D1) |
| 1. Do not invent data, references or properties | built-in records are labelled illustrative with no source; no citation without a record in `docs/sources.md` | `materialValidation` (an illustrative record may not carry a URL); `report` (references drift test) | Met |
| 2. Distinguish illustrative from verified data | `status` and `valueType` on every record, shown everywhere | `materialNotices`, `workspace`, `report` | Met |
| 3. Record source and conditions of each verified property | validator refuses a "verified" record without citation, location, date, checker and conditions | `materialValidation` | Met as a rule; **no verified data yet** (D1) |
| 4. Explain that λ varies with density, moisture, temperature and product | record limitations shown in the Materials tab; caption; docs | `materialsUi` | Met (shown on screen since Stage 8) |
| 5. Custom materials | Materials tab form → `createCustomMaterial`; status "user-defined"; saved in wall files | `customMaterial`, `materialsUi`, `persist`, `browser-e2e.cjs` | Met (on screen since Stage 8; A3) |
| 6. Data separate from calculation logic | JSON data file; engine never imports materials | `architecture` | Met |
| 7. Export or inspect the database | Materials tab table; Export JSON / CSV | `materialsUi`, `browser-e2e.cjs` | Met (on screen since Stage 8) |
| Do not present the database as a certified source | disclaimer at the top of the Materials tab, in exports and reports | `materialsUi`, `report` | Met |

## 6. Interactive 3D visualisation

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Width and height | sidebar §1 | `editorBuild`, `ui3d` | Met |
| Any number of layers; change thickness; reorder | sidebar §2 | `editorDraft`, `ui`, `application` (60 layers) | Met |
| Interior and exterior faces identified | face tags, 3D labels, Interior/Exterior views | `ui3d`, `browser-workspace.cjs` | Met |
| Rotate and zoom | orbit, pan, zoom, keyboard | `ui3d`, `browser-workspace.cjs` | Met |
| Inspect individual layers | click in 3D, layer list, Inspect buttons, inspector | `ui3d`, `workspace` | Met |
| Exploded view | toolbar switch | `sceneBuilder`, `browser-workspace.cjs` | Met |
| Layer names and thicknesses | labels (true thickness even when drawn enlarged) | `geometry`, `ui3d` | Met |
| Updates when geometry changes; generated from real geometry | `layoutWall` from the engine input | `geometry`, `sceneBuilder`, `ui3d` | Met, with limits (A7: needs WebGL; thickness drawn 5× by default, disclosed) |

## 7. Temperature profile and heat flow

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Temperature drop per layer from the resistance distribution | `calculateTemperatureProfile`; equations 10–13 | `temperatureProfile`, `relationships` (Fourier's law per layer) | Met |
| Indoor/outdoor air, surface temperatures, every interface | Profile and Layers tabs, report | `workspace`, `application` (checked by hand) | Met |
| Graph of temperature against cumulative thickness | SVG profile chart | `charts`, `browser-reports.cjs` | Met |
| Heat-flow direction | KPI, arrows (direction only), profile caption | `workspace`, `sceneBuilder` | Met |
| Calculated temperatures distinguished from graphics; physically consistent; colours explained | overlay colours = calculated temperatures, linear in each layer; colour bar and Assumptions tab explain | `thermalViz`, `browser-workspace.cjs` (pixel colours) | Met |

## 8. User interface

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| 1–4. Configuration panel, material selector, layer order/thickness editor, dimensions and boundary conditions | sidebar | `ui`, `workspace` | Met |
| 5. Live 3D viewport | viewport | `ui3d`, `browser-workspace.cjs` | Met |
| 6. Thermal results dashboard | Results tab | `workspace` | Met |
| 7. Layer-by-layer resistance table | Layers tab | `workspace` | Met |
| 8. Temperature profile | Profile tab | `workspace`, `charts` | Met |
| 9. Comparison tool | Compare tab | `analysis`, `workspace`, `materialsUi` | Met |
| 10. Assumptions and references | Assumptions tab; report sections | `workspace`, `report` | Met |
| 11. Report export | Report tab: HTML, Markdown, JSON, CSV, print/PDF | `report`, `reportUi`, `browser-reports.cjs` | Met |
| Clean, responsive, easy to use; readable units; accessible controls; correct terminology | dark workspace, phone layout, units on every number, keyboard support | `browser-e2e.cjs` (axe-core: no serious findings in 18 scans; keyboard-only), `browser-workspace.cjs` (phone) | Met, with limits (A1, A2) |

## 9. Comparison and sensitivity

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Insulation 40 / 80 / 120 mm | thickness sweep | `relationships`, `analysis`, `application` | Met |
| EPS vs mineral wool vs XPS; concrete and masonry configurations | material swap for any layer (custom materials included) | `analysis`, `materialsUi` | Met |
| Different indoor and outdoor temperatures | outside-temperature sweep | `analysis`, `report` | Met, with limits (only the outside temperature is swept; inside is changed in the sidebar) |
| Show changes in U, R, Q̇, heat capacity; consistent assumptions; changed parameter identified | comparison tables state what changed and what was held constant | `analysis`, `report` | Met |

## 10. Testing and scientific verification

| Requirement | Evidence | Status |
|---|---|---|
| Tests for every formula, unit conversions, zero/negative input, invalid/missing properties, different numbers of layers, boundary-condition changes, temperature profile, heat capacity, database integrity | `formulas`, `units`, `validateWallInput`, `materialValidation`, `calculateWall`, `temperatureProfile`, `materialDatabase`, `application` | Met |
| The six required relationships | `relationships` (one `describe` block each) | Met |
| Independent reference cases with documented derivation | `validation/reference_cases.py`, `validation/REFERENCE_CASES.md` | Met, with limits (V2: same author) |
| Do not claim scientific validation because tests pass | README, `docs/testing.md`, every report's verification section | Met |

## 11. Standards and sources

| Requirement | Implementation | Status |
|---|---|---|
| Investigate ISO 6946, EN ISO 10456, dynamic-property standards | `docs/sources.md` §1 (ISO 6946:2017, EN ISO 10456:2007+AC:2009, ISO 13786:2017) | Partly met: editions from catalogue searches; texts not read (S1, S2) |
| Verify current editions before relying on them | catalogue searches recorded with dates | Partly met (S2) |
| No fabricated citations; no compliance claims | sources register with statuses; report drift tests; "no compliance" test | Met |
| Record assumptions, equations, sources and validation results | `docs/equations-and-assumptions.md`, `docs/sources.md`, `validation/REFERENCE_CASES.md`, `docs/testing.md`, every report | Met |

## 12–13. Architecture and workflow

| Requirement | Evidence | Status |
|---|---|---|
| Separate modules: UI, materials, engine, geometry/3D, charts, tests, reporting | `src/*` folders; `architecture` test enforces the boundaries | Met |
| No unnecessary dependencies, no authentication, payments, cloud databases, AI APIs or whole-building simulation | runtime dependency: `three` only; nothing leaves the browser (`browser-e2e.cjs`: no request to another site) | Met |
| Works locally without paid APIs or services | `npm run dev`; optional free GitHub Pages preview | Met |
| Eight stages, each tested and summarised | one branch per stage (`feature/stage-2…8`), validation log | Met |
