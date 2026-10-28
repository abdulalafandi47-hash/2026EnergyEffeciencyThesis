# Calculation reports and saved walls (Stage 7)

Two things leave the program as files:

1. a **calculation report** (what was calculated, from what, with which assumptions and sources), for a thesis appendix, a supervisor or an archive;
2. a **saved wall** (the inputs only), so that a calculation can be reopened and repeated.

Both are made in the browser. Nothing is uploaded: there is no server, no account and no network request.

## Where to find them

| Action | Where |
|---|---|
| Make a report | results panel → **Report** tab |
| Save the wall's inputs | top bar → **Save wall** |
| Reopen a saved wall | top bar → **Open wall…** |

On a small results panel the Report tab is cramped; use **Enlarge** (top right of the panel).

## What a report contains

Every report has the same sections, in this order (comparisons are optional, which shifts the numbering of the later sections by one):

| # | Section | What it holds |
|---|---|---|
| – | Title block and **"Read first"** warnings | software name and version, time, input fingerprint; the data-status warnings (illustrative/unverified material values, unverified surface resistances, "steady state / not a compliance check") |
| – | Author's notes | text typed in the Report tab (optional) |
| 1 | Inputs | width, height, area, air temperatures, duration, surface resistances: **as typed** (with the unit typed) beside **as used** in the calculation (SI) |
| 2 | Layers and material data | each layer's material, thickness (as typed and in mm), λ, ρ, c_p, data status, value type; a second table with source type, citation, conditions and notices of each material used |
| 3 | Results | U, R_total (and its parts), temperature difference, Q̇ with direction, flux, energy, heat capacity (or "unavailable" and why), each with the number of the equation that gives it |
| 4 | Layer by layer | resistance, share of R_total and temperatures at both faces of every layer and both surface films |
| 5 | Temperature profile | the chart and the table of points |
| 6 | Comparisons (only if ticked) | the three one-change comparisons exactly as set up in the Compare tab, each stating what was held constant |
| next | Equations used | the 13 equations of `docs/equations-and-assumptions.md` with a plain-language meaning |
| next | Assumptions and warnings | the assumption and warning lists produced by the calculation engine itself |
| next | Limitations and what is not claimed | fixed statements: steady state, no thermal bridges, not annual energy, no compliance claim, … |
| next | References and data status | reference hierarchy, standards considered with edition and status, the secondary sources behind the preset surface resistances, the unread leads for material data |
| next | Verification of the calculation | what the automated tests do and do not show |
| last | Reproducibility | software version, time, input fingerprint and the **engine input as JSON** |

### Where each statement comes from

- **Every number is read from the calculation engine's result** (through `src/analysis`) and only formatted. The report module (`src/report/`) never calculates; the architecture test forbids it from importing the engine except for types.
- **Equations, limitations and references are fixed text** in `src/report/content.ts`. Two tests compare them with the project documents (`docs/equations-and-assumptions.md` for the equations, `docs/sources.md` for editions and web addresses) so the report cannot quietly drift from the documentation. When you change a document, change `content.ts` too; the test tells you if you forget.
- Nothing in the report states a source, edition or clause that is not already in `docs/sources.md` with its status. Material leads (SEAI, HTI, Brunel) are listed as **leads that support no value**.

## Formats

| Button | File | Use |
|---|---|---|
| Report (HTML) | `wall-report-<date>-<time>-<fingerprint>.html` | read, print, or "Save as PDF". One self-contained page: no script, no external file; a Content-Security-Policy tag forbids scripts and network access even if something slipped through |
| Report (Markdown) | `….md` | paste into notes or a thesis draft. The chart is not included (the table below it holds the same numbers) |
| Data (JSON) | `….json` | archiving and re-analysis. Numbers at **full precision**; contains the draft as typed, the engine input, the complete engine result, layer temperatures, comparisons and the formatted report |
| Layer table (CSV) | `….csv` | spreadsheets: one row per layer at full precision. Text cells starting with `= + - @` are neutralised so a spreadsheet does not run them as a formula |
| Print / Save as PDF | the browser's print dialog | choose "Save as PDF" as the printer. The print layout is A4 with page-break rules; tested by generating a PDF in Chromium (8–9 pages for the starter wall) |

File names carry the UTC time and the **fingerprint**, so reports of different states cannot be confused. All files made from one state share one fingerprint.

### The input fingerprint

An 8-hex-digit FNV-1a checksum of the engine input (key order fixed). Two reports with the same fingerprint were calculated from identical inputs. It identifies a calculation; it is **not** a security feature and it does not prove who made a report or that a file was not edited afterwards.

## Rules the report follows

1. **A report always matches the inputs on screen.** While the editor shows an error, the report buttons are switched off and the Report tab says why (otherwise a report could describe an earlier wall than the one displayed).
2. **Data status is never hidden.** The first thing in every report is the warning list. The "illustrative or unverified" warning appears whenever any layer uses such data, and the report states that none of the built-in values is an approved Cypriot design value.
3. **No compliance wording.** A test checks that every sentence mentioning "compliance" is a denial. The report never says a wall "meets" or "complies".
4. **Hostile text is inert.** Text typed by a user (title, notes) or stored in a material record (name, citation, conditions) is escaped for HTML and Markdown and neutralised for CSV. Tests inject `<script>`, `<img onerror>`, table-breaking `|`, code-fence breakers and spreadsheet formulas; a real-Chromium run confirms nothing executes. The preview in the app is an `<iframe sandbox="">` (no scripts, no same-origin access).
5. **Reproducible.** The time is the only thing in a report that is not a function of the inputs; the tests inject it. Recalculating the stored engine input reproduces the stored result exactly (tested).

## Saved wall file

`Save wall` writes the **draft exactly as typed** (text and units, even if it has errors, so work in progress can be kept) plus a note and a snapshot of the materials used:

```json
{
  "schema": "building-thermal-simulator.wall",
  "schemaVersion": 2,
  "note": "…",
  "draft": { "widthText": "3", "dimensionUnit": "m", "layers": [ { "key": "layer-1", "materialId": "gypsum-plaster", "thicknessText": "15", "thicknessUnit": "mm" } ], … },
  "materialsUsed": [ { "id": "gypsum-plaster", "name": "…", "lambdaWPerMK": 0.43, "status": "illustrative" } ],
  "customMaterials": [ { "id": "custom-…", "status": "user-defined", "…": "complete material record" } ]
}
```

**Version 2 (Stage 8)** adds `customMaterials`: the session's custom materials as complete records, so a wall that uses a datasheet value can be reopened. Version 1 files (without custom materials) still open. A file can only add records that are valid, `user-defined`, have ids starting `custom-` and do not reuse an existing id (at most 100). Opening a file adds its custom materials to the session's; a record with the same id is replaced by the file's version.

For built-in materials the file stores **ids**, not property values: values come from the database of the program that opens the file. So that a change in the database cannot pass unnoticed, opening a file **warns** when a material is missing, or when its λ or status differs from the snapshot.

A wall file is treated as untrusted input. Opening checks the size (≤ 1 000 000 characters; the Open button refuses files over 2 MB before reading them), the schema name and version (a newer version is refused), every field's type, the unit and mode lists, text length (≤ 64 characters per field), at most 200 layers, unique layer keys of the form `layer-<n>`, and that the next-layer counter is above every key. Every accepted value is copied into a new object (nothing from the file is passed on as-is; extra fields and `__proto__` entries are dropped). A refused file leaves the current wall unchanged and the message says why. A file that is accepted but wrong for the editor (for example an unknown material) is shown with the editor's normal error messages.

## What a report does and does not prove

- It documents **what was calculated and on what basis**. It is as reliable as the inputs.
- It does **not** show that the model matches real walls: the engine is checked against independent hand calculations, not against measurements (`validation/REFERENCE_CASES.md`).
- Built-in material values are illustrative. A report made from them is a demonstration, and says so on its first page.
- The report does not record the number of tests, the date of the last test run or the source-code revision. It tells the reader how to repeat the tests (`npm test`).
- The clock is the computer's own; the time in a report is not certified.

## Testing

| Layer | Tests |
|---|---|
| Report content | numbers against the engine and against an independent hand calculation of R, U, Q, E from the material values; as-typed versus as-used values (including °F and cm); source rows; temperatures that join up; section numbering; comparison percentages against an independent calculation; banners with and without verified data; heat capacity unavailable; direction for loss, gain and none; no compliance wording |
| Drift | equations vs `docs/equations-and-assumptions.md`; every web address and edition vs `docs/sources.md`; software version vs `package.json`; FNV-1a against published test vectors |
| Safety | HTML, Markdown and CSV escaping with hostile text; a chart is accepted only if it is plain `<svg>` without scripts, handlers, links, styles or images |
| Wall file | round trip (including half-typed text, other units, custom surfaces, incomplete layers); every kind of damage; limits; no extra fields; 400 random truncations and byte flips never crash the reader |
| Screen | the Report tab and Save/Open driven like a user (fake downloads): file names, content equals preview, title/notes, comparisons follow the Compare tab, switched off on errors, print, opening in a fresh editor gives identical results |
| Real browser | `validation/browser-reports.cjs` (see below) |

Deliberate-bug check: 64 bugs injected one at a time into the report, wall-file and screen code (wrong value in a row, dropped warning, missing escape, removed size limit, report allowed while the editor has errors, saving the wrong draft, …); 61 were caught immediately. One survivor ("baseline label") is an equivalent change: the baseline is already labelled "Current" by the comparison code, so the mutation changes nothing observable. Two others initially survived and led to extra tests (comparison percentages; the report following edits) before being caught.

### Real-browser check (Chromium)

`validation/browser-reports.cjs` (run instructions in its header) drives the production build: opens the Report tab and its sandboxed preview; downloads all five files and checks the JSON against an independent hand calculation (relative difference below 1e-9); opens the downloaded HTML from disk (no network request, no script element, chart drawn, no console errors); makes a PDF with the browser's print layout (several A4 pages); confirms the Print button calls `print()` once, on the report and not on the app; types hostile title and notes and confirms nothing runs; saves a wall, changes it, reopens it and checks the inputs and U-value return; refuses a bad and an oversized file; checks reports are switched off while the editor has errors; checks phone width (no sideways scrolling). Only Chromium was tested; headless Chromium cannot show a print dialog, so `print()` is recorded, not executed.

## Limitations of this stage

- One report is one wall. There is no multi-wall or whole-building report.
- The Markdown export has no chart. Mathematical notation is plain text (Unicode), not typeset.
- The PDF is made by the browser's print function, so its page layout depends on the browser. Only Chromium was checked.
- No digital signature, certified timestamp or software revision in the report (see above).
- The report cannot be edited in the program; edit the Markdown or print the HTML.

## To confirm with your thesis supervisor

1. What the thesis needs to record about each calculation (inputs, equations, sources, validation) and in which form: a report appendix per wall, a table, or text in the method chapter.
2. Whether the thesis wants the full "References and data status" table in every report, or a short pointer to one thesis-level source table.
3. Which edition of ISO 6946 and which Cyprus adoption (CYS EN ISO 6946) should be cited, and whether the library can supply the standard text so the "not yet checked" statements can be updated.
4. Whether results from illustrative values may appear in the thesis at all (for example in a method demonstration), and with what wording.
