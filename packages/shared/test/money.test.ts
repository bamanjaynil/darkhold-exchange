import { describe, it, expect } from 'vitest';
import {
  assertInteger,
  assertPositive,
  assertNonNegative,
  toMinorUnits,
  toMajorUnits,
  formatDKC,
  calculateCollarCeiling,
  validateOrderPrice,
  validateOrderQty,
} from '../src/money.js';

describe('money.ts unit invariants', () => {
  it('assertInteger passes on safe integers and throws on floats/NaN', () => {
    expect(() => assertInteger(100, 'test')).not.toThrow();
    expect(() => assertInteger(0, 'test')).not.toThrow();
    expect(() => assertInteger(-50, 'test')).not.toThrow();
    expect(() => assertInteger(10.5, 'test')).toThrow();
    expect(() => assertInteger(NaN, 'test')).toThrow();
    expect(() => assertInteger('100', 'test')).toThrow();
  });

  it('assertPositive and assertNonNegative enforce sign bounds', () => {
    expect(() => assertPositive(1, 'val')).not.toThrow();
    expect(() => assertPositive(0, 'val')).toThrow();
    expect(() => assertPositive(-1, 'val')).toThrow();

    expect(() => assertNonNegative(0, 'val')).not.toThrow();
    expect(() => assertNonNegative(10, 'val')).not.toThrow();
    expect(() => assertNonNegative(-1, 'val')).toThrow();
  });

  it('toMinorUnits and toMajorUnits convert accurately', () => {
    expect(toMinorUnits(1500)).toBe(150000);
    expect(toMinorUnits(15.25)).toBe(1525);
    expect(toMajorUnits(1525)).toBe(15.25);
    expect(formatDKC(1525)).toBe('15.25 DKC');
    expect(formatDKC(150000)).toBe('1,500.00 DKC');
  });

  it('calculateCollarCeiling enforces overflow-safe ceiling formula', () => {
    // Face: 1,500.00 DKC (150,000 units), collar: 1000 bps (10%)
    // Ceiling = floor(150000 * 11000 / 10000) = 165000 (1,650.00 DKC)
    const ceiling = calculateCollarCeiling(150000, 1000);
    expect(ceiling).toBe(165000);

    // Boundary check on validateOrderPrice
    expect(validateOrderPrice(165000, 100, ceiling).valid).toBe(true);
    expect(validateOrderPrice(165001, 100, ceiling).valid).toBe(false); // off-tick and collar violation
    expect(validateOrderPrice(165100, 100, ceiling).valid).toBe(false); // collar violation
    expect(validateOrderPrice(165050, 100, ceiling).reason).toBe('PRICE_OFF_TICK');
  });

  it('validateOrderQty respects min and max limits', () => {
    expect(validateOrderQty(5, 1, 10).valid).toBe(true);
    expect(validateOrderQty(0, 1, 10).valid).toBe(false);
    expect(validateOrderQty(11, 1, 10).reason).toBe('QTY_EXCEEDS_MAX');
  });
});