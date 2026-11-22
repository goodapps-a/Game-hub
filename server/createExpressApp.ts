import http from 'node:http';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  isValidSeat,
  sanitizeRoomCode,
  sanitizeUsername,
} from '../src/games/hokm/online/protocol';
import {
  CookieHeaderOptions,
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
  parseSessionCookieFromHeader,
} from '../cloudflare/src/lib/sessionCookie';
import { parseAuthCookieFromHeader } from '../cloudflare/src/lib/auth/authCookie';
import { verifyAuthSession } from '../cloudflare/src/lib/auth/authService';
import { handleAuthHttpRequest } from '../cloudflare/src/lib/auth/httpHandler';
import { handleSocialHttpRequest } from '../cloudflare/src/lib/social/httpHandler';
import {
  EmailSender,
  createEmailSender,
  resolvePublicAppBaseUrl,
} from '../cloudflare/src/lib/auth/emailService';
import {
  OriginEvaluationResult,
  evaluateOriginPolicy,
  normalizeIpAddress,
  parseTrustedProxyIps,
  resolveClientIp,
} from '../cloudflare/src/lib/auth/securityPolicy';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

export interface ExpressAppConfig {
  readonly isProduction: boolean;
  readonly allowedOrigins?: string;
  readonly appUrl?: string;
  readonly publicAppUrl?: string;
  readonly trustedProxyIps?: string;
  readonly cookieDomain?: string;
  readonly disconnectGraceMs?: number;
  readonly authSessionTtlSec?: string | number;
  readonly defaultPort?: number;
  readonly emailProvider?: string;
  readonly resendApiKey?: string;
  readonly emailFrom?: string;
}

export interface CreateEyvanExpressAppDeps {
  readonly db: EyvanDatabase;
  readonly roomManager: HokmRoomManager;
  readonly config: ExpressAppConfig;
  readonly emailSender?: EmailSender;
}

export interface EyvanExpressBundle {
  readonly app: Express;
  readonly evaluateRequestOrigin: (req: http.IncomingMessage) => OriginEvaluationResult;
  readonly isRequestOriginAllowed: (req: http.IncomingMessage) => boolean;
}

function getAppUrlHostAndProto(appUrlRaw: string | undefined): { host: string; protocol: string } | null {
  if (!appUrlRaw) return null;
  try {
    const parsed = new URL(appUrlRaw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return { host: parsed.host, protocol: parsed.protocol };
  } catch {
    return null;
  }
}

export function createEyvanExpressApp(deps: CreateEyvanExpressAppDeps): EyvanExpressBundle {
  const { db, roomManager, config } = deps;
  const trustedProxies = parseTrustedProxyIps(config.trustedProxyIps);
  const appUrlInfo = getAppUrlHostAndProto(config.appUrl);
  const disconnectGraceMs = config.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  const defaultPort = config.defaultPort ?? 3000;
  const cookieOpts: CookieHeaderOptions | undefined = config.cookieDomain
    ? { domain: config.cookieDomain }
    : undefined;
  const emailSender: EmailSender =
    deps.emailSender ??
    createEmailSender({
      provider: config.emailProvider,
      resendApiKey: config.resendApiKey,
      emailFrom: config.emailFrom,
      isProduction: config.isProduction,
    });

  const isSecureIncomingReq = (req: http.IncomingMessage & { secure?: boolean }): boolean => {
    if (req.secure) return true;
    const xfProtoHeader = req.headers['x-forwarded-proto'];
    const xfProto =
      typeof xfProtoHeader === 'string'
        ? xfProtoHeader.split(',')[0]?.trim().toLowerCase()
        : undefined;
    if (xfProto !== 'https') return false;

    const peerIp = normalizeIpAddress(req.socket?.remoteAddress);
    if (peerIp && trustedProxies.has(peerIp)) {
      return true;
    }

    // Allow HTTPS detection when running behind managed single-app proxy whose exact APP_URL is HTTPS
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host.trim() : '';
    if (appUrlInfo && appUrlInfo.protocol === 'https:' && hostHeader === appUrlInfo.host) {
      return true;
    }
    return false;
  };

  const evaluateRequestOrigin = (
    req: http.IncomingMessage & { secure?: boolean }
  ): OriginEvaluationResult => {
    const protocol = isSecureIncomingReq(req) ? 'https' : 'http';
    const host =
      typeof req.headers.host === 'string' && req.headers.host.trim()
        ? req.headers.host.trim()
        : `localhost:${defaultPort}`;
    const requestOrigin = `${protocol}://${host}`;
    const originHeader =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const refererHeader =
      typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
    const secFetchSiteHeader = req.headers['sec-fetch-site'];
    const secFetchSite =
      typeof secFetchSiteHeader === 'string' ? secFetchSiteHeader : undefined;

    return evaluateOriginPolicy({
      originHeader,
      refererHeader,
      secFetchSite,
      requestOrigin,
      method: req.method ?? 'GET',
      config: {
        allowedOriginsRaw: config.allowedOrigins,
        appUrlRaw: config.appUrl,
        isProduction: config.isProduction,
      },
    });
  };

  const isRequestOriginAllowed = (req: http.IncomingMessage): boolean =>
    evaluateRequestOrigin(req).allowed;

  const extractClientIp = (req: http.IncomingMessage): string => {
    const xffHeader = req.headers['x-forwarded-for'];
    const xForwardedFor =
      typeof xffHeader === 'string'
        ? xffHeader
        : Array.isArray(xffHeader)
        ? xffHeader.join(', ')
        : undefined;
    return resolveClientIp({
      remoteAddress: req.socket?.remoteAddress,
      xForwardedFor,
      trustedProxies,
    });
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Strict origin & security headers for API routes (zero wildcards, zero *.run.app suffix)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const evaluation = evaluateRequestOrigin(req);
    const hasOrigin = typeof req.headers.origin === 'string' && req.headers.origin.length > 0;
    const isMutating =
      req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';

    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      if (!evaluation.allowed) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN_ORIGIN',
          error: 'FORBIDDEN_ORIGIN',
          message: 'مبدا درخواست مجاز نیست.',
        });
        return;
      }
      if (evaluation.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', evaluation.corsOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      }
      res.status(204).end();
      return;
    }

    if ((hasOrigin || isMutating) && !evaluation.allowed) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_ORIGIN',
        error: 'FORBIDDEN_ORIGIN',
        message: 'مبدا درخواست مجاز نیست.',
      });
      return;
    }

    if (evaluation.allowed && evaluation.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', evaluation.corsOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    }

    next();
  });

  // -------------------------------------------------------------------------
  // REST API Routes
  // -------------------------------------------------------------------------

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'eyvan-hokm-online',
      activeRooms: roomManager.getActiveRoomCount(),
      disconnectGraceMs,
      serverTime: Date.now(),
    });
  });

  // Central Platform Authentication (`/api/auth/*` — shared handler with Cloudflare Workers)
  app.all('/api/auth/*', async (req: Request, res: Response) => {
    try {
      const secure = isSecureIncomingReq(req);
      const protocol = secure ? 'https' : 'http';
      const host = req.headers.host ?? `localhost:${defaultPort}`;
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

      const publicAppBaseUrl = resolvePublicAppBaseUrl(
        [config.publicAppUrl, config.appUrl, config.allowedOrigins],
        fullUrl,
        { isProduction: config.isProduction }
      );

      const webRes = await handleAuthHttpRequest(webReq, req.path, {
        db: db.getD1Adapter(),
        corsHeaders: {},
        secureCookie: secure,
        cookieOptions: cookieOpts,
        originAllowed: isRequestOriginAllowed(req),
        clientIp: extractClientIp(req),
        userAgent: String(req.headers['user-agent'] ?? 'unknown'),
        sessionTtlSec: config.authSessionTtlSec,
        publicAppBaseUrl: publicAppBaseUrl ?? undefined,
        isProduction: config.isProduction,
        emailSender,
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
      console.error(
        '[Auth] Express route adapter error:',
        err instanceof Error ? err.message : 'unknown'
      );
      res.status(500).json({
        ok: false,
        code: 'DATABASE_ERROR',
        message: 'خطای داخلی سرور رخ داد.',
      });
    }
  });

  // Stage D1 Social & Online Presence (`/api/social/*` — shared handler with Cloudflare Workers)
  app.all('/api/social/*', async (req: Request, res: Response) => {
    try {
      const secure = isSecureIncomingReq(req);
      const protocol = secure ? 'https' : 'http';
      const host = req.headers.host ?? `localhost:${defaultPort}`;
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
        hasBody && req.body !== undefined && typeof req.body === 'object' && req.body !== null
          ? JSON.stringify(req.body)
          : undefined;

      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: bodyStr,
      });

      const webRes = await handleSocialHttpRequest(webReq, req.path, {
        db: db.getD1Adapter(),
        corsHeaders: {},
        secureCookie: secure,
        cookieOptions: cookieOpts,
        originAllowed: isRequestOriginAllowed(req),
        clientIp: extractClientIp(req),
      });

      if (!webRes) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'مسیر اجتماعی یافت نشد.' });
        return;
      }

      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const responseText = await webRes.text();
      res.status(webRes.status).send(responseText);
    } catch (err) {
      console.error(
        '[Social] Express route adapter error:',
        err instanceof Error ? err.message : 'unknown'
      );
      res.status(500).json({
        ok: false,
        code: 'DATABASE_ERROR',
        message: 'خطای داخلی سرور رخ داد.',
      });
    }
  });

  const resolveOptionalAuthUserId = async (req: Request): Promise<string | null> => {
    const rawAuthToken = parseAuthCookieFromHeader(req.headers.cookie);
    if (!rawAuthToken) return null;
    try {
      const verified = await verifyAuthSession(db.getD1Adapter(), rawAuthToken);
      return verified.authenticated && verified.user ? verified.user.userId : null;
    } catch {
      return null;
    }
  };

  app.post('/api/rooms', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const verifiedUserId = await resolveOptionalAuthUserId(req);
    const result = roomManager.createRoom({
      username: body.username,
      userId: verifiedUserId,
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
        isSecureIncomingReq(req),
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

  app.post('/api/rooms/:code/join', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const preferredSeat = isValidSeat(body.preferredSeat)
      ? body.preferredSeat
      : undefined;
    const verifiedUserId = await resolveOptionalAuthUserId(req);

    const result = roomManager.joinRoom(String(req.params.code ?? ''), {
      username: body.username,
      userId: verifiedUserId,
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
        isSecureIncomingReq(req),
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
        buildClearSessionCookieHeader(isSecureIncomingReq(req), cookieOpts)
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
        buildClearSessionCookieHeader(isSecureIncomingReq(req), cookieOpts)
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
      buildClearSessionCookieHeader(isSecureIncomingReq(req), cookieOpts)
    );
    res.status(200).json({ ok: true });
  });

  app.get('/api/matches', (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 10;
    const matches = db.getRecentMatches(limit);
    res.json({ matches });
  });

  app.get('/api/stats/me', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const rawAuthToken = parseAuthCookieFromHeader(req.headers.cookie);
    if (!rawAuthToken) {
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'برای مشاهده آمار حساب خود ابتدا وارد شوید.',
      });
      return;
    }
    try {
      const verified = await verifyAuthSession(db.getD1Adapter(), rawAuthToken);
      if (!verified.authenticated || !verified.user) {
        res.status(401).json({
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'نشست کاربری معتبر نیست.',
        });
        return;
      }
      const stats = db.getPlayerStatsByUserId(verified.user.userId);
      res.json({
        ok: true,
        stats: stats ?? {
          userId: verified.user.userId,
          username: verified.user.username,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          kotWins: 0,
          hakemKotWins: 0,
          lastPlayedAt: null,
        },
      });
    } catch {
      res.status(503).json({
        ok: false,
        code: 'DATABASE_ERROR',
        message: 'خطا در خواندن آمار حساب کاربری.',
      });
    }
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
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'entity.parse.failed'
      ) {
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

  return {
    app,
    evaluateRequestOrigin,
    isRequestOriginAllowed,
  };
}
