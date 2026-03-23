/**
 * DEX Profile — Delta Exposure by strike price.
 * Shows the directional tilt of dealer hedging at each strike.
 */

import { ReactECharts, echarts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface DEXData { strike: number; call_dex: number; put_dex: number; net_dex: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }

interface Props { data: DEXData[]; spot: number; futures?: FuturesData | null }

export default function DEXProfile({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No DEX data available</div>

  const lower = spot * 0.85, upper = spot * 1.15
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper)

  const strikes = filtered.map(d => {
    if (futures) return `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})`
    return d.strike.toFixed(2)
  })
  const callDex = filtered.map(d => d.call_dex)
  const putDex = filtered.map(d => d.put_dex)

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter' },
      formatter: (params: any) => {
        const label = params[0]?.axisValue || ''
        let html = `<strong>Strike $${label}</strong><br/>`
        params.forEach((p: any) => { html += `${p.marker} ${p.seriesName}: ${p.value?.toFixed(4)}B<br/>` })
        return html
      },
    },
    legend: { data: ['Call DEX', 'Put DEX'], textStyle: { color: '#8a8a93', fontFamily: 'Inter' }, top: 10, right: 20 },
    grid: { left: 80, right: 40, top: 50, bottom: 30 },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}B` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    yAxis: {
      type: 'category', data: strikes,
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 10 },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    series: [
      {
        name: 'Call DEX', type: 'bar', stack: 'dex', data: callDex,
        itemStyle: { color: new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:'rgba(59,130,246,0.3)'},{offset:1,color:'rgba(59,130,246,0.9)'}]), borderRadius: [0,3,3,0] },
      },
      {
        name: 'Put DEX', type: 'bar', stack: 'dex', data: putDex,
        itemStyle: { color: new echarts.graphic.LinearGradient(1,0,0,0,[{offset:0,color:'rgba(249,115,22,0.3)'},{offset:1,color:'rgba(249,115,22,0.9)'}]), borderRadius: [3,0,0,3] },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

