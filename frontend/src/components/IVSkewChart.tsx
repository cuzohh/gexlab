/**
 * IV Skew — Implied Volatility smile/skew across strikes.
 * Compares call IV vs put IV to reveal market sentiment.
 */

import ReactECharts from 'echarts-for-react'

interface IVData { strike: number; call_iv: number; put_iv: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: IVData[]; spot: number; futures?: FuturesData | null }

export default function IVSkewChart({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No IV data</div>

  const lower = spot * 0.88, upper = spot * 1.12
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper && (d.call_iv > 0 || d.put_iv > 0))

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
    },
    legend: { data: ['Call IV', 'Put IV'], textStyle: { color: '#8a8a93', fontFamily: 'Inter' }, top: 10, right: 20 },
    grid: { left: 60, right: 30, top: 50, bottom: 30 },
    xAxis: {
      type: 'category' as const, data: strikes,
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    yAxis: {
      type: 'value' as const, name: 'IV %',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    series: [
      {
        name: 'Call IV', type: 'line', data: filtered.map(d => d.call_iv), smooth: true,
        lineStyle: { color: '#10b981', width: 2 },
        itemStyle: { color: '#10b981' },
        areaStyle: { color: 'rgba(16,185,129,0.08)' },
        symbol: 'none',
      },
      {
        name: 'Put IV', type: 'line', data: filtered.map(d => d.put_iv), smooth: true,
        lineStyle: { color: '#ef4444', width: 2 },
        itemStyle: { color: '#ef4444' },
        areaStyle: { color: 'rgba(239,68,68,0.08)' },
        symbol: 'none',
      },
    ],
    // Spot line
    graphic: [{
      type: 'text', right: 20, top: 10,
      style: { text: `Spot: $${spot.toFixed(2)}`, fill: '#8a8a93', fontSize: 11, fontFamily: 'JetBrains Mono' },
    }],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}
