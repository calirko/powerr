import {
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  CpuIcon,
  HardDrivesIcon,
  type Icon,
  LightbulbIcon,
  PowerIcon,
  PulseIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ApiError, fetchPowerLogs, triggerPower, type PowerEventLog } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import DeviceInfoDialog from "./DeviceInfoDialog";
import Logo from "./Logo";
import LogsDialog, { type LogFilter } from "./LogsDialog";
import PingInfoDialog from "./PingInfoDialog";
import { useDeviceStatus } from "./useDeviceStatus";
import {
  dangerButtonClass,
  frameClass,
  pageShellClass,
  panelClass,
  secondaryButtonClass,
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
  icon: Icon;
  /** Present on rows that open a details dialog; those render as buttons. */
  onClick?: () => void;
};

function StatusRow({ label, state, detail, icon: RowIcon, onClick }: StatusRowProps) {
  const iconColor = state === "on" ? "text-emerald-300" : state === "off" ? "text-rose-300" : "text-indigo-300";

  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5">
        <RowIcon className={`state-transition size-5 ${iconColor}`} />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="font-display text-sm tracking-wide text-neutral-100">{label}</p>
        <p className="text-xs text-neutral-400">{detail}</p>
      </div>
      <StatusDot state={state} />
      {onClick && <CaretRightIcon className="size-4 shrink-0 text-neutral-600" />}
    </>
  );

  if (!onClick) {
    return <div className={`${panelClass} flex items-center gap-3`}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} details`}
      className={`${panelClass} flex items-center gap-3 transition hover:border-white/20 hover:bg-white/10 active:scale-[0.99]`}
    >
      {body}
    </button>
  );
}

function StatusDot({ state }: { state: DotState }) {
  const color = state === "on" ? "bg-emerald-400" : state === "off" ? "bg-rose-500/70" : "bg-indigo-400/70";

  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      {state === "on" && <span className="animate-glow absolute h-2 w-2 rounded-xl bg-emerald-400 blur-[3px]" />}
      {state === "unknown" && <span className="absolute h-2 w-2 animate-pulse rounded-xl bg-indigo-400/50" />}
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
      : "rounded-[2rem] bg-neutral-900 px-4 py-3 font-medium text-neutral-100 shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition enabled:hover:brightness-110 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";

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
            disabled ? "border-neutral-800 from-neutral-900 to-neutral-950" : "border-white/10 from-neutral-800 to-neutral-900"
          }`}
        />
      )}
      {pending && <span className="dot-sweep rounded-[2rem]" data-tone={tone} />}

      {tone === "primary" ? (
        <>
          <span className={`state-transition relative z-10 flex flex-col items-center gap-2 ${disabled ? "text-neutral-600" : "text-neutral-100"}`}>
            <PowerIcon className="size-8" />
            <span className="font-display text-sm tracking-wide">{label}</span>
          </span>
          <span className="relative z-10 text-xs text-neutral-400">{helper}</span>
        </>
      ) : (
        <>
          <WarningIcon className={`relative z-10 size-8 ${disabled ? "text-rose-200/40" : "text-rose-200"}`} />
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
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<PowerEventLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [pingOpen, setPingOpen] = useState(false);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [blink, setBlink] = useState<{ key: number; mode: PowerMode; phase: "running" | "ending" } | null>(null);

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

  useEffect(() => {
    if (!logsOpen) return;

    let cancelled = false;
    setLogsLoading(true);
    setLogsError(null);

    fetchPowerLogs()
      .then((response) => {
        if (!cancelled) {
          setLogs(response.items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLogsError(err instanceof Error ? err.message : "failed to load logs");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLogsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [logsOpen]);

  async function handlePress(mode: PowerMode) {
    setBlink({ key: Date.now(), mode, phase: "running" });
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
      // The dot wave loops for as long as the command is in flight; let it fade out from here.
      setBlink((current) => (current ? { ...current, phase: "ending" } : null));
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
      {blink && (
        <div
          key={blink.key}
          aria-hidden
          data-phase={blink.phase}
          data-tone={blink.mode === "force" ? "danger" : undefined}
          className="power-blink-wrap"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && blink.phase === "ending") {
              setBlink(null);
            }
          }}
        >
          <div className="power-blink-overlay" />
        </div>
      )}
      <section className={`${frameClass} flex w-full flex-col gap-6`}>
        <div className="space-y-2 text-center">
          <h1 className={`${titleClass} flex items-center justify-center gap-2.5`}>
            <Logo className="size-6" />
            powerr
          </h1>
          <p className={subtitleClass}>Realtime device, ping, and front-panel indicator status.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatusRow
            label="ESP32 link"
            state={espState}
            detail={status.connected ? "connected to server" : "offline"}
            icon={CpuIcon}
            onClick={() => setDeviceOpen(true)}
          />
          <StatusRow
            label="IP ping status"
            state={pcState}
            detail={status.pcPoweredOn === null ? "waiting for first ping" : status.pcPoweredOn ? "responding" : "no response"}
            icon={PulseIcon}
            onClick={() => setPingOpen(true)}
          />
          <StatusRow
            label="LED status"
            state={ledState}
            detail={status.ledOn === null ? "waiting for first sample" : status.ledOn ? "on" : "off"}
            icon={LightbulbIcon}
          />
          <StatusRow
            label="HDD LED status"
            state={hddLedState}
            detail={status.hddLedOn === null ? "waiting for first sample" : status.hddLedOn ? "on" : "off"}
            icon={HardDrivesIcon}
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
            onClick={() => setForceConfirmOpen(true)}
          />
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setLogsOpen(true)}
            className={`${secondaryButtonClass} inline-flex items-center gap-2`}
          >
            <ClockCounterClockwiseIcon className="size-4" />
            View logs
          </button>
        </div>

        <div className="flex h-10 flex-col items-center justify-start gap-1">
          <p className={`state-transition text-sm text-red-400 ${error ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            {error ? `${error} (${secondsLeft})` : " "}
          </p>
          <p className="state-transition text-xs text-neutral-600">
            {status.lastSeenAt ? `last seen ${new Date(status.lastSeenAt).toLocaleString()}` : " "}
          </p>
        </div>
      </section>

      <DeviceInfoDialog
        open={deviceOpen}
        onClose={() => setDeviceOpen(false)}
        device={status.device}
        connected={status.connected}
      />

      <PingInfoDialog open={pingOpen} onClose={() => setPingOpen(false)} ping={status.ping} connected={status.connected} />

      <ConfirmDialog
        open={forceConfirmOpen}
        onClose={() => setForceConfirmOpen(false)}
        onConfirm={() => handlePress("force")}
        title="Force power off?"
        body={`This holds the power button for ${FORCE_HOLD_MS / 1000} seconds, which cuts power the way holding the physical button does. The OS gets no chance to shut down cleanly, so unsaved work is lost.`}
        confirmLabel="Force power off"
      />

      <LogsDialog
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        logs={logs}
        loading={logsLoading}
        error={logsError}
        filter={logFilter}
        onFilterChange={setLogFilter}
      />
    </main>
  );
}
