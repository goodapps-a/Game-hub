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
import { parseAuthCookieFromHeader } from './cloudflare/src/lib/auth/authCookie';
import {
  pruneExpiredAuthSessionsBatched,
  verifyAuthSession,
} from './cloudflare/src/lib/auth/authService';
import { pruneExpiredAuthTokensBatched } from './cloudflare/src/lib/auth/c2Service';
import { pruneExpiredOAuthStatesBatched } from './cloudflare/src/lib/auth/googleOAuthService';
import { pruneExpiredGuestSessionsBatched } from './cloudflare/src/lib/auth/guestSession';
import { pruneExpiredRateLimitsBatched } from './cloudflare/src/lib/auth/rateLimit';
import { authorizeConversationRealtimeAccess } from './cloudflare/src/lib/social/chatService';
import { pruneExpiredGameInvitesBatched } from './cloudflare/src/lib/social/inviteService';
import { pruneExpiredPresenceSessionsBatched } from './cloudflare/src/lib/social/socialService';
import { validateProductionAuthConfig } from './cloudflare/src/lib/auth/securityPolicy';
import { ExpressChatRealtimeHub } from './server/chatRealtimeHub';
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
const WS_CHAT_PATH_RE = /^\/ws\/social\/chat\/(cnv_[a-zA-Z0-9_-]{8,64})$/;

async function startServer() {
  const db = new EyvanDatabase(DB_PATH);
  const roomManager = new HokmRoomManager({
    db,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
  });
  const chatRealtimeHub = new ExpressChatRealtimeHub();

  const { app, isRequestOriginAllowed } = createEyvanExpressApp({
    db,
    roomManager,
    chatRealtimePublisher: chatRealtimeHub,
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
      googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
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

    const roomMatch = WS_ROOM_PATH_RE.exec(pathname);
    if (roomMatch) {
      if (!isRequestOriginAllowed(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const roomCode = roomMatch[1].toUpperCase();
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
      return;
    }

    const chatMatch = WS_CHAT_PATH_RE.exec(pathname);
    if (chatMatch) {
      if (!isRequestOriginAllowed(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const conversationId = chatMatch[1];
      const rawAuthToken = parseAuthCookieFromHeader(request.headers.cookie);
      if (!rawAuthToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      void (async () => {
        try {
          const d1 = db.getD1Adapter();
          const verified = await verifyAuthSession(d1, rawAuthToken);
          if (!verified.authenticated || !verified.user || !verified.session) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          const access = await authorizeConversationRealtimeAccess(
            d1,
            conversationId,
            verified.user.userId
          );
          if (access.ok === false) {
            const statusText =
              access.status === 400 ? '400 Bad Request' : '403 Forbidden';
            socket.write(`HTTP/1.1 ${statusText}\r\n\r\n`);
            socket.destroy();
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            chatRealtimeHub.attachSocket({
              ws,
              userId: verified.user!.userId,
              authSessionId: verified.session!.sessionId,
              conversationId,
            });
          });
        } catch {
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
        }
      })();
      return;
    }

    socket.destroy();
  });

  // Low-cost periodic cleanup of expired auth_rate_limits & user_presence_sessions (mirrors Worker Cron Trigger)
  const MAINTENANCE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const maintenanceCleanupTimer = setInterval(() => {
    const d1Adapter = db.getD1Adapter();
    void pruneExpiredRateLimitsBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Rate-limit cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredPresenceSessionsBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Presence cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredGuestSessionsBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Guest-session cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredOAuthStatesBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] OAuth-state cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredAuthSessionsBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Auth-session cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredAuthTokensBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Auth-token cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
    void pruneExpiredGameInvitesBatched(d1Adapter).catch((err) => {
      console.error(
        '[Eyvan Cleanup] Game-invite cleanup failed:',
        err instanceof Error ? err.message : 'unknown'
      );
    });
  }, MAINTENANCE_CLEANUP_INTERVAL_MS);
  maintenanceCleanupTimer.unref?.();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Eyvan Hokm Server] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`
    );
  });

  const shutdown = () => {
    clearInterval(maintenanceCleanupTimer);
    chatRealtimeHub.dispose();
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
