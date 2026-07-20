import { useEffect, useState } from "react";
import { statusWsUrl } from "./api";

export type DeviceStatus = {
  connected: boolean;
  lastSeenAt: string | null;
  // Whether the PC itself (probed by the ESP32 over the LAN) is powered on.
  // null until the firmware reports its first reading.
  pcPoweredOn: boolean | null;
};

type StatusMessage = { type: "status" } & DeviceStatus;

const RECONNECT_DELAY_MS = 2000;

export function useDeviceStatus(): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>({ connected: false, lastSeenAt: null, pcPoweredOn: null });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      socket = new WebSocket(statusWsUrl());

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as StatusMessage;
        if (msg.type === "status") {
          setStatus({ connected: msg.connected, lastSeenAt: msg.lastSeenAt, pcPoweredOn: msg.pcPoweredOn });
        }
      };

      socket.onclose = (event) => {
        setStatus((prev) => ({ ...prev, connected: false }));
        if (event.code === 1008) {
          window.location.replace("/login");
          return;
        }
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return status;
}
