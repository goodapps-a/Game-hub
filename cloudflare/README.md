# Eyvan Hokm Online — Cloudflare Workers + Durable Objects + D1 + R2

## Architecture Overview
- **Cloudflare Worker (`src/index.ts`)**: HTTP REST API (`/api/health`, `/api/rooms`, `/api/rooms/:code`, `/api/rooms/:code/join`, `/api/session/resume`, `/api/session/clear`, `/api/matches`, `/api/stats/:username`), cookie-authenticated WebSocket upgrade proxy (`/ws/rooms/:code`), strict Origin/CORS enforcement, streaming UTF-8 byte limits, `HttpOnly` session cookies (the secret `sessionToken` is NEVER returned in any JSON response or sent to browser JS), and R2 static asset delivery (`/r2/*`).
- **Cloudflare Durable Object (`src/HokmRoomDO.ts`)**: Single-authority stateful instance per room wrapping the shared `HokmRoomController` and Phase 1 pure Hokm engine (`src/games/hokm/engine/*`).
  - **Durable Storage Persistence**: Persists room & game state (`room:state`) and scheduled alarms (`sys:alarms`) in Durable Object Storage with `blockConcurrencyWhile` hydration on cold start/wake-up.
  - **Official WebSocket Hibernation API**: Verifies the `HttpOnly` session cookie at WebSocket upgrade before accepting connections, then uses `ctx.acceptWebSocket`, `ws.serializeAttachment` / `ws.deserializeAttachment`, `ctx.getWebSockets()`, and `webSocketMessage` / `webSocketClose` / `webSocketError` handlers with per-connection `connectionId` race protection.
  - **Safe Peek-Execute-Ack Alarm Scheduler (`src/lib/alarmScheduler.ts`)**: Never deletes a task before successful execution; failed tasks retry with bounded exponential backoff.
  - **Lossless D1 Match Persistence Queue**: Keeps completed matches in a durable FIFO queue (`pendingMatchPersistences`) that survives rematches, DO restarts, room closures, and prolonged D1 outages with capped exponential retry.
- **Cloudflare D1 (`migrations/0001_init.sql` .. `0004_accounts_auth.sql`)**: Persists completed matches, participants, aggregate stats, central accounts, sessions, C2 verification/reset tokens, and atomic rate limits (`auth_rate_limits`).
- **Cloudflare Cron Trigger (`0 */6 * * *`)**: Invokes `scheduled()` in `src/index.ts` every 6 hours to prune expired, unblocked `auth_rate_limits` rows in bounded batches (zero per-request latency impact).
- **Cloudflare R2 (`EYVAN_ASSETS`)**: Serves card artwork, avatars, and studio MP3 audio files with immutable edge caching.

## Manual Production Configuration Checklist
1. Create the D1 database and R2 bucket:
   ```bash
   wrangler d1 create eyvan-hokm-db
   wrangler r2 bucket create eyvan-assets
   ```
2. Paste the real `database_id` returned by Wrangler into `cloudflare/wrangler.toml` (replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`).
3. Apply all D1 migrations (`0001` through `0004`):
   ```bash
   wrangler d1 migrations apply eyvan-hokm-db --remote
   ```
4. Configure Production environment variables in `cloudflare/wrangler.toml` (or Cloudflare Dashboard -> Worker -> Settings -> Variables and Secrets):
   - `ENVIRONMENT = "production"`
   - `ALLOWED_ORIGINS = "https://play.yourdomain.com"` (exact HTTPS origin(s), never `*` or `*.run.app`)
   - `PUBLIC_APP_URL = "https://play.yourdomain.com"` (exact HTTPS frontend origin used in verification & password reset links)
   - `EMAIL_PROVIDER = "resend"`
   - `EMAIL_FROM = "Eyvan <no-reply@yourdomain.com>"` (must be on a Resend-verified domain with valid SPF/DKIM DNS records)
   - Optional: `COOKIE_DOMAIN = ".yourdomain.com"` if frontend & API use sibling subdomains
5. Add the Resend API key as a Cloudflare Worker **Secret** (never commit in `wrangler.toml`):
   ```bash
   wrangler secret put RESEND_API_KEY
   ```
6. Bind a **Custom Domain** (TLS 443) to the Worker on the **same root site** as your frontend (e.g. `https://api.yourdomain.com` alongside `https://play.yourdomain.com`, or Worker routes `yourdomain.com/api/*` and `yourdomain.com/ws/*`). Because `/api/auth/*`, `/api/session/resume`, and WebSocket (`/ws/rooms/:code`) rely on `HttpOnly` cookies, same-site hosting guarantees browsers (including Safari/iOS) attach cookies reliably and avoids `*.workers.dev` disruptions.
7. Deploy the Worker, Durable Object, and Cron Trigger (`0 */6 * * *`):
   ```bash
   wrangler deploy
   ```
   After deploy, verify in **Cloudflare Dashboard -> Workers & Pages -> eyvan-hokm-online -> Triggers -> Cron Triggers** that `0 */6 * * *` is active.
8. Set `VITE_ONLINE_API_BASE=https://api.yourdomain.com` (or leave empty if mounted on the exact same origin via Worker routes) in your Cloudflare Pages build environment.

## Operational Field-Testing Checklist (Iran ISPs: همراه اول، ایرانسل، مخابرات)
Real-network testing from Iranian ISPs must be executed after deploying to your Custom Domain:
1. Verify initial `wss://` handshake & RTT from MCI (همراه اول), Irancell (ایرانسل), and fixed ADSL/Fiber.
2. Run a full 4-player match across 4 separate devices/networks for 15+ minutes, verifying RTT stability and zero dropped moves.
3. Mid-trick airplane-mode toggle (15s offline -> online) AND full browser page refresh verifying `HttpOnly` session recovery, seat reservation, and zero duplicate card plays.
4. Mid-hand Wi-Fi ↔ 4G/LTE network switch verifying seamless reconnect and old-socket superseding.
