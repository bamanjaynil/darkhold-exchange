# Darkhold Exchange — Tool Disclosure & Systems Architecture Documentation

**Document Version:** 1.0.0  
**Date:** October 25, 2026  
**Audience:** Technical Evaluators, Auditors & Core Contributors  

---

## 1. Programming Languages, Runtimes & Package Managers

* **TypeScript (v5.6.3)**: Primary language for all packages (`@darkhold/shared`, `@darkhold/engine`, `@darkhold/server`, `@darkhold/web`). Configured with strict null checks, no implicit any, and modern ES2022 module resolution.
* **Node.js (v24.22.1)**: Server-side execution runtime utilizing native Node.js features (`process.loadEnvFile`, `node:crypto`, `DataView`, `Uint32Array` views, typed arrays).
* **pnpm (v12.11.1 / workspace mode)**: Monorepo package manager managing workspace dependencies across `/packages` and `/apps`.
* **React (v18.3.1)**: Frontend client framework implementing declarative UI components, hooks, Web Worker threading, and WebSocket reactive state.
* **Vite (v5.4.21 / v5.4.11)**: Frontend build tool and development server with reverse-proxy tunneling for `/api` and `/ws`.

---

## 2. Infrastructure, Databases & State Stores

* **PostgreSQL (v16-alpine via Docker Compose)**: Authoritative relational database and double-entry ledger store. Features:
  * Single-writer exclusive advisory locking (`SELECT pg_try_advisory_lock(0x4441524b)`).
  * ACID transaction boundaries with constraint-checking deferred triggers (`trg_journal_balanced`).
  * Parameterized bulk-insert using PostgreSQL `UNNEST` and multi-table Common Table Expressions (`cte_bulk_flush`).
* **Redis (v7.4-alpine via Docker Compose)**: High-speed in-memory store configured with Append-Only File (`appendfsync everysec`) for transient pub/sub and distributed cache.
* **Binary Append-Only Log (AOL)**: Local write-ahead sequential journal (`journal.bin`) with zero-allocation `Uint32Array` fixed-size binary records (128 bytes/record).

---

## 3. Libraries & Cryptographic Primitives

* **Fastify (v5.1.0)**: High-performance HTTP server engine with `@fastify/cors`, `@fastify/cookie`, and `@fastify/websocket`.
* **Argon2id (`@node-rs/argon2 v2.0.2`)**: Password hashing standard enforcing memory cost 19,456 KiB, time cost 2, and parallelism 1.
* **Zod (v3.23.8)**: Declarative schema validation enforcing strict types across API boundaries and client forms.
* **Node Native Crypto (`node:crypto`)**: SHA-256 digest creation for anti-bot Proof of Work and Merkle-sum tree cryptographic commitments.

---

## 4. Automated Testing & Performance Benchmarking Tools

* **Vitest (v2.1.8 / v2.1.9)**: Workspace-wide automated testing suite executing 63 unit, integration, and scenario tests across all packages.
* **Grafana k6 (v0.54.0)**: Production-grade load testing and performance profiling engine. Used to execute:
  * `tests/load/readiness-market-load.js` (public probes, order book L2 snapshots, trade history).
  * `tests/load/auth-and-wallet-load.js` (authentication lifecycle, session tokens, CSRF protection, and wallet queries).
* **tsx (v4.19.2)**: TypeScript JIT execution tool for development and benchmark execution (`bench/core-bench.ts`, `bench/engine-bench.ts`).

---

## 5. AI Assistance Disclosure

In accordance with transparent engineering principles, AI development assistance (Google DeepMind Antigravity Agentic Assistant) was utilized for:
* **Root-Cause Diagnosis**: Identifying the parameter scoping error in `apps/server/src/core.ts` where shadowed `resolve` caused runtime failure on 10-second `ESCROW_SWEEP` timers.
* **Optimization & Profiling**: Designing zero-allocation object pools, frozen arrays, and TypedArray buffered binary log writers.
* **Test Suite Expansion**: Drafting integration regression tests for failure paths, unauthenticated rejection, and CSRF enforcement (`apps/server/test/api-failure-paths.test.ts`).
* **Documentation & Matrix Generation**: Assembling QA checklists and technical architecture references.

All code and architecture decisions were systematically executed, typechecked, unit-tested, and verified against running PostgreSQL and Redis containers.

---

## 6. Simulation Boundaries, Data Sources & Known Limitations

* **Simulated Trading Currency (Darkhold Credits / DKC)**:
  * DKC is a demonstration currency represented as a 64-bit integer in minor units (1 DKC = 100 minor units).
  * No real fiat currency, payment gateway, or banking network is integrated.
* **Market Data Generation**:
  * The exchange operates in **offline-first mode** (`MARKET_MODE=offline`) by default.
  * Instruments (`FEST-GA`, `FEST-VIP`, `RELIC-AGAMOTTO`, `MERCH-CLOAK`) are loaded from deterministic static fixtures (`db/seed/instruments.json`).
  * Automated market activity is driven by a deterministic pseudo-random market simulator (`apps/server/src/sim/simulator.ts`) using the `mulberry32` PRNG algorithm with a seed (`config.SIM_SEED = 1337`).
  * No external third-party market data API is required or contacted for core exchange operations.
* **Single-Writer Constraint**:
  * Darkhold Exchange uses an authoritative in-memory matching engine backed by single-writer advisory locking. Clustering multiple concurrent server instances against the same database without an external partition coordinator is unsupported by design.
