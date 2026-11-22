import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  MAX_WS_PAYLOAD_BYTES,
} from './src/games/hokm/online/protocol';
import { parseSessionCookieFromHeader } from './cloudflare/src/lib/sessionCookie';
import { pruneExpiredRateLimitsBatched } from './cloudflare/src/lib/auth/rateLimit';
import { validateProductionAuthConfig } from './cloudflare/src/lib/auth/securityPolicy';
import { createEyvanExpressApp } from './server/createExpressApp';
import { EyvanDatabase } from './server/database';
import { HokmRoomManager } from './server/roomManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD =
  process.env.NODE_ENV === 'production' ||
  process.env.ENVIRONMENT?.toLowerCase() === 'production';
const DB_PATH =
  process.env.EYVAN_DB_PATH ||
  path.join(__dirname, 'data', 'eyvan-hokm.sqlite');
const DISCONNECT_GRACE_MS =
  Number(process.env.DISCONNECT_GRACE_MS) || DEFAULT_DISCONNECT_GRACE_MS;

const WS_ROOM_PATH_RE = /^\/ws\/rooms\/([A-Za-z0-9]{4,8})$/;

async function startServer() {
  const db = new EyvanDatabase(DB_PATH);
  const roomManager = new HokmRoomManager({
    db,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
  });

  const { app, isRequestOriginAllowed } = createEyvanExpressApp({
    db,
    roomManager,
    config: {
      isProduction: IS_PROD,
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      appUrl: process.env.APP_URL,
      publicAppUrl: process.env.PUBLIC_APP_URL,
      trustedProxyIps: process.env.TRUSTED_PROXY_IPS,
      cookieDomain: process.env.COOKIE_DOMAIN,
      disconnectGraceMs: DISCONNECT_GRACE_MS,
      authSessionTtlSec: process.env.AUTH_SESSION_TTL_SEC,
      defaultPort: PORT,
      emailProvider: process.env.EMAIL_PROVIDER,
      resendApiKey: process.env.RESEND_API_KEY,
      emailFrom: process.env.EMAIL_FROM,
    },
  });

  if (IS_PROD) {
    const cfgReport = validateProductionAuthConfig({
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      appUrl: process.env.APP_URL,
      publicAppUrl: process.env.PUBLIC_APP_URL,
      emailProvider: process.env.EMAIL_PROVIDER,
      resendApiKey: process.env.RESEND_API_KEY,
      emailFrom: process.env.EMAIL_FROM,
      trustedProxyIps: process.env.TRUSTED_PROXY_IPS,
    });
    if (!cfgReport.ok) {
      const codes = cfgReport.errors.map((e) => `${e.field}:${e.code}`).join(', ');
      console.warn(`[Eyvan Auth Config] Production configuration incomplete: ${codes}`);
    }
  }

  // -------------------------------------------------------------------------
  // Frontend SPA Middleware (Vite dev middleware vs production dist/)
  // -------------------------------------------------------------------------

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // -------------------------------------------------------------------------
  // HTTP Server + Dedicated Room WebSocket Upgrade Handler
  // -------------------------------------------------------------------------

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = '';
    try {
      const url = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? 'localhost'}`
      );
      pathname = url.pathname;
    } catch {
      socket.destroy();
      return;
    }

    const match = WS_ROOM_PATH_RE.exec(pathname);
    if (!match) {
      socket.destroy();
      return;
    }

    if (!isRequestOriginAllowed(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const roomCode = match[1].toUpperCase();
    const parsedCookie = parseSessionCookieFromHeader(request.headers.cookie);
    if (!parsedCookie || parsedCookie.roomCode !== roomCode) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const verified = roomManager.resumeSession(
      roomCode,
      parsedCookie.playerId,
      parsedCookie.sessionToken
    );
    if (verified.ok === false) {
      const code = verified.status === 404 ? '404 Not Found' : '401 Unauthorized';
      socket.write(`HTTP/1.1 ${code}\r\n\r\n`);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      roomManager.attachAuthenticatedWebSocket(
        roomCode,
        parsedCookie.playerId,
        parsedCookie.sessionToken,
        ws
      );
    });
  });

  // Low-cost periodic cleanup of expired, unblocked auth_rate_limits rows (mirrors Worker Cron Trigger)
  const RATE_LIMIT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const rateLimitCleanupTimer = setInterval(() => {
    void pruneExpiredRateLimitsBatched(db.getD1Adapter()).catch((err) => {
      console.error(
        '[Eyvan Auth Cleanup] Rate-limit cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  rateLimitCleanupTimer.unref?.();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Eyvan Hokm Server] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`
    );
  });

  const shutdown = () => {
    clearInterval(rateLimitCleanupTimer);
    roomManager.dispose();
    db.close();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[Eyvan Hokm Server] Fatal startup error:', err);
  process.exit(1);
});
