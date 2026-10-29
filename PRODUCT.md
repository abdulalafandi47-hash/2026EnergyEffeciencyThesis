# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: thesis examiners (the supervisor and examiners of a Civil and Environmental Engineering thesis) who open the public preview, or run the app locally, to judge the work. They need to see quickly what the model calculates, how far its results can be trusted, and where its limits are.

Secondary (not confirmed as separate audiences): the thesis author, who builds walls and takes numbers into the report.

## Product Purpose

A browser application where a user builds a multilayer wall from materials and dimensions and gets its steady-state thermal properties: layer and total resistance, U-value, heat-transfer rate with direction, energy over a stated duration, heat capacity and the temperature at every interface. It shows the wall in interactive 3D with a temperature overlay and heat-flow arrows, compares alternatives one change at a time, and writes a calculation report. Success is a thesis whose results and limits can be checked by someone else.

## Positioning

Honest about its data. Every value carries a status (verified, unverified, illustrative or user-defined), results built on weak data say so on screen and on the first page of every report, and the reports never claim compliance. The model is deliberately narrow (one wall, one-dimensional, steady state) and says what it leaves out.

## Operating Context

- Runs entirely in the browser; it sends no data anywhere. A static build is published to GitHub Pages from the `gh-pages` branch.
- Inputs go in a compact sidebar; results appear in a bottom panel with tabs (results, comparison, materials, report).
- Outputs: calculation reports (HTML, Markdown, JSON, CSV, PDF through the print dialog), saved wall files, a material database export.
- Developed and documented as a thesis: limitations have citable ids (`docs/limitations.md`), requirements are traced (`docs/requirements-traceability.md`).

## Capabilities and Constraints

- Scope: one multilayer wall, homogeneous layers, steady state, constant air temperatures. No thermal bridges, air cavities, windows, solar gains, ventilation, moisture or dynamic effects. The energy figure is not an annual energy demand.
- All 9 built-in materials are illustrative (no source). Surface-resistance presets are unverified against ISO 6946. Custom materials are labelled user-defined.
- Not validated against measurements or certified software; the tests prove the code matches its documented equations.
- Interface language is English. Numbers accept a decimal comma or dot; the value in metres is shown beside each thickness.
- Needs WebGL for the 3D view; without it the app works in text-only mode.
- Undecided: whether the author's own sourced material data and Cypriot climate data will be added.

## Brand Commitments

Product name in the page title: "Wall Thermal Simulator". The README title is "Building Thermal Performance & Energy Efficiency Simulator". The existing layout is a dark, 3D-first workspace (compact inputs sidebar, dominant 3D view, results panel at the bottom); the user asked that it be kept. No logo or other brand assets exist.

## Evidence on Hand

- Documentation in `docs/`, including `limitations.md`, `testing.md`, `equations-and-assumptions.md`, `sources.md` and `material-database.md`.
- 995 automated tests and 153 real-browser checks (as stated in the README; the 995 were re-run and pass).
- Independent reference calculations in `validation/`.
- Absent, and not to be invented: published sources for the built-in material values, measurements of real walls, user testimonials, regulatory compliance claims.

## Product Principles

1. Say how much each number can be trusted, wherever the number appears.
2. Never imply compliance, design approval or annual energy performance.
3. Show the physics, not decoration: charts, the 3D overlay and arrows display the engine's numbers and nothing else.
4. Everything shown can be traced from the input, through the equation, to the report.
5. State what the model leaves out as plainly as what it calculates.

## Accessibility & Inclusion

Keyboard-only use must work, and the automated axe-core scans (no serious or critical findings) must keep passing. The 3D picture cannot be read by a screen reader, so the layer list and tables must carry the same information. Not tested with screen-reader users so far.
