/**
 * GEX Bar Chart — Horizontal bar chart showing Call GEX vs Put GEX by strike.
 * 
 * This is THE signature chart of any GEX dashboard: green bars extend right
 * (positive call GEX) and red bars extend left (negative put GEX).
 * 
 * Overlays: Spot price line, Zero Gamma line, Call Wall, Put Wall markers.
 */

import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, MarkLineComponent, LegendComponent, CanvasRenderer])

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

interface GEXBarChartProps {
  data: StrikeData[]
  spot: number
  keyLevels: KeyLevels
}

export default function GEXBarChart({ data, spot, keyLevels }: GEXBarChartProps) {
  // Filter to strikes within a reasonable range of spot (±15%)
  const lowerBound = spot * 0.85
  const upperBound = spot * 1.15
  const filtered = data.filter(d => d.strike >= lowerBound && d.strike <= upperBound)

  const strikes = filtered.map(d => d.strike.toFixed(0))
  const callGex = filtered.map(d => d.call_gex)
  const putGex = filtered.map(d => d.put_gex)

  // Build mark lines for key levels
  const markLines: any[] = []
  
  // Spot price
  const spotIdx = filtered.findIndex(d => d.strike >= spot)
  if (spotIdx >= 0) {
    markLines.push({
      yAxis: spotIdx,
      label: { formatter: `SPOT $${spot.toFixed(0)}`, position: 'insideStartTop', fontSize: 10, color: '#ededf0' },
      lineStyle: { color: '#ededf0', type: 'solid', width: 2 },
    })
  }

  // Zero Gamma
  if (keyLevels.zero_gamma) {
    const zgIdx = filtered.findIndex(d => d.strike >= keyLevels.zero_gamma!)
    if (zgIdx >= 0) {
      markLines.push({
        yAxis: zgIdx,
        label: { formatter: `ZERO γ $${keyLevels.zero_gamma.toFixed(0)}`, position: 'insideStartTop', fontSize: 10, color: '#f59e0b' },
        lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.5 },
      })
    }
  }

  // Call Wall
  if (keyLevels.call_wall) {
    const cwIdx = filtered.findIndex(d => d.strike >= keyLevels.call_wall!)
    if (cwIdx >= 0) {
      markLines.push({
        yAxis: cwIdx,
        label: { formatter: `CALL WALL $${keyLevels.call_wall.toFixed(0)}`, position: 'insideEndTop', fontSize: 10, color: '#10b981' },
        lineStyle: { color: '#10b981', type: 'dotted', width: 1.5 },
      })
    }
  }

  // Put Wall
  if (keyLevels.put_wall) {
    const pwIdx = filtered.findIndex(d => d.strike >= keyLevels.put_wall!)
    if (pwIdx >= 0) {
      markLines.push({
        yAxis: pwIdx,
        label: { formatter: `PUT WALL $${keyLevels.put_wall.toFixed(0)}`, position: 'insideEndTop', fontSize: 10, color: '#ef4444' },
        lineStyle: { color: '#ef4444', type: 'dotted', width: 1.5 },
      })
    }
  }

  const option: echarts.EChartsCoreOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#16161a',
      borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter' },
      formatter: (params: any) => {
        const strike = params[0]?.axisValue || ''
        let html = `<strong>Strike $${strike}</strong><br/>`
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
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
      notMerge={true}
    />
  )
}
