/**
 * @file config.ts
 * Strict configuration validation using Zod. Fails fast with actionable messages.
 */

import { z } from 'zod';
// Native Node.js env loader
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