/**
 * @file aol.ts
 * Memory-Mapped / Sequential Binary Append-Only Log (AOL).
 *
 * Implements low-overhead binary event journaling on the critical path.
 * Writes fixed-size 128-byte binary frames directly into the OS page cache,
 * enabling deterministic crash recovery and async CQRS projection.
 */

import fs from 'node:fs';

export const AOL_MAGIC = 0x4441524b; // 'DARK'
export const AOL_RECORD_SIZE = 128;   // Fixed 128 bytes per frame

export interface AolRecord {
  seq: number;
  timestamp: number;
  cmdType: number; // 1 = ORDER_SUBMIT, 2 = ORDER_CANCEL, 3 = TRADE
  price: number;
  qty: number;
  side: number;    // 0 = BUY, 1 = SELL
  orderId: string;
  userId: string;
  symbol: string;
}

export class AppendOnlyJournal {
  public readonly filePath: string;
  private fd: number;
  private writeBuffer: Buffer;
  private bufferOffset: number = 0;
  private readonly bufferCapacity: number;
  private currentSeq: number = 0;
  private isFlushScheduled: boolean = false;

  constructor(filePath: string, bufferCapacity: number = 4 * 1024 * 1024) {
    this.filePath = filePath;
    this.bufferCapacity = bufferCapacity;
    this.writeBuffer = Buffer.alloc(bufferCapacity, 0);
    this.fd = fs.openSync(filePath, 'a+');
  }

  private scheduleFlush(): void {
    if (this.isFlushScheduled) return;
    this.isFlushScheduled = true;
    setImmediate(() => {
      this.isFlushScheduled = false;
      this.flushSync();
    });
  }

  /**
   * Serializes an event into a fixed 128-byte binary frame and appends it to the log.
   */
  public append(record: AolRecord): void {
    this.appendRecord(
      record.seq,
      record.timestamp,
      record.cmdType,
      record.price,
      record.qty,
      record.side,
      record.orderId,
      record.userId,
      record.symbol
    );
  }

  /**
   * Zero-allocation primitive append directly to contiguous write buffer.
   */
  public appendRecord(
    seq: number,
    timestamp: number,
    cmdType: number,
    price: number,
    qty: number,
    side: number,
    orderId: string,
    userId: string,
    symbol: string
  ): void {
    if (this.bufferOffset + AOL_RECORD_SIZE > this.bufferCapacity) {
      this.flushSync();
    }

    const buf = this.writeBuffer;
    let offset = this.bufferOffset;

    // Header (16 bytes)
    buf.writeUInt32BE(AOL_MAGIC, offset);
    buf.writeBigUInt64BE(BigInt(seq), offset + 4);
    buf.writeUInt32BE(cmdType, offset + 12);
    offset += 16;

    // Numerical Data (24 bytes)
    buf.writeBigInt64BE(BigInt(timestamp), offset);
    buf.writeBigInt64BE(BigInt(price), offset + 8);
    buf.writeUInt32BE(qty, offset + 16);
    buf.writeUInt8(side, offset + 20);
    offset += 24;

    // Fixed-length Strings (88 bytes)
    buf.write(orderId, offset, 31, 'utf-8');
    offset += 32;

    buf.write(userId, offset, 31, 'utf-8');
    offset += 32;

    buf.write(symbol, offset, 23, 'utf-8');
    offset += 24;

    this.bufferOffset += AOL_RECORD_SIZE;
    this.currentSeq = seq;
    this.scheduleFlush();
  }

  /**
   * Flushes in-flight buffer to the OS page cache.
   */
  public flushSync(): void {
    if (this.bufferOffset > 0) {
      fs.writeSync(this.fd, this.writeBuffer, 0, this.bufferOffset);
      this.writeBuffer.fill(0, 0, this.bufferOffset);
      this.bufferOffset = 0;
    }
  }

  /**
   * Synchronizes dirty page cache to physical disk.
   */
  public syncToDisk(): void {
    this.flushSync();
    fs.fsyncSync(this.fd);
  }

  /**
   * Closes the underlying file descriptor.
   */
  public close(): void {
    this.flushSync();
    fs.closeSync(this.fd);
  }

  /**
   * Replays binary journal records sequentially from disk.
   */
  public static replay(filePath: string, onRecord: (record: AolRecord) => void): number {
    if (!fs.existsSync(filePath)) return 0;
    const fd = fs.openSync(filePath, 'r');
    const readBuf = Buffer.allocUnsafe(AOL_RECORD_SIZE);
    let count = 0;

    try {
      while (fs.readSync(fd, readBuf, 0, AOL_RECORD_SIZE, null) === AOL_RECORD_SIZE) {
        const magic = readBuf.readUInt32BE(0);
        if (magic !== AOL_MAGIC) break;

        const seq = Number(readBuf.readBigUInt64BE(4));
        const cmdType = readBuf.readUInt32BE(12);
        const timestamp = Number(readBuf.readBigInt64BE(16));
        const price = Number(readBuf.readBigInt64BE(24));
        const qty = readBuf.readUInt32BE(32);
        const side = readBuf.readUInt8(36);

        const orderId = readBuf.toString('utf-8', 40, 72).replace(/\0+$/, '');
        const userId = readBuf.toString('utf-8', 72, 104).replace(/\0+$/, '');
        const symbol = readBuf.toString('utf-8', 104, 128).replace(/\0+$/, '');

        onRecord({ seq, timestamp, cmdType, price, qty, side, orderId, userId, symbol });
        count++;
      }
    } finally {
      fs.closeSync(fd);
    }

    return count;
  }
}
