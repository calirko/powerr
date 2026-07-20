# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monorepo controlling a PC's power button remotely: an ESP32-WROVER (`firmware/`) wired to a relay across the
motherboard's power-switch header, a Bun/Hono server (`server/`) that the ESP32 stays persistently connected to
over WebSocket, and a React frontend (`web/`) served by that same server. There are three independent packages
(no workspace tooling ties them together) — each has its own dependencies and must be built/run separately.

## Commands

### server/ (Bun + Hono + Prisma)
```
bun install
bun run dev         # watch mode
bun run start       # bun run src/index.ts
bun run typecheck   # tsc --noEmit
```
Requires a `.env` (see `.env.example`) with `AUTH_TOKEN`, `UI_PASSWORD`, `DATABASE_URL`.

Prisma (schema at `prisma/schema.prisma`, SQLite):
```
bunx prisma migrate dev --name <name>   # after schema changes
bunx prisma generate                     # regenerate client into src/generated/prisma
```
No test suite exists yet — verification in this repo has been done by scripting a fake WebSocket "device" client
and curl against a running `bun run src/index.ts` instance (see conversation history / recreate ad hoc if needed).

### web/ (Vite + React + Tailwind v4)
```
bun install
bun run dev      # vite dev server, proxies /status, /power, /login, /ws to localhost:3000
bun run build    # tsc -b && vite build — outputs directly into ../server/public
bun run lint     # oxlint
```
The frontend has no `.env`/build-time secrets — auth is entirely via the `powerr_session` cookie the server sets.

### firmware/ (PlatformIO, Arduino framework, esp-wrover-kit)
No PlatformIO/arduino-cli in this environment historically — firmware changes could not be compiled locally in this
repo's history; treat firmware edits as unverified until built with `pio run` on a machine that has PlatformIO.
Copy `include/secrets.h.example` to `include/secrets.h` (gitignored) and fill in WiFi/server/PC-probe values before
building.

## Architecture

### Two independent "online" concepts — don't conflate them
- **ESP32 connectivity**: whether the device's WebSocket to the server is alive. Tracked in
  `server/src/device-state.ts` (`DeviceState.connected`), driven by a heartbeat the firmware sends every
  `HEARTBEAT_INTERVAL_MS` (`firmware/include/config.h`) and a matching staleness timeout server-side
  (`STALE_AFTER_MS`/`STALE_CHECK_INTERVAL_MS`). If you change one, change the other to keep the same ratio.
- **PC power state**: whether the *target machine* is powered on, determined by the ESP32 ICMP-pinging
  `PC_HOST_IP` (firmware secret) on its own LAN — nothing to do with the WebSocket. Reported via a `pc_status`
  message and reset to `null` (unknown) whenever the ESP32 disconnects, since a stale reading from a device
  that's no longer there can't be trusted (see `DeviceState.disconnect`).

### Server (`server/src/`)
- `index.ts` — all Hono routes. Two independent auth mechanisms are both accepted by `requireAuth`: a bearer
  `AUTH_TOKEN` (used by the ESP32's `/ws` connection and for curl/API testing) and a signed session cookie set by
  `POST /login` after checking `UI_PASSWORD` (used by the browser). `GET /` redirects to `/login` server-side if
  there's no valid session cookie — this is what gates the SPA.
- `device-state.ts` — single in-memory `DeviceState` singleton holding the one ESP32 connection, pending
  power-command acks (keyed by UUID, resolved when the firmware's `ack` message arrives or a timeout fires), and
  the set of frontend WebSocket subscribers for `/ws/status`. All "push an update to the frontend" logic funnels
  through `broadcastStatus()`.
- `POST /power` has a server-side cooldown (`POWER_COOLDOWN_MS`, module-level `lastPowerTriggerAt` in `index.ts`)
  that rejects with 429 + `retryAfterMs` regardless of whether the underlying command succeeds — it exists purely
  to stop rapid-fire clicking, not to rate-limit legitimate use.
- `db.ts` / Prisma — logs every button pass-through transition and every remote power command to the `PowerEvent`
  table. **Important Bun-specific gotcha**: use `@prisma/adapter-libsql`, not `@prisma/adapter-better-sqlite3` —
  the latter's native binding fails to `dlopen` under Bun. Prisma 7 requires an explicit driver adapter; there's no
  bundled default engine anymore.
- Server-to-device and device-to-server message shapes are the discriminated unions in `types.ts` — keep firmware
  and server in sync manually when adding message types (no shared schema/codegen between them).

### Firmware (`firmware/`)
- `src/main.cpp` is a single-loop, mostly non-blocking design: the physical case button (`BUTTON_PIN`) is mirrored
  straight to the relay every loop iteration with **no debounce/filtering** (intentional — raw transitions are
  logged as-is), while remote `power` commands from the server are tracked via a millis()-based timer
  (`remotePulseActive`/`remotePulseUntil`) rather than `delay()`, so they can coexist with button mirroring and the
  WS heartbeat. The relay is energized if *either* the button is held *or* a remote pulse is active.
- The PC-power ICMP probe (`checkPcPower`) is the one intentionally blocking call in the loop (via the
  `ESP32Ping` library) — kept infrequent (`PC_PING_INTERVAL_MS`) specifically to limit how long it stalls button
  mirroring and the heartbeat.
- `include/config.h` holds non-secret tuning (pins, intervals, polarity); `include/secrets.h` (gitignored, copy
  from `.example`) holds WiFi credentials, server address, the shared `AUTH_TOKEN`, and `PC_HOST_IP`.

### Frontend (`web/src/`)
- No client-side router library — `Root.tsx` does a one-shot check (`GET /status`, reusing the same auth-gated
  endpoint rather than a dedicated session-check route) on mount and redirects between `/` and `/login` via
  `window.location.replace`, then renders `LoginPage` or `PowerPage` based on `window.location.pathname`.
- `useDeviceStatus.ts` owns the `/ws/status` connection: auto-reconnects on unexpected close, but a close with
  code `1008` (server-side unauthorized) redirects to `/login` instead of retrying.
- Tailwind v4 is configured CSS-first (no `tailwind.config.js`) — theme tokens (fonts, custom `shimmer` animation)
  live in `@theme`/`@keyframes` blocks in `src/index.css`.
- `vite.config.ts` sets `build.outDir` to `../server/public` and proxies `/status`, `/power`, `/login`, `/ws` to
  `localhost:3000` in dev — the frontend is meant to be built and served by the Bun server, not run standalone in
  production.
