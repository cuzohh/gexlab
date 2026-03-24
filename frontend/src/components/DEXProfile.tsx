/**
 * DEX Profile - Delta Exposure by strike price.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartGrid, chartLinearGradient, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface DEXData { strike: number; call_dex: number; put_dex: number; net_dex: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: DEXData[]; spot: number; futures?: FuturesData | null }

export default function DEXProfile({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No DEX data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.85 && d.strike <= spot * 1.15)
  if (filtered.length === 0) return <ChartEmptyState>No DEX bars are available within the current spot range.</ChartEmptyState>
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
        let html = `<strong>Strike $${label}</strong><br/>`
        items.forEach((item) => {
          const value = typeof item.value === 'number' ? item.value : 0
          html += `${item.marker ?? ''} ${item.seriesName ?? ''}: ${value.toFixed(4)}B<br/>`
        })
        return html
      },
    },
    legend: { data: ['Call DEX', 'Put DEX'], ...legendStyle, top: 10, right: 20 },
    grid: chartGrid({ left: 84, right: 24, top: 50, bottom: 20 }),
    xAxis: { type: 'value', ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(2)}B` } },
    yAxis: { type: 'category', data: strikes, ...categoryAxisStyle },
    series: [
      {
        name: 'Call DEX',
        type: 'bar',
        stack: 'dex',
        data: filtered.map((d) => d.call_dex),
        itemStyle: { color: chartLinearGradient(0, 0, 1, 0, [{ offset: 0, color: chartPalette.accentSoft }, { offset: 1, color: chartPalette.accent }]), borderRadius: [0, 3, 3, 0] },
      },
      {
        name: 'Put DEX',
        type: 'bar',
        stack: 'dex',
        data: filtered.map((d) => d.put_dex),
        itemStyle: { color: chartLinearGradient(1, 0, 0, 0, [{ offset: 0, color: chartPalette.warningSoft }, { offset: 1, color: chartPalette.warning }]), borderRadius: [3, 0, 0, 3] },
      },
    ],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Delta exposure profile chart around spot ${spot.toFixed(2)}.`} fallbackText={`Horizontal bar chart showing call and put delta exposure by strike around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
