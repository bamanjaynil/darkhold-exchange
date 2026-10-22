# Data Sources & Market Integrity — The Darkhold Exchange

## 1. Local Seeded Catalogue
The primary data source for The Darkhold Exchange is the authoritative local configuration defined in `db/seed/instruments.json`:
- `FEST-GA` (General Admission Festival Pass)
- `FEST-VIP` (VIP Sanctum Access Pass)
- `RELIC-AGAMOTTO` (Eye of Agamotto Amulet, Escrow-Required)
- `MERCH-CLOAK` (Cloak of Levitation Replica)
- `BENCH-X` (Dedicated Benchmark Stress Instrument)

All face values, collar bounds (`collar_bps`), tick sizes, and quantity limits are loaded directly from PostgreSQL and immutable in RAM during runtime.

## 2. Policy on External Ticket & Market Data APIs
- **Ticketmaster / Eventbrite APIs:** These platforms do not provide real-time order books or secondary double-entry ledgers. They are ticketing primary sales APIs. Connecting to them in a high-frequency matching engine would introduce external network latency, non-deterministic rate limits, and fragile third-party dependencies.
- **Stock Market LOBSTER / FI-2010 Datasets:** Stock market datasets do not model secondary ticket economies with anti-scalping price caps, face-value dynamic collars, or delivery escrows.
- **Verdict:** Third-party APIs are documented as optional future reference feeds only and must never sit on the critical path of the in-memory matching engine.
