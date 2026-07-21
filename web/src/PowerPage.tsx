import { useEffect, useState } from "react";
import { useDeviceStatus } from "./useDeviceStatus";
import { ApiError, triggerPower } from "./api";

const HOLD_MS = 500;
const DEFAULT_ERROR_SECONDS = 4;

type DotState = "on" | "off" | "unknown";

function StatusDot({ state }: { state: DotState }) {
  const color =
    state === "on" ? "bg-emerald-400" : state === "off" ? "bg-rose-500/70" : "bg-amber-400/70";

  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      {state === "on" && <span className="animate-glow absolute h-2 w-2 rounded-full bg-emerald-400 blur-[3px]" />}
      {state === "unknown" && <span className="absolute h-2 w-2 animate-pulse rounded-full bg-amber-400/50" />}
      <span className={`state-transition relative h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export default function PowerPage() {
  const status = useDeviceStatus();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Ticks the countdown down once a second; the message disappears at 0.
  useEffect(() => {
    if (!error) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [error]);

  useEffect(() => {
    if (error && secondsLeft === 0) {
      setError(null);
    }
  }, [error, secondsLeft]);

  async function handlePress() {
    setPending(true);
    setError(null);
    try {
      await triggerPower(HOLD_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to trigger power";
      const retrySeconds = err instanceof ApiError && err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : null;
      setError(message);
      setSecondsLeft(retrySeconds ?? DEFAULT_ERROR_SECONDS);
    } finally {
      setPending(false);
    }
  }

  const pcState: DotState = status.pcPoweredOn === null ? "unknown" : status.pcPoweredOn ? "on" : "off";
  const espState: DotState = status.connected ? "on" : "off";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 p-4">
      <h1 className="font-display text-2xl tracking-tight">powerr</h1>

      <div className="flex flex-col items-center gap-2 text-sm text-neutral-500">
        <div className="flex items-center gap-2">
          <StatusDot state={espState} />
          <span className="state-transition">ESP32 {status.connected ? "connected" : "disconnected"}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot state={pcState} />
          <span className="state-transition">
            PC {status.pcPoweredOn === null ? "unknown" : status.pcPoweredOn ? "on" : "off"}
          </span>
        </div>
      </div>

      <button
        onClick={handlePress}
        disabled={pending || !status.connected}
        className={`state-transition group relative flex h-40 w-40 items-center justify-center rounded-full ${
          !pending && !status.connected ? "opacity-40" : "opacity-100"
        }`}
      >
        {/* ambient glow behind the button */}
        <span
          className={`state-transition absolute inset-0 -z-10 rounded-full blur-2xl ${
            status.connected ? "bg-indigo-500/30" : "bg-neutral-700/10"
          }`}
        />

        {/* button body */}
        <span
          className={`state-transition absolute inset-0 rounded-full border bg-gradient-to-b from-neutral-800 to-neutral-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.5)] group-active:scale-95 ${
            status.connected ? "border-indigo-400/40" : "border-neutral-800"
          }`}
        />

        {pending && (
          <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
            <span className="animate-shimmer absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </span>
        )}

        <span className="relative z-10 flex flex-col items-center gap-2 text-neutral-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
          >
            <path d="M12 2v8" />
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          </svg>
          <span className="font-display text-sm tracking-wide">POWER</span>
        </span>
      </button>

      <div className="flex h-10 flex-col items-center justify-start gap-1">
        <p
          className={`state-transition text-sm text-red-400 ${error ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          {error ? `${error} (${secondsLeft})` : " "}
        </p>
        <p className="state-transition text-xs text-neutral-600">
          {status.lastSeenAt ? `last seen ${new Date(status.lastSeenAt).toLocaleString()}` : " "}
        </p>
      </div>
    </main>
  );
}
