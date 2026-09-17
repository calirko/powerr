import type { ServerToDeviceMessage } from "./types";

// Runtime settings pushed to the ESP32 on every connect, so changing them only
// needs a server restart (the device reconnects and picks them up), not a reflash.

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function ipEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
    throw new Error(`${name} must be an IPv4 address`);
  }
  return raw;
}

// LAN IP of the PC's NIC the device ICMP-probes. Unset disables the probe.
export const PC_HOST_IP = ipEnv("PC_HOST_IP");
export const PC_PING_INTERVAL_MS = intEnv("PC_PING_INTERVAL_MS", 5_000, 1_000, 600_000);
// Any reply out of this many counts as powered on (the first ping often misses on ARP).
export const PC_PING_COUNT = intEnv("PC_PING_COUNT", 4, 1, 20);
export const HEARTBEAT_INTERVAL_MS = intEnv("HEARTBEAT_INTERVAL_MS", 3_000, 500, 60_000);
// Holds at or above this are shown as a "long press" by the device's status LED.
export const LONG_HOLD_THRESHOLD_MS = intEnv("LONG_HOLD_THRESHOLD_MS", 2_000, 100, 60_000);

// Derived from the heartbeat so the two can't drift apart: a couple of missed beats = stale.
export const STALE_AFTER_MS = Math.round(HEARTBEAT_INTERVAL_MS * 2.7);
export const STALE_CHECK_INTERVAL_MS = Math.max(500, Math.round(HEARTBEAT_INTERVAL_MS * 2 / 3));

export function deviceConfigMessage(): ServerToDeviceMessage {
  return {
    type: "config",
    pcHostIp: PC_HOST_IP,
    pcPingIntervalMs: PC_PING_INTERVAL_MS,
    pcPingCount: PC_PING_COUNT,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    longHoldThresholdMs: LONG_HOLD_THRESHOLD_MS,
  };
}
