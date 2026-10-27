# Wall editor (Stage 4)

Run it with `npm run dev` and open the address Vite prints (normally http://localhost:5173).

## What you can do

- Set the wall **width and height** (mm, cm or m).
- **Add, remove and reorder layers** (↑ moves a layer toward the interior, ↓ toward the exterior). The list is always interior at the top, exterior at the bottom, with both faces labelled; the first layer is tagged "Interior face", the last "Exterior face".
- **Choose a material** for each layer from the database (grouped by category; each option shows its data status). A filter box narrows the lists but never hides a layer's current choice.
- Enter each **thickness** in mm, cm or m. The thickness in metres is shown beside it.
- Enter **inside/outside air temperatures** (°C, K or °F) and a **duration**.
- Choose the **surface resistances**: the horizontal-flow preset (shown as UNVERIFIED) or your own values.
- See, for each layer: material name, thickness, λ, ρ, c_p (missing ones are flagged), data status, value type, source type, citation, conditions and caveats.
- See a live **configuration summary**: valid or the list of problems, warnings, the layer table, and the exact SI input that would be given to the calculation engine.

Calculation results, the 3D view, charts and reports are later stages. Nothing on the screen is a thermal result.

## How the code is organised

| Layer | Folder | Knows about |
|---|---|---|
| Calculation engine | `src/engine/` | nothing else |
| Materials | `src/materials/` | engine |
| Editor logic | `src/editor/` | engine, materials, units |
| Screen | `src/ui/` | editor, materials; engine **types only** |

`tests/architecture.test.ts` fails if any module imports something it should not, if screen code appears outside `src/ui/`, or if the UI contains engineering formulas.

`src/editor/` holds a **draft** of what was typed (text plus unit). `buildWall(draft, materials)`:

1. reads each number strictly (decimal point or comma; no letters, units, exponents or thousands separators);
2. converts everything to SI (metres, °C);
3. asks the engine's own `validateWallInput` what is physically valid, so the editor and engine cannot disagree;
4. rewrites each problem as a message in your units, attached to the field;
5. returns the wall only if the engine accepts it.

The test suite includes a 2,000-draft fuzz test asserting: *whenever the editor accepts a draft, the engine accepts the wall and can calculate it*.

## What is blocked

Missing, empty or non-numeric inputs; zero or negative width, height or thickness; no layers; a layer without a material or whose material is not in the database; temperatures below absolute zero (in any unit); negative duration; negative surface resistances. A wall is never produced while any error exists.

## Warnings (do not block)

Likely unit slips: a layer thinner than 1 mm or thicker than 1 m; a wall dimension under 0.1 m or over 100 m; an air temperature outside −40…60 °C; a duration over a year; a material lacking density or specific heat (heat capacity unavailable). These bounds are rough sanity checks, not scientific limits.

## Units

Typed numbers stay in the unit shown beside them. **Changing a unit converts the number** so the physical value is unchanged (80 mm → 8 cm; 20 °C → 293.15 K). Everything is converted to metres/°C once, in `buildWall`. A comma is read as a decimal separator, so "1,200" means 1.2, not 1200; the metre readout beside every thickness makes such a slip visible.

## Known limitations

- No custom-material form yet. The function `createCustomMaterial` exists and the editor accepts custom materials passed to it; a form is a small follow-up.
- Nothing is saved between sessions.
- Surface resistances: only the horizontal-flow preset or custom values; the preset is unverified.
- Wall only: no openings, thermal bridges, air layers or ground contact.
- No results yet. The editor deliberately does not display a U-value built from illustrative data.
- Accessibility was designed in (labels, `aria-invalid`, text-prefixed errors, keyboard-operable controls, focus kept after moves, live regions) and tested in a simulated browser and in Chromium, but has **not** been audited with a screen reader or against WCAG.

## To confirm with your thesis supervisor

1. **Which edition of EN ISO 6946 is the current Cyprus adoption (CYS EN ISO 6946)**, and whether a national annex or correction changes the method or the default surface resistances.
2. **Which document governs design material properties for Cyprus.** Is it a regulation or technical guide with tabulated λ, ρ and c_p; the EN ISO 10456 tables; or manufacturer declared values converted per EN ISO 10456? And which edition of the regulations applies (a search suggested KDP 121/2020 may be current; unverified).
3. **Which surface resistances and boundary conditions** (inside/outside temperatures, assessment method) the thesis should use, since the preset values are unverified and R_si/R_se depend on the assessment.
4. **Whether HTI/Brunel measured values may be used** as measured (not design) values, and with what conversion to design conditions.
5. **Library access** to the standards, so presets and material values can move from `unverified`/`illustrative` to `verified` with a proper source trail.
6. **The thesis claim boundary:** whether the work is a method demonstration (illustrative data is acceptable) or must report values usable for Cypriot design (then verified data is required).
