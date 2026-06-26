'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from 'recharts';
import type { StrikeAnalytics } from '../types/analytics';
import { formatCompactNumber } from '../lib/format';

interface GexStrikeChartProps {
  data: StrikeAnalytics[];
  metricKey?: 'gex' | 'dex' | 'vex' | 'chex' | 'vega' | 'charm';
  metricLabel?: string;
  highlightedStrike?: number | null;
  pinnedStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  onPinStrike?: (strike: number | null) => void;
}

export default function GexStrikeChart({
  data,
  metricKey = 'gex',
  metricLabel = 'GEX',
  highlightedStrike,
  pinnedStrike,
  onHoverStrike,
  onPinStrike,
}: GexStrikeChartProps) {
  if (!data || data.length === 0) return <div className="text-zinc-600">No data available</div>;

  const formatMetricValue = (value: number) => {
    if (metricKey === 'vega' || metricKey === 'charm') {
      return formatCompactNumber(value, 2);
    }

    return formatCompactNumber(value, 2);
  };

  // Filter strikes close to current price for better visibility (e.g. within 10% or most active)
  const chartData = [...data]
    .sort((a, b) => a.strike - b.strike)
    .map(s => ({
      strike: s.strike,
      gex: s.gex,
      dex: s.dex,
      vex: s.vex,
      chex: s.chex ?? 0,
      vega: s.vega ?? 0,
      charm: s.charm ?? 0,
      oi: s.openInterest
    }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-[#e5ddcf] bg-white/95 p-3 shadow-2xl dark:border-white/10 dark:bg-[#171b22]">
          <p className="mb-1 text-[10px] font-bold uppercase text-[#7b6f60] dark:text-[#b8ae9f]">Strike {label}</p>
          <p className={`text-sm font-mono ${payload[0].value >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
            {metricLabel}: {formatMetricValue(payload[0].value)}
          </p>
          <p className="text-xs font-mono text-[#847868] dark:text-[#938878]">
            OI: {payload[0].payload.oi.toLocaleString()}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          onMouseMove={(state: any) => {
            const strike = state?.activePayload?.[0]?.payload?.strike;
            onHoverStrike?.(typeof strike === 'number' ? strike : null);
          }}
          onMouseLeave={() => onHoverStrike?.(null)}
          onClick={(state: any) => {
            const strike = state?.activePayload?.[0]?.payload?.strike;
            if (typeof strike === 'number') {
              onPinStrike?.(pinnedStrike === strike ? null : strike);
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(152,135,110,0.25)" vertical={false} />
          <XAxis 
            dataKey="strike" 
            stroke="#7d705e" 
            fontSize={10} 
            tickLine={false} 
            axisLine={false} 
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(184,134,11,0.08)' }} />
          <ReferenceLine y={0} stroke="rgba(120,101,75,0.4)" />
          <Bar dataKey={metricKey}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={(entry[metricKey] ?? 0) >= 0 ? '#60a5fa' : '#fb923c'}
                stroke={entry.strike === highlightedStrike ? '#b8860b' : 'transparent'}
                strokeWidth={entry.strike === highlightedStrike ? 2 : 0}
                opacity={highlightedStrike == null || entry.strike === highlightedStrike ? 1 : 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
