// bench/k6/orders.js
// k6 load test script targeting /api/orders on BENCH-X
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 50 },
    { duration: '10s', target: 200 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'], // 95% of requests must complete below 50ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: 'admin', password: 'admin_darkhold_2026' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(loginRes, { 'login status is 200': (r) => r.status === 200 });
  const data = JSON.parse(loginRes.body);
  return {
    csrfToken: data.csrfToken,
    cookies: loginRes.headers['Set-Cookie'],
  };
}

export default function (data) {
  const payload = JSON.stringify({
    clientOrderId: `k6_${Date.now()}_${Math.random()}`,
    symbol: 'BENCH-X',
    side: Math.random() < 0.5 ? 'BUY' : 'SELL',
    type: 'LIMIT',
    tif: 'GTC',
    price: 100000,
    qty: 1,
  });

  const res = http.post(`${BASE_URL}/api/orders`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': data.csrfToken,
      'x-bench-bypass': 'true',
    },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}