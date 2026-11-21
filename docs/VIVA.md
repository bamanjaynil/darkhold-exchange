# Viva Defense Guide: 15 Hardest Technical Questions

### Q1: Why did you choose a single-writer architecture instead of multi-threaded or distributed writers?
**Answer:** In matching engines and financial ledgers, the hardest problem is serializing overlapping orders at the same price tick. Multi-writer systems require distributed locks or optimistic concurrency with high abort rates. By dedicating a single Node.js process to own state in memory, order execution is strictly serialized on a single FIFO event loop, achieving deterministic Price-Time Priority with zero race conditions and sub-microsecond matching latency. Horizontal scaling is achieved by sharding by instrument symbol.

### Q2: How does group-commit persistence guarantee atomicity without sacrificing throughput?
**Answer:** Instead of committing to PostgreSQL synchronously per order (which limits throughput to disk fsync rates of ~100-200 ops/sec), `ExchangeCore` produces in-memory state deltas. The `PersistenceEngine` collects up to 100 deltas (or waits at most 5ms) and flushes them in a single PostgreSQL transaction. Crucially, HTTP responses and WebSocket broadcasts are released **only after** that transaction commits.

### Q3: What happens if a group-commit batch fails in PostgreSQL?
**Answer:** If the commit fails, the persistence engine halts the queue, rejects all commands in that batch, and invokes the recovery callback. The core completely rebuilds its in-memory books, balances, and holdings directly from PostgreSQL (`orders ORDER BY seq`, `balances`, `holdings`) and then resumes clean processing. This guarantees memory never diverges from durable disk.

### Q4: How does Fill-or-Kill (FOK) guarantee zero side effects on failure?
**Answer:** Before executing any mutations or reservations, the engine performs a non-mutating dry-run walk of the order book (`canFillFOK`). It tallies fillable volume respecting limit price, collar ceiling, and self-trade rules. If cumulative volume is less than requested quantity, the order is rejected immediately with `FOK_NOT_FILLABLE` without modifying a single pointer or account balance.

### Q5: How do pre-flight reservations prevent overspending under concurrent requests?
**Answer:** When an order arrives in `ExchangeCore`, the core immediately transfers the required funds from `available` to `reserved` (`buyer.available -= reservationCash; buyer.reserved += reservationCash`). Because all commands are processed serially on the core queue, subsequent concurrent orders see the depleted `available` balance and reject with `INSUFFICIENT_FUNDS` before matching begins.

### Q6: What does the Merkle Sum Tree prove, and what does it NOT prove?
**Answer:** The Merkle Sum Tree proves internal mathematical consistency: that the user's balance is included in the tree leaf, that the tree root sum equals total liabilities, and that this sum matches the internal double-entry ledger postings. It does **not** prove external solvency or that the exchange holds real fiat/crypto reserves in external bank accounts or blockchains.

### Q7: Why do odd nodes get promoted instead of duplicated in your Merkle tree?
**Answer:** In traditional Merkle trees, odd nodes are sometimes duplicated to balance the tree. In a Merkle **Sum** Tree, duplicating a node would double its financial liability in the parent sum, corrupting the total sum. Therefore, unpaired odd nodes are promoted directly to the next level without duplication.

### Q8: How does Self-Trade Prevention (STP) work in your matching engine?
**Answer:** During the matching walk, if the next resting order belongs to the same `userId` as the incoming aggressor, matching halts immediately. The incoming order's remaining quantity is cancelled (it never rests in the book), while the resting order remains untouched. For FOK orders, the whole order is rejected.

### Q9: Why is price-improvement refund necessary, and how is it calculated?
**Answer:** A buyer placing a LIMIT BUY at ₹2,100 reserves ₹2,100 up front. If the resting ask executes at ₹2,040, the trade settles at the maker's price (₹2,040). The engine calculates `buyerRefund = (limitPrice - execPrice) * matchQty` (₹60) and releases it from `reserved` back to `available` via a balanced `RELEASE` journal.

### Q10: Why are PostgreSQL postings append-only, and how is that enforced?
**Answer:** Accounting integrity requires that past ledger entries can never be modified or deleted. We enforce this at the database engine level using a PostgreSQL trigger (`trg_postings_immutable`) that throws an uncatchable exception on `BEFORE UPDATE OR DELETE`. Any corrections must be submitted as new compensating journals.

### Q11: How does the server prevent a second replica from corrupting database state?
**Answer:** On startup, `bootstrapCore` attempts to acquire an exclusive PostgreSQL advisory lock (`SELECT pg_try_advisory_lock(0x4441524b)`). If another instance is running or holds the lock, the process exits immediately with `SINGLE_WRITER_VIOLATION`.

### Q12: How does adaptive Proof-of-Work protect the order submission endpoint?
**Answer:** The client must solve an HMAC-SHA256 challenge before placing an order. If a client submits orders at high frequency (>20/min), difficulty bits increase adaptively, requiring more hash iterations in their Web Worker. Bounded replay caching ensures nonces cannot be reused.

### Q13: How is the Dutch auction price computed, and why is it server-side only?
**Answer:** The price is computed authoritatively by the server as:
$$\text{price} = \max(\text{floorPrice}, \text{startPrice} - \lfloor \text{elapsedMs} / \text{stepIntervalMs} \rfloor \times \text{stepAmount})$$
Clients submit only `{ auctionId, qty, maxPrice }`. The server recomputes the price at the exact moment of execution on the serialized queue, rejecting with `PRICE_MOVED` if the market moved above `maxPrice`.

### Q14: How does the restart recovery algorithm verify database integrity?
**Answer:** At boot, the server loads all active orders `ORDER BY seq ASC` and replays them into in-memory books. It then recomputes all account balances from immutable postings and compares them against `balances` and `holdings` cache tables. If any divergence is detected, boot is halted unless `FORCE_START=true`.

### Q15: Why is Redis not used for order matching or wallet storage?
**Answer:** In-memory V8 heap structures (`Map`, `Array`, doubly-linked lists) have sub-microsecond access times ($<1\,\mu\text{s}$), whereas network round-trips to Redis take $0.5\text{--}2\,\text{ms}$. Storing balances in both Redis and PostgreSQL introduces distributed consistency risks.
