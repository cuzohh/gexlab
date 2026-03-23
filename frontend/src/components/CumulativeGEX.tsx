/**
 * Cumulative GEX — Line chart showing running sum of GEX across strikes.
 * The point where the line crosses zero is the Gamma Flip / Zero Gamma level.
 */

import { ReactECharts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface StrikeData {
  strike: number; call_gex: number; put_gex: number; net_gex: number
  total_oi: number; total_volume: number; avg_iv: number
}
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: StrikeData[]; spot: number; futures?: FuturesData | null }

export default function CumulativeGEX({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No data</div>

  const lower = spot * 0.88, upper = spot * 1.12
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper)

  // Build cumulative sum
  let cum = 0
  const cumData = filtered.map(d => { cum += d.net_gex; return cum })

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })

  // Find zero crossing index
  let zeroCrossIdx = -1
  for (let i = 1; i < cumData.length; i++) {
    if ((cumData[i - 1] <= 0 && cumData[i] >= 0) || (cumData[i - 1] >= 0 && cumData[i] <= 0)) {
      zeroCrossIdx = i; break
    }
  }

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const label = params[0]?.axisValue || ''
        const val = params[0]?.value || 0
        return `<strong>Strike $${label}</strong><br/>Cumulative GEX: ${val.toFixed(4)}B<br/>${val >= 0 ? '<span style="color:#10b981">POSITIVE GAMMA</span>' : '<span style="color:#ef4444">NEGATIVE GAMMA</span>'}`
      },
    },
    grid: { left: 70, right: 30, top: 40, bottom: 40 },
    xAxis: {
      type: 'category' as const, data: strikes,
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}B` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    series: [{
      type: 'line', data: cumData, smooth: true, symbol: 'none',
      lineStyle: { width: 2.5 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(16, 185, 129, 0.15)' },
            { offset: 0.5, color: 'transparent' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.15)' },
          ],
        },
      },
      itemStyle: { color: '#5e6ad2' },
      markLine: {
        silent: true, animation: false,
        data: [
          { yAxis: 0, lineStyle: { color: '#f59e0b', type: 'dashed' as const, width: 1.5 }, label: { formatter: 'ZERO GAMMA', color: '#f59e0b', fontSize: 10, fontWeight: 600, backgroundColor: 'rgba(10,10,12,0.85)', padding: [2, 6], borderRadius: 3 } },
          ...(zeroCrossIdx >= 0 ? [{
            xAxis: zeroCrossIdx, lineStyle: { color: '#f59e0b', type: 'dotted' as const, width: 1 },
            label: { show: false },
          }] : []),
        ],
      },
    }],
    visualMap: {
      show: false, dimension: 1, pieces: [
        { lte: 0, color: '#ef4444' },
        { gt: 0, color: '#10b981' },
      ],
    },
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

