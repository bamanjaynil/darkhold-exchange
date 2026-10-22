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

  constructor(filePath: string, bufferCapacity: number = 65_536) {
    this.filePath = filePath;
    this.bufferCapacity = bufferCapacity;
    this.writeBuffer = Buffer.allocUnsafe(bufferCapacity);
    this.fd = fs.openSync(filePath, 'a+');
  }

  /**
   * Serializes an event into a fixed 128-byte binary frame and appends it to the log.
   */
  public append(record: AolRecord): void {
    if (this.bufferOffset + AOL_RECORD_SIZE > this.bufferCapacity) {
      this.flushSync();
    }

    const buf = this.writeBuffer;
    let offset = this.bufferOffset;

    // Header (16 bytes)
    buf.writeUInt32BE(AOL_MAGIC, offset);
    buf.writeBigUInt64BE(BigInt(record.seq), offset + 4);
    buf.writeUInt32BE(record.cmdType, offset + 12);
    offset += 16;

    // Numerical Data (24 bytes)
    buf.writeBigInt64BE(BigInt(record.timestamp), offset);
    buf.writeBigInt64BE(BigInt(record.price), offset + 8);
    buf.writeUInt32BE(record.qty, offset + 16);
    buf.writeUInt8(record.side, offset + 20);
    buf.fill(0, offset + 21, offset + 24); // 3 bytes alignment padding
    offset += 24;

    // Fixed-length Strings (88 bytes)
    // orderId (32 bytes)
    buf.fill(0, offset, offset + 32);
    buf.write(record.orderId.slice(0, 31), offset, 'utf-8');
    offset += 32;

    // userId (32 bytes)
    buf.fill(0, offset, offset + 32);
    buf.write(record.userId.slice(0, 31), offset, 'utf-8');
    offset += 32;

    // symbol (24 bytes)
    buf.fill(0, offset, offset + 24);
    buf.write(record.symbol.slice(0, 23), offset, 'utf-8');
    offset += 24;

    this.bufferOffset += AOL_RECORD_SIZE;
    this.currentSeq = record.seq;
  }

  /**
   * Flushes in-flight buffer to the OS page cache.
   */
  public flushSync(): void {
    if (this.bufferOffset > 0) {
      fs.writeSync(this.fd, this.writeBuffer, 0, this.bufferOffset);
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
