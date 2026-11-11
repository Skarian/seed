export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  const unit = bytes ? Math.min(3, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024)))) : 0;
  return `${(bytes / 1024 ** unit).toLocaleString('en-US', { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
