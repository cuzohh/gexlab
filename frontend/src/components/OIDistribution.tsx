/**
 * OI Distribution — Open Interest concentration by strike.
 * Stacked bars show Call OI and Put OI to reveal dealer positioning clusters.
 */

import { ReactECharts, echarts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface PCData { strike: number; call_oi: number; put_oi: number; pc_ratio: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: PCData[]; spot: number; futures?: FuturesData | null }

export default function OIDistribution({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No OI data</div>

  const lower = spot * 0.88, upper = spot * 1.12
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper && (d.call_oi > 0 || d.put_oi > 0))

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })

  // Find max OI strike
  const maxOIStrike = filtered.reduce((max, d) => (d.call_oi + d.put_oi) > (max.call_oi + max.put_oi) ? d : max, filtered[0])

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex
        if (idx === undefined) return ''
        const d = filtered[idx]
        const total = d.call_oi + d.put_oi
        const fStr = futures ? ` (${futures.name} ${(d.strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${d.strike.toFixed(2)}${fStr}</strong><br/>` +
          `<span style="color:#10b981">Call OI: ${d.call_oi.toLocaleString()}</span><br/>` +
          `<span style="color:#ef4444">Put OI: ${d.put_oi.toLocaleString()}</span><br/>` +
          `Total: ${total.toLocaleString()}`
      },
    },
    legend: { data: ['Call OI', 'Put OI'], textStyle: { color: '#8a8a93', fontFamily: 'Inter' }, top: 10, right: 20 },
    grid: { left: 70, right: 30, top: 50, bottom: 40 },
    xAxis: {
      type: 'category', data: strikes,
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    series: [
      {
        name: 'Call OI', type: 'bar', stack: 'oi',
        data: filtered.map(d => d.call_oi),
        itemStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(16,185,129,0.8)'},{offset:1,color:'rgba(16,185,129,0.3)'}]) },
      },
      {
        name: 'Put OI', type: 'bar', stack: 'oi',
        data: filtered.map(d => d.put_oi),
        itemStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(239,68,68,0.8)'},{offset:1,color:'rgba(239,68,68,0.3)'}]) },
      },
    ],
    graphic: [{
      type: 'text', right: 20, top: 40,
      style: {
        text: `Max OI: $${maxOIStrike?.strike.toFixed(2)} (${(maxOIStrike.call_oi + maxOIStrike.put_oi).toLocaleString()})`,
        fill: '#8a8a93', fontSize: 11, fontFamily: 'JetBrains Mono',
      },
    }],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

