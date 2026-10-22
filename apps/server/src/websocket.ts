/**
 * @file websocket.ts
 * Real-time WebSocket Gateway for Level 2 book ladder, trade stream, and private user events.
 */

type WebSocket = any;
import { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthManager, SessionUser } from './auth.js';
import { ExchangeCore } from './core.js';
import { WsClientMessage, WsServerMessage, PROTOCOL_VERSION } from '@darkhold/shared';

type ClientConnection = {
  ws: WebSocket;
  user: SessionUser | null;
  subscriptions: Set<string>;
  channelSeqs: Map<string, number>;
  lastPing: number;
};

export class WebSocketGateway {
  private connections = new Set<ClientConnection>();
  private auth: AuthManager;
  private core: ExchangeCore;

  constructor(auth: AuthManager, core: ExchangeCore) {
    this.auth = auth;
    this.core = core;

    // Register broadcast listener with ExchangeCore
    this.core.setWsBroadcast((event) => {
      this.broadcastToChannel(event.channel, event.type, event.seq, event.data);
    });

    // Heartbeat check interval
    setInterval(() => {
      const now = Date.now();
      for (const conn of this.connections) {
        if (now - conn.lastPing > 30_000) {
          conn.ws.terminate();
          this.connections.delete(conn);
        }
      }
    }, 15_000);
  }

  public register(server: FastifyInstance): void {
    server.get('/ws', { websocket: true }, async (socket, req) => {
      const conn: ClientConnection = {
        ws: socket,
        user: null,
        subscriptions: new Set(),
        channelSeqs: new Map(),
        lastPing: Date.now(),
      };

      // Authenticate upgrade from session cookie if present
      const cookie = req.cookies['dk_session'];
      if (cookie) {
        conn.user = await this.auth.validateSession(cookie);
      }

      this.connections.add(conn);

      socket.on('message', (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsClientMessage;
          this.handleClientMessage(conn, msg);
        } catch {
          this.send(conn, {
            v: 1,
            type: 'error',
            code: 'MALFORMED_JSON',
            message: 'Invalid JSON payload',
          });
        }
      });

      socket.on('close', () => {
        this.connections.delete(conn);
      });

      socket.on('error', () => {
        this.connections.delete(conn);
      });
    });
  }

  private handleClientMessage(conn: ClientConnection, msg: WsClientMessage): void {
    if (msg.v !== PROTOCOL_VERSION) {
      return this.send(conn, {
        v: 1,
        type: 'error',
        code: 'UNSUPPORTED_VERSION',
        message: `Supported protocol version is ${PROTOCOL_VERSION}`,
      });
    }

    if (msg.type === 'ping') {
      conn.lastPing = Date.now();
      return this.send(conn, { v: 1, type: 'pong' });
    }

    if (msg.type === 'subscribe') {
      const channel = msg.channel;

      // Restrict private channels to authenticated users
      if (channel === 'me') {
        if (!conn.user) {
          return this.send(conn, {
            v: 1,
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required for private channel',
            channel,
          });
        }
      }

      conn.subscriptions.add(channel);

      // Send initial snapshot on subscribe
      if (channel.startsWith('book:')) {
        const symbol = channel.split(':')[1];
        const snap = this.core.engine.getL2Snapshot(symbol, 20);
        if (snap) {
          this.send(conn, {
            v: 1,
            type: 'snapshot',
            channel,
            seq: this.core.seq,
            data: snap,
          });
        }
      } else if (channel === 'me' && conn.user) {
        const bal = this.core.getBalance(conn.user.id);
        this.send(conn, {
          v: 1,
          type: 'snapshot',
          channel: 'me',
          seq: this.core.seq,
          data: {
            balance: {
              available: bal.available,
              reserved: bal.reserved,
              escrow: bal.escrow,
              total: bal.available + bal.reserved + bal.escrow,
            },
          },
        });
      }
    } else if (msg.type === 'unsubscribe') {
      conn.subscriptions.delete(msg.channel);
    }
  }

  public broadcastToChannel(channel: string, type: 'snapshot' | 'delta', seq: number, data: any): void {
    const msg: WsServerMessage = {
      v: 1,
      type,
      channel,
      seq,
      data,
    };

    const payload = JSON.stringify(msg);
    for (const conn of this.connections) {
      if (conn.subscriptions.has(channel)) {
        conn.ws.send(payload);
      }
    }
  }

  public sendToUser(userId: string, data: any, seq: number): void {
    const msg: WsServerMessage = {
      v: 1,
      type: 'delta',
      channel: 'me',
      seq,
      data,
    };
    const payload = JSON.stringify(msg);

    for (const conn of this.connections) {
      if (conn.user?.id === userId && conn.subscriptions.has('me')) {
        conn.ws.send(payload);
      }
    }
  }

  private send(conn: ClientConnection, msg: WsServerMessage): void {
    if (conn.ws.readyState === 1) { // 1 = OPEN
      conn.ws.send(JSON.stringify(msg));
    }
  }
}