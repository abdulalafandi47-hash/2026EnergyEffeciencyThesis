/**
 * Unit conversions between DISPLAY units (what a user types or reads) and the
 * SI units used inside the engine.
 *
 * Rule of the project: convert at the edges, calculate in SI. The engine never
 * sees millimetres or kWh-as-input, so changing a display unit cannot change a
 * physical result; the tests check exactly that.
 *
 * Scale factors are stored as exact integer ratios (numerator / denominator)
 * and applied as (value × num) / den. Dividing by 1000 gives the correctly
 * rounded result, whereas multiplying by 0.001 would not (0.001 cannot be
 * stored exactly in binary floating point).
 *
 * These functions only convert; they do not judge physics (e.g. they do not
 * reject temperatures below absolute zero). The engine does that.
 */
import { EngineInputError } from '../engine/errors';

interface Ratio {
  /** value_in_base = value × num / den */
  num: number;
  den: number;
}

function check(value: number, unit: string, table: Record<string, Ratio> | null): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EngineInputError([
      { code: 'not-a-finite-number', path: 'value', message: `Value to convert must be a finite number (got ${String(value)}).` },
    ]);
  }
  if (table && !Object.hasOwn(table, unit)) {
    throw new EngineInputError([
      { code: 'invalid-option', path: 'unit', message: `Unknown unit "${unit}". Known units: ${Object.keys(table).join(', ')}.` },
    ]);
  }
}

function toBase(value: number, unit: string, table: Record<string, Ratio>): number {
  check(value, unit, table);
  const ratio = table[unit] as Ratio;
  return (value * ratio.num) / ratio.den;
}

function fromBase(valueInBase: number, unit: string, table: Record<string, Ratio>): number {
  check(valueInBase, unit, table);
  const ratio = table[unit] as Ratio;
  return (valueInBase * ratio.den) / ratio.num;
}

// ---- length (base: metre) ---------------------------------------------------
export type LengthUnit = 'mm' | 'cm' | 'm';
const LENGTH: Record<LengthUnit, Ratio> = {
  mm: { num: 1, den: 1000 },
  cm: { num: 1, den: 100 },
  m: { num: 1, den: 1 },
};
export const lengthToMetres = (value: number, unit: LengthUnit): number => toBase(value, unit, LENGTH);
export const metresToLength = (valueM: number, unit: LengthUnit): number => fromBase(valueM, unit, LENGTH);

// ---- energy (base: joule) ---------------------------------------------------
export type EnergyUnit = 'J' | 'kJ' | 'MJ' | 'Wh' | 'kWh';
const ENERGY: Record<EnergyUnit, Ratio> = {
  J: { num: 1, den: 1 },
  kJ: { num: 1000, den: 1 },
  MJ: { num: 1_000_000, den: 1 },
  Wh: { num: 3600, den: 1 }, // 1 Wh = 3600 s × 1 W
  kWh: { num: 3_600_000, den: 1 },
};
export const energyToJoules = (value: number, unit: EnergyUnit): number => toBase(value, unit, ENERGY);
export const joulesToEnergy = (valueJ: number, unit: EnergyUnit): number => fromBase(valueJ, unit, ENERGY);

// ---- power (base: watt) -----------------------------------------------------
export type PowerUnit = 'W' | 'kW';
const POWER: Record<PowerUnit, Ratio> = {
  W: { num: 1, den: 1 },
  kW: { num: 1000, den: 1 },
};
export const powerToWatts = (value: number, unit: PowerUnit): number => toBase(value, unit, POWER);
export const wattsToPower = (valueW: number, unit: PowerUnit): number => fromBase(valueW, unit, POWER);

// ---- temperature ------------------------------------------------------------
// ABSOLUTE temperatures (a reading on a thermometer) and temperature
// DIFFERENCES (a gap between two readings) convert differently: 0 °C = 32 °F,
// but a difference of 0 K = a difference of 0 °F. Mixing these up is a classic
// error, so there are two separate sets of functions.
export type TemperatureUnit = 'C' | 'K' | 'F';

function checkTemperatureUnit(value: number, unit: string): void {
  check(value, unit, null);
  if (unit !== 'C' && unit !== 'K' && unit !== 'F') {
    throw new EngineInputError([
      { code: 'invalid-option', path: 'unit', message: `Unknown temperature unit "${unit}". Known units: C, K, F.` },
    ]);
  }
}

/** Absolute temperature in the given unit → °C. */
export function temperatureToCelsius(value: number, unit: TemperatureUnit): number {
  checkTemperatureUnit(value, unit);
  if (unit === 'K') return value - 273.15;
  if (unit === 'F') return ((value - 32) * 5) / 9;
  return value;
}

/** Absolute temperature in °C → the given unit. */
export function celsiusToTemperature(valueC: number, unit: TemperatureUnit): number {
  checkTemperatureUnit(valueC, unit);
  if (unit === 'K') return valueC + 273.15;
  if (unit === 'F') return (valueC * 9) / 5 + 32;
  return valueC;
}

/** Temperature DIFFERENCE in the given unit → kelvin (identical to a difference in °C). */
export function temperatureDifferenceToKelvin(delta: number, unit: TemperatureUnit): number {
  checkTemperatureUnit(delta, unit);
  return unit === 'F' ? (delta * 5) / 9 : delta;
}

/** Temperature DIFFERENCE in kelvin → the given unit. */
export function kelvinToTemperatureDifference(deltaK: number, unit: TemperatureUnit): number {
  checkTemperatureUnit(deltaK, unit);
  return unit === 'F' ? (deltaK * 9) / 5 : deltaK;
}
