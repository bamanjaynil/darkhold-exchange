import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../src/pool.js';

describe('Zero-GC Object Pool Suite', () => {
  type TestOrder = {
    id: string;
    price: number;
    qty: number;
    active: boolean;
  };

  const createOrder = (): TestOrder => ({
    id: '',
    price: 0,
    qty: 0,
    active: false,
  });

  const resetOrder = (o: TestOrder) => {
    o.id = '';
    o.price = 0;
    o.qty = 0;
    o.active = false;
  };

  it('pre-allocates requested capacity and tracks metrics correctly', () => {
    const pool = new ObjectPool<TestOrder>(createOrder, 1000, resetOrder);
    const metrics = pool.getMetrics();

    expect(metrics.capacity).toBe(1000);
    expect(metrics.available).toBe(1000);
    expect(metrics.active).toBe(0);
  });

  it('acquires and releases objects in LIFO order with zero new allocations', () => {
    const pool = new ObjectPool<TestOrder>(createOrder, 10, resetOrder);

    const o1 = pool.acquire();
    o1.id = 'ord-1';
    o1.price = 150000;
    o1.qty = 5;
    o1.active = true;

    expect(pool.getMetrics().active).toBe(1);
    expect(pool.getMetrics().available).toBe(9);

    pool.release(o1);

    expect(pool.getMetrics().active).toBe(0);
    expect(pool.getMetrics().available).toBe(10);
    expect(o1.id).toBe(''); // Reset hook was invoked

    // Re-acquire should yield the exact same object reference
    const o2 = pool.acquire();
    expect(o2).toBe(o1);
  });

  it('expands dynamically when capacity is exceeded without throwing', () => {
    const pool = new ObjectPool<TestOrder>(createOrder, 2, resetOrder);

    const o1 = pool.acquire();
    const o2 = pool.acquire();
    const o3 = pool.acquire(); // Exceeds capacity

    expect(o3).toBeDefined();
    expect(pool.getMetrics().totalAcquired).toBe(3);

    pool.release(o1);
    pool.release(o2);
    pool.release(o3);
  });
});
