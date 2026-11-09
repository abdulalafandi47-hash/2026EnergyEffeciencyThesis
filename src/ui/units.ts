/**
 * The units the user sees and types: one choice for temperatures and one for
 * layer thicknesses, shared by both workspaces. The model and every calculation
 * stay in SI (°C, m); these helpers only convert at the screen.
 */
import { celsiusToTemperature, kelvinToTemperatureDifference, lengthToMetres, metresToLength, temperatureToCelsius } from '../units';
import type { LengthUnit, TemperatureUnit } from '../units';

export type { LengthUnit, TemperatureUnit };

export interface UnitChoice {
  temperature: TemperatureUnit;
  thickness: LengthUnit;
}

export const DEFAULT_UNITS: UnitChoice = { temperature: 'C', thickness: 'mm' };
export const TEMPERATURE_SYMBOL: Record<TemperatureUnit, string> = { C: '°C', K: 'K', F: '°F' };
/** Unit of a temperature DIFFERENCE in the chosen scale (1 °C difference = 1 K). */
export const DIFFERENCE_SYMBOL: Record<TemperatureUnit, string> = { C: 'K', K: 'K', F: '°F' };

export const showTemperature = (celsius: number, unit: TemperatureUnit): number => celsiusToTemperature(celsius, unit);
export const readTemperature = (value: number, unit: TemperatureUnit): number => temperatureToCelsius(value, unit);
export const showDifference = (kelvin: number, unit: TemperatureUnit): number => kelvinToTemperatureDifference(kelvin, unit);
export const showThickness = (metres: number, unit: LengthUnit): number => metresToLength(metres, unit);
export const readThickness = (value: number, unit: LengthUnit): number => lengthToMetres(value, unit);

/** A stored unit choice, or null if `text` is not one (damaged or foreign storage). */
export function parseUnitChoice(text: string | null): UnitChoice | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return null;
    const { temperature, thickness } = raw as Record<string, unknown>;
    if ((temperature === 'C' || temperature === 'K' || temperature === 'F') && (thickness === 'mm' || thickness === 'cm' || thickness === 'm')) return { temperature, thickness };
    return null;
  } catch {
    return null;
  }
}
