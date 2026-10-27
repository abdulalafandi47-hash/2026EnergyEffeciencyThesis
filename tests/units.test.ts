import { describe, expect, it } from 'vitest';
import {
  celsiusToTemperature,
  energyToJoules,
  joulesToEnergy,
  kelvinToTemperatureDifference,
  lengthToMetres,
  metresToLength,
  powerToWatts,
  temperatureDifferenceToKelvin,
  temperatureToCelsius,
  wattsToPower,
} from '../src/units';
import { EngineInputError } from '../src/engine';
import { expectClose, wrong } from './helpers/helpers';

describe('length conversions', () => {
  it('converts mm, cm and m to metres exactly (no 0.07999999 artefacts)', () => {
    expect(lengthToMetres(80, 'mm')).toBe(0.08);
    expect(lengthToMetres(8, 'cm')).toBe(0.08);
    expect(lengthToMetres(0.08, 'm')).toBe(0.08);
    expect(lengthToMetres(15, 'mm')).toBe(0.015);
    expect(lengthToMetres(12.5, 'mm')).toBe(0.0125);
  });

  it('the same physical length gives the same value in metres from every unit', () => {
    const fromMm = lengthToMetres(200, 'mm');
    const fromCm = lengthToMetres(20, 'cm');
    const fromM = lengthToMetres(0.2, 'm');
    expect(fromMm).toBe(fromCm);
    expect(fromCm).toBe(fromM);
  });

  it('round-trips metres → unit → metres', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      for (const metres of [0.0125, 0.015, 0.08, 0.2, 3.0, 12.34]) {
        expectClose(lengthToMetres(metresToLength(metres, unit), unit), metres);
      }
    }
  });

  it('converts metres to display units', () => {
    expectClose(metresToLength(0.08, 'mm'), 80);
    expectClose(metresToLength(0.08, 'cm'), 8);
  });

  it('only converts: it does not reject negative or zero values (the engine does that)', () => {
    expect(lengthToMetres(-5, 'mm')).toBe(-0.005);
    expect(lengthToMetres(0, 'mm')).toBe(0);
  });
});

describe('energy and power conversions', () => {
  it('uses 1 Wh = 3600 J and 1 kWh = 3.6 MJ', () => {
    expect(energyToJoules(1, 'Wh')).toBe(3600);
    expect(energyToJoules(1, 'kWh')).toBe(3_600_000);
    expect(energyToJoules(1, 'kJ')).toBe(1000);
    expect(energyToJoules(1, 'MJ')).toBe(1_000_000);
    expectClose(joulesToEnergy(energyToJoules(1, 'kWh'), 'MJ'), 3.6);
  });

  it('round-trips every energy unit', () => {
    for (const unit of ['J', 'kJ', 'MJ', 'Wh', 'kWh'] as const) {
      expectClose(joulesToEnergy(energyToJoules(1.234, unit), unit), 1.234);
    }
  });

  it('converts watts and kilowatts', () => {
    expect(powerToWatts(1.5, 'kW')).toBe(1500);
    expect(wattsToPower(1500, 'kW')).toBe(1.5);
    expect(powerToWatts(250, 'W')).toBe(250);
  });

  it('is consistent: 1000 W for 1 hour is 1 kWh', () => {
    const joules = powerToWatts(1, 'kW') * 3600; // W × s
    expectClose(joulesToEnergy(joules, 'kWh'), 1);
  });
});

describe('temperature conversions', () => {
  it('converts absolute temperatures', () => {
    expectClose(temperatureToCelsius(273.15, 'K'), 0);
    expectClose(temperatureToCelsius(32, 'F'), 0);
    expectClose(temperatureToCelsius(212, 'F'), 100);
    expectClose(temperatureToCelsius(-40, 'F'), -40);
    expectClose(celsiusToTemperature(0, 'K'), 273.15);
    expectClose(celsiusToTemperature(100, 'F'), 212);
    expect(temperatureToCelsius(25, 'C')).toBe(25);
  });

  it('round-trips absolute temperatures', () => {
    for (const unit of ['C', 'K', 'F'] as const) {
      for (const celsius of [-30, 0, 5, 20, 36.6]) {
        expectClose(temperatureToCelsius(celsiusToTemperature(celsius, unit), unit), celsius);
      }
    }
  });

  it('converts temperature DIFFERENCES differently from absolute temperatures', () => {
    // A difference of 10 K is a difference of 10 °C, and 18 °F.
    expect(temperatureDifferenceToKelvin(10, 'K')).toBe(10);
    expect(temperatureDifferenceToKelvin(10, 'C')).toBe(10);
    expectClose(temperatureDifferenceToKelvin(18, 'F'), 10);
    expectClose(kelvinToTemperatureDifference(10, 'F'), 18);
    // ...whereas the ABSOLUTE reading 0 °C is 32 °F, not 0 °F.
    expectClose(celsiusToTemperature(0, 'F'), 32);
    expect(kelvinToTemperatureDifference(0, 'F')).toBe(0);
  });
});

describe('conversion error handling', () => {
  it('rejects NaN, Infinity and non-numbers', () => {
    expect(() => lengthToMetres(NaN, 'mm')).toThrow(EngineInputError);
    expect(() => lengthToMetres(Infinity, 'mm')).toThrow(EngineInputError);
    expect(() => energyToJoules(wrong('5'), 'kWh')).toThrow(EngineInputError);
    expect(() => temperatureToCelsius(NaN, 'C')).toThrow(EngineInputError);
  });

  it('rejects unknown units instead of silently treating them as metres', () => {
    expect(() => lengthToMetres(1, wrong('furlong'))).toThrow(EngineInputError);
    expect(() => energyToJoules(1, wrong('BTU'))).toThrow(EngineInputError);
    expect(() => powerToWatts(1, wrong('hp'))).toThrow(EngineInputError);
    expect(() => temperatureToCelsius(1, wrong('R'))).toThrow(EngineInputError);
  });

  it('does not accept inherited object keys as units', () => {
    expect(() => lengthToMetres(1, wrong('toString'))).toThrow(EngineInputError);
    expect(() => lengthToMetres(1, wrong('constructor'))).toThrow(EngineInputError);
  });
});
