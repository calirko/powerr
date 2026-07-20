# powerr

Remotely trigger a PC's power button over the internet.

An ESP32 wired to a relay across the motherboard's power-switch header stays connected to a small
Bun/Hono server over WebSocket. A React frontend (served by that same server) lets you trigger a
power pulse from anywhere, see whether the ESP32 is online, and see whether the PC itself is powered
on (probed by the ESP32 over the LAN).

## Structure

- `firmware/` — ESP32 firmware (PlatformIO, Arduino framework). Mirrors the physical case button to
  the relay and listens for remote power commands.
- `server/` — Bun + Hono + Prisma server. Holds the WebSocket connection to the ESP32, exposes
  `/power` and `/status`/`/ws/status` for the frontend, and logs power events to SQLite.
- `web/` — Vite + React + Tailwind frontend, built directly into `server/public`.

Each package has its own dependencies and is built/run independently — see each directory for setup.

## Running

```
cd server && bun install && bun run dev
cd web && bun install && bun run build   # outputs into server/public
```

Copy `server/.env.example` to `server/.env` and `firmware/include/secrets.h.example` to
`firmware/include/secrets.h` and fill in the required values before running.

A `Dockerfile` and `docker-compose.yml` are included for running the server in production.
