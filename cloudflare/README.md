# Eyvan Hokm Online — Cloudflare Workers + Durable Objects + D1 + R2

## Architecture Overview
- **Cloudflare Worker (`src/index.ts`)**: HTTP REST API (`/api/rooms`, `/api/matches`, `/api/stats/:username`), WebSocket upgrade router (`/ws/rooms/:code`), and R2 static asset delivery (`/r2/*`).
- **Cloudflare Durable Object (`src/HokmRoomDO.ts`)**: Single-authority stateful instance per room wrapping the exact shared `HokmRoomController` and Phase 1 pure Hokm engine (`src/games/hokm/engine/*`). Handles real-time WebSocket rooms, strict card privacy, action idempotency, trick collection alarms, auto-next-hand, and disconnect grace windows.
- **Cloudflare D1 (`migrations/0001_init.sql`)**: Persists completed matches, participants, and aggregate win/loss/kot/hakem-kot statistics ONLY at match completion (minimizing D1 row writes).
- **Cloudflare R2 (`EYVAN_ASSETS`)**: Serves card artwork, avatars, and studio MP3 audio files with immutable edge caching.

## Deployment Steps
1. Create the D1 database and R2 bucket:
   ```bash
   wrangler d1 create eyvan-hokm-db
   wrangler r2 bucket create eyvan-assets
   ```
2. Put the returned `database_id` into `cloudflare/wrangler.toml`.
3. Apply the D1 migration:
   ```bash
   wrangler d1 migrations apply eyvan-hokm-db --remote
   ```
4. Configure `ALLOWED_ORIGINS` in `wrangler.toml` with your frontend domain, then deploy:
   ```bash
   wrangler deploy
   ```
5. Point the frontend build to your deployed Worker via `VITE_ONLINE_API_BASE=https://your-custom-domain.example`.

## Iran Real-Network Testing Checklist (همراه اول، ایرانسل، مخابرات)
Because Iranian ISPs may throttle or block default `*.workers.dev` subdomains or silently drop idle WebSocket connections through NAT/DPI firewalls, follow these verified practices:
1. **Always bind a Custom Domain (TLS on port 443)** instead of `*.workers.dev`.
2. **Application-level Heartbeat (already implemented in `HokmOnlineClient`)**: Sends JSON `ping` every 10s with a 6s `pong` watchdog so silently dropped sockets reconnect immediately rather than hanging.
3. **Network / IP Switch Recovery**: Switching Wi-Fi ↔ 4G/LTE triggers automatic jittered backoff reconnect and re-authenticates using the player's `sessionToken` without losing seat or replaying moves.
4. **Field Test Matrix to Execute from Iran**:
   - Initial `wss://` handshake & RTT on MCI (همراه اول), Irancell (ایرانسل), and fixed ADSL/Fiber (مخابرات / شاتل).
   - 15-minute sustained 4-player match measuring RTT jitter & packet drops.
   - Mid-trick airplane-mode toggle (15s offline -> online) verifying seat reservation and instant state resync.
   - Wi-Fi to 4G switch mid-hand verifying seamless token resume.
