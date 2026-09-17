// Small display helpers shared by the status dialogs.

export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** "just now" / "12s ago" / "4m ago", for timestamps that are always recent. */
export function formatAgo(iso: string, now = Date.now()): string {
  const deltaMs = now - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return "unknown";
  const seconds = Math.max(0, Math.round(deltaMs / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export type SignalQuality = { label: string; bars: number; className: string };

// Rough but conventional RSSI buckets for 2.4GHz WiFi.
export function signalQuality(rssi: number): SignalQuality {
  if (rssi >= -55) return { label: "Excellent", bars: 4, className: "text-emerald-300" };
  if (rssi >= -65) return { label: "Good", bars: 3, className: "text-emerald-300" };
  if (rssi >= -75) return { label: "Fair", bars: 2, className: "text-indigo-300" };
  return { label: "Weak", bars: 1, className: "text-rose-300" };
}
