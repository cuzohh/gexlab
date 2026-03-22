/**
 * GEX Bar Chart — Horizontal bar chart showing Call GEX vs Put GEX by strike.
 * 
 * Green bars extend right (positive call GEX), red bars extend left (negative put GEX).
 * Key level overlays rendered as static horizontal reference lines.
 */

import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'

interface StrikeData {
  strike: number
  call_gex: number
  put_gex: number
  net_gex: number
  total_oi: number
  total_volume: number
  avg_iv: number
}

interface KeyLevels {
  call_wall: number | null
  put_wall: number | null
  zero_gamma: number | null
  max_pain: number | null
  vol_trigger: number | null
}

interface FuturesData {
  symbol: string
  name: string
  full_name: string
  futures_price: number
  ratio: number
}

interface GEXBarChartProps {
  data: StrikeData[]
  spot: number
  keyLevels: KeyLevels
  futures?: FuturesData | null
}

export default function GEXBarChart({ data, spot, keyLevels, futures }: GEXBarChartProps) {
  const lowerBound = spot * 0.85
  const upperBound = spot * 1.15
  const filtered = data.filter(d => d.strike >= lowerBound && d.strike <= upperBound)

  const strikes = filtered.map(d => {
    if (futures) {
      const fPrice = (d.strike * futures.ratio).toFixed(0)
      return `${d.strike.toFixed(0)} (${fPrice})`
    }
    return d.strike.toFixed(0)
  })
  const callGex = filtered.map(d => d.call_gex)
  const putGex = filtered.map(d => d.put_gex)

  // Build static mark lines for key levels
  const markLines: any[] = []

  const addMarkLine = (level: number | null, label: string, color: string, lineType: string) => {
    if (!level) return
    const idx = filtered.findIndex(d => d.strike >= level)
    if (idx >= 0) {
      markLines.push({
        yAxis: idx,
        label: {
          show: true,
          formatter: `${label} $${level.toFixed(0)}`,
          position: 'insideEndBottom',
          fontSize: 10,
          fontWeight: 600,
          color: color,
          backgroundColor: 'rgba(10, 10, 12, 0.85)',
          padding: [2, 6],
          borderRadius: 3,
        },
        lineStyle: { color, type: lineType, width: 1.5 },
      })
    }
  }

  addMarkLine(spot, 'SPOT', '#ededf0', 'solid')
  addMarkLine(keyLevels.zero_gamma, 'ZERO γ', '#f59e0b', 'dashed')
  addMarkLine(keyLevels.call_wall, 'CALL WALL', '#10b981', 'dotted')
  addMarkLine(keyLevels.put_wall, 'PUT WALL', '#ef4444', 'dotted')

  const option: echarts.EChartsCoreOption = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#16161a',
      borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter' },
      formatter: (params: any) => {
        const strikeLabel = params[0]?.axisValue || ''
        let html = `<strong>Strike $${strikeLabel}</strong><br/>`
        params.forEach((p: any) => {
          html += `${p.marker} ${p.seriesName}: ${p.value?.toFixed(4)}B<br/>`
        })
        return html
      },
    },
    legend: {
      data: ['Call GEX', 'Put GEX'],
      textStyle: { color: '#8a8a93', fontFamily: 'Inter' },
      top: 10,
      right: 20,
    },
    grid: {
      left: 80,
      right: 40,
      top: 50,
      bottom: 30,
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}B` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    yAxis: {
      type: 'category',
      data: strikes,
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 10 },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    series: [
      {
        name: 'Call GEX',
        type: 'bar',
        stack: 'gex',
        data: callGex,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.9)' },
          ]),
          borderRadius: [0, 3, 3, 0],
        },
        markLine: {
          symbol: 'none',
          animation: false,
          silent: true,
          data: markLines,
        },
      },
      {
        name: 'Put GEX',
        type: 'bar',
        stack: 'gex',
        data: putGex,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.9)' },
          ]),
          borderRadius: [3, 0, 0, 3],
        },
      },
    ],
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '100%', width: '100%' }}
      notMerge={true}
    />
  )
}
