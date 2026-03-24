/**
 * OI Distribution - Open interest concentration by strike.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartAxisInterval, chartGrid, chartLinearGradient, chartMetricText, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface PCData { strike: number; call_oi: number; put_oi: number; pc_ratio: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: PCData[]; spot: number; futures?: FuturesData | null }

export default function OIDistribution({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No open interest data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.88 && d.strike <= spot * 1.12 && (d.call_oi > 0 || d.put_oi > 0))
  if (filtered.length === 0) return <ChartEmptyState>No open interest bars are available within the current spot range.</ChartEmptyState>
  const strikes = filtered.map((d) => futures ? `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})` : d.strike.toFixed(2))
  const maxOIStrike = filtered.reduce((max, d) => (d.call_oi + d.put_oi) > (max.call_oi + max.put_oi) ? d : max, filtered[0])

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const items = tooltipItems(params)
        const index = items[0]?.dataIndex
        if (index === undefined) return ''
        const entry = filtered[index]
        const total = entry.call_oi + entry.put_oi
        const futuresLabel = futures ? ` (${futures.name} ${(entry.strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${entry.strike.toFixed(2)}${futuresLabel}</strong><br/><span style="color:${chartPalette.positive}">Call OI: ${entry.call_oi.toLocaleString()}</span><br/><span style="color:${chartPalette.negative}">Put OI: ${entry.put_oi.toLocaleString()}</span><br/>Total: ${total.toLocaleString()}`
      },
    },
    legend: { data: ['Call OI', 'Put OI'], ...legendStyle, top: 10, right: 20 },
    grid: chartGrid({ left: 68, right: 18, top: 50, bottom: 48 }),
    xAxis: { type: 'category', data: strikes, ...categoryAxisStyle, axisLabel: { ...categoryAxisStyle.axisLabel, color: chartPalette.textDim, fontSize: 9, rotate: 38, interval: chartAxisInterval(filtered.length, 10) } },
    yAxis: { type: 'value', ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}` } },
    series: [
      { name: 'Call OI', type: 'bar', stack: 'oi', data: filtered.map((d) => d.call_oi), itemStyle: { color: chartLinearGradient(0, 0, 0, 1, [{ offset: 0, color: chartPalette.positive }, { offset: 1, color: chartPalette.positiveSoft }]) } },
      { name: 'Put OI', type: 'bar', stack: 'oi', data: filtered.map((d) => d.put_oi), itemStyle: { color: chartLinearGradient(0, 0, 0, 1, [{ offset: 0, color: chartPalette.negative }, { offset: 1, color: chartPalette.negativeSoft }]) } },
    ],
    graphic: [{ right: 20, top: 40, ...chartMetricText(`Max OI: $${maxOIStrike?.strike.toFixed(2)} (${(maxOIStrike.call_oi + maxOIStrike.put_oi).toLocaleString()})`) }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Open interest distribution chart around spot ${spot.toFixed(2)}.`} fallbackText={`Bar chart showing call and put open interest distribution by strike around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
