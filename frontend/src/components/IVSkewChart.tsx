/**
 * IV Skew - Implied Volatility smile/skew across strikes.
 */

import { ReactECharts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartMetricText, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface IVData { strike: number; call_iv: number; put_iv: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: IVData[]; spot: number; futures?: FuturesData | null }

export default function IVSkewChart({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No IV data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.88 && d.strike <= spot * 1.12 && (d.call_iv > 0 || d.put_iv > 0))
  const strikes = filtered.map((d) => futures ? `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})` : d.strike.toFixed(2))

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...tooltipStyle },
    legend: { data: ['Call IV', 'Put IV'], ...legendStyle, top: 10, right: 20 },
    grid: { left: 60, right: 30, top: 50, bottom: 30 },
    xAxis: { type: 'category', data: strikes, ...categoryAxisStyle, axisLabel: { ...categoryAxisStyle.axisLabel, color: chartPalette.textDim, fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) } },
    yAxis: { type: 'value', name: 'IV %', ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(0)}%` } },
    series: [
      { name: 'Call IV', type: 'line', data: filtered.map((d) => d.call_iv), smooth: true, lineStyle: { color: chartPalette.positive, width: 2 }, itemStyle: { color: chartPalette.positive }, areaStyle: { color: chartPalette.positiveSoft }, symbol: 'none' },
      { name: 'Put IV', type: 'line', data: filtered.map((d) => d.put_iv), smooth: true, lineStyle: { color: chartPalette.negative, width: 2 }, itemStyle: { color: chartPalette.negative }, areaStyle: { color: chartPalette.negativeSoft }, symbol: 'none' },
    ],
    graphic: [{ right: 20, top: 10, ...chartMetricText(`Spot: $${spot.toFixed(2)}`) }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Implied volatility skew chart around spot ${spot.toFixed(2)}.`} fallbackText={`Line chart showing call and put implied volatility by strike around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
