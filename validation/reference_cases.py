#!/usr/bin/env python3
"""
Independent reference calculations for the wall calculation engine.

PURPOSE
    The TypeScript engine is tested against numbers produced HERE, by a
    different program, in a different language, using EXACT rational
    arithmetic (Python's `fractions.Fraction`), so there is no floating-point
    rounding at all. If the engine and this script agree, an arithmetic or
    logic slip in either one is very unlikely.

    The input values are SYNTHETIC test values chosen to give clean numbers.
    They are NOT real material data and must never be quoted as such.

HOW TO RUN (from the repository root)
    python3 validation/reference_cases.py

    This rewrites tests/fixtures/reference-cases.json, which the automated
    tests read. Only re-run it if you deliberately change a case; then review
    the change in Git before committing.

DERIVATION
    See validation/REFERENCE_CASES.md for the hand derivation of each case.
"""
import json
from fractions import Fraction as F
from pathlib import Path

# --- Synthetic cases. Every number is a decimal string so it is parsed exactly. ---
CASES = [
    {
        "id": "A-four-layer-wall-heat-loss",
        "description": "Plaster / masonry / insulation / render, winter heat loss (outward).",
        "widthM": "3.0",
        "heightM": "2.5",
        "rsi": "0.13",
        "rse": "0.04",
        "insideC": "20",
        "outsideC": "5",
        "durationHours": "24",
        "layers": [
            {"name": "Plaster (test)", "thicknessM": "0.015", "lambdaWPerMK": "0.50", "densityKgPerM3": "1200", "specificHeatJPerKgK": "1000"},
            {"name": "Masonry (test)", "thicknessM": "0.200", "lambdaWPerMK": "1.00", "densityKgPerM3": "2000", "specificHeatJPerKgK": "1000"},
            {"name": "Insulation (test)", "thicknessM": "0.080", "lambdaWPerMK": "0.040", "densityKgPerM3": "30", "specificHeatJPerKgK": "1500"},
            {"name": "Render (test)", "thicknessM": "0.020", "lambdaWPerMK": "0.80", "densityKgPerM3": "1800", "specificHeatJPerKgK": "1000"},
        ],
    },
    {
        "id": "B-single-layer-pure-conduction",
        "description": "One layer, zero surface resistances: U = lambda/d exactly. Checkable by hand in seconds.",
        "widthM": "5.0",
        "heightM": "2.0",
        "rsi": "0",
        "rse": "0",
        "insideC": "21",
        "outsideC": "1",
        "durationHours": "10",
        "layers": [
            {"name": "Slab (test)", "thicknessM": "0.30", "lambdaWPerMK": "0.60", "densityKgPerM3": "1500", "specificHeatJPerKgK": "800"},
        ],
    },
    {
        "id": "C-four-layer-wall-heat-gain",
        "description": "Same wall as case A, outside warmer than inside (summer heat gain, inward).",
        "widthM": "3.0",
        "heightM": "2.5",
        "rsi": "0.13",
        "rse": "0.04",
        "insideC": "24",
        "outsideC": "35",
        "durationHours": "12",
        "layers": [
            {"name": "Plaster (test)", "thicknessM": "0.015", "lambdaWPerMK": "0.50", "densityKgPerM3": "1200", "specificHeatJPerKgK": "1000"},
            {"name": "Masonry (test)", "thicknessM": "0.200", "lambdaWPerMK": "1.00", "densityKgPerM3": "2000", "specificHeatJPerKgK": "1000"},
            {"name": "Insulation (test)", "thicknessM": "0.080", "lambdaWPerMK": "0.040", "densityKgPerM3": "30", "specificHeatJPerKgK": "1500"},
            {"name": "Render (test)", "thicknessM": "0.020", "lambdaWPerMK": "0.80", "densityKgPerM3": "1800", "specificHeatJPerKgK": "1000"},
        ],
    },
    {
        "id": "D-three-layer-wall-sub-zero-outside",
        "description": "Different layers and a below-zero outside temperature (checks negative temperatures).",
        "widthM": "4.0",
        "heightM": "2.7",
        "rsi": "0.13",
        "rse": "0.04",
        "insideC": "21",
        "outsideC": "-3",
        "durationHours": "8",
        "layers": [
            {"name": "Board (test)", "thicknessM": "0.0125", "lambdaWPerMK": "0.25", "densityKgPerM3": "900", "specificHeatJPerKgK": "1000"},
            {"name": "Brick (test)", "thicknessM": "0.25", "lambdaWPerMK": "0.50", "densityKgPerM3": "1600", "specificHeatJPerKgK": "900"},
            {"name": "Foam (test)", "thicknessM": "0.12", "lambdaWPerMK": "0.040", "densityKgPerM3": "20", "specificHeatJPerKgK": "1450"},
        ],
    },
]


def exact(x):
    """Exact value as 'numerator/denominator' (or an integer string)."""
    return str(x)


def solve(case):
    rsi, rse = F(case["rsi"]), F(case["rse"])
    layers = case["layers"]
    d = [F(layer["thicknessM"]) for layer in layers]
    lam = [F(layer["lambdaWPerMK"]) for layer in layers]
    rho = [F(layer["densityKgPerM3"]) for layer in layers]
    cp = [F(layer["specificHeatJPerKgK"]) for layer in layers]

    # A. Layer resistances R = d / lambda, and the total.
    r = [di / li for di, li in zip(d, lam)]
    r_total = rsi + sum(r) + rse
    u = 1 / r_total

    # C. Heat-transfer rate (magnitude) and direction.
    area = F(case["widthM"]) * F(case["heightM"])
    t_in, t_out = F(case["insideC"]), F(case["outsideC"])
    delta_t = t_in - t_out
    q_dot = u * area * abs(delta_t)
    direction = "outward" if delta_t > 0 else ("inward" if delta_t < 0 else "none")

    # D. Energy at constant conditions: E = Q * t / 1000 (kWh).
    hours = F(case["durationHours"])
    energy_kwh = q_dot * hours / 1000

    # E. Heat capacity: areal = sum(rho * cp * d); total = areal * area.
    areal = [ro * c * di for ro, c, di in zip(rho, cp, d)]
    areal_total = sum(areal)
    total_capacity = areal_total * area

    # Temperature profile. Signed flux q (W/m2): positive = inside -> outside.
    flux = delta_t / r_total
    t_si = t_in - flux * rsi
    points = [
        ("inside-air", F(0), t_in),
        ("inside-surface", F(0), t_si),
    ]
    pos, temp = F(0), t_si
    temps_at_layer_faces = [t_si]
    for i, (di, ri) in enumerate(zip(d, r)):
        pos += di
        temp -= flux * ri
        temps_at_layer_faces.append(temp)
        if i < len(d) - 1:
            points.append(("interface", pos, temp))
    t_se = temp
    # Independent consistency checks (exact; any failure stops the script):
    assert t_se == t_out + flux * rse, "outside surface temperature mismatch"
    for i in range(len(d)):
        # Fourier's law applied layer by layer must give back the same flux.
        layer_flux = lam[i] * (temps_at_layer_faces[i] - temps_at_layer_faces[i + 1]) / d[i]
        assert layer_flux == flux, f"Fourier check failed in layer {i}"
    assert abs(flux) * area == q_dot, "flux x area must equal Q"
    points.append(("outside-surface", pos, t_se))
    points.append(("outside-air", pos, t_out))

    return {
        "id": case["id"],
        "description": case["description"],
        "input": {
            "widthM": float(F(case["widthM"])),
            "heightM": float(F(case["heightM"])),
            "surfaceResistances": {"insideM2KPerW": float(rsi), "outsideM2KPerW": float(rse)},
            "conditions": {
                "insideTemperatureC": float(t_in),
                "outsideTemperatureC": float(t_out),
                "durationHours": float(hours),
            },
            "layers": [
                {
                    "name": layer["name"],
                    "thicknessM": float(F(layer["thicknessM"])),
                    "lambdaWPerMK": float(F(layer["lambdaWPerMK"])),
                    "densityKgPerM3": float(F(layer["densityKgPerM3"])),
                    "specificHeatJPerKgK": float(F(layer["specificHeatJPerKgK"])),
                }
                for layer in layers
            ],
        },
        "expected": {
            "areaM2": float(area),
            "totalThicknessM": float(sum(d)),
            "layerResistancesM2KPerW": [float(x) for x in r],
            "layerResistanceFractions": [float(x / r_total) for x in r],
            "totalResistanceM2KPerW": float(r_total),
            "uValueWPerM2K": float(u),
            "temperatureDifferenceK": float(delta_t),
            "heatTransferMagnitudeW": float(q_dot),
            "heatFluxMagnitudeWPerM2": float(abs(flux)),
            "direction": direction,
            "energyMagnitudeKWh": float(energy_kwh),
            "arealHeatCapacityPerLayerJPerM2K": [float(x) for x in areal],
            "arealHeatCapacityJPerM2K": float(areal_total),
            "totalHeatCapacityJPerK": float(total_capacity),
            "temperatureProfile": [
                {"kind": kind, "positionM": float(p), "temperatureC": float(t)} for kind, p, t in points
            ],
        },
        "exact": {
            "totalResistanceM2KPerW": exact(r_total),
            "uValueWPerM2K": exact(u),
            "heatTransferMagnitudeW": exact(q_dot),
            "energyMagnitudeKWh": exact(energy_kwh),
            "arealHeatCapacityJPerM2K": exact(areal_total),
            "totalHeatCapacityJPerK": exact(total_capacity),
            "heatFluxSignedWPerM2": exact(flux),
            "temperatureProfileC": [exact(t) for _, _, t in points],
        },
    }


def main():
    solved = [solve(case) for case in CASES]
    out_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "reference-cases.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(
            {
                "_note": "Generated by validation/reference_cases.py with exact rational arithmetic. "
                "Synthetic test values only; NOT real material data. Do not edit by hand.",
                "cases": solved,
            },
            fh,
            indent=2,
            ensure_ascii=False,
        )
        fh.write("\n")

    for case in solved:
        e, x = case["expected"], case["exact"]
        print(f"[{case['id']}]")
        print(f"  R_total = {x['totalResistanceM2KPerW']} = {e['totalResistanceM2KPerW']:.10f} m2K/W")
        print(f"  U       = {x['uValueWPerM2K']} = {e['uValueWPerM2K']:.10f} W/m2K")
        print(f"  Q       = {x['heatTransferMagnitudeW']} = {e['heatTransferMagnitudeW']:.8f} W ({e['direction']})")
        print(f"  E       = {x['energyMagnitudeKWh']} = {e['energyMagnitudeKWh']:.8f} kWh")
        print(f"  C_areal = {e['arealHeatCapacityJPerM2K']:.1f} J/m2K ; C_total = {e['totalHeatCapacityJPerK']:.1f} J/K")
        temps = ", ".join(f"{p['temperatureC']:.4f}" for p in e["temperatureProfile"])
        print(f"  T profile (C): {temps}")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
