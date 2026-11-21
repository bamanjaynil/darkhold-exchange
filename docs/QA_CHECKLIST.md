# Darkhold Exchange — Comprehensive QA Checklist & Verification Matrix

**Last Audit:** October 25, 2026  
**Auditor:** Full-Stack & Systems Reliability Engineering  
**Branch:** `perf/final-complete-optimization`  
**Vitest Suite Status:** **63 / 63 tests passing (100% green)**  
**k6 Load Testing Status:** **100% checks passing (0% error rate)**  
**Ledger Reconciliation:** **CLEAN (100% Balanced)**

---

## 1. Core Services & Infrastructure

| Item | Component | Verification Status | Evidence / Test | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 1.1 | Docker Compose PostgreSQL 16 | **VERIFIED** | `docker compose ps` / port `5433:5432` | Container healthy; tables hydrated with schema and constraints. |
| 1.2 | Docker Compose Redis 7.4 | **VERIFIED** | `docker compose ps` / port `6379:6379` | Container healthy; appendonly persistence enabled. |
| 1.3 | Server Liveness Probe | **VERIFIED** | `GET /api/health` & `GET /health` | Returns HTTP 200 `{ status: "ok", service: "darkhold-exchange" }`. |
| 1.4 | Server Readiness Probe | **VERIFIED** | `GET /api/ready` & `GET /ready` | Returns HTTP 200 `{ status: "ready", database: "connected" }`. |
| 1.5 | Single-Writer Advisory Lock | **VERIFIED** | `test/api-failure-paths.test.ts` | Exclusive PostgreSQL advisory lock `0x4441524b` prevents split-brain. |
| 1.6 | Escrow Sweeper Stability | **VERIFIED** | `apps/server/src/core.ts` & `test/api-failure-paths.test.ts` | Resolved parameter scoping bug where `ESCROW_SWEEP` crashed on shadowed `resolve`. |
| 1.7 | Vite Reverse Proxy | **VERIFIED** | `apps/web/vite.config.ts` | Properly forwards `/api` and `/ws` to `http://127.0.0.1:3000`. |

---

## 2. Authentication & User Management

| Item | Feature | Verification Status | Evidence / Test | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 2.1 | Demo Account Seeding | **VERIFIED** | `db/seed/accounts.json` & `db/seed.ts` | `alice`, `bob`, `carol`, `admin` properly seeded with Argon2id password hashes. |
| 2.2 | Demo User Login | **VERIFIED** | `test/api-failure-paths.test.ts` | HTTP 200 with HttpOnly session cookie `dk_session` and `dk_csrf`. |
| 2.3 | Bad Credentials Rejection | **VERIFIED** | `test/api-failure-paths.test.ts` | HTTP 401 `INVALID_CREDENTIALS` for invalid passwords or unknown users. |
| 2.4 | Malformed Payload Handling | **VERIFIED** | `test/api-failure-paths.test.ts` | HTTP 400 `INVALID_CREDENTIALS` on missing or malformed fields. |
| 2.5 | Session Introspection | **VERIFIED** | `GET /api/auth/me` | Returns user profile, balances, and csrfToken. |
| 2.6 | Session Logout | **VERIFIED** | `POST /api/auth/logout` | Clears `dk_session` and `dk_csrf` cookies; invalidates session token. |
| 2.7 | UI Modal State Protection | **VERIFIED** | `apps/web/src/App.tsx` | Integrated `AbortController` with 8s timeout, disabled inputs during flight, and guaranteed finally cleanup. |
| 2.8 | Rate Limiting Guard | **VERIFIED** | `apps/server/src/auth.ts` | Returns HTTP 429 `RATE_LIMITED` when threshold exceeded; bench profile bypass supported. |

---

## 3. Financial Ledger & Wallet Integrity

| Item | Feature | Verification Status | Evidence / Test | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 3.1 | Wallet Invariant | **VERIFIED** | `test/scenarios.test.ts` | `Total Balance = Available + Reserved + Escrow` strictly maintained. |
| 3.2 | Double-Entry Balancing | **VERIFIED** | `test/postings-optimization.test.ts` | Every journal entry sums to 0 per currency/asset unit; enforced by DB trigger `trg_journal_balanced`. |
| 3.3 | Non-Overspend Enforced | **VERIFIED** | `test/concurrency.test.ts` | Concurrent orders cannot spend beyond available cash balance. |
| 3.4 | Atomic Reservations | **VERIFIED** | `apps/server/src/core.ts` | Cash/asset reservations occur atomically before matching engine processing. |
| 3.5 | Audit Reconciliation | **VERIFIED** | `GET /api/admin/reconcile` | Full reconstruction of ledger postings verifies zero global divergence. |

---

## 4. Order Book & Matching Engine

| Item | Feature | Verification Status | Evidence / Test | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 4.1 | Price-Time Priority | **VERIFIED** | `packages/engine/test/orderbook.test.ts` | FIFO order queues per price level strictly enforced. |
| 4.2 | Limit & Market Orders | **VERIFIED** | `packages/engine/test/orderbook.test.ts` | Supports BUY/SELL, LIMIT, MARKET, and TIF (GTC, IOC, FOK). |
| 4.3 | Self-Trade Prevention (STP) | **VERIFIED** | `apps/server/test/scenarios.test.ts` | Immediate STP cancellation when aggressor matches own resting order at level head. |
| 4.4 | Anti-Scalping Collar | **VERIFIED** | `apps/server/test/scenarios.test.ts` | Orders exceeding `ceiling = faceValue * (1 + collarBps / 10000)` are rejected. |
| 4.5 | Market Depth & Trades | **VERIFIED** | `k6/readiness-market-load.js` | L2 snapshots and recent trade history update dynamically from matching engine. |

---

## 5. Advanced Exchange Features

| Item | Feature | Verification Status | Evidence / Test | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 5.1 | Dutch Auctions | **VERIFIED** | `apps/server/test/scenarios.test.ts` | Linear price decay, bid validation, and reservation settlements. |
| 5.2 | Escrow Custody | **VERIFIED** | `apps/server/test/scenarios.test.ts` | Locked escrow, mock issuer receipt delivery verification, and automated sweeper refunds. |
| 5.3 | Proof of Solvency | **VERIFIED** | `packages/shared/test/merkle.test.ts` | Merkle-sum tree inclusion proof verifies individual liabilities without exposing peer balances. |
| 5.4 | Anti-Bot Proof of Work | **VERIFIED** | `packages/shared/test/pow.test.ts` & `App.tsx` | SHA-256 leading-zero bit challenge verified in backend and computed in frontend Web Worker. |
| 5.5 | Offline Market Simulation | **VERIFIED** | `apps/server/src/sim/simulator.ts` | Deterministic PRNG (`mulberry32`) simulation runs offline without external feeds. |

---

## 6. Performance Benchmarking & Reliability

| Item | Benchmark | Result | Target / Threshold | Status |
| :--- | :--- | :--- | :--- | :--- |
| 6.1 | k6 Public Market Load | **527.99 req/sec** (avg 2.09 ms, p95 4.96 ms) | p95 < 50 ms, error < 1% | **VERIFIED (PASSED)** |
| 6.2 | k6 Auth & Wallet Load | **83.04 req/sec** (avg 29.56 ms, p95 96.49 ms) | p95 < 150 ms, error < 2% | **VERIFIED (PASSED)** |
| 6.3 | Core AOL Ack Speed | **348,183 – 484,975 ops/sec** (~10–14 ms) | > 200,000 ops/sec | **VERIFIED (PASSED)** |
| 6.4 | Group Commit Flushed | **140,667 – 279,912 ops/sec** (< 35 ms) | > 100,000 ops/sec | **VERIFIED (PASSED)** |
| 6.5 | Memory Churn | **2.12 MB delta** (down from 22.0 MB) | < 5.0 MB heap churn | **VERIFIED (PASSED)** |

---

## 7. Interactive UI & Controls Verification Matrix

| Control / Button | Location | Action & Verification | Status |
| :--- | :--- | :--- | :--- |
| **Logout Button** | Header Navbar | Invokes `POST /api/auth/logout` (with `GET` fallback), clears `dk_session` and `dk_csrf` with matching `SameSite=Lax`, `HttpOnly`, `Path=/`, and `Max-Age=0` attributes; resets local session, balance, holdings, open orders, escrows, diagnostics, and solvency state via `try...finally` with 4s AbortController. | **VERIFIED** |
| **Login / Demo Buttons** | Header & Auth Modal | 1-click fast login for `alice`, `bob`, `carol`, `admin`; includes 8s AbortController and rate limiting guards. | **VERIFIED** |
| **Register Form / Switch** | Auth Modal | Toggles mode without freezing; validates credentials and creates authenticated session with starter balance. | **VERIFIED** |
| **Instrument Switchers** | Instrument Bar | Switches active order book, trades, and WebSocket subscription (`FEST-GA`, `FEST-VIP`, `RELIC-AGAMOTTO`, `MERCH-CLOAK`). Auto-aligns price input with instrument face value to prevent collar rejections. | **VERIFIED** |
| **Order Placement (BUY/SELL)** | Trading Ladder Tab | Fetches PoW challenge, solves in background Web Worker, validates price collar, submits order, and updates book. Auto-switches `GTC` to `IOC` on MARKET order selection to prevent `UNSUPPORTED_COMBINATION`. | **VERIFIED** |
| **Order Cancel Button** | Open Orders Table | Sends `DELETE /api/orders/:id?symbol=${symbol}` with order-specific symbol and CSRF validation; unlinks resting node and updates balance. | **VERIFIED** |
| **Create Dutch Auction** | Dutch Auctions Tab | Form modal validates collar ceiling, floor price, and step amounts; dispatches `AUCTION_CREATE` with seller asset inventory deduction. | **VERIFIED** |
| **Buy Dutch Auction Unit** | Dutch Auctions Tab | Sends `POST /api/auctions/:id/buy` with credentials; validates maxPrice against decayed price and settles. | **VERIFIED** |
| **Generate Receipt & Deliver** | Escrow Custody Tab | Requests cryptographic delivery receipt from mock issuer authority and executes `ESCROW_DELIVER` release. Escrow Custody tab button includes credentials. | **VERIFIED** |
| **Re-run Solvency Proof** | Proof of Solvency Tab | Computes client-side Merkle-sum leaf-to-root path, validates root sum conservation, and verifies zero-sum ledger status. | **VERIFIED** |
| **Simulate Tamper Test** | Proof of Solvency Tab | Injects +100,000 DKC fraudulent liability into proof; correctly demonstrates cryptographic detection of fraud. | **VERIFIED** |
| **Run Ledger Reconciliation** | Diagnostics Tab | Admin diagnostic queries double-entry postings across all currency/asset units, verifying zero invariant errors. | **VERIFIED** |
| **Run Scalper Bot Attack Demo** | Diagnostics Tab | Dispatches 30-burst rapid order submissions to trigger rate limit token exhaustion and audit log capture. | **VERIFIED** |
