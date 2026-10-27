# Material database (Stage 3)

**This database is not a certified source of design values.** At present every built-in record is `illustrative`: a representative, order-of-magnitude number chosen for demonstration, with no source behind it. Results built from them are for demonstrating the software, not for design, compliance or thesis conclusions.

## Where things live

| What | Where |
|---|---|
| The data (inspect this file to see every number) | `src/materials/data/builtInMaterials.json` |
| Record format and categories | `src/materials/types.ts` |
| Validation rules | `src/materials/validateMaterial.ts` |
| Search, merge, load | `src/materials/database.ts` |
| User-defined materials | `src/materials/customMaterial.ts` |
| Material + thickness → engine layer | `src/materials/toLayer.ts` |
| JSON / CSV export | `src/materials/exportMaterials.ts` |

The calculation engine never imports from `src/materials/`. Material data and calculation logic are separate.

## What a record contains

`id`, `name`, `category`, `lambdaWPerMK`, optional `densityKgPerM3` and `specificHeatJPerKgK`, optional `additionalProperties` (name/value/unit), `units` (always SI; anything else is rejected), `status`, **`valueType`** (`measured` / `declared` / `design` / `unspecified`), `source` (**`type`**: standard / regulation-or-guidance / manufacturer-datasheet / published-research / reference-table / user-note / none; citation, optional url, location, checkedOn, checkedBy), `conditions`, and `assumptionsAndLimitations`.

**Measured, declared and design values are different** (see `docs/sources.md` section 0): a measured value belongs to a specimen and its test conditions; a declared value is a manufacturer's declaration under reference conditions; a design value is the one stated for use in design calculations. `unspecified` means the record does not say, and is the only option for illustrative data.

Categories: Concrete, Cement plaster, Gypsum plaster, Clay brick, Concrete block, EPS, XPS, Mineral wool, Polyurethane, Other.

## Status labels and the rules that enforce them

| Status | Meaning | Enforced by the validator |
|---|---|---|
| `verified` | Checked against a named primary source | Needs a real `source.type` (not `none`/`user-note`), a `valueType` other than `unspecified`, `source.citation`, `source.location` (table/clause/page), `source.checkedOn` (real date, YYYY-MM-DD), `source.checkedBy`, and `conditions`. |
| `unverified` | Believed to match a source, not yet checked | Needs a citation. |
| `illustrative` | Demonstration value | Must have `source.type` `none` and `valueType` `unspecified`, and a citation that says there is no source. **May not carry a URL**, so an unsourced number cannot look sourced. |
| `user-defined` | Entered by the user | Created by `createCustomMaterial`; the application does not check them. |

When a layer built from `illustrative` or `unverified` data is used in a calculation, the engine adds a warning to the result (`layer-properties-not-verified`) naming those layers.

## Why one number per material is a simplification

Conductivity depends on density, moisture content, temperature and the specific product (and ageing for some insulations). A single λ is only meaningful together with the conditions it applies to. That is why each record has a `conditions` field and a list of limitations, and why *design* values (EN ISO 10456 distinguishes declared and design values and gives conversion procedures) must come from the standard or from manufacturer data, not from this file.

## Custom materials

`createCustomMaterial({ name, lambdaWPerMK, densityKgPerM3?, specificHeatJPerKgK?, category?, sourceNote? })`

- values must be in SI units (convert first with `src/units`);
- invalid input throws and lists every problem;
- suspicious but valid numbers (for example λ = 40, or specific heat in kJ/(kg·K)) are returned as `warnings` for the interface to display;
- ids are made unique (`custom-my-insulation`, `custom-my-insulation-2`, …) and the record is always `user-defined`.

Saving custom materials between sessions is a user-interface task (Stage 4).

## How to turn a record into a `verified` one

1. Obtain the source itself (the standard, the datasheet, the paper). A summary or a web snippet is not enough.
2. Compare the numbers. Convert units if needed; keep the *original* conditions.
3. Edit the record in `builtInMaterials.json`: set `status` to `"verified"`; fill `source.citation`, `source.location`, `source.checkedOn`, `source.checkedBy`, `source.url` (if any), and `conditions`; remove the "demonstration value" wording from `assumptionsAndLimitations`.
4. Run `npm test`. The validator and integrity tests reject a `verified` record with a missing piece of the trail.
5. Record the check in `docs/sources.md`.

## Inspecting and exporting

Open `src/materials/data/builtInMaterials.json`, or call `exportMaterialsJson(...)` / `exportMaterialsCsv(...)`. JSON exports carry the schema version, units and the "not a certified source" disclaimer. CSV text cells starting with `=`, `+`, `-`, `@` are prefixed with `'` so spreadsheets do not execute them as formulas.

## Transparency note about the current numbers

The values were chosen as typical orders of magnitude for each material class. Three of them (gypsum plaster λ = 0.43 at ρ = 1200 kg/m³, EPS λ = 0.035 at ρ = 25 kg/m³, and cement plaster λ = 1.0) happen to coincide with figures that appeared in a search-result snippet of an Irish SEAI table; the table itself could not be opened from this environment. Coincidence with a snippet does **not** make them verified.
