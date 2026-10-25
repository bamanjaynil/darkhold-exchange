import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 5 },   // Ramp-up to 5 concurrent users
    { duration: '15s', target: 10 }, // Sustained load at 10 concurrent users
    { duration: '5s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],    // Under 2% failure rate
    http_req_duration: ['p(95)<150'],  // 95% of auth/wallet requests under 150ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const DEMO_PASSWORD = __ENV.DEMO_PASSWORD || 'demo_darkhold_2026';

const users = ['alice', 'bob', 'carol'];

export default function () {
  const username = users[__VU % users.length];

  // 1. Authenticate with demo credentials
  const loginPayload = JSON.stringify({
    username: username,
    password: DEMO_PASSWORD,
  });

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  const loginSuccess = check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'login returned sessionToken': (r) => Boolean(r.json('sessionToken')),
    'login set dk_session cookie': (r) => Boolean(r.cookies.dk_session),
  });

  if (!loginSuccess) {
    sleep(0.5);
    return;
  }

  const sessionToken = loginRes.json('sessionToken');
  const csrfToken = loginRes.json('csrfToken');

  const authHeaders = {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,
    'x-csrf-token': csrfToken,
  };

  // 2. Fetch authenticated session details
  const meRes = http.get(`${BASE_URL}/api/auth/me`, { headers: authHeaders });
  check(meRes, {
    'me status is 200': (r) => r.status === 200,
    'me username matches': (r) => r.json('user.username') === username,
  });

  // 3. Fetch user wallet balances
  const balRes = http.get(`${BASE_URL}/api/wallet/balances`, { headers: authHeaders });
  check(balRes, {
    'wallet balance is 200': (r) => r.status === 200,
    'available balance >= 0': (r) => r.json('available') >= 0,
  });

  // 4. Fetch user holdings
  const holdRes = http.get(`${BASE_URL}/api/wallet/holdings`, { headers: authHeaders });
  check(holdRes, {
    'wallet holdings is 200': (r) => r.status === 200,
    'holdings is array': (r) => Array.isArray(r.json()),
  });

  // 5. Logout session
  const logoutRes = http.post(`${BASE_URL}/api/auth/logout`, '{}', { headers: authHeaders });
  check(logoutRes, {
    'logout status is 200': (r) => r.status === 200,
  });

  sleep(0.2);
}
