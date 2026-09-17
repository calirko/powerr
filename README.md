# powerr

Remotely trigger a PC's power button over the internet.

An ESP32 wired to a relay across the motherboard's power-switch header stays connected to a small
Bun/Hono server over WebSocket. A React frontend (served by that same server) lets you trigger a
power pulse from anywhere, see whether the ESP32 is online, and see whether the PC itself is powered
on (probed by the ESP32 over the LAN).

## Structure

- `firmware/`: ESP32 firmware (PlatformIO, Arduino framework). Mirrors the physical case button to
  the relay and listens for remote power commands.
- `server/`: Bun + Hono + Prisma server. Holds the WebSocket connection to the ESP32, exposes
  `/power` and `/status`/`/ws/status` for the frontend, and logs power events to SQLite.
- `web/`: Vite + React + Tailwind frontend, built directly into `server/public`.

Each package has its own dependencies and is built/run independently; see each directory for setup.

## Wiring

Pins use the XIAO ESP32-S3's silkscreen labels; the GPIO numbers are what the ESP32 actually
reports. Defined in `firmware/include/config.h`.

| Label | GPIO | Signal | Mode | Active | Notes |
| --- | --- | --- | --- | --- | --- |
| D0 | 1 | — | — | — | Intentionally unused |
| D1 | 2 | Relay | Output | High | Bridges the motherboard's power-switch header |
| D2 | 3 | Case power button | `INPUT_PULLUP` | Low | Wired to GND; mirrored raw to the relay, no debounce |
| D3 | 4 | Chassis power LED | `INPUT_PULLDOWN` | High | Read from the motherboard LED header through an optocoupler |
| D4 | 5 | HDD activity LED | `INPUT_PULLDOWN` | High | Same optocoupler arrangement as D3 |
| — | 21 | On-board user LED | Output | Low | Status indicator (`LED_BUILTIN`), see `firmware/include/status_led.h` |

The relay is energized if *either* the case button is held *or* a remote pulse is active. The LED
header inputs are read through optocouplers that switch 3V3 onto the GPIO, so they read HIGH while
the corresponding LED is lit.

## Running

```
cd server && bun install && bun run dev
cd web && bun install && bun run build   # outputs into server/public
```

Copy `server/.env.example` to `server/.env` and `firmware/include/secrets.h.example` to
`firmware/include/secrets.h` and fill in the required values before running.

A `Dockerfile` and `docker-compose.yml` are included for running the server in production.
