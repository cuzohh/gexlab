/**
 * Put/Call Ratio — OI-based P/C ratio across strikes.
 * Ratios > 1 = more put OI (bearish), < 1 = more call OI (bullish).
 */

import { ReactECharts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface PCData { strike: number; call_oi: number; put_oi: number; pc_ratio: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: PCData[]; spot: number; futures?: FuturesData | null }

export default function PutCallRatio({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No P/C data</div>

  const lower = spot * 0.88, upper = spot * 1.12
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper && (d.call_oi > 0 || d.put_oi > 0))

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex
        if (idx === undefined) return ''
        const d = filtered[idx]
        const fStr = futures ? ` (${futures.name} ${(d.strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${d.strike.toFixed(2)}${fStr}</strong><br/>` +
          `Call OI: ${d.call_oi.toLocaleString()}<br/>` +
          `Put OI: ${d.put_oi.toLocaleString()}<br/>` +
          `P/C Ratio: <strong>${d.pc_ratio.toFixed(2)}</strong>`
      },
    },
    legend: { data: ['Call OI', 'Put OI', 'P/C Ratio'], textStyle: { color: '#8a8a93', fontFamily: 'Inter' }, top: 10, right: 20 },
    grid: { left: 70, right: 70, top: 50, bottom: 30 },
    xAxis: {
      type: 'category', data: strikes,
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    yAxis: [
      {
        type: 'value', name: 'Open Interest',
        axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}` },
        axisLine: { lineStyle: { color: '#26262f' } },
        splitLine: { lineStyle: { color: '#1a1a22' } },
      },
      {
        type: 'value', name: 'P/C Ratio',
        axisLabel: { color: '#f59e0b', fontFamily: 'JetBrains Mono', fontSize: 10 },
        axisLine: { lineStyle: { color: '#f59e0b' } },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Call OI', type: 'bar', stack: 'oi', yAxisIndex: 0,
        data: filtered.map(d => d.call_oi),
        itemStyle: { color: 'rgba(16, 185, 129, 0.5)', borderRadius: [0,0,0,0] },
      },
      {
        name: 'Put OI', type: 'bar', stack: 'oi', yAxisIndex: 0,
        data: filtered.map(d => d.put_oi),
        itemStyle: { color: 'rgba(239, 68, 68, 0.5)', borderRadius: [3,3,0,0] },
      },
      {
        name: 'P/C Ratio', type: 'line', yAxisIndex: 1,
        data: filtered.map(d => d.pc_ratio), smooth: true,
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b' },
        symbol: 'none',
        markLine: {
          silent: true, animation: false,
          data: [{ yAxis: 1, lineStyle: { color: '#f59e0b', type: 'dashed', width: 1 }, label: { formatter: '1.0', color: '#f59e0b', fontSize: 10 } }],
        },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

