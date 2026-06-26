'use client';

import React from 'react';
import type { StrikeAnalytics } from '../types/analytics';

interface GexHeatmapProps {
  data: StrikeAnalytics[];
  aristocratic?: boolean;
  metricKey?: 'gex' | 'dex' | 'vex' | 'chex' | 'vega' | 'charm';
  metricLabel?: string;
  highlightedStrike?: number | null;
  pinnedStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  onPinStrike?: (strike: number | null) => void;
}

export default function GexHeatmap({
  data,
  metricKey = 'gex',
  metricLabel = 'Exposure',
  highlightedStrike,
  pinnedStrike,
  onHoverStrike,
  onPinStrike,
}: GexHeatmapProps) {
  if (!data || data.length === 0) return <div className="text-zinc-600 dark:text-[#a79b8b]">No data</div>;

  // For a true heatmap, we usually need [Expiry x Strike] matrix.
  // We'll simplify this to a "Relative Exposure Intensity" across strikes.
  const maxAbsMetric = Math.max(...data.map(s => Math.abs(Number(s[metricKey] ?? 0))));

  return (
    <div className="space-y-1">
      <div className="mb-2 flex justify-between text-[8px] font-bold uppercase tracking-widest text-zinc-600 dark:text-[#a79b8b]">
         <span>Out the Money</span>
         <span>{metricLabel}</span>
         <span>In the Money</span>
      </div>
      <div className="grid grid-cols-1 gap-[2px]">
        {[...data].sort((a, b) => b.strike - a.strike).slice(0, 40).map((s, i) => {
          const value = Number(s[metricKey] ?? 0);
          const intensity = maxAbsMetric > 0 ? (Math.abs(value) / maxAbsMetric) * 100 : 0;
          const color = value >= 0 ? `rgba(96, 165, 250, ${intensity / 100})` : `rgba(251, 146, 60, ${intensity / 100})`;
          const isSelected = s.strike === highlightedStrike;
          const isPinned = s.strike === pinnedStrike;
          
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => onHoverStrike?.(s.strike)}
              onMouseLeave={() => onHoverStrike?.(null)}
              onClick={() => onPinStrike?.(isPinned ? null : s.strike)}
              className="flex w-full items-center gap-2 h-4 text-[9px] font-mono text-left"
            >
              <div className="w-12 text-right text-zinc-500 dark:text-[#9d9386]">{s.strike}</div>
              <div 
                className={`flex-1 h-full rounded-sm transition-all duration-500 ${isSelected ? 'ring-1 ring-[#b8860b]' : ''}`}
                style={{ backgroundColor: color, borderLeft: `2px solid ${value >= 0 ? '#60a5fa' : '#fb923c'}`, opacity: highlightedStrike == null || isSelected ? 1 : 0.5 }}
              >
                {intensity > 30 && (
                   <span className="px-2 text-white opacity-40">
                      {Math.abs(value / 1e6).toFixed(1)}M
                   </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
