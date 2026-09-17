import { PulseIcon } from "@phosphor-icons/react";
import Dialog, { DialogEmpty, DialogField } from "./Dialog";
import { formatAgo } from "./format";
import type { PingSummary } from "./api";

export default function PingInfoDialog({
  open,
  onClose,
  ping,
  connected,
}: {
  open: boolean;
  onClose: () => void;
  ping: PingSummary | null;
  connected: boolean;
}) {
  const verdictClass = ping?.poweredOn ? "text-emerald-300" : "text-rose-300";
  const lossClass = !ping ? "" : ping.lossPercent === 0 ? "text-emerald-300" : ping.lossPercent < 100 ? "text-indigo-300" : "text-rose-300";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={PulseIcon}
      title="PC ping probe"
      subtitle={ping ? `Checked ${formatAgo(ping.lastCheckedAt)}` : "No check yet"}
    >
      <div className="max-h-[70dvh] overflow-y-auto px-4 py-4 sm:px-6">
        {!ping ? (
          <DialogEmpty>
            {connected
              ? "Waiting for the board's first ICMP probe."
              : "The board is offline, so its last ping result was discarded."}
          </DialogEmpty>
        ) : (
          <>
            <div className="mb-4 rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
              <p className={`font-display text-sm tracking-wide ${verdictClass}`}>
                {ping.poweredOn ? "Responding to ICMP" : "No ICMP response"}
              </p>
              <p className="text-xs text-neutral-400">
                The board pings the PC's own NIC from the LAN; with the machine fully off there's no OS to answer.
              </p>
            </div>

            <DialogField label="Target" mono>
              {ping.host ?? "probe disabled (no PC_HOST_IP)"}
            </DialogField>
            <DialogField label="Last checked">
              {formatAgo(ping.lastCheckedAt)} · {new Date(ping.lastCheckedAt).toLocaleTimeString()}
            </DialogField>
            <DialogField label="Packets">
              {ping.received} of {ping.sent} replied
            </DialogField>
            <DialogField label="Packet loss">
              <span className={lossClass}>{ping.lossPercent}%</span>
            </DialogField>
            <DialogField label="Reply time">{ping.replyMs === null ? "no reply" : `${Math.round(ping.replyMs)} ms`}</DialogField>
            <DialogField label="Probe interval">
              every {Math.round(ping.intervalMs / 1000)}s · {ping.packetsPerCheck} packets per check
            </DialogField>
          </>
        )}
      </div>
    </Dialog>
  );
}
