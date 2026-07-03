export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '';
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytesPerSec >= GB) return `${(bytesPerSec / GB).toFixed(2)} GB/s`;
  if (bytesPerSec >= MB) return `${(bytesPerSec / MB).toFixed(1)} MB/s`;
  if (bytesPerSec >= KB) return `${(bytesPerSec / KB).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}
