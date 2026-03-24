/**
 * GEX Bar Chart - Horizontal bar chart showing Call GEX vs Put GEX by strike.
 * Green bars extend right (positive call GEX), red bars extend left (negative put GEX).
 * Key level overlays rendered as static horizontal reference lines.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartGrid, chartLinearGradient, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

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
  const filtered = data.filter((d) => d.strike >= lowerBound && d.strike <= upperBound)
  if (filtered.length === 0) return <ChartEmptyState>No GEX bars are available within the current spot range.</ChartEmptyState>

  const strikes = filtered.map((d) => {
    if (futures) {
      const futuresPrice = (d.strike * futures.ratio).toFixed(2)
      return `${d.strike.toFixed(2)} (${futuresPrice})`
    }
    return d.strike.toFixed(2)
  })

  const callGex = filtered.map((d) => d.call_gex)
  const putGex = filtered.map((d) => d.put_gex)
  const markLines: Array<Record<string, unknown>> = []

  const addMarkLine = (level: number | null, label: string, color: string, lineType: string) => {
    if (!level) return
    const index = filtered.findIndex((d) => d.strike >= level)
    if (index < 0) return

    markLines.push({
      yAxis: index,
      label: {
        show: true,
        formatter: `${label} $${level.toFixed(2)}`,
        position: 'insideEndBottom',
        fontSize: 10,
        fontWeight: 600,
        color,
        backgroundColor: chartPalette.surface,
        padding: [2, 6],
        borderRadius: 3,
      },
      lineStyle: { color, type: lineType, width: 3.5 },
    })
  }

  addMarkLine(spot, 'SPOT', chartPalette.ivory, 'solid')
  addMarkLine(keyLevels.zero_gamma, 'ZERO GAMMA', chartPalette.warning, 'dashed')
  addMarkLine(keyLevels.call_wall, 'CALL WALL', chartPalette.positive, 'dotted')
  addMarkLine(keyLevels.put_wall, 'PUT WALL', chartPalette.negative, 'dotted')

  const spotIndex = filtered.findIndex((d) => d.strike >= spot)
  const safeSpotIndex = spotIndex >= 0 ? spotIndex : Math.floor(filtered.length / 2)
  const displayRange = 15

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const items = tooltipItems(params)
        const strikeLabel = items[0]?.name || ''
        let html = `<div><strong>Strike $${strikeLabel}</strong><br/>`
        let net = 0

        items.forEach((item) => {
          const value = typeof item.value === 'number' ? item.value : 0
          net += value
          html += `${item.marker ?? ''} ${item.seriesName ?? ''}: ${value.toFixed(4)}B<br/>`
        })

        html += `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid ${chartPalette.tooltipBorder};"><strong>Net: ${net > 0 ? '+' : ''}${net.toFixed(4)}B</strong></div></div>`
        return html
      },
    },
    legend: {
      data: ['Call GEX', 'Put GEX'],
      ...legendStyle,
      top: 10,
      right: 20,
    },
    grid: chartGrid({ left: 88, right: 56, top: 52, bottom: 20 }),
    dataZoom: [
      {
        type: 'inside',
        yAxisIndex: 0,
        startValue: Math.max(0, safeSpotIndex - displayRange),
        endValue: Math.min(filtered.length - 1, safeSpotIndex + displayRange),
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
      },
      {
        type: 'slider',
        yAxisIndex: 0,
        right: 10,
        width: 12,
        fillerColor: chartPalette.accentSoft,
        borderColor: 'transparent',
        handleSize: '100%',
        showDetail: false,
        textStyle: { color: 'transparent' },
      },
    ],
    xAxis: {
      type: 'value',
      ...valueAxisStyle,
      axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(2)}B` },
    },
    yAxis: {
      type: 'category',
      data: strikes,
      ...categoryAxisStyle,
    },
    series: [
      {
        name: 'Call GEX',
        type: 'bar',
        stack: 'gex',
        data: callGex,
        itemStyle: {
          color: chartLinearGradient(0, 0, 1, 0, [
            { offset: 0, color: chartPalette.positiveSoft },
            { offset: 1, color: chartPalette.positive },
          ]),
          borderRadius: [0, 3, 3, 0],
        },
        barWidth: '94%',
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
          color: chartLinearGradient(1, 0, 0, 0, [
            { offset: 0, color: chartPalette.negativeSoft },
            { offset: 1, color: chartPalette.negative },
          ]),
          borderRadius: [3, 0, 0, 3],
        },
        barWidth: '94%',
      },
    ],
  }

  return (
    <ReactECharts
      className="chart-canvas"
      ariaLabel={`Gamma exposure profile bar chart centered around spot ${spot.toFixed(2)}.`}
      fallbackText={`Horizontal bar chart showing call and put gamma exposure by strike around spot ${spot.toFixed(2)}.`}
      option={option}
      notMerge={false}
    />
  )
}
