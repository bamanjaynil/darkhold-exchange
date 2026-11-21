/**
 * @file ringbuffer.ts
 * Lock-Free Single-Producer Single-Consumer (SPSC) Ring Buffer.
 * Backed by a contiguous SharedArrayBuffer using Atomics pointer synchronization.
 *
 * Designed for ultra-low latency inter-thread event streaming with zero object cloning.
 */

export class LockFreeRingBuffer {
  public readonly capacity: number;
  public readonly slotSize: number;
  private readonly sharedBuffer: SharedArrayBuffer;
  private readonly header: Int32Array;
  private readonly data: Uint8Array;
  private readonly mask: number;

  // Header offsets (in 32-bit words)
  private static readonly WRITE_CURSOR_OFFSET = 0;
  private static readonly READ_CURSOR_OFFSET = 1;
  private static readonly HEADER_BYTES = 64; // Padded to prevent cache line false sharing

  /**
   * @param capacity Number of slots (must be a power of 2).
   * @param slotSize Fixed size of each slot in bytes.
   * @param existingBuffer Optional pre-allocated SharedArrayBuffer for multi-worker sharing.
   */
  constructor(capacity: number = 65_536, slotSize: number = 128, existingBuffer?: SharedArrayBuffer) {
    if ((capacity & (capacity - 1)) !== 0) {
      throw new Error(`Capacity must be a power of 2, received ${capacity}`);
    }
    this.capacity = capacity;
    this.slotSize = slotSize;
    this.mask = capacity - 1;

    const totalBytes = LockFreeRingBuffer.HEADER_BYTES + capacity * slotSize;
    this.sharedBuffer = existingBuffer || new SharedArrayBuffer(totalBytes);
    this.header = new Int32Array(this.sharedBuffer, 0, 16);
    this.data = new Uint8Array(this.sharedBuffer, LockFreeRingBuffer.HEADER_BYTES);
  }

  public getSharedBuffer(): SharedArrayBuffer {
    return this.sharedBuffer;
  }

  /**
   * Attempts to push raw binary slot data into the ring buffer.
   * Lock-free; returns false immediately if buffer is saturated.
   */
  public tryPush(slotData: Uint8Array): boolean {
    const writePos = Atomics.load(this.header, LockFreeRingBuffer.WRITE_CURSOR_OFFSET);
    const readPos = Atomics.load(this.header, LockFreeRingBuffer.READ_CURSOR_OFFSET);

    if (writePos - readPos >= this.capacity) {
      return false; // Buffer full
    }

    const slotIndex = writePos & this.mask;
    const offset = slotIndex * this.slotSize;
    this.data.set(slotData.subarray(0, this.slotSize), offset);

    // Release fence: advance write pointer atomically
    Atomics.store(this.header, LockFreeRingBuffer.WRITE_CURSOR_OFFSET, writePos + 1);
    return true;
  }

  /**
   * Attempts to pop raw binary slot data from the ring buffer.
   * Lock-free; returns null immediately if buffer is empty.
   */
  public tryPop(targetBuffer?: Uint8Array): Uint8Array | null {
    const readPos = Atomics.load(this.header, LockFreeRingBuffer.READ_CURSOR_OFFSET);
    const writePos = Atomics.load(this.header, LockFreeRingBuffer.WRITE_CURSOR_OFFSET);

    if (readPos >= writePos) {
      return null; // Buffer empty
    }

    const slotIndex = readPos & this.mask;
    const offset = slotIndex * this.slotSize;
    const out = targetBuffer || new Uint8Array(this.slotSize);
    out.set(this.data.subarray(offset, offset + this.slotSize));

    // Release fence: advance read pointer atomically
    Atomics.store(this.header, LockFreeRingBuffer.READ_CURSOR_OFFSET, readPos + 1);
    return out;
  }

  /**
   * Returns current backlog depth.
   */
  public getDepth(): number {
    const writePos = Atomics.load(this.header, LockFreeRingBuffer.WRITE_CURSOR_OFFSET);
    const readPos = Atomics.load(this.header, LockFreeRingBuffer.READ_CURSOR_OFFSET);
    return Math.max(0, writePos - readPos);
  }
}
