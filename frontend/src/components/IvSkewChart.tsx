'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine
} from 'recharts';
import type { StrikeAnalytics } from '../types/analytics';

interface IvSkewChartProps {
  data: StrikeAnalytics[];
  highlightedStrike?: number | null;
}

export default function IvSkewChart({ data, highlightedStrike }: IvSkewChartProps) {
  if (!data || data.length === 0) return <div className="text-zinc-600">No data available</div>;

  const chartData = [...data]
    .sort((a, b) => a.strike - b.strike)
    .map(s => ({
      strike: s.strike,
      iv: s.iv * 100 // Convert to percentage
    }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="colorIv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(152,135,110,0.25)" vertical={false} />
          <XAxis 
            dataKey="strike" 
            stroke="#7d705e" 
            fontSize={10} 
            tickLine={false} 
            axisLine={false} 
          />
          <YAxis 
            stroke="#7d705e" 
            fontSize={10} 
            tickLine={false} 
            axisLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: 'rgba(255,250,242,0.96)', border: '1px solid #e5ddcf', borderRadius: '8px', color: '#5d513f' }}
            itemStyle={{ color: '#8b5cf6', fontSize: '12px' }}
          />
          {typeof highlightedStrike === 'number' && <ReferenceLine x={highlightedStrike} stroke="#b8860b" strokeDasharray="4 4" />}
          <Area 
            type="monotone" 
            dataKey="iv" 
            stroke="#a78bfa" 
            fillOpacity={1} 
            fill="url(#colorIv)" 
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
