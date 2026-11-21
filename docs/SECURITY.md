# Security & Threat Model — The Darkhold Exchange

## 1. Threat Model & Mitigations

### 1.1 Account Isolation & Impersonation
- **Threat:** Malicious caller attempts to place orders or cancel resting orders on behalf of another user by tampering with body or header fields.
- **Mitigation:**
  - Zero trust in client-supplied `userId`. Identity is derived solely from the cryptographically random 32-byte session token stored in the `dk_session` cookie.
  - Ownership is checked on every state-changing command: `order.userId === session.userId` (returns HTTP 403 Forbidden).

### 1.2 Cross-Site Request Forgery (CSRF)
- **Threat:** Attacker tricks a trader into submitting orders via unauthorized cross-site requests.
- **Mitigation:**
  - Double-submit CSRF token architecture (`dk_csrf` cookie matched with `x-csrf-token` header).
  - Strict `Origin` and `SameSite=Lax` cookie attributes.

### 1.3 High-Frequency Bot Swarms & DoS Attacks
- **Threat:** Scalper bots attempt to flood order entry to exhaust available inventory or overwhelm server resources.
- **Mitigation:**
  - **Adaptive Proof-of-Work (PoW):** Requires solving an HMAC-SHA256 challenge before order submission. Difficulty scales adaptively based on caller request velocity.
  - **Bounded Replay Cache:** Prevents reuse of valid nonces across requests.
  - **Token-Bucket Rate Limiting:** Enforces independent per-IP and per-user order submission caps.

### 1.4 Predatory Secondary Price Gouging (Scalping)
- **Threat:** Sellers attempt to corner the secondary market and list limited-edition passes at exorbitant prices.
- **Mitigation:**
  - **Authoritative Server-Side Price Collars:** Dynamic price caps tied to face value (`ceiling = floor(face_value * (10000 + collar_bps) / 10000)`). Orders exceeding ceiling are rejected immediately with `COLLAR_VIOLATION`.

### 1.5 Database Injection & Tampering
- **Threat:** Direct SQL tampering or race conditions modifying ledger postings.
- **Mitigation:**
  - Parameterized queries on all PostgreSQL statements.
  - Database-level append-only trigger (`trg_postings_immutable`) that throws runtime exceptions on any `UPDATE` or `DELETE` attempt.
