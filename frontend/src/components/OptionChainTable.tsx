'use client';

import React from 'react';
import type { RawContract } from '../types/analytics';

function formatStrikeLabel(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface OptionChainTableProps {
  data: RawContract[];
  mode?: 'ledger' | 'chain';
  highlightedStrike?: number | null;
  pinnedStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  onPinStrike?: (strike: number | null) => void;
}

export default function OptionChainTable({
  data,
  mode = 'ledger',
  highlightedStrike,
  pinnedStrike,
  onHoverStrike,
  onPinStrike,
}: OptionChainTableProps) {
  if (!data || data.length === 0) return (
     <div className="p-20 text-center text-[12px] tracking-wide text-[#86868B] dark:text-[#a79b8b]">
        Awaiting contract data from engine...
     </div>
  );

  return (
    <div className="overflow-hidden rounded-[2.5rem] border border-[#E5E5E7] bg-white shadow-sm dark:border-white/10 dark:bg-[#171b22]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] font-sans border-collapse">
          <thead>
            <tr className="bg-[#F5F5F7] text-[#86868B] uppercase tracking-[0.2em] font-bold dark:bg-white/6 dark:text-[#b5ab9c]">
              <th className="px-6 py-4">Expiry</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Strike</th>
              <th className="px-6 py-4 text-right">Delta</th>
              <th className="px-6 py-4 text-right">Gamma</th>
              <th className="px-6 py-4 text-right">Vega</th>
              <th className="px-6 py-4 text-right">Vanna</th>
              <th className="px-6 py-4 text-right">Charm</th>
              <th className="px-6 py-4 text-right">IV</th>
              <th className="px-6 py-4 text-right">Net GEX</th>
              {mode === 'chain' && <th className="px-6 py-4 text-right">Volume</th>}
              <th className="px-6 py-4 text-right">OI</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 100).map((row, i) => {
              const isSelected = row.strike === highlightedStrike;
              const isPinned = row.strike === pinnedStrike;
              return (
              <tr
                key={i}
                onMouseEnter={() => onHoverStrike?.(row.strike)}
                onMouseLeave={() => onHoverStrike?.(null)}
                onClick={() => onPinStrike?.(isPinned ? null : row.strike)}
                className={`group cursor-pointer border-b border-[#F5F5F7] transition-colors hover:bg-[#FAFAFA] dark:border-white/6 dark:hover:bg-white/6 ${isSelected ? 'bg-[#fbf6eb] dark:bg-[#2a2214]' : ''}`}
              >
                <td className="px-6 py-3.5 font-medium text-[#86868B] dark:text-[#a89d8f]">{row.expiry}</td>
                <td className="px-6 py-3.5">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${row.type === 'call' ? 'bg-[#F0F7FF] text-blue-600' : 'bg-[#FFF5ED] text-orange-600'}`}>
                    {row.type}
                  </span>
                </td>
                <td className="px-6 py-3.5 font-bold tracking-tight tabular-nums text-[#1D1D1F] dark:text-[#f5efe3]">{formatStrikeLabel(row.strike)}</td>
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{typeof row.delta === 'number' ? row.delta.toFixed(3) : '--'}</td>
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{typeof row.gamma === 'number' ? row.gamma.toFixed(4) : '--'}</td>
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{typeof row.vega === 'number' ? row.vega.toFixed(3) : '--'}</td>
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{typeof row.vanna === 'number' ? row.vanna.toFixed(4) : '--'}</td>
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{typeof row.charm === 'number' ? row.charm.toFixed(4) : '--'}</td>
                <td className="px-6 py-3.5 text-right font-bold tabular-nums text-[#D4AF37]">{typeof row.iv === 'number' ? `${(row.iv * 100).toFixed(1)}%` : '--'}</td>
                <td className={`px-6 py-3.5 text-right font-bold tabular-nums ${typeof row.gex === 'number' && row.gex >= 0 ? 'text-blue-500' : 'text-orange-500'}`}>
                  {typeof row.gex === 'number' ? `${(row.gex / 1e6).toFixed(2)}M` : '--'}
                </td>
                {mode === 'chain' && <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{row.volume?.toLocaleString() ?? '--'}</td>}
                <td className="px-6 py-3.5 text-right font-medium tabular-nums text-[#86868B] dark:text-[#a89d8f]">{row.openInterest?.toLocaleString()}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      {data.length > 100 && (
         <div className="bg-[#F5F5F7]/30 p-6 text-center text-[10px] font-bold uppercase tracking-widest text-[#86868B] dark:bg-white/5 dark:text-[#a89d8f]">
            Displaying top 100 of {data.length} active contracts
         </div>
      )}
    </div>
  );
}
