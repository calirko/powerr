export type ServerToDeviceMessage =
  | { type: "power"; id: string; holdMs: number }
  | { type: "pong" };

export type DeviceToServerMessage =
  | { type: "ping" }
  | { type: "ack"; id: string; ok: boolean; error?: string }
  | { type: "button"; pressed: boolean }
  | { type: "pc_status"; poweredOn: boolean };

export type DeviceStatus = {
  connected: boolean;
  lastSeenAt: string | null;
  // Whether the PC itself (probed by the ESP32 over the LAN) is powered on.
  // null until the firmware reports its first reading.
  pcPoweredOn: boolean | null;
};
