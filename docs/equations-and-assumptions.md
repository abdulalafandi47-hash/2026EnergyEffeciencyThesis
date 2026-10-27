# Equations, assumptions and limitations (calculation engine, Stage 2)

Implemented in `src/engine/`. All quantities are SI inside the engine; field names end with their unit.

## 1. Symbols

| Symbol | Meaning | Unit | Engine field |
|---|---|---|---|
| d | layer thickness | m | `thicknessM` |
| λ | thermal conductivity | W/(m·K) | `lambdaWPerMK` |
| R | thermal resistance of one layer | m²·K/W | `resistanceM2KPerW` |
| R_si, R_se | internal / external surface resistance | m²·K/W | `surfaceResistances.insideM2KPerW` / `outsideM2KPerW` |
| R_total | total thermal resistance | m²·K/W | `resistance.totalM2KPerW` |
| U | thermal transmittance | W/(m²·K) | `uValueWPerM2K` |
| A | wall area | m² | `geometry.areaM2` |
| T_i, T_e | inside / outside air temperature | °C | `conditions.insideTemperatureC` / `outsideTemperatureC` |
| Q̇ | heat-transfer rate (magnitude) | W | `heatTransfer.magnitudeW` |
| q | heat flux | W/m² | `heatTransfer.fluxMagnitudeWPerM2` |
| t | duration | h | `conditions.durationHours` |
| E | energy transferred | kWh | `energy.magnitudeKWh` |
| ρ | density | kg/m³ | `densityKgPerM3` |
| c_p | specific heat capacity | J/(kg·K) | `specificHeatJPerKgK` |
| V | volume of a layer | m³ | (computed: A·d) |
| C | heat capacity | J/K | `heatCapacity.totalJPerK` |
| C_A | areal heat capacity | J/(m²·K) | `heatCapacity.arealJPerM2K` |

Layers are always listed **from the interior face to the exterior face**.

## 2. Equations

| # | Equation | Code |
|---|---|---|
| 1 | R = d / λ | `layerResistance` |
| 2 | R_total = R_si + Σ(d_i / λ_i) + R_se | `totalResistance` |
| 3 | U = 1 / R_total | `uValueFromResistance` |
| 4 | A = width × height | `wallArea` |
| 5 | Q̇ = U · A · \|T_i − T_e\| | `heatTransferRateW` |
| 6 | direction = outward if T_i > T_e; inward if T_i < T_e; none if equal | `heatFlowDirection` |
| 7 | E = Q̇ · t / 1000 | `energyKWh` |
| 8 | C = Σ ρ_i · c_p,i · V_i, with V_i = A · d_i | `heatCapacity` |
| 9 | C_A = Σ ρ_i · c_p,i · d_i | `arealHeatCapacity` |
| 10 | q_signed = (T_i − T_e) / R_total (positive = outward) | `calculateTemperatureProfile` |
| 11 | T_si = T_i − q·R_si | same |
| 12 | T after layer k = T_si − q · Σ_{j≤k} R_j | same |
| 13 | T_se = T_e + q·R_se | same |

Equations 10–13 follow from steady state: the same flux passes through every element in series, so each element's temperature drop is q × its resistance. Inside each homogeneous layer the temperature is linear in position (exact for 1-D steady conduction). The temperature step across a surface film is drawn at the wall surface (air point and surface point share a position).

**Magnitude vs direction.** Equation 5 gives only a magnitude (≥ 0). Equation 6 gives the direction separately. The result object keeps them in different fields on purpose.

### Display mappings (no new physics)

- **Thermal overlay colour:** fraction = (T − T_min) / (T_max − T_min), where T_min and T_max are the coldest and warmest temperatures in the wall (surface and interface temperatures from equations 11–13); the fraction picks a colour from a fixed blue → grey → red scale (`src/geometry/colormap.ts`). Inside a layer T varies linearly between its two face temperatures.
- **Comparisons** run the unchanged engine on copies of the wall with ONE parameter changed; percentage change = (variant − current) / current × 100.

## 3. Assumptions built into every result

1. Steady state, one-dimensional heat flow, constant inside and outside air temperatures.
2. Every layer is thermally homogeneous.
3. No thermal bridges (studs, ties, mortar joints, fasteners), air cavities, windows or doors. The full width × height is one uniform wall.
4. Layer properties (λ, ρ, c_p) are used exactly as entered. No correction for temperature, moisture content or ageing.
5. Solar radiation, air leakage and ventilation are not modelled.
6. Surface resistances are **never defaulted silently**. The caller must supply them, either from a labelled preset or as custom values, and the choice is printed in the result's `assumptions` list.
7. Heat capacity is a simple sum. It says how much heat the wall can store per kelvin; it does **not** by itself describe dynamic thermal response, which needs a transient model (e.g. ISO 13786-type methods), boundary conditions and the order of layers.
8. The energy figure is power × duration under constant conditions. It is **not** an annual energy demand.

## 4. How bad input is handled

- The engine never returns NaN or a "fixed" value. It throws `EngineInputError`, whose `issues` list every problem with a path such as `layers[2].thicknessM`.
- Thickness, conductivity, width, height must be finite and > 0. Surface resistances ≥ 0. Temperatures finite and ≥ −273.15 °C. Duration ≥ 0.
- Density and specific heat are optional. **Absent** → heat capacity is reported as `available: false`, naming the layers, and nothing is guessed. **Present but invalid** (0, negative, NaN) → error.

## 5. Data-status labels

Used for any number whose reliability matters (will also label the material database in Stage 3):

| Label | Meaning |
|---|---|
| `verified` | checked against a named primary source |
| `unverified` | believed to match a named source, not yet checked against it |
| `illustrative` | demonstration value, no claim of real-world accuracy |
| `user-defined` | entered by the user |

## 6. Four quantities that are easy to confuse

- **Thermal conductivity λ** (W/(m·K)): a property of a *material*. How easily heat conducts through it. Lower is better insulation. It can vary with density, moisture content, temperature and product.
- **Thermal resistance R** (m²·K/W): a property of a *layer of given thickness*: R = d/λ. Resistances in series add. Higher is better.
- **Thermal transmittance U** (W/(m²·K)): a property of the *whole assembly*, including surface films: U = 1/R_total. It tells you the heat flow per m² per kelvin. Lower is better.
- **Heat capacity C** (J/K) and areal heat capacity (J/(m²·K)): how much heat the material *stores* per kelvin. It is independent of how fast heat passes through. A heavy wall and a light wall can have the same U but very different heat capacity. Dynamic behaviour depends on both together with the boundary conditions.

## 7. Known limitations of this stage

- No air layers or ventilated cavities, thermal bridging, inhomogeneous layers, or ground contact.
- ISO 6946 compliance is **not** claimed. The method follows its basic homogeneous-layer approach, but the standard text has not been checked (see `sources.md`).
- No dynamic (transient) model.
- Material data is not part of this stage; test values are synthetic.
