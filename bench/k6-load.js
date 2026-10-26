// bench/k6-load.js
// Production-grade k6 load test for Darkhold Exchange matching engine pipeline
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '15s',
    },
  },
  noConnectionReuse: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_failed: ['rate<0.01'], // Error rate must stay below 1%
    http_req_duration: ['p(95)<50'], // 95% of orders processed under 50ms under 50 concurrent VUs
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export function setup() {
  const usersToLogin = [
    { username: 'admin', password: 'password123' },
    { username: 'bench_maker', password: 'password123' },
    { username: 'bench_bot', password: 'password123' },
    { username: 'bench_taker', password: 'password123' },
  ];

  const authData = {};

  for (const cred of usersToLogin) {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify(cred),
      { headers: { 'Content-Type': 'application/json' } }
    );

    const loginSuccess = check(res, {
      [`login ${cred.username} returned 200`]: (r) => r.status === 200,
    });

    if (!loginSuccess) {
      throw new Error(`Failed to login user ${cred.username} during k6 setup: ${res.body}`);
    }

    const json = res.json();
    authData[cred.username] = {
      username: cred.username,
      sessionToken: json.sessionToken,
      csrfToken: json.csrfToken,
      cookie: `dk_session=${json.sessionToken}; dk_csrf=${json.csrfToken}`,
    };
  }

  return { users: authData };
}

export default function (data) {
  const isEvenVU = __VU % 2 === 0;
  const isEvenIter = __ITER % 2 === 0;

  // Disjoint dedicated benchmark counterparty sets:
  // Even VUs (25 VUs): Group A = [admin, bench_maker]
  // Odd VUs (25 VUs):  Group B = [bench_bot, bench_taker]
  // Complete separation guarantees 0% STP collisions and keeps alice, bob, carol 100% untouched
  let user;
  let side;

  if (isEvenVU) {
    user = (__VU % 4 === 0) ? data.users.admin : data.users.bench_maker;
    side = isEvenIter ? 'BUY' : 'SELL';
  } else {
    user = ((__VU + 1) % 4 === 0) ? data.users.bench_bot : data.users.bench_taker;
    side = isEvenIter ? 'SELL' : 'BUY';
  }

  const payload = JSON.stringify({
    clientOrderId: `k6_${__VU}_${__ITER}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    symbol: 'BENCH-X',
    side,
    type: 'LIMIT',
    tif: 'GTC',
    price: 100000,
    qty: 1,
  });

  const res = http.post(`${BASE_URL}/api/orders`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': user.cookie,
      'x-session-token': user.sessionToken,
      'x-csrf-token': user.csrfToken,
      'x-bench-bypass': 'true',
      'Connection': 'keep-alive',
    },
    responseType: 'none',
  });

  check(res, {
    'order accepted (200 or 201)': (r) => r.status === 200 || r.status === 201,
  });
}

export function teardown() {
  http.post(`${BASE_URL}/api/admin/flush`, null, {
    headers: { 'x-bench-bypass': 'true' },
  });
}

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration ? data.metrics.http_req_duration.values : {};
  const med = (dur.med !== undefined ? dur.med : (dur['p(50)'] !== undefined ? dur['p(50)'] : 0)).toFixed(2);
  const p95 = (dur['p(95)'] !== undefined ? dur['p(95)'] : 0).toFixed(2);
  const p99 = (dur['p(99)'] !== undefined ? dur['p(99)'] : (dur.max || 0)).toFixed(2);
  const avg = (dur.avg !== undefined ? dur.avg : 0).toFixed(2);
  const min = (dur.min !== undefined ? dur.min : 0).toFixed(2);
  const max = (dur.max !== undefined ? dur.max : 0).toFixed(2);

  const totalReqs = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const rps = (data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0).toFixed(2);
  const failedRate = data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.rate * 100).toFixed(2) : '0.00';

  const report = [
    '================================================================================',
    '                   DARKHOLD EXCHANGE — K6 LOAD BENCHMARK REPORT                 ',
    '================================================================================',
    `Timestamp:           ${new Date().toISOString()}`,
    `Target URL:          ${BASE_URL}`,
    `Concurrency:         50 VUs (constant-vus)`,
    `Duration:            15s`,
    `Instrument:          BENCH-X`,
    '--------------------------------------------------------------------------------',
    'HTTP THROUGHPUT & STATUS:',
    `  Total Requests:    ${totalReqs}`,
    `  Throughput:        ${rps} req/sec`,
    `  Error Rate:        ${failedRate}%`,
    '--------------------------------------------------------------------------------',
    'LATENCY PERCENTILES (ms):',
    `  Min:               ${min} ms`,
    `  Median (p50):      ${med} ms`,
    `  p95:               ${p95} ms`,
    `  p99:               ${p99} ms`,
    `  Max:               ${max} ms`,
    `  Avg:               ${avg} ms`,
    '================================================================================',
  ].join('\n');

  return {
    'stdout': '\n' + report + '\n',
    'bench/results/k6-report.txt': report,
  };
}
