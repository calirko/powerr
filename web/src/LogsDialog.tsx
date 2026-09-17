import {
  BroadcastIcon,
  ClockCounterClockwiseIcon,
  DesktopTowerIcon,
  HandTapIcon,
  type Icon,
  PlugsConnectedIcon,
  PlugsIcon,
  QuestionIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import Dialog from "./Dialog";
import type { PowerEventLog } from "./api";
import { panelClass, secondaryButtonClass } from "./ui";

export type LogFilter = "all" | "remote" | "button" | "device" | "pc";

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "remote", label: "Remote" },
  { value: "button", label: "Button" },
  { value: "device", label: "ESP32" },
  { value: "pc", label: "PC" },
];

type Tone = "neutral" | "green" | "red" | "indigo";

function LogBadge({ children, tone = "neutral" }: { children: string; tone?: Tone }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "indigo"
        ? "border-indigo-400/25 bg-indigo-400/10 text-indigo-100"
        : tone === "red"
          ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
          : "border-white/10 bg-white/5 text-neutral-300";

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${toneClass}`}>{children}</span>;
}

type LogDisplay = { icon: Icon; iconClass: string; text: string; tone: Tone };

// `kind` was added after the first logs existed, so button rows fall back to
// `pressed` and anything unrecognised is still rendered rather than dropped.
function describeLog(log: PowerEventLog): LogDisplay {
  if (log.source === "remote") {
    return {
      icon: BroadcastIcon,
      iconClass: "text-indigo-200",
      text: `${Math.round(log.holdMs ?? 0)} ms power signal`,
      tone: "indigo",
    };
  }

  if (log.source === "button") {
    const pressed = log.kind === "press" || (log.kind !== "release" && log.pressed === true);
    return {
      icon: HandTapIcon,
      iconClass: "text-neutral-300",
      text: pressed ? "case button pressed" : "case button released",
      tone: pressed ? "green" : "neutral",
    };
  }

  if (log.source === "device") {
    const connected = log.kind === "connected";
    return {
      icon: connected ? PlugsConnectedIcon : PlugsIcon,
      iconClass: connected ? "text-emerald-300" : "text-rose-300",
      text: connected ? "ESP32 connected to the server" : "ESP32 lost its connection",
      tone: connected ? "green" : "red",
    };
  }

  if (log.source === "pc") {
    const on = log.kind === "on";
    return {
      icon: DesktopTowerIcon,
      iconClass: on ? "text-emerald-300" : "text-rose-300",
      text: on ? "PC started responding to pings" : "PC stopped responding to pings",
      tone: on ? "green" : "red",
    };
  }

  return { icon: QuestionIcon, iconClass: "text-neutral-400", text: `${log.source} ${log.kind}`, tone: "neutral" };
}

export default function LogsDialog({
  open,
  onClose,
  logs,
  loading,
  error,
  filter,
  onFilterChange,
}: {
  open: boolean;
  onClose: () => void;
  logs: PowerEventLog[];
  loading: boolean;
  error: string | null;
  filter: LogFilter;
  onFilterChange: (value: LogFilter) => void;
}) {
  const filteredLogs = useMemo(
    () => (filter === "all" ? logs : logs.filter((log) => log.source === filter)),
    [filter, logs]
  );

  const filterButtonClass = (active: boolean) =>
    active ? `${secondaryButtonClass} border-white/25 bg-white/12 text-white` : secondaryButtonClass;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={ClockCounterClockwiseIcon}
      title="Event logs"
      subtitle="Last 7 days from the database"
      label="Power event logs"
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={filterButtonClass(filter === value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">{filteredLogs.length} entries shown</p>
      </div>

      <div className="max-h-[70dvh] overflow-y-auto px-4 py-4 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-neutral-500">Loading logs...</p>}
        {!loading && error && <p className="py-8 text-center text-sm text-rose-300">{error}</p>}
        {!loading && !error && filteredLogs.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-500">No logs found for the selected filter.</p>
        )}

        {!loading && !error && filteredLogs.length > 0 && (
          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const display = describeLog(log);
              const EntryIcon = display.icon;

              return (
                <article key={log.id} className={`${panelClass} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
                  <div className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5">
                      <EntryIcon className={`size-5 ${log.ok ? display.iconClass : "text-rose-300"}`} />
                    </span>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <LogBadge tone={display.tone}>{log.source}</LogBadge>
                        <LogBadge tone={display.tone}>{log.kind}</LogBadge>
                        {!log.ok && <LogBadge tone="red">error</LogBadge>}
                      </div>
                      <p className="text-sm text-neutral-100">{display.text}</p>
                      {log.error && <p className="text-sm text-rose-300">{log.error}</p>}
                    </div>
                  </div>

                  <div className="text-left text-xs text-neutral-500 sm:text-right">
                    <p>{new Date(log.createdAt).toLocaleString()}</p>
                    {log.source === "remote" && log.holdMs !== null && <p>Hold: {Math.round(log.holdMs)} ms</p>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
