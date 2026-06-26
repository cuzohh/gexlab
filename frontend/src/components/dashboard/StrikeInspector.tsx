import type { RawContract, StrikeAnalytics } from '../../types/analytics';
import { formatCompactNumber, formatDistanceFromSpot, formatCurrency } from '../../lib/format';

function sumBy(rows: RawContract[], key: 'openInterest' | 'volume') {
  return rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key]! : 0), 0);
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-[#eae2d6] bg-[#faf7f2] p-4 dark:border-white/10 dark:bg-white/6">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#897d6b] dark:text-[#bcae9a]">{label}</p>
      <p className="mt-2 text-lg font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{value}</p>
    </div>
  );
}

export function StrikeInspector({
  selectedStrike,
  selectedStrikeData,
  contracts,
  spot,
  onClearPin,
  pinned,
}: {
  selectedStrike: number | null;
  selectedStrikeData: StrikeAnalytics | null;
  contracts: RawContract[];
  spot: number | null;
  onClearPin: () => void;
  pinned: boolean;
}) {
  if (selectedStrike == null || !selectedStrikeData) {
    return (
      <div className="rounded-[2rem] border border-dashed border-[#dfd7c8] bg-white/70 p-6 text-[#766c5e] dark:border-white/12 dark:bg-white/4 dark:text-[#a89d8f]">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8e816d] dark:text-[#c7baaa]">Strike Inspector</p>
        <p className="mt-3 text-sm leading-relaxed">
          Hover a strike anywhere in the dashboard to trace it across every panel, or click a level to pin it here for deeper inspection.
        </p>
      </div>
    );
  }

  const calls = contracts.filter((row) => row.type === 'call');
  const puts = contracts.filter((row) => row.type === 'put');

  return (
    <div className="rounded-[2rem] border border-[#e6dfd3] bg-white/85 p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-white/6 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8b7f6c] dark:text-[#c7baaa]">Strike Inspector</p>
          <h3 className="mt-1 text-3xl font-light tracking-[-0.05em] text-[#1D1D1F] dark:text-[#f5efe3]">{formatCurrency(selectedStrike, 2)}</h3>
          <p className="mt-1 text-[12px] text-[#766b5d] dark:text-[#a89d8f]">Distance from spot: {formatDistanceFromSpot(selectedStrike, spot)}</p>
        </div>
        {pinned && (
          <button onClick={onClearPin} className="rounded-full border border-[#e0d7c8] px-3 py-1.5 text-[10px] uppercase tracking-[0.24em] text-[#7e7262] transition-colors hover:border-[#b8860b] hover:text-[#b8860b] dark:border-white/10 dark:text-[#c0b4a5] dark:hover:border-[#d4af37] dark:hover:text-[#f0d78d]">
            Clear Pin
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InspectorMetric label="Strike GEX" value={formatCompactNumber(selectedStrikeData.gex)} />
        <InspectorMetric label="Strike DEX" value={formatCompactNumber(selectedStrikeData.dex)} />
        <InspectorMetric label="Strike VEX" value={formatCompactNumber(selectedStrikeData.vex)} />
        <InspectorMetric label="Strike CHEX" value={formatCompactNumber(selectedStrikeData.chex)} />
        <InspectorMetric label="Call OI" value={formatCompactNumber(sumBy(calls, 'openInterest'))} />
        <InspectorMetric label="Put OI" value={formatCompactNumber(sumBy(puts, 'openInterest'))} />
        <InspectorMetric label="Call Volume" value={formatCompactNumber(sumBy(calls, 'volume'))} />
        <InspectorMetric label="Put Volume" value={formatCompactNumber(sumBy(puts, 'volume'))} />
      </div>
    </div>
  );
}
