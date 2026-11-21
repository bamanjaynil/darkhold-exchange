# bench/locustfile.py
# Production-grade Locust load test for Darkhold Exchange
import itertools
import os
import time
import urllib.request
from datetime import datetime, timezone
from locust import FastHttpUser, task, between, events

DEMO_USERS = [
    {"username": "admin", "password": "password123"},
    {"username": "bench_maker", "password": "password123"},
    {"username": "bench_bot", "password": "password123"},
    {"username": "bench_taker", "password": "password123"},
]

user_cycler = itertools.cycle(DEMO_USERS)

class DarkholdExchangeUser(FastHttpUser):
    # Minimal wait time to maximize throughput without artificial client pacing
    wait_time = between(0.0001, 0.001)

    def on_start(self):
        # Rotate user assignment per VU
        self.user_creds = next(user_cycler)
        self.username = self.user_creds["username"]
        self.user_index = DEMO_USERS.index(self.user_creds)
        self.order_counter = 0

        # Login and obtain session tokens
        login_res = self.client.post(
            "/api/auth/login",
            json=self.user_creds,
            headers={"Content-Type": "application/json", "x-bench-bypass": "true"},
        )
        if login_res.status_code != 200:
            raise RuntimeError(f"Login failed for {self.username}: {login_res.text}")

        login_data = login_res.json()
        self.session_token = login_data.get("sessionToken", "")
        self.csrf_token = login_data.get("csrfToken", "")

        self.custom_headers = {
            "x-session-token": self.session_token,
            "x-csrf-token": self.csrf_token,
            "x-bench-bypass": "true",
        }

    @task(10)
    def submit_crossing_order(self):
        self.order_counter += 1
        is_even = self.order_counter % 2 == 0

        # Complementary user groups alternate BUY / SELL to recycle cash and inventory cleanly
        if self.user_index < len(DEMO_USERS) // 2:
            side = "BUY" if is_even else "SELL"
        else:
            side = "SELL" if is_even else "BUY"

        order_payload = {
            "clientOrderId": f"locust_{self.username}_{time.time_ns()}_{self.order_counter}",
            "symbol": "BENCH-X",
            "side": side,
            "type": "LIMIT",
            "tif": "GTC",
            "price": 100000,
            "qty": 1,
        }

        with self.client.post(
            "/api/orders",
            json=order_payload,
            headers=self.custom_headers,
            catch_response=True,
            name="POST /api/orders [BENCH-X]",
        ) as res:
            if res.status_code in (200, 201):
                res.success()
            else:
                res.failure(f"HTTP {res.status_code}: {res.text}")

    @task(2)
    def get_orderbook(self):
        with self.client.get(
            "/api/book/BENCH-X",
            headers=self.custom_headers,
            catch_response=True,
            name="GET /api/book/[symbol]",
        ) as res:
            if res.status_code == 200:
                res.success()
            else:
                res.failure(f"Book status {res.status_code}")

    @task(1)
    def get_recent_trades(self):
        with self.client.get(
            "/api/trades/BENCH-X",
            headers=self.custom_headers,
            catch_response=True,
            name="GET /api/trades/[symbol]",
        ) as res:
            if res.status_code == 200:
                res.success()
            else:
                res.failure(f"Trades status {res.status_code}")

@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Generates clean summary report to bench/results/locust-report.txt upon test completion."""
    # Ensure background persistence flushes all queued batches
    try:
        host = environment.host or "http://127.0.0.1:3000"
        req = urllib.request.Request(f"{host}/api/admin/flush", data=b"{}", headers={"Content-Type": "application/json", "x-bench-bypass": "true"})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

    stats = environment.runner.stats
    total = stats.total
    results_dir = os.path.join(os.path.dirname(__file__), "results")
    os.makedirs(results_dir, exist_ok=True)
    report_path = os.path.join(results_dir, "locust-report.txt")

    p50 = round(total.get_response_time_percentile(0.5) or 0, 2)
    p95 = round(total.get_response_time_percentile(0.95) or 0, 2)
    p99 = round(total.get_response_time_percentile(0.99) or 0, 2)
    avg = round(total.avg_response_time or 0, 2)
    min_time = round(total.min_response_time or 0, 2)
    max_time = round(total.max_response_time or 0, 2)
    fail_rate = round(total.fail_ratio * 100, 2)
    rps = round(total.total_rps or 0, 2)

    lines = [
        "================================================================================",
        "                 DARKHOLD EXCHANGE — LOCUST LOAD BENCHMARK REPORT               ",
        "================================================================================",
        f"Timestamp:           {datetime.now(timezone.utc).isoformat()}",
        f"Target Host:         {environment.host}",
        f"Total Requests:      {total.num_requests}",
        f"Total Failures:      {total.num_failures} ({fail_rate}%)",
        f"Average RPS:         {rps} req/sec",
        "--------------------------------------------------------------------------------",
        "RESPONSE TIME LATENCIES (ms):",
        f"  Min:               {min_time} ms",
        f"  Median (p50):      ${p50} ms".replace("$", ""),
        f"  p95:               {p95} ms",
        f"  p99:               {p99} ms",
        f"  Max:               {max_time} ms",
        f"  Avg:               {avg} ms",
        "--------------------------------------------------------------------------------",
        "REQUEST BREAKDOWN BY ENDPOINT:",
    ]

    for entry in stats.entries.values():
        if entry == total:
            continue
        entry_p50 = round(entry.get_response_time_percentile(0.5) or 0, 1)
        entry_p95 = round(entry.get_response_time_percentile(0.95) or 0, 1)
        entry_fail = round(entry.fail_ratio * 100, 1)
        lines.append(
            f"  {entry.method} {entry.name:<30} | {entry.num_requests:>6} reqs | "
            f"{entry_fail}% fail | avg: {round(entry.avg_response_time, 1):>5}ms | "
            f"p50: {entry_p50:>5}ms | p95: {entry_p95:>5}ms"
        )

    lines.append("================================================================================")
    report_content = "\n".join(lines) + "\n"

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    print("\n" + report_content)
