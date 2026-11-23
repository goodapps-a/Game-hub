/**
 * Game-agnostic structural interfaces matching the official Cloudflare Workers,
 * Durable Objects (WebSocket Hibernation API + Storage + Alarms), D1, and R2 runtimes.
 *
 * Designed so Hokm and future multiplayer games (Chess, Ludo/Mensch, Backgammon, etc.)
 * share the exact same durable room, alarm, and hibernation primitives cleanly.
 */

export interface D1RunMeta {
  changes?: number;
  last_row_id?: number;
}

export interface D1RunResult {
  success?: boolean;
  meta?: D1RunMeta;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResult>;
  all<T = unknown>(): Promise<{ results: T[]; success?: boolean }>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]>;
}

export interface R2BucketLike {
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    writeHttpMetadata?: (headers: Headers) => void;
  } | null>;
}

export interface HibernatableWebSocket {
  readonly readyState?: number;
  send(message: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(attachment: unknown): void;
  deserializeAttachment(): unknown;
}

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectStateLike {
  readonly storage: DurableObjectStorageLike;
  acceptWebSocket(ws: HibernatableWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HibernatableWebSocket[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

export interface ScheduledControllerLike {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry?: () => void;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?: () => void;
}

export interface CfWorkerEnv {
  HOKM_ROOM: DurableObjectNamespaceLike;
  CHAT_CONVERSATION?: DurableObjectNamespaceLike;
  EYVAN_DB: D1DatabaseLike;
  EYVAN_ASSETS: R2BucketLike;
  DISCONNECT_GRACE_MS?: string;
  ALLOWED_ORIGINS?: string;
  APP_URL?: string;
  PUBLIC_APP_URL?: string;
  ENVIRONMENT?: string;
  COOKIE_DOMAIN?: string;
  ROOM_CLEANUP_TTL_MS?: string;
  AUTH_SESSION_TTL_SEC?: string;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_SENDER?: import('./auth/emailService').EmailSender;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GOOGLE_OAUTH_FETCH?: typeof fetch;
}
