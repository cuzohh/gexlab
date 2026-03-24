/**
 * GEX Topology - layered strike profiles by expiration.
 */

import { ReactECharts, type EChartsOption, tooltipItems } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartAxisInterval, chartGrid, chartMetricText, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface HeatmapPoint { strike: number; expiration: string; gex: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: HeatmapPoint[]; spot: number; futures?: FuturesData | null }

const MAX_EXPIRATIONS = 6
const topologySeriesColors = [
  chartPalette.ivory,
  chartPalette.accent,
  chartPalette.accentAlt,
  chartPalette.warning,
  chartPalette.positive,
  chartPalette.textMuted,
] as const

export default function GEXTopology({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No topology data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.9 && d.strike <= spot * 1.1)
  if (filtered.length === 0) return <ChartEmptyState>No topology points are available within the current spot range.</ChartEmptyState>

  const expirations = [...new Set(filtered.map((d) => d.expiration))].sort().slice(0, MAX_EXPIRATIONS)
  if (expirations.length === 0) return <ChartEmptyState>No expiration curves are available yet.</ChartEmptyState>

  const strikes = [...new Set(filtered.map((d) => d.strike))].sort((a, b) => a - b)
  if (strikes.length < 2) return <ChartEmptyState>Not enough strike detail is available to draw the topology view.</ChartEmptyState>

  const strikeLabels = strikes.map((strike) => (
    futures ? `$${strike.toFixed(2)}\n(${futures.name} ${(strike * futures.ratio).toFixed(0)})` : `$${strike.toFixed(2)}`
  ))
  const spotIndex = strikes.reduce((closestIndex, strike, index) => (
    Math.abs(strike - spot) < Math.abs(strikes[closestIndex] - spot) ? index : closestIndex
  ), 0)
  const maxAbsGex = Math.max(...filtered.map((point) => Math.abs(point.gex)), 0.001)
  const interval = chartAxisInterval(strikes.length, 10)

  const series = expirations.map((expiration, index) => {
    const pointsByStrike = new Map(
      filtered
        .filter((point) => point.expiration === expiration)
        .map((point) => [point.strike, point.gex]),
    )

    return {
      name: expiration,
      type: 'line' as const,
      smooth: 0.22,
      symbol: 'none' as const,
      connectNulls: false,
      emphasis: { focus: 'series' as const },
      lineStyle: {
        color: topologySeriesColors[index] ?? chartPalette.textMuted,
        width: index === 0 ? 3.2 : 2.2,
        opacity: Math.max(0.44, 1 - index * 0.1),
      },
      data: strikes.map((strike) => pointsByStrike.get(strike) ?? null),
      markLine: index === 0
        ? {
            symbol: 'none' as const,
            lineStyle: { color: chartPalette.warning, type: 'dashed' as const, width: 1.2 },
            label: {
              formatter: 'SPOT',
              color: chartPalette.warning,
              fontSize: 10,
              fontWeight: 600,
            },
            data: [{ xAxis: spotIndex }],
          }
        : undefined,
    }
  })

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    legend: {
      ...legendStyle,
      top: 8,
      left: 14,
      itemGap: 14,
      data: expirations,
      textStyle: { ...legendStyle.textStyle, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const points = tooltipItems(params)
        const strikeIndex = Number(points[0]?.axisValue ?? 0)
        const strike = strikes[strikeIndex] ?? strikes[0]
        const futuresLabel = futures ? ` (${futures.name} ${(strike * futures.ratio).toFixed(2)})` : ''

        return [
          `<strong>$${strike.toFixed(2)}${futuresLabel}</strong>`,
          ...points.map((point) => {
            const value = typeof point.value === 'number' ? point.value : Number(point.value ?? 0)
            return `${point.marker ?? ''}${point.seriesName ?? 'Expiration'}: ${value.toFixed(4)}B`
          }),
        ].join('<br/>')
      },
    },
    grid: chartGrid({ left: 72, right: 18, top: 58, bottom: 56 }),
    xAxis: {
      type: 'category',
      data: strikeLabels,
      ...categoryAxisStyle,
      boundaryGap: false,
      axisLabel: { ...categoryAxisStyle.axisLabel, color: chartPalette.textDim, fontSize: 9, interval, rotate: 38 },
    },
    yAxis: {
      type: 'value',
      name: 'GEX',
      ...valueAxisStyle,
      axisLabel: { ...valueAxisStyle.axisLabel, formatter: (value: number) => `${value.toFixed(2)}B` },
    },
    graphic: [{
      left: 74,
      top: 16,
      ...chartMetricText(`Nearest ${expirations.length} expirations | Peak ${maxAbsGex.toFixed(2)}B`),
    }],
    series,
  }

  return (
    <ReactECharts
      className="chart-canvas"
      ariaLabel={`Gamma topology chart around spot ${spot.toFixed(2)} across the nearest ${expirations.length} expirations.`}
      fallbackText={`Layered line chart showing gamma exposure by strike for the nearest ${expirations.length} expirations around spot ${spot.toFixed(2)}.`}
      option={option}
      notMerge={false}
    />
  )
}
