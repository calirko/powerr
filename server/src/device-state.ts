import type { ServerWebSocket } from "bun";
import type { DeviceStatus, DeviceToServerMessage, ServerToDeviceMessage } from "./types";
import { prisma } from "./db";

type PendingAck = {
  resolve: (ok: boolean, error?: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

// Device is considered offline if we haven't heard a ping/message in this long.
// Firmware heartbeats every HEARTBEAT_INTERVAL_MS (3s); this allows a couple
// of missed beats before flagging it stale.
const STALE_AFTER_MS = 8_000;
const STALE_CHECK_INTERVAL_MS = 2_000;

class DeviceState {
  private socket: ServerWebSocket<unknown> | null = null;
  private lastSeen: number | null = null;
  private pending = new Map<string, PendingAck>();
  private statusSubscribers = new Set<ServerWebSocket<unknown>>();
  private lastBroadcastConnected = false;
  private pcPoweredOn: boolean | null = null;
  private ledOn: boolean | null = null;
  private hddLedOn: boolean | null = null;

  constructor() {
    setInterval(() => this.checkStaleness(), STALE_CHECK_INTERVAL_MS);
  }

  connect(ws: ServerWebSocket<unknown>) {
    this.socket?.close(1000, "replaced by new connection");
    this.socket = ws;
    this.lastSeen = Date.now();
    this.broadcastStatus();
  }

  disconnect(ws: ServerWebSocket<unknown>) {
    if (this.socket === ws) {
      this.socket = null;
      // No longer trustworthy once the device that was probing it is gone.
      this.pcPoweredOn = null;
      this.ledOn = null;
      this.hddLedOn = null;
    }
    this.broadcastStatus();
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
      prisma.powerEvent
        .create({ data: { source: "button", pressed: msg.pressed } })
        .catch((err) => console.error("failed to log button event", err));
      return;
    }

    if (msg.type === "pc_status") {
      if (msg.poweredOn !== this.pcPoweredOn) {
        this.pcPoweredOn = msg.poweredOn;
      }
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
  async sendPowerCommand(holdMs: number, timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
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

    await prisma.powerEvent
      .create({ data: { source: "remote", holdMs, ok: result.ok, error: result.error } })
      .catch((err) => console.error("failed to log remote power event", err));

    return result;
  }
}

export const deviceState = new DeviceState();
