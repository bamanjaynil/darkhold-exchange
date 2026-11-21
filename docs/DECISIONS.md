# Architecture Decision Records (ADR) — The Darkhold Exchange

## 1. Single Authoritative Writer with PostgreSQL Advisory Lock
- **Decision:** A single Node.js process owns all market state in memory (order books, cash balances, relic inventory, auctions, escrows). All state-changing operations are serialized through a single FIFO command queue in `ExchangeCore`.
- **Alternatives Considered:**
  1. *Distributed Multi-Writer with Optimistic Concurrency Control (OCC):* Rejected due to high abort/retry rates under high-frequency crossing traffic on the same instrument.
  2. *Redis Streams with Redis Locks:* Rejected to eliminate external broker dependencies in the critical financial path and avoid dual-write divergence between Redis and PostgreSQL.
- **Trade-offs:** Horizontal scaling requires sharding by instrument symbol (`FEST-GA`, `RELIC-AGAMOTTO`), where each writer process owns a disjoint set of instruments. Multi-replica active-active clustering against the same database is strictly forbidden; enforced by PostgreSQL advisory lock `pg_try_advisory_lock(0x4441524b)` at boot.

## 2. Group-Commit Persistence Engine
- **Decision:** In-memory command execution produces a state delta batch (orders, fills, journals, postings, balance deltas). Up to `PERSIST_BATCH_MAX` (100) deltas are collected or held for at most `PERSIST_BATCH_MS` (5ms), and flushed into PostgreSQL in a single ACID transaction. HTTP responses and WebSocket events are released only after database commit.
- **Rollback-by-Rebuild Strategy:** If a PostgreSQL transaction fails, the core rejects all commands in that batch, halts the queue, rebuilds RAM state directly from PostgreSQL (`orders ORDER BY seq`, `balances`, `holdings`), and resumes processing.
- **Trade-offs:** Adds bounded ~5ms queuing latency to individual HTTP responses in exchange for order-of-magnitude higher transaction throughput and zero dirty broadcasts.

## 3. Exclusion of Redis from Critical Financial Path
- **Decision:** Docker Compose includes Redis 7.4, but the exchange core runs 100% independently of Redis.
- **Justification:** Financial ledgers and matching engines demand strict durability and zero balance anomalies. Relying on Redis for financial state creates dual-write split-brain hazards. In-memory JavaScript heap maps provide sub-microsecond lookups with zero network overhead.

## 4. Pure In-Memory Limit Order Book (`packages/engine`)
- **Decision:** `packages/engine` contains zero I/O, zero `Date.now()`, and zero `Math.random()`. Time is represented strictly by monotonic sequence numbers (`seq`).
- **Data Structure:**
  - `Map<number, PriceLevel>` for $O(1)$ level lookup.
  - Sorted price arrays (`bids` descending, `asks` ascending) with binary search insertion ($O(\log P)$).
  - Doubly-linked list per price level for $O(1)$ FIFO order queueing and $O(1)$ order cancellation via node pointers in `Map<string, OrderNode>`.

## 5. Integer Minor Units for Monetary Arithmetic
- **Decision:** All currency amounts are represented as safe 64-bit integer minor units (1 DKC = 100 minor units). Floating-point arithmetic is strictly forbidden in matching, reservation, and ledger paths.
- **Collar Math:** Ceiling calculation `floor(face_value * (10000 + collar_bps) / 10000)` is implemented with `BigInt` to prevent integer overflow.

## 6. Pure Double-Entry Append-Only Ledger
- **Decision:** Every monetary movement is recorded as a journal with balanced postings where $\sum \text{amount} = 0$ per unit (`CASH` or instrument symbol).
- **Enforcement:** Enforced at three levels:
  1. In TypeScript before persistence (`LedgerManager.assertJournalBalanced`).
  2. In PostgreSQL via deferred constraint trigger `trg_journal_balanced`.
  3. In PostgreSQL via trigger `trg_postings_immutable` forbidding `UPDATE` and `DELETE`.

## 7. Cryptographic Proof of Solvency (Merkle Sum Tree)
- **Decision:** Merkle Sum Tree where leaves represent user total cash liabilities (`available + reserved + escrow`), hashed with private salt.
- **Verification:** Verification is performed entirely client-side in the browser using pure TypeScript (`@darkhold/shared`), checking leaf inclusion, root sum conservation, and full ledger reconciliation.
