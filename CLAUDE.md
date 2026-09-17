# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monorepo controlling a PC's power button remotely: a Seeed XIAO ESP32-S3 Sense (`firmware/`) wired to a relay across the
motherboard's power-switch header, a Bun/Hono server (`server/`) that the ESP32 stays persistently connected to
over WebSocket, and a React frontend (`web/`) served by that same server. There are three independent packages
(no workspace tooling ties them together); each has its own dependencies and must be built/run separately.

## Commands

### server/ (Bun + Hono + Prisma)
```
bun install
bun run dev         # watch mode
bun run start       # bun run src/index.ts
bun run typecheck   # tsc --noEmit
```
Requires a `.env` (see `.env.example`) with `AUTH_TOKEN`, `UI_PASSWORD`, `DATABASE_URL`, plus the device runtime
settings (`PC_HOST_IP`, optional ping/heartbeat/long-hold tuning) that get pushed to the ESP32 on connect.

Prisma (schema at `prisma/schema.prisma`, SQLite):
```
bunx prisma migrate dev --name <name>   # after schema changes
bunx prisma generate                     # regenerate client into src/generated/prisma
```
No test suite exists yet. Verification in this repo has been done by scripting a fake WebSocket "device" client
and curl against a running `bun run src/index.ts` instance (see conversation history / recreate ad hoc if needed).

### web/ (Vite + React + Tailwind v4)
```
bun install
bun run dev      # vite dev server, proxies /status, /power, /login, /ws to localhost:3050
bun run build    # tsc -b && vite build, outputs directly into ../server/public
bun run lint     # oxlint
```
The frontend has no `.env`/build-time secrets; auth is entirely via the `powerr_session` cookie the server sets.

### firmware/ (PlatformIO, Arduino framework, seeed_xiao_esp32s3)
```
~/.platformio/penv/bin/pio run                                   # build
~/.platformio/penv/bin/pio run -t upload --upload-port /dev/ttyACM0
~/.platformio/penv/bin/pio device monitor                         # serial logs ([wifi]/[ws]/[pc]/[power]/[button])
```
`pio` isn't on PATH; use the penv binary above. The board enumerates as `/dev/ttyACM0` (native USB CDC).
Copy `include/secrets.h.example` to `include/secrets.h` (gitignored) and fill in WiFi/server values before building.

## Architecture

### Two independent "online" concepts, not to be conflated
- **ESP32 connectivity**: whether the device's WebSocket to the server is alive. Tracked in
  `server/src/device-state.ts` (`DeviceState.connected`), driven by a heartbeat the firmware sends every
  `HEARTBEAT_INTERVAL_MS` and a staleness timeout server-side (`STALE_AFTER_MS`/`STALE_CHECK_INTERVAL_MS`). All
  three live in `server/src/device-config.ts`; the stale values are derived from the heartbeat, which is pushed to
  the device, so they can't drift apart.
- **PC power state**: whether the *target machine* is powered on, determined by the ESP32 ICMP-pinging
  `PC_HOST_IP` (server env, pushed to the device) on its own LAN, nothing to do with the WebSocket. Reported via a `pc_status`
  message and reset to `null` (unknown) whenever the ESP32 disconnects, since a stale reading from a device
  that's no longer there can't be trusted (see `DeviceState.disconnect`).

### Server (`server/src/`)
- `index.ts`: all Hono routes. Two independent auth mechanisms are both accepted by `requireAuth`: a bearer
  `AUTH_TOKEN` (used by the ESP32's `/ws` connection and for curl/API testing) and a signed session cookie set by
  `POST /login` after checking `UI_PASSWORD` (used by the browser). `GET /` redirects to `/login` server-side if
  there's no valid session cookie; this is what gates the SPA.
- `device-state.ts`: single in-memory `DeviceState` singleton holding the one ESP32 connection, pending
  power-command acks (keyed by UUID, resolved when the firmware's `ack` message arrives or a timeout fires), and
  the set of frontend WebSocket subscribers for `/ws/status`. All "push an update to the frontend" logic funnels
  through `broadcastStatus()`.
- `POST /power` has a server-side cooldown (`POWER_COOLDOWN_MS`, module-level `lastPowerTriggerAt` in `index.ts`)
  that rejects with 429 + `retryAfterMs` regardless of whether the underlying command succeeds; it exists purely
  to stop rapid-fire clicking, not to rate-limit legitimate use.
- `db.ts` / Prisma: every logged event is a `PowerEvent` row identified by `source` + `kind`: `button`/`press`,
  `button`/`release`, `remote`/`pulse`, `device`/`connected`, `device`/`disconnected`, `pc`/`on`, `pc`/`off`.
  `DeviceState.logEvent` writes them all, fire-and-forget. A `pc` row is only written for a change from a *known*
  previous state, so the first reading after a device reconnect is not mistaken for a transition, and a
  `device`/`disconnected` row is only written for the socket that is still the live one (a replaced socket's close
  is not a disconnect). **Important Bun-specific gotcha**: use `@prisma/adapter-libsql`, not `@prisma/adapter-better-sqlite3`;
  the latter's native binding fails to `dlopen` under Bun. Prisma 7 requires an explicit driver adapter; there's no
  bundled default engine anymore.
- `device-config.ts`: runtime device settings read from env (`PC_HOST_IP`, `PC_PING_INTERVAL_MS`, `PC_PING_COUNT`,
  `HEARTBEAT_INTERVAL_MS`, `LONG_HOLD_THRESHOLD_MS`). `DeviceState.connect` sends them as a `config` message on every
  device connect, so changing them needs only a server restart (the device reconnects), not a reflash.
- Server-to-device and device-to-server message shapes are the discriminated unions in `types.ts`; keep firmware
  and server in sync manually when adding message types (no shared schema/codegen between them).
- Besides the live dots, `DeviceStatus` carries two detail blobs for the UI's dialogs: `device` (the board's own
  `device_info` snapshot: RSSI, SSID, IP/MAC, heap, uptime, chip, temperature) and `ping` (the last ICMP probe:
  target, packets sent/received, loss, reply time, plus the probe settings from `device-config.ts`). Both are
  cleared on disconnect for the same reason `pcPoweredOn` is.

### Firmware (`firmware/`)
- `src/main.cpp` is a single-loop, mostly non-blocking design: the physical case button (`BUTTON_PIN`) is mirrored
  straight to the relay every loop iteration with **no debounce/filtering** (intentional, raw transitions are
  logged as-is), while remote `power` commands from the server are tracked via a millis()-based timer
  (`RemotePulse` struct) rather than `delay()`, so they can coexist with button mirroring and the
  WS heartbeat. The relay is energized if *either* the button is held *or* a remote pulse is active.
- WiFi is supervised non-blockingly (`maintainWiFi`, retries after `WIFI_CONNECT_TIMEOUT_MS`); the loop never
  blocks on connectivity, so button mirroring keeps working with WiFi/server down.
- The PC-power ICMP probe (`pcPingTask`, `ESP32Ping`) blocks for seconds, so it runs as a FreeRTOS task pinned to
  core 0 and hands results to the loop through a spinlock; only the loop touches the WebSocket client.
- `pc_status` is sent once per completed probe (not only on change) and carries the ICMP counters, so the UI can
  show a fresh "last checked" and packet loss. `PingCounters` in `main.cpp` is a derived class used purely to read
  `PingClass`'s protected reply counter, which the library otherwise keeps private.
- `device_info` is a board snapshot (WiFi, heap, uptime, chip, temperature) resent every
  `DEVICE_INFO_INTERVAL_MS` and immediately on every WS connect. Nothing on the device depends on it.
- Remote pulses are acked only *after* the relay releases, so the server's ack timeout is `holdMs + grace`
  (`DeviceState.sendPowerCommand`). A second `power` command during an active pulse is rejected with `ok: false`.
- `status_led.{h,cpp}` drives the on-board LED (GPIO21, active-low): fast blink = WiFi connecting, slow blink =
  server connecting, short blip every 4s = idle; solid while the button is held or a short remote pulse runs,
  strobe during long holds (`>= LONG_HOLD_THRESHOLD_MS`), then 1 or 3 confirmation flashes.
- The board is deliberately "dumb" about runtime settings: `DeviceConfig` in `main.cpp` holds what the server's
  `config` message sends (guarded by `configMux`, since the ping task reads it). Until one arrives the PC probe idles
  and the rest use built-in defaults. Only things needed *before* connecting, or tied to physical wiring, stay
  compiled in.
- `include/config.h` holds compile-time tuning (pins as XIAO `D1..D4` labels, D0 unused, polarity, WS reconnect/ping timing,
  `MAX_REMOTE_HOLD_MS` safety net); `include/secrets.h` (gitignored, copy from `.example`) holds WiFi credentials,
  server address, and the shared `AUTH_TOKEN`.

### Frontend (`web/src/`)
- No client-side router library: `Root.tsx` does a one-shot check (`GET /status`, reusing the same auth-gated
  endpoint rather than a dedicated session-check route) on mount and redirects between `/` and `/login` via
  `window.location.replace`, then renders `LoginPage` or `PowerPage` based on `window.location.pathname`.
- `useDeviceStatus.ts` owns the `/ws/status` connection: auto-reconnects on unexpected close, but a close with
  code `1008` (server-side unauthorized) redirects to `/login` instead of retrying.
- `Dialog.tsx` is the shared shell (backdrop click, Escape, icon + title header, optional footer) behind
  `DeviceInfoDialog`, `PingInfoDialog`, `ConfirmDialog` and `LogsDialog`. `ConfirmDialog` guards FORCE POWER OFF
  and closes itself *before* running the action, so the dot wave on the page is visible immediately.
- Icons are Phosphor duotone; the weight is set once via `IconContext.Provider` in `Root.tsx`. State colors are
  emerald (on), rose (off) and indigo (unknown/waiting, matching the power button's glow).
- The dot wave behind a power command (`.power-blink-wrap` / `.power-blink-overlay` in `index.css`) loops for as
  long as the request is in flight: the wrapper owns the fade in/out, the inner element the looping sweep, so the
  two never fight when the command settles.
- Tailwind v4 is configured CSS-first (no `tailwind.config.js`); theme tokens (fonts, custom `shimmer` animation)
  live in `@theme`/`@keyframes` blocks in `src/index.css`.
- `vite.config.ts` sets `build.outDir` to `../server/public` and proxies `/status`, `/power`, `/login`, `/ws` to
  `localhost:3050` in dev. The frontend is meant to be built and served by the Bun server, not run standalone in
  production.
