export type ServerToDeviceMessage =
  | { type: "power"; id: string; holdMs: number }
  | { type: "pong" };

export type DeviceToServerMessage =
  | { type: "ping" }
  | { type: "ack"; id: string; ok: boolean; error?: string }
  | { type: "button"; pressed: boolean }
  | { type: "pc_status"; poweredOn: boolean }
  | { type: "gpio_status"; ledOn: boolean; hddLedOn: boolean };

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
};

export type PowerEventLog = {
  id: number;
  source: string;
  holdMs: number | null;
  pressed: boolean | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
};
