/**
 * @file clock.ts
 * Injected Clock interface allowing deterministic testing of time-based features
 * like Dutch auctions and escrow timeouts without sleeping or relying on system clock.
 */

export interface Clock {
  now(): number; // Milliseconds since UNIX epoch
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private currentTime: number;

  constructor(initialTime: number = 1700000000000) {
    this.currentTime = initialTime;
  }

  public now(): number {
    return this.currentTime;
  }

  public advance(ms: number): void {
    this.currentTime += ms;
  }

  public set(timeMs: number): void {
    this.currentTime = timeMs;
  }
}