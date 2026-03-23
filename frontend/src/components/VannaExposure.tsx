/**
 * Vanna Exposure — Shows Vanna (dDelta/dVol) exposure by strike.
 * Positive vanna = dealers buy stock when vol drops (supportive).
 * Negative vanna = dealers sell stock when vol drops (destabilizing).
 */

import { ReactECharts, echarts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface VannaData { strike: number; vanna_exposure: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: VannaData[]; spot: number; futures?: FuturesData | null }

export default function VannaExposure({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No Vanna data</div>

  const lower = spot * 0.88, upper = spot * 1.12
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper && d.vanna_exposure !== 0)

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const label = params[0]?.axisValue || ''
        const val = params[0]?.value || 0
        return `<strong>Strike $${label}</strong><br/>Vanna Exposure: ${val.toFixed(6)}B<br/>${val >= 0 ? '<span style="color:#06b6d4">SUPPORTIVE</span>' : '<span style="color:#f97316">DESTABILIZING</span>'}`
      },
    },
    grid: { left: 80, right: 40, top: 30, bottom: 30 },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10 },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    yAxis: {
      type: 'category', data: strikes,
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 10 },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    series: [{
      type: 'bar',
      data: filtered.map(d => ({
        value: d.vanna_exposure,
        itemStyle: {
          color: d.vanna_exposure >= 0
            ? new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:'rgba(6,182,212,0.3)'},{offset:1,color:'rgba(6,182,212,0.9)'}])
            : new echarts.graphic.LinearGradient(1,0,0,0,[{offset:0,color:'rgba(249,115,22,0.3)'},{offset:1,color:'rgba(249,115,22,0.9)'}]),
          borderRadius: d.vanna_exposure >= 0 ? [0,3,3,0] : [3,0,0,3],
        },
      })),
    }],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

