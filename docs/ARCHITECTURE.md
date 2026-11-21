# Architecture Specification — The Darkhold Exchange

## 1. System Overview & Monorepo Topology
The Darkhold Exchange is a high-frequency secondary marketplace for festival passes and rare relics, engineered for absolute financial integrity, sub-millisecond in-memory execution, and provable anti-bot protection.

```
                    ┌─────────────────────────┐
                    │      React 18 Web       │
                    │   Obsidian Terminal UI  │
                    └────────────┬────────────┘
                                 │ HTTP (REST) / WebSocket
                    ┌────────────▼────────────┐
                    │     apps/server         │
                    │   Fastify + WS Gateway  │
                    └──────┬───────────▲──────┘
             Command Dispatch (FIFO)   │ Broadcast Commits
                    ┌──────▼───────────┴──────┐
                    │      ExchangeCore       │
                    │ (Single In-Memory Writer│
                    └──────┬───────────▲──────┘
             Delta Batches │           │ Hydrate State
                    ┌──────▼───────────┴──────┐
                    │    PostgreSQL 16        │
                    │ (Double-Entry Ledger)   │
                    └─────────────────────────┘
```

## 2. In-Memory Order Book Data Structure
The order book in `packages/engine` implements strict Price-Time Priority (FIFO):
- **Price Levels:** `Map<number, PriceLevel>` maps tick prices directly to price level descriptors.
- **Sorted Price Arrays:**
  - `bids`: Array of bid prices sorted descending (`bids[0]` is best bid).
  - `asks`: Array of ask prices sorted ascending (`asks[0]` is best ask).
- **FIFO Doubly-Linked List:** Each `PriceLevel` maintains `head` and `tail` pointers to `OrderNode` entries.
- **Order Lookup:** `Map<string, OrderNode>` provides instant $O(1)$ node location for immediate cancellation.

### Complexity Matrix
| Operation | Implementation Structure | Time Complexity |
| :--- | :--- | :--- |
| **Submit Limit (Resting)** | Level FIFO append + binary search price insertion | $O(1)$ amortized insert, $O(\log P)$ search, $O(P)$ array splice for new level |
| **Order Cancel** | Node reference in Doubly-Linked List | $O(1)$ unlink and map removal |
| **Best Price Lookup** | Direct array index (`bids[0]`, `asks[0]`) | $O(1)$ |
| **Matching Walk** | Walk opposite book levels and FIFO nodes | $O(M)$ where $M$ is number of matched fills |
| **L2 Depth Aggregation** | Top $K$ levels linear scan | $O(K)$ |

## 3. Financial Invariants & Double-Entry Ledger
1. **Quantity Conservation:**
   $$\text{Available} + \text{Reserved} + \text{Escrowed} = \text{Constant}$$
2. **Double-Entry Equilibrium:**
   $$\sum_{p \in \text{Journal}} p.\text{amount} = 0 \quad \forall \text{ unit} \in \{\text{CASH}, \text{FEST-GA}, \dots\}$$
3. **No Negative Balances:**
   All accounts enforce non-negative constraints in RAM and PostgreSQL `CHECK (available >= 0 AND reserved >= 0 AND escrow >= 0)`.
4. **Append-Only Immutability:**
   Postings cannot be updated or deleted; corrections are recorded as reversing journals.

## 4. Merkle Sum Tree Cryptographic Encoding
- **Leaf Encoding:**
  $$\text{Leaf} = \text{SHA256}(0x00 \parallel \text{len}(\text{pseudonym}) \parallel \text{pseudonym} \parallel \text{balance}_{8B})$$
  $$\text{pseudonym} = \text{SHA256}(\text{snapshot\_salt} \parallel \text{userId})$$
- **Internal Node Encoding:**
  $$\text{Node} = \text{SHA256}(0x01 \parallel \text{leftHash}_{32B} \parallel \text{leftSum}_{8B} \parallel \text{rightHash}_{32B} \parallel \text{rightSum}_{8B})$$
  $$\text{Node.sum} = \text{leftSum} + \text{rightSum}$$
- **Odd Node Handling:** Unpaired odd nodes are promoted directly to the next level without duplication.
