import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  MAX_WS_PAYLOAD_BYTES,
  isValidSeat,
  sanitizeRoomCode,
  sanitizeUsername,
} from './src/games/hokm/online/protocol';
import {
  CookieHeaderOptions,
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
  parseSessionCookieFromHeader,
} from './cloudflare/src/lib/sessionCookie';
import { handleAuthHttpRequest } from './cloudflare/src/lib/auth/httpHandler';
import { EyvanDatabase } from './server/database';
import { HokmRoomManager } from './server/roomManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DB_PATH =
  process.env.EYVAN_DB_PATH ||
  path.join(__dirname, 'data', 'eyvan-hokm.sqlite');
const DISCONNECT_GRACE_MS =
  Number(process.env.DISCONNECT_GRACE_MS) || DEFAULT_DISCONNECT_GRACE_MS;

const WS_ROOM_PATH_RE = /^\/ws\/rooms\/([A-Za-z0-9]{4,8})$/;

function isOriginAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Same-origin or native/CLI client without Origin header

  const host = req.headers.host;
  try {
    const parsed = new URL(origin);
    if (host && parsed.host === host) return true;
    // Allow explicit APP_URL when hosted behind proxy/iframe
    if (process.env.APP_URL) {
      const appUrl = new URL(process.env.APP_URL);
      if (parsed.origin === appUrl.origin) return true;
    }
    // Allow explicit comma-separated ALLOWED_ORIGINS if configured
    if (process.env.ALLOWED_ORIGINS) {
      const list = process.env.ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.includes(parsed.origin)) return true;
    }
    // Allow local dev origins
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.run.app')
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function startServer() {
  const db = new EyvanDatabase(DB_PATH);
  const roomManager = new HokmRoomManager({
    db,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Strict origin & security headers for API routes (no wildcard CORS)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!isOriginAllowed(req)) {
        res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'مبدا درخواست مجاز نیست.' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const isSecureExpressReq = (req: Request): boolean => {
    const xfProto = req.headers['x-forwarded-proto'];
    if (typeof xfProto === 'string') {
      return xfProto.split(',')[0].trim().toLowerCase() === 'https';
    }
    return req.secure;
  };
  const cookieOpts: CookieHeaderOptions | undefined = process.env.COOKIE_DOMAIN
    ? { domain: process.env.COOKIE_DOMAIN }
    : undefined;

  // -------------------------------------------------------------------------
  // REST API Routes
  // -------------------------------------------------------------------------

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'eyvan-hokm-online',
      activeRooms: roomManager.getActiveRoomCount(),
      disconnectGraceMs: DISCONNECT_GRACE_MS,
      serverTime: Date.now(),
    });
  });

  // Central Platform Authentication (`/api/auth/*` — shared handler with Cloudflare Workers)
  app.all('/api/auth/*', async (req: Request, res: Response) => {
    try {
      const protocol = isSecureExpressReq(req) ? 'https' : 'http';
      const host = req.headers.host ?? `localhost:${PORT}`;
      const fullUrl = `${protocol}://${host}${req.originalUrl}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (
          lower === 'content-length' ||
          lower === 'transfer-encoding' ||
          lower === 'connection'
        ) {
          continue;
        }
        if (typeof val === 'string') {
          headers.set(key, val);
        } else if (Array.isArray(val)) {
          headers.set(key, val.join(', '));
        }
      }

      const method = req.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const bodyStr =
        hasBody && req.body !== undefined && Object.keys(req.body ?? {}).length > 0
          ? JSON.stringify(req.body)
          : hasBody && typeof req.body === 'object' && req.body !== null
          ? JSON.stringify(req.body)
          : undefined;

      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: bodyStr,
      });

      const xff = req.headers['x-forwarded-for'];
      const clientIp =
        (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ||
        req.socket.remoteAddress ||
        'unknown';

      const webRes = await handleAuthHttpRequest(webReq, req.path, {
        db: db.getD1Adapter(),
        corsHeaders: {},
        secureCookie: isSecureExpressReq(req),
        cookieOptions: cookieOpts,
        originAllowed: isOriginAllowed(req),
        clientIp,
        userAgent: String(req.headers['user-agent'] ?? 'unknown'),
        sessionTtlSec: process.env.AUTH_SESSION_TTL_SEC,
      });

      if (!webRes) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'مسیر یافت نشد.' });
        return;
      }

      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const responseText = await webRes.text();
      res.status(webRes.status).send(responseText);
    } catch (err) {
      console.error('[Auth] Express route adapter error:', err instanceof Error ? err.message : 'unknown');
      res.status(500).json({
        ok: false,
        code: 'DATABASE_ERROR',
        message: 'خطای داخلی سرور رخ داد.',
      });
    }
  });

  app.post('/api/rooms', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = roomManager.createRoom({
      username: body.username,
      avatarCode: body.avatarCode,
      targetMatchScore: body.targetMatchScore,
    });
    if (result.ok === false) {
      res.status(result.status).json({
        error: result.code,
        message: result.message,
      });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildSetSessionCookieHeader(
        {
          roomCode: result.response.roomCode,
          playerId: result.response.playerId,
          sessionToken: result.sessionToken,
        },
        isSecureExpressReq(req),
        cookieOpts
      )
    );
    res.status(201).json(result.response);
  });

  app.get('/api/rooms/:code', (req: Request, res: Response) => {
    const summary = roomManager.getRoomSummary(String(req.params.code ?? ''));
    if (!summary) {
      res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: 'اتاقی با این کد یافت نشد.',
      });
      return;
    }
    res.json(summary);
  });

  app.post('/api/rooms/:code/join', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const preferredSeat = isValidSeat(body.preferredSeat)
      ? body.preferredSeat
      : undefined;

    const result = roomManager.joinRoom(String(req.params.code ?? ''), {
      username: body.username,
      avatarCode: body.avatarCode,
      preferredSeat,
    });
    if (result.ok === false) {
      res.status(result.status).json({
        error: result.code,
        message: result.message,
      });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildSetSessionCookieHeader(
        {
          roomCode: result.response.roomCode,
          playerId: result.response.playerId,
          sessionToken: result.sessionToken,
        },
        isSecureExpressReq(req),
        cookieOpts
      )
    );
    res.status(200).json(result.response);
  });

  app.post('/api/session/resume', (req: Request, res: Response) => {
    if (req.headers['x-requested-with'] !== 'eyvan-client') {
      res.status(403).json({
        error: 'UNAUTHORIZED',
        message: 'درخواست نامعتبر است.',
      });
      return;
    }

    const rawCookieHeader = req.headers.cookie;
    const hasSessionCookie = Boolean(
      rawCookieHeader && rawCookieHeader.includes('eyvan_hokm_sess=')
    );
    if (!hasSessionCookie) {
      res.status(200).json({ active: false });
      return;
    }

    const parsedCookie = parseSessionCookieFromHeader(rawCookieHeader);
    if (!parsedCookie) {
      res.setHeader(
        'Set-Cookie',
        buildClearSessionCookieHeader(isSecureExpressReq(req), cookieOpts)
      );
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'نشست فعالی یافت نشد.',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestedCode = sanitizeRoomCode(body.roomCode);
    if (requestedCode && requestedCode !== parsedCookie.roomCode) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'نشست متعلق به این اتاق نیست.',
      });
      return;
    }

    const result = roomManager.resumeSession(
      parsedCookie.roomCode,
      parsedCookie.playerId,
      parsedCookie.sessionToken
    );
    if (result.ok === false) {
      res.setHeader(
        'Set-Cookie',
        buildClearSessionCookieHeader(isSecureExpressReq(req), cookieOpts)
      );
      res.status(result.status).json({
        error: result.code,
        message: result.message,
      });
      return;
    }
    res.status(200).json(result.response);
  });

  app.post('/api/session/clear', (req: Request, res: Response) => {
    if (req.headers['x-requested-with'] !== 'eyvan-client') {
      res.status(403).json({
        error: 'UNAUTHORIZED',
        message: 'درخواست نامعتبر است.',
      });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildClearSessionCookieHeader(isSecureExpressReq(req), cookieOpts)
    );
    res.status(200).json({ ok: true });
  });

  app.get('/api/matches', (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 10;
    const matches = db.getRecentMatches(limit);
    res.json({ matches });
  });

  app.get('/api/stats/:username', (req: Request, res: Response) => {
    const cleanName = sanitizeUsername(req.params.username);
    if (!cleanName) {
      res.status(400).json({
        error: 'INVALID_MESSAGE',
        message: 'نام کاربری نامعتبر است.',
      });
      return;
    }
    res.json(db.getPlayerStats(cleanName));
  });

  // Clean JSON parse error handler for `/api/*` routes (never leak stack traces or HTML)
  app.use(
    '/api',
    (
      err: unknown,
      _req: Request,
      res: Response,
      next: NextFunction
    ) => {
      if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
        res.status(400).json({
          ok: false,
          code: 'INVALID_INPUT',
          message: 'فرمت JSON درخواست نامعتبر است.',
        });
        return;
      }
      next(err);
    }
  );

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
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      pathname = url.pathname;
    } catch {
      socket.destroy();
      return;
    }

    const match = WS_ROOM_PATH_RE.exec(pathname);
    if (!match) {
      // Not a Hokm room WebSocket path; close cleanly
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(request)) {
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Eyvan Hokm Server] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`
    );
  });

  const shutdown = () => {
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
