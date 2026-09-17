export type ServerToDeviceMessage =
  | { type: "power"; id: string; holdMs: number }
  | { type: "pong" }
  | {
      type: "config";
      pcHostIp: string | null;
      pcPingIntervalMs: number;
      pcPingCount: number;
      heartbeatIntervalMs: number;
      longHoldThresholdMs: number;
    };

export type DeviceToServerMessage =
  | { type: "ping" }
  | { type: "ack"; id: string; ok: boolean; error?: string }
  | { type: "button"; pressed: boolean }
  | {
      type: "pc_status";
      poweredOn: boolean;
      // Per-probe ICMP stats. Older firmware omits them.
      sent?: number;
      received?: number;
      replyMs?: number;
    }
  | { type: "gpio_status"; ledOn: boolean; hddLedOn: boolean }
  | ({ type: "device_info" } & DeviceInfoReport);

// The board's own snapshot, resent on a slow timer while connected. Nothing here
// drives behaviour; it exists for the ESP32 dialog in the UI.
export type DeviceInfoReport = {
  ssid: string;
  rssi: number;
  channel: number;
  ip: string;
  mac: string;
  hostname: string;
  uptimeMs: number;
  freeHeapBytes: number;
  heapSizeBytes: number;
  chipModel: string;
  chipCores: number;
  cpuFreqMhz: number;
  sdkVersion: string;
  temperatureC: number;
};

export type DeviceInfo = DeviceInfoReport & {
  // When the server received this snapshot, so the UI can age it.
  reportedAt: string;
};

// Last completed ICMP probe of the PC, plus the settings it ran with.
export type PingSummary = {
  host: string | null;
  intervalMs: number;
  packetsPerCheck: number;
  lastCheckedAt: string;
  poweredOn: boolean;
  sent: number;
  received: number;
  lossPercent: number;
  // Null when nothing replied (no round-trip to report).
  replyMs: number | null;
};

export type DeviceStatus = {
  connected: boolean;
  lastSeenAt: string | null;
  // Whether the PC itself (probed by the ESP32 over the LAN) is powered on.
  // null until the firmware reports its first reading.
  pcPoweredOn: boolean | null;
  // Current chassis LED state as sampled by the firmware.
  ledOn: boolean | null;
  // Current HDD activity LED state as sampled by the firmware.
  hddLedOn: boolean | null;
  // Board stats and last ping result, both null until the device reports them
  // and cleared whenever it drops (same reasoning as pcPoweredOn).
  device: DeviceInfo | null;
  ping: PingSummary | null;
};

export type PowerEventLog = {
  id: number;
  source: string;
  kind: string;
  holdMs: number | null;
  pressed: boolean | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
};
