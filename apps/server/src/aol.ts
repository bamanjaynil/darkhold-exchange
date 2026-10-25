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
  private dataView: DataView;
  private u32View: Uint32Array;
  private bufferOffset: number = 0;
  private readonly bufferCapacity: number;
  private currentSeq: number = 0;
  private isFlushScheduled: boolean = false;

  private lastUserId?: string;
  private lastUserBuf: Buffer = Buffer.alloc(32, 0);
  private uW0 = 0; private uW1 = 0; private uW2 = 0; private uW3 = 0;
  private uW4 = 0; private uW5 = 0; private uW6 = 0; private uW7 = 0;

  private lastSymbol?: string;
  private lastSymbolBuf: Buffer = Buffer.alloc(24, 0);
  private sW0 = 0; private sW1 = 0; private sW2 = 0; private sW3 = 0;
  private sW4 = 0; private sW5 = 0;

  constructor(filePath: string, bufferCapacity: number = 4 * 1024 * 1024) {
    this.filePath = filePath;
    this.bufferCapacity = bufferCapacity;
    this.writeBuffer = Buffer.alloc(bufferCapacity, 0);
    this.dataView = new DataView(this.writeBuffer.buffer, this.writeBuffer.byteOffset, bufferCapacity);
    this.u32View = new Uint32Array(this.writeBuffer.buffer, this.writeBuffer.byteOffset, bufferCapacity / 4);
    this.fd = fs.openSync(filePath, 'a+');
  }

  private scheduleFlush(): void {
    if (this.isFlushScheduled) return;
    this.isFlushScheduled = true;
    setImmediate(() => {
      this.isFlushScheduled = false;
      this.flushAsync();
    });
  }

  public flushAsync(): void {
    if (this.bufferOffset > 0) {
      const len = this.bufferOffset;
      const slice = Buffer.allocUnsafe(len);
      this.writeBuffer.copy(slice, 0, 0, len);
      this.bufferOffset = 0;
      fs.write(this.fd, slice, 0, len, null, (err) => {
        if (err) console.error('[AOL] Async write failed:', err);
      });
    }
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

    const dv = this.dataView;
    const buf = this.writeBuffer;
    let offset = this.bufferOffset;

    // Header (16 bytes)
    dv.setUint32(offset, AOL_MAGIC);
    dv.setUint32(offset + 4, 0);
    dv.setUint32(offset + 8, seq);
    dv.setUint32(offset + 12, cmdType);
    offset += 16;

    // Numerical Data (24 bytes)
    dv.setUint32(offset, Math.floor(timestamp / 4294967296));
    dv.setUint32(offset + 4, timestamp >>> 0);
    dv.setUint32(offset + 8, Math.floor(price / 4294967296));
    dv.setUint32(offset + 12, price >>> 0);
    dv.setUint32(offset + 16, qty);
    dv.setUint8(offset + 20, side);
    offset += 24;

    // Fixed-length Strings (88 bytes)
    // 1. orderId (32 bytes)
    (buf as any).utf8Write(orderId, offset, 31);
    offset += 32;

    // 2. userId (32 bytes = 8 words)
    let wOff = offset >> 2;
    if (userId !== this.lastUserId) {
      this.lastUserBuf.fill(0);
      (this.lastUserBuf as any).utf8Write(userId, 0, 31);
      const tempView = new Uint32Array(this.lastUserBuf.buffer, this.lastUserBuf.byteOffset, 8);
      this.uW0 = tempView[0]!;
      this.uW1 = tempView[1]!;
      this.uW2 = tempView[2]!;
      this.uW3 = tempView[3]!;
      this.uW4 = tempView[4]!;
      this.uW5 = tempView[5]!;
      this.uW6 = tempView[6]!;
      this.uW7 = tempView[7]!;
      this.lastUserId = userId;
    }
    const u32 = this.u32View;
    u32[wOff] = this.uW0;
    u32[wOff + 1] = this.uW1;
    u32[wOff + 2] = this.uW2;
    u32[wOff + 3] = this.uW3;
    u32[wOff + 4] = this.uW4;
    u32[wOff + 5] = this.uW5;
    u32[wOff + 6] = this.uW6;
    u32[wOff + 7] = this.uW7;
    offset += 32;
    wOff += 8;

    // 3. symbol (24 bytes = 6 words)
    if (symbol !== this.lastSymbol) {
      this.lastSymbolBuf.fill(0);
      (this.lastSymbolBuf as any).utf8Write(symbol, 0, 23);
      const tempView = new Uint32Array(this.lastSymbolBuf.buffer, this.lastSymbolBuf.byteOffset, 6);
      this.sW0 = tempView[0]!;
      this.sW1 = tempView[1]!;
      this.sW2 = tempView[2]!;
      this.sW3 = tempView[3]!;
      this.sW4 = tempView[4]!;
      this.sW5 = tempView[5]!;
      this.lastSymbol = symbol;
    }
    u32[wOff] = this.sW0;
    u32[wOff + 1] = this.sW1;
    u32[wOff + 2] = this.sW2;
    u32[wOff + 3] = this.sW3;
    u32[wOff + 4] = this.sW4;
    u32[wOff + 5] = this.sW5;

    this.bufferOffset += AOL_RECORD_SIZE;
    this.currentSeq = seq;
    if (!this.isFlushScheduled) {
      this.scheduleFlush();
    }
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

  public reset(): void {
    this.bufferOffset = 0;
    this.isFlushScheduled = false;
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
