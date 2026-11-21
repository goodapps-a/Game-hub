# Eyvan Hokm Online — Cloudflare Workers + Durable Objects + D1 + R2

## Architecture Overview
- **Cloudflare Worker (`src/index.ts`)**: HTTP REST API (`/api/health`, `/api/rooms`, `/api/rooms/:code`, `/api/rooms/:code/join`, `/api/session/resume`, `/api/session/clear`, `/api/matches`, `/api/stats/:username`), cookie-authenticated WebSocket upgrade proxy (`/ws/rooms/:code`), strict Origin/CORS enforcement, streaming UTF-8 byte limits, `HttpOnly` session cookies (the secret `sessionToken` is NEVER returned in any JSON response or sent to browser JS), and R2 static asset delivery (`/r2/*`).
- **Cloudflare Durable Object (`src/HokmRoomDO.ts`)**: Single-authority stateful instance per room wrapping the shared `HokmRoomController` and Phase 1 pure Hokm engine (`src/games/hokm/engine/*`).
  - **Durable Storage Persistence**: Persists room & game state (`room:state`) and scheduled alarms (`sys:alarms`) in Durable Object Storage with `blockConcurrencyWhile` hydration on cold start/wake-up.
  - **Official WebSocket Hibernation API**: Verifies the `HttpOnly` session cookie at WebSocket upgrade before accepting connections, then uses `ctx.acceptWebSocket`, `ws.serializeAttachment` / `ws.deserializeAttachment`, `ctx.getWebSockets()`, and `webSocketMessage` / `webSocketClose` / `webSocketError` handlers with per-connection `connectionId` race protection.
  - **Safe Peek-Execute-Ack Alarm Scheduler (`src/lib/alarmScheduler.ts`)**: Never deletes a task before successful execution; failed tasks retry with bounded exponential backoff.
  - **Lossless D1 Match Persistence Queue**: Keeps completed matches in a durable FIFO queue (`pendingMatchPersistences`) that survives rematches, DO restarts, room closures, and prolonged D1 outages with capped exponential retry.
- **Cloudflare D1 (`migrations/0001_init.sql`, `0002_indexes.sql`, `0003_username_canonical_key.sql`)**: Persists completed matches, participants, and aggregate stats strictly ONCE using canonical lowercase username keys with preserved `display_username`.
- **Cloudflare R2 (`EYVAN_ASSETS`)**: Serves card artwork, avatars, and studio MP3 audio files with immutable edge caching.

## Manual Production Configuration Checklist
1. Create the D1 database and R2 bucket:
   ```bash
   wrangler d1 create eyvan-hokm-db
   wrangler r2 bucket create eyvan-assets
   ```
2. Paste the real `database_id` returned by Wrangler into `cloudflare/wrangler.toml` (replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`).
3. Apply all three D1 migrations:
   ```bash
   wrangler d1 migrations apply eyvan-hokm-db --remote
   ```
4. Set `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml` to your exact frontend domain(s), e.g. `"https://play.yourdomain.com"` (never `*`). Keep local dev separate from production (e.g. via `[env.production]` or Cloudflare Dashboard Environment Variables).
5. Bind a **Custom Domain** (TLS 443) to the Worker on the **same root site** as your frontend (e.g. `https://api.yourdomain.com` alongside `https://play.yourdomain.com`, or Worker routes `yourdomain.com/api/*` and `yourdomain.com/ws/*`). Because BOTH `/api/session/resume` AND WebSocket (`/ws/rooms/:code`) rely on the `HttpOnly` cookie, same-site hosting guarantees browsers (including Safari/iOS) attach the cookie reliably on both `fetch` and `WebSocket` upgrades, and avoids `*.workers.dev` disruptions for Iranian users.
6. Deploy the Worker & Durable Object:
   ```bash
   wrangler deploy
   ```
7. Set `VITE_ONLINE_API_BASE=https://api.yourdomain.com` (or leave empty if mounted on the exact same origin via Worker routes) in your Cloudflare Pages build environment.

## Operational Field-Testing Checklist (Iran ISPs: همراه اول، ایرانسل، مخابرات)
Real-network testing from Iranian ISPs must be executed after deploying to your Custom Domain:
1. Verify initial `wss://` handshake & RTT from MCI (همراه اول), Irancell (ایرانسل), and fixed ADSL/Fiber.
2. Run a full 4-player match across 4 separate devices/networks for 15+ minutes, verifying RTT stability and zero dropped moves.
3. Mid-trick airplane-mode toggle (15s offline -> online) AND full browser page refresh verifying `HttpOnly` session recovery, seat reservation, and zero duplicate card plays.
4. Mid-hand Wi-Fi ↔ 4G/LTE network switch verifying seamless reconnect and old-socket superseding.
