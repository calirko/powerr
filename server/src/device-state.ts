import type { ServerWebSocket } from "bun";
import type { DeviceInfo, DeviceStatus, DeviceToServerMessage, PingSummary, ServerToDeviceMessage } from "./types";
import { prisma } from "./db";
import {
  deviceConfigMessage,
  PC_HOST_IP,
  PC_PING_COUNT,
  PC_PING_INTERVAL_MS,
  STALE_AFTER_MS,
  STALE_CHECK_INTERVAL_MS,
} from "./device-config";

type PendingAck = {
  resolve: (ok: boolean, error?: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

class DeviceState {
  private socket: ServerWebSocket<unknown> | null = null;
  private lastSeen: number | null = null;
  private pending = new Map<string, PendingAck>();
  private statusSubscribers = new Set<ServerWebSocket<unknown>>();
  private lastBroadcastConnected = false;
  private pcPoweredOn: boolean | null = null;
  private ledOn: boolean | null = null;
  private hddLedOn: boolean | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private ping: PingSummary | null = null;

  constructor() {
    setInterval(() => this.checkStaleness(), STALE_CHECK_INTERVAL_MS);
  }

  connect(ws: ServerWebSocket<unknown>) {
    this.socket?.close(1000, "replaced by new connection");
    this.socket = ws;
    this.lastSeen = Date.now();
    ws.send(JSON.stringify(deviceConfigMessage()));
    this.logEvent({ source: "device", kind: "connected" });
    this.broadcastStatus();
  }

  disconnect(ws: ServerWebSocket<unknown>) {
    // A socket that was already replaced by a newer one isn't a disconnect of
    // the live device, so it neither clears state nor gets logged.
    if (this.socket === ws) {
      this.socket = null;
      // No longer trustworthy once the device that was probing it is gone.
      this.pcPoweredOn = null;
      this.ledOn = null;
      this.hddLedOn = null;
      this.deviceInfo = null;
      this.ping = null;
      this.logEvent({ source: "device", kind: "disconnected" });
    }
    this.broadcastStatus();
  }

  /** Fire-and-forget row in the PowerEvent log; never blocks the caller. */
  private logEvent(data: {
    source: string;
    kind: string;
    holdMs?: number;
    pressed?: boolean;
    ok?: boolean;
    error?: string;
  }) {
    prisma.powerEvent
      .create({ data })
      .catch((err) => console.error(`failed to log ${data.source}/${data.kind} event`, err));
  }

  private checkStaleness() {
    if (this.getStatus().connected !== this.lastBroadcastConnected) {
      this.broadcastStatus();
    }
  }

  subscribeStatus(ws: ServerWebSocket<unknown>) {
    this.statusSubscribers.add(ws);
    ws.send(JSON.stringify({ type: "status", ...this.getStatus() }));
  }

  unsubscribeStatus(ws: ServerWebSocket<unknown>) {
    this.statusSubscribers.delete(ws);
  }

  private broadcastStatus() {
    const status = this.getStatus();
    this.lastBroadcastConnected = status.connected;
    const payload = JSON.stringify({ type: "status", ...status });
    for (const ws of this.statusSubscribers) {
      ws.send(payload);
    }
  }

  getStatus(): DeviceStatus {
    const stale = this.lastSeen === null || Date.now() - this.lastSeen >= STALE_AFTER_MS;
    return {
      connected: this.socket !== null && !stale,
      lastSeenAt: this.lastSeen ? new Date(this.lastSeen).toISOString() : null,
      pcPoweredOn: this.pcPoweredOn,
      ledOn: this.ledOn,
      hddLedOn: this.hddLedOn,
      device: this.deviceInfo,
      ping: this.ping,
    };
  }

  get isConnected() {
    return this.socket !== null;
  }

  handleMessage(raw: string) {
    let msg: DeviceToServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    this.lastSeen = Date.now();

    if (msg.type === "ping") {
      this.broadcastStatus();
      this.socket?.send(JSON.stringify({ type: "pong" } satisfies ServerToDeviceMessage));
      return;
    }

    if (msg.type === "ack") {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);
        pending.resolve(msg.ok, msg.error);
      }
      return;
    }

    if (msg.type === "button") {
      this.logEvent({
        source: "button",
        kind: msg.pressed ? "press" : "release",
        pressed: msg.pressed,
      });
      return;
    }

    if (msg.type === "pc_status") {
      // A first reading after (re)connect says nothing about a transition:
      // the machine may well have been in that state all along, so only a
      // change from a known previous state is worth a log row.
      if (this.pcPoweredOn !== null && msg.poweredOn !== this.pcPoweredOn) {
        this.logEvent({ source: "pc", kind: msg.poweredOn ? "on" : "off" });
      }
      this.pcPoweredOn = msg.poweredOn;

      const sent = msg.sent ?? PC_PING_COUNT;
      const received = msg.received ?? (msg.poweredOn ? 1 : 0);
      this.ping = {
        host: PC_HOST_IP,
        intervalMs: PC_PING_INTERVAL_MS,
        packetsPerCheck: PC_PING_COUNT,
        lastCheckedAt: new Date().toISOString(),
        poweredOn: msg.poweredOn,
        sent,
        received,
        lossPercent: sent > 0 ? Math.round(((sent - received) / sent) * 100) : 0,
        replyMs: msg.replyMs && msg.replyMs > 0 ? msg.replyMs : null,
      };
    }

    if (msg.type === "device_info") {
      const { type: _type, ...report } = msg;
      this.deviceInfo = { ...report, reportedAt: new Date().toISOString() };
    }

    if (msg.type === "gpio_status") {
      if (msg.ledOn !== this.ledOn || msg.hddLedOn !== this.hddLedOn) {
        this.ledOn = msg.ledOn;
        this.hddLedOn = msg.hddLedOn;
      }
    }

    this.broadcastStatus();
  }

  /** Sends a power command to the device and waits for an ack (or times out). */
  // The firmware acks only after releasing the relay, so the timeout has to cover the hold itself.
  async sendPowerCommand(holdMs: number, ackGraceMs = 5000): Promise<{ ok: boolean; error?: string }> {
    const timeoutMs = holdMs + ackGraceMs;
    if (!this.socket) {
      return { ok: false, error: "device not connected" };
    }

    const id = crypto.randomUUID();
    const message: ServerToDeviceMessage = { type: "power", id, holdMs };

    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "timed out waiting for device ack" });
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (ok, error) => resolve({ ok, error }),
        timeout,
      });

      this.socket!.send(JSON.stringify(message));
    });

    this.logEvent({ source: "remote", kind: "pulse", holdMs, ok: result.ok, error: result.error });

    return result;
  }
}

export const deviceState = new DeviceState();
