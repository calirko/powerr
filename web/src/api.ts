export class ApiError extends Error {
  retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export type PowerMode = "standard" | "force";

// Mirrors DeviceInfo / PingSummary in server/src/types.ts.
export type DeviceInfo = {
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
  reportedAt: string;
};

export type PingSummary = {
  host: string | null;
  intervalMs: number;
  packetsPerCheck: number;
  lastCheckedAt: string;
  poweredOn: boolean;
  sent: number;
  received: number;
  lossPercent: number;
  replyMs: number | null;
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

export type PowerLogResponse = {
  since: string;
  items: PowerEventLog[];
};

export function statusWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/status`;
}

export async function triggerPower(holdMs: number, mode: PowerMode = "standard"): Promise<void> {
  const res = await fetch("/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdMs, mode }),
  });

  if (res.status === 401) {
    window.location.replace("/login");
    return;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed with status ${res.status}`, body.retryAfterMs);
  }
}

export async function login(password: string): Promise<void> {
  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "invalid password");
  }
}

export async function checkSession(): Promise<boolean> {
  const res = await fetch("/status");
  return res.ok;
}

export async function fetchPowerLogs(): Promise<PowerLogResponse> {
  const res = await fetch("/logs");

  if (res.status === 401) {
    window.location.replace("/login");
    return { since: new Date().toISOString(), items: [] };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }

  return (await res.json()) as PowerLogResponse;
}
