'use client';

import React from 'react';
import { formatCompactNumber, formatDistanceFromSpot } from '../lib/format';
import type { LevelsData, StrikeAnalytics } from '../types/analytics';

function formatStrikeLabel(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface GexLadderProps {
  strikes: StrikeAnalytics[];
  levels?: LevelsData;
  spot: number;
  aristocratic?: boolean;
  highlightedStrike?: number | null;
  pinnedStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  onPinStrike?: (strike: number | null) => void;
}

export default function GexLadder({
  strikes,
  levels,
  spot,
  aristocratic,
  highlightedStrike,
  pinnedStrike,
  onHoverStrike,
  onPinStrike,
}: GexLadderProps) {
  if (!strikes || strikes.length === 0) return null;

  const sorted = [...strikes].sort((a, b) => b.strike - a.strike);
  const spotIdx = sorted.findIndex(s => s.strike <= spot);
  const ladder = sorted.slice(
    Math.max(0, spotIdx >= 0 ? spotIdx - 15 : 0),
    Math.min(sorted.length, spotIdx >= 0 ? spotIdx + 25 : 40)
  );

  const isLevel = (strike: number) => {
    if (typeof levels?.gammaFlip === 'number' && Math.abs(strike - levels.gammaFlip) < 0.5) {
      return { name: 'FLIP', color: aristocratic ? 'bg-[#D4AF37] text-white' : 'bg-emerald-500 text-black' };
    }
    if (strike === levels?.callWall) return { name: 'CALL WALL', color: 'bg-blue-500 text-white' };
    if (strike === levels?.putWall) return { name: 'PUT WALL', color: 'bg-orange-600 text-white' };
    if (strike === levels?.vannaMagnet) return { name: 'VANNA', color: 'bg-purple-500 text-white' };
    return null;
  };

  return (
    <div className={`rounded-[2rem] overflow-hidden ${aristocratic ? 'border border-[#E5E5E7] bg-white shadow-sm dark:border-white/10 dark:bg-white/6' : 'border border-zinc-800 bg-zinc-900/20'}`}>
      <div className={`p-6 border-b text-[10px] uppercase font-bold tracking-[0.2em] ${aristocratic ? 'border-[#E5E5E7] text-[#86868B] dark:border-white/10 dark:text-[#b6ab9b]' : 'border-zinc-800 text-zinc-500'}`}>
        <div className="flex items-center justify-between gap-4">
          <span>Price Ladder</span>
          <span className={`text-[9px] tracking-[0.24em] ${aristocratic ? 'text-[#9a8d79] dark:text-[#b6ab9b]' : 'text-zinc-500'}`}>Distance • Net Gamma</span>
        </div>
      </div>
      <div className="max-h-[700px] overflow-y-auto scrollbar-hide py-2">
        {ladder.map((s, i) => {
          const level = isLevel(s.strike);
          const isAtSpot = Math.abs(s.strike - spot) < 0.5;
          const isSelected = s.strike === highlightedStrike;
          const isPinned = s.strike === pinnedStrike;
          const gexTone = (s.gex ?? 0) >= 0
            ? (aristocratic ? 'text-[#2f6b39] dark:text-[#9fdbab]' : 'text-emerald-400')
            : (aristocratic ? 'text-[#9b4f26] dark:text-[#f0b390]' : 'text-orange-400');
          const strikeDistance = formatDistanceFromSpot(s.strike, spot);

          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => onHoverStrike?.(s.strike)}
              onMouseLeave={() => onHoverStrike?.(null)}
              onClick={() => onPinStrike?.(isPinned ? null : s.strike)}
              className={`flex min-h-[58px] w-full items-center border-b text-left transition-colors last:border-0 ${aristocratic ? 'border-[#F5F5F7] hover:bg-[#F5F5F7] dark:border-white/6 dark:hover:bg-white/6' : 'border-zinc-900/50 hover:bg-zinc-800/30'} ${isAtSpot ? (aristocratic ? 'bg-[#F5F5F7] dark:bg-white/8' : 'bg-zinc-800/40') : ''} ${isSelected ? 'ring-1 ring-inset ring-[#b8860b]/55 bg-[#fbf6eb] dark:bg-[#2a2214]' : ''}`}
            >
              <div className={`w-24 border-r px-2 text-center text-xs font-medium ${aristocratic ? 'border-[#F5F5F7] text-[#1D1D1F] dark:border-white/6 dark:text-[#f5efe3]' : 'border-zinc-800/50 text-zinc-400'}`}>
                {formatStrikeLabel(s.strike)}
              </div>
              <div className="flex-1 px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {level && (
                      <span className={`${level.color} text-[8px] font-black px-2 py-0.5 rounded-full tracking-tighter uppercase shadow-sm`}>
                        {level.name}
                      </span>
                    )}
                    {isAtSpot && <span className="text-[#D4AF37] text-[9px] font-black tracking-widest uppercase">SPOT</span>}
                    {isPinned && <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#7a5b09] dark:text-[#e3c676]">PINNED</span>}
                  </div>
                  <div className={`text-[11px] font-mono font-semibold ${gexTone}`}>
                    {formatCompactNumber(s.gex, 1)}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className={`text-[10px] uppercase tracking-[0.18em] ${aristocratic ? 'text-[#86868B] dark:text-[#b6ab9b]' : 'text-zinc-500'}`}>
                    {strikeDistance === '0.00' ? 'At Spot' : `${strikeDistance} vs spot`}
                  </div>
                  <div className={`text-[10px] font-mono ${aristocratic ? 'text-[#86868B] dark:text-[#b6ab9b]' : 'text-zinc-500'}`}>
                    OI {formatCompactNumber(s.openInterest, 1)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
