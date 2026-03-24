/**
 * Vanna Exposure - Shows vanna exposure by strike.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartLinearGradient, chartPalette, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface VannaData { strike: number; vanna_exposure: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: VannaData[]; spot: number; futures?: FuturesData | null }

export default function VannaExposure({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No vanna data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.88 && d.strike <= spot * 1.12 && d.vanna_exposure !== 0)
  const strikes = filtered.map((d) => futures ? `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})` : d.strike.toFixed(2))

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const items = tooltipItems(params)
        const label = items[0]?.name || ''
        const value = typeof items[0]?.value === 'number' ? items[0].value : 0
        const tone = value >= 0 ? chartPalette.accentAlt : chartPalette.warning
        const state = value >= 0 ? 'SUPPORTIVE' : 'DESTABILIZING'
        return `<strong>Strike $${label}</strong><br/>Vanna Exposure: ${value.toFixed(6)}B<br/><span style="color:${tone}">${state}</span>`
      },
    },
    grid: { left: 80, right: 40, top: 30, bottom: 30 },
    xAxis: { type: 'value', ...valueAxisStyle },
    yAxis: { type: 'category', data: strikes, ...categoryAxisStyle },
    series: [{
      type: 'bar',
      data: filtered.map((d) => ({
        value: d.vanna_exposure,
        itemStyle: {
          color: d.vanna_exposure >= 0
            ? chartLinearGradient(0, 0, 1, 0, [{ offset: 0, color: chartPalette.accentAltSoft }, { offset: 1, color: chartPalette.accentAlt }])
            : chartLinearGradient(1, 0, 0, 0, [{ offset: 0, color: chartPalette.warningSoft }, { offset: 1, color: chartPalette.warning }]),
          borderRadius: d.vanna_exposure >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
        },
      })),
    }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Vanna exposure chart around spot ${spot.toFixed(2)}.`} fallbackText={`Bar chart showing vanna exposure by strike around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
