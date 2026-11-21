# DARKHOLD TERMINAL — EVIDENCE-BASED ENGINEERING AUDIT REPORT

## 1. Executive Baseline & Architecture Summary
- **Repository Stack:** pnpm Workspace Monorepo (`packages/shared`, `apps/api`, `apps/web`), Node.js 24, TypeScript 5.6, Fastify v5, `@fastify/websocket`, `@fastify/jwt`, Prisma ORM + PostgreSQL 16 (host port `5433`), Redis 7.4 (host port `6379`), React 18 + Vite 5.
- **Execution Model:** Single-writer in-memory Price-Time Priority (FIFO) Doubly-Linked List Limit Order Book per market, paired with Double-Entry Ledger accounting, Ed25519 cryptographic escrow receipts, deterministic Dutch auctions, and SHA-256 Merkle Sum Tree liability proofs.

---

## 2. Prioritized Defect Findings (P0 – P3)

### [P0-01] Unilateral Dutch Auction Balance Deduction Allows Negative Balances
- **Severity:** P0 (Critical Financial Integrity Defect)
- **Affected Feature:** Dutch Auction & Instant Liquidation (`POST /api/v1/auctions/clear`)
- **Evidence:** `apps/api/src/server.ts` lines 422–425 subtracted `clearingPrice` from `winnerW.available` without checking `winnerW.available < clearingPrice`.
- **Why It Matters:** A user with insufficient funds could capture the auction and force their available balance below zero, violating the core non-negative balance invariant.
- **Concrete Fix:** Check `winnerW.available < clearingPrice` before acquiring the lock or mutating state; return HTTP `400 ERR_INSUFFICIENT_FUNDS`.
- **Verification Method:** Automated test `Scenario D & H` in `apps/api/test/exchange.test.ts`.

### [P0-02] Self-Trade Prevention (STP) Silently Destroys Reserved Cash and Inventory
- **Severity:** P0 (Critical Financial Conservation Defect)
- **Affected Feature:** Matching Engine (`apps/api/src/engine/OrderBook.ts`)
- **Evidence:** In `OrderBook.ts` lines 124–129 and 189–194, when `resting.userId === incoming.userId`, `level.remove(resting)` removed the resting order without refunding `resting.lockedCash` (for BUY) or `resting.remainingQty` (for SELL).
- **Why It Matters:** Any trader whose order crossed their own resting order permanently lost their locked cash or inventory, breaking wallet/ledger conservation.
- **Concrete Fix:** Return `stpCancelled: OrderNode[]` from `processOrder()` and immediately reverse the reservation (`USER_LOCKED -> USER_AVAILABLE` or restore relic inventory) with an explicit `STP_CANCEL_UNLOCK` ledger entry.
- **Verification Method:** Unit & integration test `Self-Trade Prevention refunds resting reservation` in `apps/api/test/exchange.test.ts`.

### [P0-03] Price-Improvement Refund Double-Deducted Buyer Locked Balance
- **Severity:** P0 (Critical Accounting Defect)
- **Affected Feature:** Limit Order Matching & Settlement (`apps/api/src/server.ts` & `OrderBook.ts`)
- **Evidence:** When a Buyer submitted a Limit BUY at ₹2,100 against a resting Ask at ₹2,040, `incoming.lockedCash` was decremented at the limit price while settlement deducted `tradeValue` AND `buyerRefund` from `buyerW.locked` inconsistently when resting vs. incoming orders matched.
- **Why It Matters:** Caused divergence between sum of open order reservations and `USER_LOCKED` account balances.
- **Concrete Fix:** Track `buyerLockPrice` on every `MatchedTrade`. Deduct `buyerLockPrice * qty` from `buyer.locked`, credit `execPrice * qty` to `ESCROW_VAULT`, and credit `buyerRefund` (`(buyerLockPrice - execPrice) * qty`) back to `buyer.available`.
- **Verification Method:** `Scenario A & B` ledger reconstruction invariant check (`assertSystemInvariants()`).

### [P0-04] Missing Password Authentication & Cross-User Order Cancellation Vulnerability
- **Severity:** P0 (Critical Security & Access Control Defect)
- **Affected Feature:** Authentication, Order Entry, Order Cancellation, Dutch Auction
- **Evidence:** `POST /api/v1/auth/login` accepted any `userId` without password verification; `DELETE /api/v1/orders/:id` had no JWT check and allowed any caller to cancel any user's order; `POST /api/v1/orders` allowed body `userId` spoofing.
- **Why It Matters:** Violates user isolation; an attacker can impersonate another trader or cancel competing orders in the book.
- **Concrete Fix:** Add PBKDF2-SHA256 password verification on login, require valid `Authorization: Bearer <jwt>` on all protected routes, bind operations strictly to `req.user.userId`, and enforce `order.userId === req.user.userId` on cancellation (`403 Forbidden`).
- **Verification Method:** `Scenario F — Authentication & Authorization Boundary` in `apps/api/test/exchange.test.ts`.

### [P0-05] Missing Request Idempotency on Order & Auction Submissions
- **Severity:** P0 (Reliability & Duplicate Execution Defect)
- **Affected Feature:** Order Placement & Auction Liquidation
- **Evidence:** `POST /api/v1/orders` did not inspect `X-Idempotency-Key`.
- **Why It Matters:** Network retries during high load could double-submit an order and lock twice the user's funds.
- **Concrete Fix:** Store responses keyed by `${userId}:${idempotencyKey}` and return the original payload cleanly on duplicate retries.
- **Verification Method:** `Scenario G — Duplicate Request Idempotency` in `apps/api/test/exchange.test.ts`.

### [P1-06] Incomplete Merkle Sum Tree Verification (Leaf-Only Check in UI)
- **Severity:** P1 (Cryptographic Verification Gap)
- **Affected Feature:** Merkle Solvency Verification (`apps/api/src/ledger/Solvency.ts` & `apps/web/src/App.tsx`)
- **Evidence:** Browser only verified `sha256(userId:nonce:balance) === leafHash` without traversing `siblings` to verify `merkleRootHash` and total liability sum.
- **Why It Matters:** A valid inclusion proof must verify the entire path from leaf to root and reject tampered balances or sibling hashes.
- **Concrete Fix:** Implement full `verifyMerkleSumProof(proof)` in `@darkhold/shared` and expose both valid verification and a "Tamper Proof Test" in the UI.
- **Verification Method:** `Scenario I — Solvency Verification (Valid & Tampered Proofs)` in `apps/api/test/exchange.test.ts`.

### [P1-07] Benchmark Traffic Contaminated Live Demo Order Book
- **Severity:** P1 (Diagnostic Isolation Defect)
- **Affected Feature:** System Diagnostics (`/api/v1/sim/swarm` & `/api/v1/sim/http-benchmark`)
- **Evidence:** Benchmarks executed against `mkt_darkhold_vip` and `usr_wanda`, polluting demo balances and ledger audit history.
- **Why It Matters:** Running diagnostics during a judge evaluation corrupted the human trading state.
- **Concrete Fix:** Isolate benchmark runs into a dedicated `OrderBook` instance (`mkt_benchmark_sandbox`) and report true P50, P95, P99 latencies, memory usage, and order outcome breakdowns.

---

## 3. Feature & Implementation Status Matrix (Phase 2)

| # | Feature | Initial Status | Post-Repair Status | Persistence | Test Coverage | Required Action Taken |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Authentication & Account Identity | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL + JWT | Scenario A, F | Added PBKDF2 password auth, session persistence, logout & strict JWT ownership guards. |
| 2 | Wallet Balances & Inventory | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL + RAM Sync | Scenario A–K | Enforced strict reservation & ledger reconstruction invariants. |
| 3 | Level 2 Order Book & Depth | IMPLEMENTED BUT INSUFFICIENTLY TESTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL + Redis Stream | Scenario A, B, C, E | Verified price-time priority, cumulative depth & spread calculation. |
| 4 | Limit & Market Orders | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL + RAM Sync | Scenario A, B, E | Fixed Market SELL collar execution and unfilled Market order IOC refund. |
| 5 | Buy/Sell Execution | IMPLEMENTED BUT INSUFFICIENTLY TESTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL | Scenario A, B, K | Fixed price-improvement refund and STP unlock accounting. |
| 6 | GTC, IOC & FOK Handling | IMPLEMENTED BUT INSUFFICIENTLY TESTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL | Scenario E | Verified FOK atomic pre-check and IOC immediate remainder cancellation. |
| 7 | Open Orders & Cancellation | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL | Scenario C, F | Enforced owner-only JWT authorization on `DELETE /api/v1/orders/:id`. |
| 8 | Partial & Complete Fills | IMPLEMENTED BUT INSUFFICIENTLY TESTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL | Scenario A, B | Added partial fill reservation retention & subsequent fill tests. |
| 9 | Double-Entry Ledger | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL `LedgerEntry` | Scenario A–K | Verified $\sum \text{Debits} = \sum \text{Credits}$ and account balance reconstruction. |
| 10 | Escrow Custody & Settlement | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL | Scenario A | Added Ed25519 signature verification & buyer/seller authorization. |
| 11 | Dutch Auction & Liquidation | BROKEN (No balance check) | **IMPLEMENTED AND VERIFIED** | PostgreSQL + Redis Lock | Scenario H | Fixed balance validation & concurrent buyer mutex lock. |
| 12 | HTTP Order Pipeline Benchmark | MISLABELLED ("TCP Benchmark") | **IMPLEMENTED AND VERIFIED** | Isolated Sandbox | Benchmark Suite | Relabelled accurately as HTTP Order Pipeline Benchmark; isolated state. |
| 13 | 2,500-Order Engine Burst | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | Isolated Sandbox | Benchmark Suite | Added P50/P95/P99 latency tracking & isolated sandbox book. |
| 14 | Merkle Solvency Verification | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | Live Wallet Tree | Scenario I | Added full leaf-to-root sum path verification & tamper rejection test. |
| 15 | Real-Time Updates & Metrics | IMPLEMENTED BUT INSUFFICIENTLY TESTED | **IMPLEMENTED AND VERIFIED** | 20 FPS WS Broadcast | Integration Suite | Added WS connection status indicator & clean fallback. |
| 16 | Persistence & Recovery | PARTIALLY IMPLEMENTED | **IMPLEMENTED AND VERIFIED** | PostgreSQL + Seed Reset | Scenario J | Added DB write-through, startup hydration & deterministic demo reset. |
