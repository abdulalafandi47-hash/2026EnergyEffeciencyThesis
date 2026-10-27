# Sources and standards register

Keep this file up to date as the project evolves. A source only counts as **verified** once someone has checked the number or rule against the source itself, not against a summary of it.

Last updated: 2026-10-27 (Stage 2).

## 1. Standards considered

| Standard | Edition found | Role in this project | Status |
|---|---|---|---|
| ISO 6946 *Building components and building elements — Thermal resistance and thermal transmittance — Calculation methods* | **ISO 6946:2017** (3rd edition, June 2017). ISO's page states it was last reviewed and confirmed in 2022. | Basis of the U-value method (R = d/λ, R_total = R_si + ΣR + R_se). Applies to thermally homogeneous layers; thermal bridges and metal fasteners need other methods. Excludes doors, windows, curtain walling, ground-contact elements. | Edition confirmed via catalogue search results. **Standard text not read.** No compliance claim is made. |
| EN ISO 10456 *Building materials and products — Hygrothermal properties — Tabulated design values and procedures for determining declared and design thermal values* | **EN ISO 10456:2007 + AC:2009** appears to be current; no newer edition found. ISO's own site was not checked. | Planned for Stage 3 (material data, declared vs design values, conversion for moisture and temperature). Procedures apply to design temperatures from −30 °C to +60 °C; conversion coefficients for mean temperatures 0–30 °C (per a standards-catalogue summary). | Not used in the engine yet. Confirm edition on ISO's site before citing. |
| ISO 13786 *Thermal performance of building components — Dynamic thermal characteristics — Calculation methods* | **ISO 13786:2017** (replaced the 2007 edition). | Only if a dynamic model is added later. The catalogue summary says its simplified heat-capacity estimates suit energy-consumption work but not product characterisation. | Not used. |

## 2. Surface resistances (R_si, R_se) used by the presets

Values in `ISO6946_U_VALUE_PRESETS` (`src/engine/surfaceResistance.ts`):

| Heat-flow direction | R_si (m²·K/W) | R_se (m²·K/W) |
|---|---|---|
| horizontal (vertical walls) | 0.13 | 0.04 |
| upwards | 0.10 | 0.04 |
| downwards | 0.17 | 0.04 |

**Status: `unverified`.** These are the commonly quoted ISO 6946 values for U-value calculations. Three independent secondary sources, found by web search on 2026-10-27, agree with them; none is the standard itself:

- Ravago Building Solutions knowledge base — heat transfer coefficient: <https://ravagobuildingsolutions.com/hu/en/knowledgebase/heat-transfer-coefficient>
- Forum post reproducing the ISO 6946 table (also states horizontal means within ±30° of horizontal): <https://forum.edilclima.it/viewtopic.php?p=63126>
- Data Driven AEC wall U-value calculator (applies 0.13 / 0.04 to walls): <https://datadrivenaec.com/tools/uvalue-calculator-wall-assembly>

A Canadian RSI table found in the same search lists *different* air-film values (wall 0.12, external 0.03 at 6.7 m/s wind), which illustrates why these numbers depend on the reference convention and must not be treated as universal.

### To verify against the purchased/library copy of ISO 6946:2017

- [ ] The numeric values and the table/clause that contains them (then set `status: 'verified'` and put the clause in `basis`).
- [ ] The rule for when heat flow counts as "horizontal" (secondary source says ±30°).
- [ ] What the standard says about external surface resistance and wind speed.
- [ ] Whether other assessment methods (for example surface-condensation or mould-risk checks) prescribe different internal surface resistances, and which standard governs them. The engine comments say they can differ; that statement is from general knowledge and is **not yet verified**.
- [ ] Which edition is the current CEN adoption (a DIN catalogue listing seen in search mentions EN ISO 6946:2017 with a 2021 correction; unverified).

## 3. Other references to add

- Material properties: none used yet. Stage 3 must cite the exact table, clause or datasheet for every value marked `verified`.
- Climate data for Cyprus: not used yet (no weather-driven calculation in this version).
- Peer-reviewed building-physics literature: to be added when the thesis text needs it. Do not cite a paper that has not been read.
