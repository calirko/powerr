import { useEffect, useState } from "react";
import { ApiError, triggerPower } from "./api";
import { useDeviceStatus } from "./useDeviceStatus";
import {
  dangerButtonClass,
  frameClass,
  pageShellClass,
  panelClass,
  subtitleClass,
  titleClass,
} from "./ui";

const NORMAL_HOLD_MS = 500;
const FORCE_HOLD_MS = 8_000;
const DEFAULT_ERROR_SECONDS = 4;

type DotState = "on" | "off" | "unknown";
type PowerMode = "standard" | "force";

type StatusRowProps = {
  label: string;
  state: DotState;
  detail: string;
};

function StatusRow({ label, state, detail }: StatusRowProps) {
  return (
    <div className={`${panelClass} flex items-start gap-3`}>
      <StatusDot state={state} />
      <div className="min-w-0">
        <p className="font-display text-sm tracking-wide text-neutral-100">{label}</p>
        <p className="text-xs text-neutral-400">{detail}</p>
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: DotState }) {
  const color = state === "on" ? "bg-emerald-400" : state === "off" ? "bg-rose-500/70" : "bg-amber-400/70";

  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      {state === "on" && <span className="animate-glow absolute h-2 w-2 rounded-xl bg-emerald-400 blur-[3px]" />}
      {state === "unknown" && <span className="absolute h-2 w-2 animate-pulse rounded-xl bg-amber-400/50" />}
      <span className={`state-transition relative h-2 w-2 rounded-xl ${color}`} />
    </span>
  );
}

function PowerActionButton({
  disabled,
  pending,
  label,
  helper,
  tone,
  onClick,
}: {
  disabled: boolean;
  pending: boolean;
  label: string;
  helper: string;
  tone: "primary" | "danger";
  onClick: () => void;
}) {
  const baseClass =
    tone === "danger"
      ? `${dangerButtonClass} text-center`
      : "rounded-[2rem] border border-white/10 bg-gradient-to-b from-neutral-100 to-neutral-300 px-4 py-3 font-medium text-neutral-950 shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition enabled:hover:brightness-105 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} state-transition relative flex h-40 flex-1 flex-col items-center justify-center gap-2 overflow-hidden rounded-[2rem] ${
        disabled ? "" : "active:scale-[0.99]"
      }`}
      type="button"
    >
      {tone === "primary" && (
        <span
          className={`state-transition absolute inset-0 -z-10 rounded-[2rem] blur-2xl ${
            disabled ? "bg-neutral-700/10" : "bg-indigo-500/30"
          }`}
        />
      )}
      {tone === "primary" && (
        <span
          className={`state-transition absolute inset-0 rounded-[2rem] border bg-gradient-to-b shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_30px_rgba(0,0,0,0.45)] ${
            disabled ? "border-neutral-800 from-neutral-900 to-neutral-950" : "border-indigo-400/40 from-neutral-800 to-neutral-900"
          }`}
        />
      )}
      {tone === "primary" && pending && (
        <span className="animate-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-[2rem] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      )}

      {tone === "primary" ? (
        <>
          <span className={`state-transition relative z-10 flex flex-col items-center gap-2 ${disabled ? "text-neutral-600" : "text-neutral-100"}`}>
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
            <span className="font-display text-sm tracking-wide">{label}</span>
          </span>
          <span className="relative z-10 text-xs text-neutral-400">{helper}</span>
        </>
      ) : (
        <>
          <span className="relative z-10 font-display text-sm tracking-wide text-rose-100">{label}</span>
          <span className="relative z-10 max-w-[14rem] text-xs leading-5 text-rose-100/75">{helper}</span>
          {pending && <span className="relative z-10 text-xs uppercase tracking-[0.24em] text-rose-100/80">Sending</span>}
        </>
      )}
    </button>
  );
}

export default function PowerPage() {
  const status = useDeviceStatus();
  const [pendingAction, setPendingAction] = useState<PowerMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

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

  async function handlePress(mode: PowerMode) {
    setPendingAction(mode);
    setError(null);
    try {
      await triggerPower(mode === "force" ? FORCE_HOLD_MS : NORMAL_HOLD_MS, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to trigger power";
      const retrySeconds = err instanceof ApiError && err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : null;
      setError(message);
      setSecondsLeft(retrySeconds ?? DEFAULT_ERROR_SECONDS);
    } finally {
      setPendingAction(null);
    }
  }

  const pcState: DotState = status.pcPoweredOn === null ? "unknown" : status.pcPoweredOn ? "on" : "off";
  const ledState: DotState = status.ledOn === null ? "unknown" : status.ledOn ? "on" : "off";
  const hddLedState: DotState = status.hddLedOn === null ? "unknown" : status.hddLedOn ? "on" : "off";
  const espState: DotState = status.connected ? "on" : "off";
  const isBusy = pendingAction !== null;
  const canTrigger = status.connected && !isBusy;

  return (
    <main className={pageShellClass}>
      <section className={`${frameClass} flex w-full flex-col gap-6`}>
        <div className="space-y-2 text-center">
          <h1 className={titleClass}>powerr</h1>
          <p className={subtitleClass}>Realtime device, ping, and front-panel indicator status.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatusRow label="ESP32 link" state={espState} detail={status.connected ? "connected to server" : "offline"} />
          <StatusRow
            label="IP ping status"
            state={pcState}
            detail={status.pcPoweredOn === null ? "waiting for first ping" : status.pcPoweredOn ? "responding" : "no response"}
          />
          <StatusRow
            label="LED status"
            state={ledState}
            detail={status.ledOn === null ? "waiting for first sample" : status.ledOn ? "on" : "off"}
          />
          <StatusRow
            label="HDD LED status"
            state={hddLedState}
            detail={status.hddLedOn === null ? "waiting for first sample" : status.hddLedOn ? "on" : "off"}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <PowerActionButton
            disabled={!canTrigger}
            pending={pendingAction === "standard"}
            label="POWER"
            helper="Tap for a normal shutdown signal."
            tone="primary"
            onClick={() => handlePress("standard")}
          />
          <PowerActionButton
            disabled={!canTrigger}
            pending={pendingAction === "force"}
            label="FORCE POWER OFF"
            helper="Hold the power signal longer to force a shutdown."
            tone="danger"
            onClick={() => handlePress("force")}
          />
        </div>

        <div className="flex h-10 flex-col items-center justify-start gap-1">
          <p className={`state-transition text-sm text-red-400 ${error ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            {error ? `${error} (${secondsLeft})` : " "}
          </p>
          <p className="state-transition text-xs text-neutral-600">
            {status.lastSeenAt ? `last seen ${new Date(status.lastSeenAt).toLocaleString()}` : " "}
          </p>
        </div>
      </section>
    </main>
  );
}
