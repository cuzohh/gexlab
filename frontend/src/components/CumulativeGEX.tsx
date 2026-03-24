/**
 * Cumulative GEX - Line chart showing running sum of GEX across strikes.
 * The point where the line crosses zero is the Gamma Flip / Zero Gamma level.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartPalette, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

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

interface Props {
  data: StrikeData[]
  spot: number
  futures?: FuturesData | null
}

export default function CumulativeGEX({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No data available for this view.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.88 && d.strike <= spot * 1.12)
  const cumData = filtered.reduce<number[]>((acc, item) => {
    acc.push((acc.at(-1) ?? 0) + item.net_gex)
    return acc
  }, [])

  const strikes = filtered.map((d) => futures ? `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})` : d.strike.toFixed(2))

  let zeroCrossIndex = -1
  for (let index = 1; index < cumData.length; index += 1) {
    if ((cumData[index - 1] <= 0 && cumData[index] >= 0) || (cumData[index - 1] >= 0 && cumData[index] <= 0)) {
      zeroCrossIndex = index
      break
    }
  }

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const items = tooltipItems(params)
        const label = items[0]?.name || ''
        const value = typeof items[0]?.value === 'number' ? items[0].value : 0
        const tone = value >= 0 ? chartPalette.positive : chartPalette.negative
        const state = value >= 0 ? 'POSITIVE GAMMA' : 'NEGATIVE GAMMA'
        return `<strong>Strike $${label}</strong><br/>Cumulative GEX: ${value.toFixed(4)}B<br/><span style="color:${tone}">${state}</span>`
      },
    },
    grid: { left: 70, right: 30, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: strikes,
      ...categoryAxisStyle,
      axisLabel: { ...categoryAxisStyle.axisLabel, rotate: 45, fontSize: 9, interval: Math.max(0, Math.floor(filtered.length / 20)) },
    },
    yAxis: {
      type: 'value',
      ...valueAxisStyle,
      axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(2)}B` },
    },
    series: [{
      type: 'line',
      data: cumData,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 4 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: chartPalette.positiveSoft },
            { offset: 0.5, color: 'transparent' },
            { offset: 1, color: chartPalette.negativeSoft },
          ],
        },
      },
      itemStyle: { color: chartPalette.accent },
      markLine: {
        silent: true,
        animation: false,
        data: [
          {
            yAxis: 0,
            lineStyle: { color: chartPalette.warning, type: 'dashed', width: 3.5 },
            label: {
              formatter: 'ZERO GAMMA',
              color: chartPalette.warning,
              fontSize: 10,
              fontWeight: 600,
              backgroundColor: chartPalette.surface,
              padding: [2, 6],
              borderRadius: 3,
            },
          },
          ...(zeroCrossIndex >= 0 ? [{
            xAxis: zeroCrossIndex,
            lineStyle: { color: chartPalette.warning, type: 'dotted' as const, width: 3.5 },
            label: { show: false },
          }] : []),
        ],
      },
    }],
    visualMap: {
      show: false,
      dimension: 1,
      pieces: [
        { lte: 0, color: chartPalette.negative },
        { gt: 0, color: chartPalette.positive },
      ],
    },
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Cumulative gamma exposure chart around spot ${spot.toFixed(2)}.`} fallbackText={`Line chart showing the running cumulative gamma exposure around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
