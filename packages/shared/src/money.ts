/**
 * @file money.ts
 * Strict integer minor-unit financial arithmetic for Darkhold Credits (DKC).
 * 1 DKC = 100 minor units (cents).
 * Floats are strictly prohibited in matching, reservations, and ledger state.
 */

export const MINOR_UNITS_PER_DKC = 100;

export function assertInteger(val: unknown, fieldName: string): asserts val is number {
  if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
    throw new Error(`[MONEY_ASSERTION_FAILED] ${fieldName} must be a safe integer, received: ${String(val)}`);
  }
}

export function assertPositive(val: unknown, fieldName: string): asserts val is number {
  assertInteger(val, fieldName);
  if (val <= 0) {
    throw new Error(`[MONEY_ASSERTION_FAILED] ${fieldName} must be strictly positive (> 0), received: ${val}`);
  }
}

export function assertNonNegative(val: unknown, fieldName: string): asserts val is number {
  assertInteger(val, fieldName);
  if (val < 0) {
    throw new Error(`[MONEY_ASSERTION_FAILED] ${fieldName} must be non-negative (>= 0), received: ${val}`);
  }
}

/**
 * Converts a floating-point or major DKC amount into integer minor units.
 */
export function toMinorUnits(major: number): number {
  if (!Number.isFinite(major)) {
    throw new Error(`Invalid major amount: ${major}`);
  }
  const minor = Math.round(major * MINOR_UNITS_PER_DKC);
  assertInteger(minor, 'minor_units');
  return minor;
}

/**
 * Converts integer minor units back to floating-point major DKC for display purposes only.
 */
export function toMajorUnits(minor: number): number {
  assertInteger(minor, 'minor');
  return minor / MINOR_UNITS_PER_DKC;
}

/**
 * Formats minor units to human-readable DKC display string (e.g. "1,500.00 DKC").
 */
export function formatDKC(minor: number): string {
  assertInteger(minor, 'minor');
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const major = Math.floor(abs / MINOR_UNITS_PER_DKC);
  const cents = abs % MINOR_UNITS_PER_DKC;
  const majorStr = major.toLocaleString('en-US');
  const centsStr = cents.toString().padStart(2, '0');
  return `${sign}${majorStr}.${centsStr} DKC`;
}

/**
 * Calculates authoritative anti-scalping price collar ceiling.
 * Formula: ceiling = floor(face_value * (10000 + collar_bps) / 10000)
 * Computed with BigInt to guarantee overflow safety.
 */
export function calculateCollarCeiling(faceValue: number, collarBps: number): number {
  assertPositive(faceValue, 'faceValue');
  assertNonNegative(collarBps, 'collarBps');

  const faceBig = BigInt(faceValue);
  const bpsMultiplier = BigInt(10000 + collarBps);
  const ceilingBig = (faceBig * bpsMultiplier) / 10000n;

  const ceiling = Number(ceilingBig);
  assertInteger(ceiling, 'ceiling');
  return ceiling;
}

/**
 * Validates order price against tick size and collar ceiling.
 */
export function validateOrderPrice(
  price: number,
  tickSize: number,
  ceiling: number
): { valid: boolean; reason?: string } {
  if (!Number.isSafeInteger(price) || price <= 0) {
    return { valid: false, reason: 'INVALID_PRICE' };
  }
  if (!Number.isSafeInteger(tickSize) || tickSize <= 0) {
    return { valid: false, reason: 'INVALID_TICK_SIZE' };
  }
  if (price % tickSize !== 0) {
    return { valid: false, reason: 'PRICE_OFF_TICK' };
  }
  if (price > ceiling) {
    return { valid: false, reason: 'COLLAR_VIOLATION' };
  }
  return { valid: true };
}

/**
 * Validates order quantity against instrument constraints.
 */
export function validateOrderQty(
  qty: number,
  minQty: number,
  maxQty: number
): { valid: boolean; reason?: string } {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    return { valid: false, reason: 'INVALID_QTY' };
  }
  if (qty < minQty) {
    return { valid: false, reason: 'QTY_BELOW_MIN' };
  }
  if (qty > maxQty) {
    return { valid: false, reason: 'QTY_EXCEEDS_MAX' };
  }
  return { valid: true };
}