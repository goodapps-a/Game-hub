# Eyvan Hokm Online — Cloudflare Workers + Durable Objects + D1 + R2

## Architecture Overview
- **Cloudflare Worker (`src/index.ts`)**: HTTP REST API (`/api/health`, `/api/rooms`, `/api/rooms/:code`, `/api/rooms/:code/join`, `/api/matches`, `/api/stats/:username`), WebSocket upgrade router (`/ws/rooms/:code`), strict Origin/CORS enforcement, body size limits, and R2 static asset delivery (`/r2/*`).
- **Cloudflare Durable Object (`src/HokmRoomDO.ts`)**: Single-authority stateful instance per room wrapping the shared `HokmRoomController` and Phase 1 pure Hokm engine (`src/games/hokm/engine/*`).
  - **Durable Storage Persistence**: Persists room & game state (`room:state`) and scheduled alarms (`sys:alarms`) in Durable Object Storage with `blockConcurrencyWhile` hydration on cold start/wake-up.
  - **Official WebSocket Hibernation API**: Uses `ctx.acceptWebSocket`, `ws.serializeAttachment` / `ws.deserializeAttachment`, `ctx.getWebSockets()`, and `webSocketMessage` / `webSocketClose` / `webSocketError` handlers with per-connection `connectionId` race protection.
  - **Game-Agnostic Primitives (`src/lib/`)**: `DurableAlarmScheduler`, `hibernationSockets`, and `d1Persistence` are decoupled from Hokm rules so future games (Chess, Ludo/Mensch, Backgammon) reuse the exact same reliability layer.
- **Cloudflare D1 (`migrations/0001_init.sql`, `migrations/0002_indexes.sql`)**: Persists completed matches, participants, and aggregate win/loss/kot/hakem-kot statistics strictly ONCE at match completion, with durable retry alarms on transient D1 errors.
- **Cloudflare R2 (`EYVAN_ASSETS`)**: Serves card artwork, avatars, and studio MP3 audio files with immutable edge caching.

## Manual Production Configuration Checklist
1. Create the D1 database and R2 bucket:
   ```bash
   wrangler d1 create eyvan-hokm-db
   wrangler r2 bucket create eyvan-assets
   ```
2. Paste the real `database_id` returned by Wrangler into `cloudflare/wrangler.toml` (replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`).
3. Apply both D1 migrations:
   ```bash
   wrangler d1 migrations apply eyvan-hokm-db --remote
   ```
4. Set `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml` to your exact frontend domain(s), e.g. `"https://play.yourdomain.com"` (never `*`).
5. Bind a **Custom Domain** (TLS 443) to the Worker in the Cloudflare Dashboard or `[[routes]]` in `wrangler.toml` (do not rely on `*.workers.dev` for Iranian users).
6. Deploy the Worker & Durable Object:
   ```bash
   wrangler deploy
   ```
7. Set `VITE_ONLINE_API_BASE=https://api.yourdomain.com` in your frontend build environment.

## Operational Field-Testing Checklist (Iran ISPs: همراه اول، ایرانسل، مخابرات)
Real-network testing from Iranian ISPs must be executed after deploying to your Custom Domain:
1. Verify initial `wss://` handshake & RTT from MCI (همراه اول), Irancell (ایرانسل), and fixed ADSL/Fiber.
2. Run a full 4-player match across 4 separate devices/networks for 15+ minutes, verifying RTT stability and zero dropped moves.
3. Mid-trick airplane-mode toggle (15s offline -> online) verifying seat reservation, reconnect recovery, and zero duplicate card plays.
4. Mid-hand Wi-Fi ↔ 4G/LTE network switch verifying seamless `sessionToken` resume and old-socket superseding.
