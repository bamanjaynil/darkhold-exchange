/**
 * @file simulator.ts
 * Deterministic automated market maker and trader simulation.
 * Submits orders through the exact same ExchangeCore command path as human users.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExchangeCore } from '../core.js';
import { config } from '../config.js';

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarketSimulator {
  private core: ExchangeCore;
  private rng: () => number;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private simUsers = ['usr_alice', 'usr_bob', 'usr_carol'];

  constructor(core: ExchangeCore, seed: number = config.SIM_SEED) {
    this.core = core;
    this.rng = mulberry32(seed);
  }

  public start(intervalMs: number = 1000 / config.SIM_ARRIVAL_RATE): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(() => {
      void this.step();
    }, intervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async step(): Promise<void> {
    const symbols = ['FEST-GA', 'FEST-VIP', 'MERCH-CLOAK'];
    const symbol = symbols[Math.floor(this.rng() * symbols.length)];
    const inst = this.core.instruments.get(symbol);
    if (!inst) return;

    const user = this.simUsers[Math.floor(this.rng() * this.simUsers.length)];
    const side = this.rng() < 0.5 ? 'BUY' : 'SELL';

    // Spread orders around face value
    const offset = (Math.floor(this.rng() * 10) - 5) * inst.tickSize;
    const price = Math.max(inst.tickSize, inst.faceValue + offset);
    const qty = Math.floor(this.rng() * 3) + 1;

    try {
      await this.core.dispatch({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: `sim_ord_${Date.now()}_${Math.floor(this.rng() * 10000)}`,
          clientOrderId: `sim_cid_${Date.now()}_${Math.floor(this.rng() * 10000)}`,
          seq: 0,
          userId: user,
          symbol,
          side,
          type: 'LIMIT',
          tif: 'GTC',
          price,
          qty,
        },
      });
    } catch {
      // Ignored in simulation loop
    }
  }
}