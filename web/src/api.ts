export class ApiError extends Error {
  retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export function statusWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/status`;
}

export async function triggerPower(holdMs: number): Promise<void> {
  const res = await fetch("/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdMs }),
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
