import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 10 },  // Ramp-up to 10 VUs
    { duration: '15s', target: 20 }, // Sustained load at 20 VUs
    { duration: '5s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],    // Under 1% failures
    http_req_duration: ['p(95)<50'],   // 95% of requests under 50ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export default function () {
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health status is ok': (r) => r.json('status') === 'ok',
  });

  // 2. Readiness check
  const readyRes = http.get(`${BASE_URL}/api/ready`);
  check(readyRes, {
    'readiness status is 200': (r) => r.status === 200,
    'readiness status is ready': (r) => r.json('status') === 'ready',
  });

  // 3. Instruments list
  const instRes = http.get(`${BASE_URL}/api/instruments`);
  check(instRes, {
    'instruments status is 200': (r) => r.status === 200,
    'instruments returned list': (r) => Array.isArray(r.json()),
  });

  // 4. Orderbook snapshot
  const bookRes = http.get(`${BASE_URL}/api/book/FEST-GA`);
  check(bookRes, {
    'orderbook status is 200': (r) => r.status === 200,
  });

  // 5. Recent trades
  const tradesRes = http.get(`${BASE_URL}/api/trades/FEST-GA`);
  check(tradesRes, {
    'trades status is 200': (r) => r.status === 200,
  });

  sleep(0.1);
}
