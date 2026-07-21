import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import type { ServerWebSocket } from "bun";
import { deviceState } from "./device-state";

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const TOKEN = process.env.AUTH_TOKEN;
if (!TOKEN) {
  throw new Error("AUTH_TOKEN env var must be set");
}

const UI_PASSWORD = process.env.UI_PASSWORD;
if (!UI_PASSWORD) {
  throw new Error("UI_PASSWORD env var must be set");
}

// Reuse AUTH_TOKEN as the cookie-signing secret; it's already a private, random value.
const SESSION_SECRET = TOKEN;
const SESSION_COOKIE = "powerr_session";
const SESSION_VALUE = "ok";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const MIN_HOLD_MS = 50;
const MAX_HOLD_MS = 10_000;
const DEFAULT_HOLD_MS = 500;
const FORCE_HOLD_MS = 8_000;
const POWER_COOLDOWN_MS = 5_000;
let lastPowerTriggerAt = 0;

const app = new Hono();

function isAuthorized(token: string | undefined | null): boolean {
  return typeof token === "string" && token.length > 0 && token === TOKEN;
}

async function hasValidSession(c: Context): Promise<boolean> {
  const session = await getSignedCookie(c, SESSION_SECRET, SESSION_COOKIE);
  return session === SESSION_VALUE;
}

// Accepts either the device/API bearer token or a logged-in browser session.
const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (isAuthorized(bearer) || (await hasValidSession(c))) {
    await next();
    return;
  }
  return c.json({ error: "unauthorized" }, 401);
};

app.use("/status", requireAuth);
app.use("/power", requireAuth);

app.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = (body as Record<string, unknown>)?.password;

  if (typeof password !== "string" || password !== UI_PASSWORD) {
    return c.json({ error: "invalid password" }, 401);
  }

  await setSignedCookie(c, SESSION_COOKIE, SESSION_VALUE, SESSION_SECRET, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: c.req.url.startsWith("https:"),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return c.json({ ok: true });
});

app.get("/status", (c) => c.json(deviceState.getStatus()));

app.post("/power", async (c) => {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // no body / not JSON is fine, use defaults
  }

  const rawHoldMs = (body as Record<string, unknown>)?.holdMs;
  const rawMode = (body as Record<string, unknown>)?.mode;
  const mode = rawMode === "force" ? "force" : "standard";
  let holdMs = mode === "force" ? FORCE_HOLD_MS : DEFAULT_HOLD_MS;
  if (rawHoldMs !== undefined) {
    const parsed = Number(rawHoldMs);
    if (!Number.isFinite(parsed)) {
      return c.json({ error: "holdMs must be a number" }, 400);
    }
    if (parsed < MIN_HOLD_MS || parsed > MAX_HOLD_MS) {
      return c.json({ error: `holdMs must be between ${MIN_HOLD_MS} and ${MAX_HOLD_MS}` }, 400);
    }
    holdMs = parsed;
  }

  const sinceLastTrigger = Date.now() - lastPowerTriggerAt;
  if (sinceLastTrigger < POWER_COOLDOWN_MS) {
    const retryAfterMs = POWER_COOLDOWN_MS - sinceLastTrigger;
    c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return c.json(
      { error: `wait ${Math.ceil(retryAfterMs / 1000)}s before triggering power again`, retryAfterMs },
      429
    );
  }
  lastPowerTriggerAt = Date.now();

  if (!deviceState.isConnected) {
    return c.json({ error: "device not connected" }, 503);
  }

  const result = await deviceState.sendPowerCommand(holdMs);
  if (!result.ok) {
    return c.json({ error: result.error ?? "unknown error" }, 502);
  }

  return c.json({ ok: true, holdMs, mode });
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const token = c.req.query("token");
    // Bun upgrades the connection before this factory runs, so an
    // unauthorized client is accepted then closed immediately in onOpen.
    return {
      onOpen: (_event, ws) => {
        if (!isAuthorized(token)) {
          ws.close(1008, "unauthorized");
          return;
        }
        deviceState.connect(ws.raw as ServerWebSocket);
        console.log("device connected");
      },
      onMessage: (event) => {
        deviceState.handleMessage(event.data.toString());
      },
      onClose: (_event, ws) => {
        deviceState.disconnect(ws.raw as ServerWebSocket);
        console.log("device disconnected");
      },
    };
  })
);

app.get(
  "/ws/status",
  upgradeWebSocket(async (c) => {
    const token = c.req.query("token");
    const authorized = isAuthorized(token) || (await hasValidSession(c));
    return {
      onOpen: (_event, ws) => {
        if (!authorized) {
          ws.close(1008, "unauthorized");
          return;
        }
        deviceState.subscribeStatus(ws.raw as ServerWebSocket);
      },
      onClose: (_event, ws) => {
        deviceState.unsubscribeStatus(ws.raw as ServerWebSocket);
      },
    };
  })
);

// SPA gate: bare "/" redirects to the login page unless a session cookie is present.
app.get("/", async (c, next) => {
  if (!(await hasValidSession(c))) {
    return c.redirect("/login");
  }
  await next();
});

app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 3050);
console.log(`server listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
