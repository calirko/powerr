import { CpuIcon } from "@phosphor-icons/react";
import Dialog, { DialogEmpty, DialogField } from "./Dialog";
import { formatAgo, formatBytes, formatUptime, signalQuality } from "./format";
import type { DeviceInfo } from "./api";

// Stands in for a WiFi icon: it says "this row is the radio" and encodes the
// strength, so the dBm reading next to it isn't drawn twice.
function SignalBars({ bars, className }: { bars: number; className: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} aria-hidden>
      {[1, 2, 3, 4].map((level) => (
        <span
          key={level}
          className="w-[3px] rounded-sm bg-current"
          style={{ height: `${level * 4}px`, opacity: level <= bars ? 1 : 0.2 }}
        />
      ))}
    </span>
  );
}

export default function DeviceInfoDialog({
  open,
  onClose,
  device,
  connected,
}: {
  open: boolean;
  onClose: () => void;
  device: DeviceInfo | null;
  connected: boolean;
}) {
  const signal = device ? signalQuality(device.rssi) : null;
  const heapUsedPercent = device
    ? Math.round(((device.heapSizeBytes - device.freeHeapBytes) / device.heapSizeBytes) * 100)
    : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={CpuIcon}
      title="ESP32 board"
      subtitle={device ? `Snapshot ${formatAgo(device.reportedAt)}` : "No snapshot yet"}
    >
      <div className="max-h-[70dvh] overflow-y-auto px-4 py-4 sm:px-6">
        {!device ? (
          <DialogEmpty>
            {connected
              ? "Waiting for the board's first stats report."
              : "The board is offline, so its last stats were discarded."}
          </DialogEmpty>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5">
                <SignalBars bars={signal?.bars ?? 0} className={signal?.className ?? ""} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm tracking-wide text-neutral-100">{device.ssid || "unknown network"}</p>
                <p className="text-xs text-neutral-400">
                  {device.rssi} dBm · {signal?.label} · channel {device.channel}
                </p>
              </div>
            </div>

            <DialogField label="IP address" mono>
              {device.ip}
            </DialogField>
            <DialogField label="MAC" mono>
              {device.mac}
            </DialogField>
            <DialogField label="Hostname" mono>
              {device.hostname}
            </DialogField>
            <DialogField label="Uptime">{formatUptime(device.uptimeMs)}</DialogField>
            <DialogField label="Free heap">
              {formatBytes(device.freeHeapBytes)} of {formatBytes(device.heapSizeBytes)} ({heapUsedPercent}% used)
            </DialogField>
            <DialogField label="Chip">
              {device.chipModel} · {device.chipCores} {device.chipCores === 1 ? "core" : "cores"} @ {device.cpuFreqMhz} MHz
            </DialogField>
            <DialogField label="Temperature">{device.temperatureC.toFixed(1)} °C</DialogField>
            <DialogField label="ESP-IDF" mono>
              {device.sdkVersion}
            </DialogField>
          </>
        )}
      </div>
    </Dialog>
  );
}
