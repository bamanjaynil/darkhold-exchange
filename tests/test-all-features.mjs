import { verifyMerkleSumProof, calculateCollarCeiling, solvePoW } from '../packages/shared/dist/index.js';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3000';
let cookieJar = '';
let csrfToken = '';

function setCookies(res) {
  const sc = res.headers.getSetCookie();
  if (sc && sc.length > 0) {
    const parts = sc.map(c => c.split(';')[0]);
    cookieJar = parts.join('; ');
    const csrfMatch = cookieJar.match(/dk_csrf=([^;]+)/);
    if (csrfMatch) csrfToken = csrfMatch[1];
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookieJar) headers['Cookie'] = cookieJar;
  if (csrfToken && ['POST', 'PUT', 'DELETE'].includes(options.method)) {
    headers['x-csrf-token'] = csrfToken;
  }
  const url = BASE + path;
  const res = await fetch(url, { ...options, headers });
  setCookies(res);
  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log('>>> [1] HEALTH & READY PROBES');
  const h = await api('/health');
  if (!h.ok || h.data.status !== 'ok') throw new Error('Health check failed');
  const r = await api('/ready');
  if (!r.ok || r.data.status !== 'ready') throw new Error('Readiness check failed');
  console.log('    ✓ /health and /ready returned 200 OK');

  console.log('>>> [2] AUTH LOGOUT & UNAUTHENTICATED STATE');
  cookieJar = '';
  csrfToken = '';
  const unauth = await api('/api/auth/me');
  if (unauth.status !== 401) throw new Error('Expected 401 for unauthenticated');
  console.log('    ✓ /api/auth/me correctly returns 401');

  console.log('>>> [3] USER REGISTRATION & LOGOUT');
  const regUser = 'test_trader_' + Date.now();
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: regUser, password: 'password123' })
  });
  if (!reg.ok) throw new Error('Registration failed: ' + JSON.stringify(reg.data));
  console.log('    ✓ Registered new user ' + regUser);

  const logout1 = await api('/api/auth/logout', { method: 'POST' });
  if (!logout1.ok) throw new Error('Logout failed: ' + JSON.stringify(logout1.data));
  const meAfterLogout = await api('/api/auth/me');
  if (meAfterLogout.status !== 401) throw new Error('Session persisted after logout!');
  console.log('    ✓ Logout cleared session, subsequent /api/auth/me returns 401');

  console.log('>>> [4] LOGIN AS ALICE');
  const loginAlice = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'demo_darkhold_2026' })
  });
  if (!loginAlice.ok) throw new Error('Alice login failed');
  console.log('    ✓ Logged in as alice. Available: ' + loginAlice.data.balance.available + ' minor DKC');

  console.log('>>> [5] WALLET HOLDINGS');
  const holdings = await api('/api/wallet/holdings');
  if (!holdings.ok) throw new Error('Holdings fetch failed');
  console.log('    ✓ Holdings for alice:', holdings.data);

  console.log('>>> [6] ORDER PLACEMENT (LIMIT SELL WITH POW)');
  const chal = await api('/api/pow/challenge');
  const nonce = solvePoW(chal.data.seed, chal.data.difficultyBits);
  const sellOrder = await api('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientOrderId: 'web_' + Date.now(),
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 160000,
      qty: 1,
      pow: { challengeId: chal.data.challengeId, nonce }
    })
  });
  if (!sellOrder.ok) throw new Error('Sell order rejected: ' + JSON.stringify(sellOrder.data));
  const orderId = sellOrder.data.orderId;
  console.log('    ✓ Placed resting SELL order ' + orderId + ' status: ' + sellOrder.data.status);

  console.log('>>> [7] OPEN ORDERS & CANCEL');
  const myOrders = await api('/api/orders/my');
  if (!myOrders.ok || !myOrders.data.some(o => o.id === orderId)) throw new Error('Order not found in my orders');
  console.log('    ✓ Order ' + orderId + ' visible in /api/orders/my');

  const cancelRes = await api('/api/orders/' + orderId + '?symbol=FEST-GA', { method: 'DELETE' });
  if (!cancelRes.ok) throw new Error('Order cancel failed: ' + JSON.stringify(cancelRes.data));
  console.log('    ✓ Order ' + orderId + ' successfully cancelled');

  console.log('>>> [8] COLLAR VIOLATION REJECTION');
  const chal2 = await api('/api/pow/challenge');
  const nonce2 = solvePoW(chal2.data.seed, chal2.data.difficultyBits);
  const badOrder = await api('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientOrderId: 'bad_' + Date.now(),
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 999900, // on tick and way over ceiling (165000)
      qty: 1,
      pow: { challengeId: chal2.data.challengeId, nonce: nonce2 }
    })
  });
  if (badOrder.ok || badOrder.data.error !== 'COLLAR_VIOLATION') {
    throw new Error('Collar violation test failed, unexpected response: ' + JSON.stringify(badOrder));
  }
  console.log('    ✓ Collar violation correctly rejected with COLLAR_VIOLATION');

  console.log('>>> [9] DUTCH AUCTION CREATION & BUYING');
  // Alice creates auction for FEST-GA (she has inventory)
  const createAuc = await api('/api/auctions/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: 'FEST-GA',
      qty: 1,
      startPrice: 160000,
      floorPrice: 120000,
      stepAmount: 2000,
      stepIntervalMs: 2000,
      durationSec: 300
    })
  });
  if (!createAuc.ok) throw new Error('Auction creation failed: ' + JSON.stringify(createAuc.data));
  const aucId = createAuc.data.auction.id;
  console.log('    ✓ Created Dutch Auction ' + aucId);

  // Login as bob to buy from auction
  await api('/api/auth/logout', { method: 'POST' });
  const loginBob = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'demo_darkhold_2026' })
  });
  if (!loginBob.ok) throw new Error('Bob login failed');

  const buyAuc = await api('/api/auctions/' + aucId + '/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty: 1, maxPrice: 160000 })
  });
  if (!buyAuc.ok) throw new Error('Bob auction purchase failed: ' + JSON.stringify(buyAuc.data));
  console.log('    ✓ Bob bought 1 unit from auction ' + aucId + ' at ' + buyAuc.data.trade?.price);

  console.log('>>> [10] PROOF OF SOLVENCY VERIFICATION');
  const proofRes = await api('/api/solvency/proof');
  if (!proofRes.ok) throw new Error('Proof fetch failed: ' + JSON.stringify(proofRes.data));
  const proof = proofRes.data;
  const verifyResult = verifyMerkleSumProof(proof);
  if (!verifyResult.valid) throw new Error('Proof verification failed: ' + verifyResult.reason);
  console.log('    ✓ Cryptographic Merkle Sum Proof verified valid!');

  // Tamper test
  const tampered = { ...proof, balance: proof.balance + 50000 };
  const tamperedResult = verifyMerkleSumProof(tampered);
  if (tamperedResult.valid) throw new Error('Tampered proof should have failed verification!');
  console.log('    ✓ Tampered proof correctly failed verification: ' + tamperedResult.reason);

  console.log('>>> [11] PUBLIC SOLVENCY STATUS');
  const solStatus = await api('/api/solvency/status');
  if (!solStatus.ok || solStatus.data.balanced !== true) throw new Error('Solvency status failed');
  console.log('    ✓ Public solvency status balanced = true');

  console.log('>>> [12] ADMIN RECONCILIATION & SCALPER DEMO');
  await api('/api/auth/logout', { method: 'POST' });
  const loginAdmin = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin_darkhold_2026' })
  });
  if (!loginAdmin.ok) throw new Error('Admin login failed');

  const reconcile = await api('/api/admin/reconcile');
  if (!reconcile.ok || !reconcile.data.balanced) throw new Error('Reconciliation failed: ' + JSON.stringify(reconcile.data));
  console.log('    ✓ Ledger reconciliation verified balanced (anomalies: ' + reconcile.data.anomaliesCount + ')');

  const scalper = await api('/api/admin/scalper-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ burstCount: 15 })
  });
  if (!scalper.ok) throw new Error('Scalper demo failed');
  console.log('    ✓ Scalper attack demo executed: ' + scalper.data.attempted + ' attempts, ' + scalper.data.accepted + ' accepted');

  console.log('>>> [13] FINAL ADMIN LOGOUT');
  const finalLogout = await api('/api/auth/logout', { method: 'POST' });
  if (!finalLogout.ok) throw new Error('Final logout failed');
  const meFinal = await api('/api/auth/me');
  if (meFinal.status !== 401) throw new Error('Final logout session persisted');
  console.log('    ✓ Final logout confirmed');

  console.log('\n=============================================');
  console.log('ALL 13 MAJOR BACKEND & API FEATURE CHECKS PASSED!');
  console.log('=============================================\n');
}

main().catch(err => {
  console.error('\n❌ FAILURE:', err);
  process.exit(1);
});
