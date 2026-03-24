/**
 * GEX Heatmap - Heatmap of gamma exposure by strike and expiration.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartAxisInterval, chartGrid, chartPalette, tooltipStyle } from '../lib/chartTheme'

interface HeatmapPoint { strike: number; expiration: string; gex: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface GEXHeatmapProps { data: HeatmapPoint[]; spot: number; futures?: FuturesData | null }

export default function GEXHeatmap({ data, spot, futures }: GEXHeatmapProps) {
  if (!data || data.length === 0) return <ChartEmptyState>No heatmap data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.9 && d.strike <= spot * 1.1)
  if (filtered.length === 0) return <ChartEmptyState>No heatmap cells are available within the current spot range.</ChartEmptyState>
  const strikes = [...new Set(filtered.map((d) => d.strike))].sort((a, b) => a - b)
  const expirations = [...new Set(filtered.map((d) => d.expiration))].sort()
  const heatmapData = filtered.map((d) => [strikes.indexOf(d.strike), expirations.indexOf(d.expiration), d.gex >= 0 ? Math.sqrt(Math.abs(d.gex)) : -Math.sqrt(Math.abs(d.gex))])
  const absMax = Math.max(...heatmapData.map((d) => Math.abs(d[2] as number)), 0.001)

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const [item] = tooltipItems(params)
        const value = Array.isArray(item?.value) ? item.value : []
        const strike = strikes[Number(value[0])]
        const expiration = expirations[Number(value[1])]
        const rawGex = filtered.find((d) => d.strike === strike && d.expiration === expiration)?.gex || 0
        const futuresLabel = futures ? ` (${futures.name} ${(strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${strike.toFixed(2)}${futuresLabel}</strong> | ${expiration}<br/>GEX: ${rawGex.toFixed(4)}B`
      },
    },
    grid: chartGrid({ left: 92, right: 16, top: 24, bottom: 68 }),
    xAxis: {
      type: 'category',
      data: strikes.map((strike) => futures ? `$${strike.toFixed(2)}\n(${futures.name} ${(strike * futures.ratio).toFixed(2)})` : `$${strike.toFixed(2)}`),
      ...categoryAxisStyle,
      axisLabel: { ...categoryAxisStyle.axisLabel, color: chartPalette.textDim, fontSize: 9, rotate: 38, interval: chartAxisInterval(strikes.length, 10) },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: expirations,
      ...categoryAxisStyle,
      splitArea: { show: false },
    },
    visualMap: {
      min: -absMax,
      max: absMax,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 120,
      textStyle: { color: chartPalette.textDim, fontSize: 10 },
      inRange: {
        color: [chartPalette.negative, '#6d3139', chartPalette.surfaceSoft, '#285345', chartPalette.positive],
      },
    },
    series: [{
      name: 'GEX',
      type: 'heatmap',
      data: heatmapData,
      emphasis: { itemStyle: { borderColor: chartPalette.panelEdge, borderWidth: 1 } },
      itemStyle: { borderColor: chartPalette.surface, borderWidth: 1, borderRadius: 2 },
    }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Gamma exposure heatmap around spot ${spot.toFixed(2)} across expirations.`} fallbackText={`Heatmap of gamma exposure by strike and expiration around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
