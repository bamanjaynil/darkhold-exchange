/**
 * @file config.ts
 * Strict configuration validation using Zod. Fails fast with actionable messages.
 */

import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url))); } catch {}
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch {}
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}
try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch {}
try { process.loadEnvFile(); } catch {}

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  POW_SECRET: z.string().min(32, 'POW_SECRET must be at least 32 characters'),
  ESCROW_SECRET: z.string().min(32, 'ESCROW_SECRET must be at least 32 characters'),

  MARKET_MODE: z.enum(['shared', 'offline']).default('offline'),
  FORCE_START: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),

  REGISTRATION_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  STARTER_GRANT_DKC: z.coerce.number().int().nonnegative().default(100000), // 1,000.00 DKC

  PERSIST_BATCH_MAX: z.coerce.number().int().min(1).default(5000),
  PERSIST_BATCH_MS: z.coerce.number().int().min(1).default(5),

  POW_REQUIRED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  POW_MIN_DIFFICULTY: z.coerce.number().int().min(4).max(32).default(10),
  POW_MAX_DIFFICULTY: z.coerce.number().int().min(4).max(32).default(22),
  RATE_LIMIT_PROFILE: z
    .preprocess((val) => {
      const v = (val || process.env.RATE_PROFILE || 'standard') as string;
      if (v === 'benchmark' || v === 'unthrottled') return 'bench';
      return v;
    }, z.enum(['standard', 'bench']).default('standard')),
  MAX_OPEN_ORDERS_PER_USER: z.coerce.number().int().min(1).default(50),
  RATE_LIMIT_ORDERS_PER_SEC: z.coerce.number().int().min(1).default(50),
  RATE_LIMIT_CANCELS_PER_SEC: z.coerce.number().int().min(1).default(50),

  COLLAR_BPS_DEFAULT: z.coerce.number().int().min(0).default(1000),
  ESCROW_TIMEOUT_SEC: z.coerce.number().int().min(10).default(300),

  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),

  ADMIN_PASSWORD: z.string().default('admin_darkhold_2026'),
  DEMO_PASSWORD: z.string().default('demo_darkhold_2026'),

  SIM_SEED: z.coerce.number().int().default(1337),
  SIM_ARRIVAL_RATE: z.coerce.number().int().default(10),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let parsedConfig: AppConfig;
try {
  parsedConfig = ConfigSchema.parse(process.env);
} catch (err: any) {
  if (err instanceof z.ZodError) {
    console.error('Configuration validation failed:');
    for (const issue of err.issues) {
      console.error(`  - [${issue.path.join('.')}] ${issue.message}`);
    }
    process.exit(1);
  }
  throw err;
}

export const config = parsedConfig;

/**
 * Darkhold Exchange Economy Configuration
 */
export const ECONOMY_CONFIG = {
  // Configurable fixed exchange rate: 1 DKC = ₹1.00 INR
  INR_PER_DKC: 1.0,

  // Platform fee in basis points (100 bps = 1%, default 0)
  PLATFORM_FEE_BPS: 0,

  // Withdrawal limits (in DKC)
  MIN_WITHDRAWAL_DKC: 10,
  MAX_WITHDRAWAL_DKC: 100000,

  // Deposit limits (in DKC)
  MIN_DEPOSIT_DKC: 10,
  MAX_DEPOSIT_DKC: 100000,
};

// UPI ID / VPA validation regex (e.g. name@okaxis, trader@okhdfc, user@ybl, fail@upi)
export const UPI_ID_REGEX = /^[\w.-]+@[\w.-]+$/;

export function isValidUpiId(upiId: unknown): boolean {
  if (typeof upiId !== 'string') return false;
  return UPI_ID_REGEX.test(upiId.trim());
}
