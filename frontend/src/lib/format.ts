export function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatCompactNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';

  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(digits)}K`;
  return value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatAge(ageMs: number | null | undefined): string {
  if (typeof ageMs !== 'number' || Number.isNaN(ageMs)) return '--';
  if (ageMs < 1000) return 'just now';

  const totalSeconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s ago`;
  return `${seconds}s ago`;
}

export function formatDistanceFromSpot(level: number | null | undefined, spot: number | null | undefined): string {
  if (typeof level !== 'number' || typeof spot !== 'number') return '--';
  const diff = level - spot;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)}`;
}
