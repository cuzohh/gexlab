/**
 * Unusual Flow Bubble Chart - Surfaces strikes with abnormally high volume or OI concentration.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { chartGrid, chartMetricText, chartPalette, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface StrikeData {
  strike: number
  call_gex: number
  put_gex: number
  net_gex: number
  total_oi: number
  total_volume: number
  avg_iv: number
}

interface FuturesData {
  symbol: string
  name: string
  full_name: string
  futures_price: number
  ratio: number
}

interface UnusualFlowChartProps {
  data: StrikeData[]
  spot: number
  futures?: FuturesData | null
}

interface BubblePoint {
  value: [number, number, number]
  itemStyle: { color: string; borderColor: string; borderWidth: number }
  _raw: StrikeData
  _isAnomaly: boolean
}

export default function UnusualFlowChart({ data, spot, futures }: UnusualFlowChartProps) {
  if (!data || data.length === 0) return <ChartEmptyState>No flow data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.85 && d.strike <= spot * 1.15 && d.total_volume > 0)
  if (filtered.length === 0) return <ChartEmptyState>No flow bubbles are available within the current spot range.</ChartEmptyState>
  const volumes = filtered.map((d) => d.total_volume)
  const meanVolume = volumes.reduce((sum, value) => sum + value, 0) / volumes.length
  const stdVolume = Math.sqrt(volumes.reduce((sum, value) => sum + (value - meanVolume) ** 2, 0) / volumes.length)
  const anomalyThreshold = meanVolume + 1.5 * stdVolume
  const maxVolume = Math.max(...volumes)

  const bubbleData = filtered.map((entry) => {
    const isAnomaly = entry.total_volume > anomalyThreshold
    const size = Math.max(5, (entry.total_volume / maxVolume) * 55)
    const positive = entry.net_gex >= 0
    return {
      value: [entry.strike, entry.avg_iv, size],
      itemStyle: {
        color: positive ? (isAnomaly ? chartPalette.positive : chartPalette.positiveSoft) : (isAnomaly ? chartPalette.negative : chartPalette.negativeSoft),
        borderColor: isAnomaly ? (positive ? chartPalette.positive : chartPalette.negative) : 'transparent',
        borderWidth: isAnomaly ? 2 : 0,
      },
      _raw: entry,
      _isAnomaly: isAnomaly,
    }
  })

  const anomalyCount = bubbleData.filter((entry) => entry._isAnomaly).length

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const [item] = tooltipItems(params)
        const point = item?.data as BubblePoint | undefined
        const raw = point?._raw
        if (!raw) return ''
        const tag = point._isAnomaly ? `<span style="color:${chartPalette.warning}">UNUSUAL</span><br/>` : ''
        const futuresLabel = futures ? ` (${futures.name} ${(raw.strike * futures.ratio).toFixed(2)})` : ''
        const flowLabel = raw.net_gex >= 0 ? 'CALL HEAVY' : 'PUT HEAVY'
        const flowColor = raw.net_gex >= 0 ? chartPalette.positive : chartPalette.negative
        return `${tag}<strong>$${raw.strike.toFixed(2)}${futuresLabel}</strong><br/>IV: ${raw.avg_iv.toFixed(1)}%<br/>Volume: ${raw.total_volume.toLocaleString()}<br/>OI: ${raw.total_oi.toLocaleString()}<br/>Net GEX: ${raw.net_gex.toFixed(4)}B<br/><span style="color:${flowColor}">${flowLabel}</span>`
      },
    },
    grid: chartGrid({ left: 68, right: 20, top: 40, bottom: 54 }),
    xAxis: { type: 'value', name: 'Strike', nameTextStyle: { color: chartPalette.textDim, fontSize: 11 }, ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => futures ? `$${v.toFixed(2)}\n(${futures.name} ${(v * futures.ratio).toFixed(2)})` : `$${v.toFixed(2)}` } },
    yAxis: { type: 'value', name: 'Avg IV %', nameTextStyle: { color: chartPalette.textDim, fontSize: 11 }, ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(0)}%` } },
    series: [{
      type: 'scatter',
      data: bubbleData,
      symbolSize: (value: number[]) => value[2],
      emphasis: { scale: 1.3, itemStyle: { shadowBlur: 15, shadowColor: chartPalette.accentSoft } },
    }],
    graphic: [{ right: 20, top: 10, ...chartMetricText(`${anomalyCount} unusual strike${anomalyCount !== 1 ? 's' : ''} detected`, anomalyCount > 0) }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Unusual flow scatter chart around spot ${spot.toFixed(2)}.`} fallbackText={`Scatter chart highlighting unusual flow and volume-open-interest relationships around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
