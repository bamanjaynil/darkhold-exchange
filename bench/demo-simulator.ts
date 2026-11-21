/**
 * @file bench/demo-simulator.ts
 * Live Demo Market Maker and Trade Simulator for Darkhold Exchange Web UI.
 * Simulates realistic order flow, order book depth, and live crossing trades
 * between demo accounts (alice, bob, carol) for real-time WebSocket demonstration.
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SYMBOL = process.env.SYMBOL || 'FEST-GA';

interface DemoUserSession {
  username: string;
  userId: string;
  sessionToken: string;
  csrfToken: string;
  cookie: string;
}

const DEMO_USERS = [
  { username: 'alice', password: 'demo_darkhold_2026' },
  { username: 'bob', password: 'demo_darkhold_2026' },
  { username: 'carol', password: 'demo_darkhold_2026' },
];

async function loginUser(user: { username: string; password: string }): Promise<DemoUserSession> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to login demo user ${user.username} (${res.status}): ${text}`);
  }

  const data: any = await res.json();
  const sessionToken = data.sessionToken;
  const csrfToken = data.csrfToken;
  const cookie = `dk_session=${sessionToken}; dk_csrf=${csrfToken}`;

  return {
    username: user.username,
    userId: data.user.id,
    sessionToken,
    csrfToken,
    cookie,
  };
}

async function submitOrder(
  session: DemoUserSession,
  side: 'BUY' | 'SELL',
  price: number,
  qty: number,
  symbol: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': session.cookie,
        'x-session-token': session.sessionToken,
        'x-csrf-token': session.csrfToken,
        'x-bench-bypass': 'true',
      },
      body: JSON.stringify({
        clientOrderId: `sim_${session.username}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        symbol,
        side,
        type: 'LIMIT',
        tif: 'GTC',
        price,
        qty,
      }),
    });

    const data: any = await res.json();
    return { success: res.ok, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('================================================================================');
  console.log('         DARKHOLD EXCHANGE — LIVE DEMO MARKET MAKER SIMULATOR                   ');
  console.log('================================================================================');
  console.log(`[DEMO:SIM] Connecting to Darkhold Exchange at ${BASE_URL}...`);
  console.log(`[DEMO:SIM] Active Target Instrument: ${SYMBOL}`);

  // 1. Authenticate Demo Users
  console.log('[DEMO:SIM] Authenticating demo traders (alice, bob, carol)...');
  const sessions: DemoUserSession[] = [];
  for (const cred of DEMO_USERS) {
    const session = await loginUser(cred);
    sessions.push(session);
    console.log(`  ✓ Logged in ${session.username} (${session.userId})`);
  }

  console.log('--------------------------------------------------------------------------------');
  console.log('[DEMO:SIM] Starting live simulation loop...');
  console.log('[DEMO:SIM] Open http://localhost:5173 to watch the Order Book and Trade Tape update live!');
  console.log('[DEMO:SIM] Press Ctrl+C at any time to halt the simulation.\n');

  // Baseline market price for FEST-GA (150,000 minor DKC = 1,500.00 DKC)
  let midPrice = 150000;
  const tickSize = 100;
  let tick = 0;
  let running = true;

  process.on('SIGINT', () => {
    console.log('\n[DEMO:SIM] Stopping simulator gracefully...');
    running = false;
    process.exit(0);
  });

  // Simulation tick loop
  while (running) {
    tick++;

    // Slight random walk on mid-price around 1,500.00 DKC (+/- 15.00 DKC)
    const drift = (Math.random() - 0.5) * tickSize * 2;
    midPrice = Math.max(148500, Math.min(151500, Math.round((midPrice + drift) / tickSize) * tickSize));

    // Rotate traders
    const traderA = sessions[tick % sessions.length]!;
    const traderB = sessions[(tick + 1) % sessions.length]!;
    const traderC = sessions[(tick + 2) % sessions.length]!;

    const action = tick % 5;

    if (action === 0) {
      // 1. Crossing trade at midPrice: Trader A posts resting SELL, Trader B matches with BUY
      const qty = Math.floor(Math.random() * 2) + 1;
      await submitOrder(traderA, 'SELL', midPrice, qty, SYMBOL);
      const buyRes = await submitOrder(traderB, 'BUY', midPrice, qty, SYMBOL);

      const dkcPrice = (midPrice / 100).toFixed(2);
      if (buyRes.success) {
        console.log(
          `[TRADE] ${traderB.username.toUpperCase()} BOUGHT ${qty} ${SYMBOL} @ ${dkcPrice} DKC from ${traderA.username.toUpperCase()} (Crossing Fill)`
        );
      }
    } else if (action === 1) {
      // 2. Crossing trade in reverse: Trader B posts resting BUY, Trader C matches with SELL
      const qty = Math.floor(Math.random() * 2) + 1;
      await submitOrder(traderB, 'BUY', midPrice, qty, SYMBOL);
      const sellRes = await submitOrder(traderC, 'SELL', midPrice, qty, SYMBOL);

      const dkcPrice = (midPrice / 100).toFixed(2);
      if (sellRes.success) {
        console.log(
          `[TRADE] ${traderC.username.toUpperCase()} SOLD ${qty} ${SYMBOL} @ ${dkcPrice} DKC to ${traderB.username.toUpperCase()} (Crossing Fill)`
        );
      }
    } else if (action === 2) {
      // 3. Resting Bid Ladder Liquidity (Trader A and C place bids below mid)
      const bidPrice = midPrice - (Math.floor(Math.random() * 4) + 1) * tickSize;
      const qty = Math.floor(Math.random() * 3) + 1;
      await submitOrder(traderA, 'BUY', bidPrice, qty, SYMBOL);
    } else if (action === 3) {
      // 4. Resting Ask Ladder Liquidity (Trader B and C place asks above mid)
      const askPrice = midPrice + (Math.floor(Math.random() * 4) + 1) * tickSize;
      const qty = Math.floor(Math.random() * 3) + 1;
      await submitOrder(traderB, 'SELL', askPrice, qty, SYMBOL);
    } else {
      // 5. Dual Market-Maker Quotes: Tight spread around mid
      const spread = tickSize;
      const tightBid = midPrice - spread;
      const tightAsk = midPrice + spread;
      await submitOrder(traderC, 'BUY', tightBid, 1, SYMBOL);
      await submitOrder(traderA, 'SELL', tightAsk, 1, SYMBOL);
    }

    // Dynamic sleep between 250ms and 450ms for realistic trading rhythm
    const delay = 250 + Math.floor(Math.random() * 200);
    await new Promise((r) => setTimeout(r, delay));
  }
}

main().catch((err) => {
  console.error('[DEMO:SIM ERROR]', err);
  process.exit(1);
});
