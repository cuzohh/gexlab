/**
 * GEX by Expiration - Shows how much GEX each expiration date contributes.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartLinearGradient, chartPalette, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface ExpGEX { expiration: string; total_gex: number }
interface Props { data: ExpGEX[] }

export default function GEXByExpiration({ data }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No expiration data available.</ChartEmptyState>

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const [item] = tooltipItems(params)
        const value = typeof item?.value === 'number' ? item.value : 0
        const tone = value > 0 ? chartPalette.positive : chartPalette.negative
        const label = value > 0 ? 'POSITIVE' : 'NEGATIVE'
        return `<strong>${item?.name ?? ''}</strong><br/>GEX: ${value.toFixed(4)}B<br/><span style="color:${tone}">${label}</span>`
      },
    },
    grid: { left: 80, right: 30, top: 30, bottom: 50 },
    xAxis: { type: 'category', data: data.map((d) => d.expiration), ...categoryAxisStyle, axisLabel: { ...categoryAxisStyle.axisLabel, rotate: 30 } },
    yAxis: { type: 'value', ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(2)}B` } },
    series: [{
      type: 'bar',
      data: data.map((d) => ({
        value: d.total_gex,
        itemStyle: {
          color: d.total_gex >= 0
            ? chartLinearGradient(0, 0, 0, 1, [{ offset: 0, color: chartPalette.positive }, { offset: 1, color: chartPalette.positiveSoft }])
            : chartLinearGradient(0, 0, 0, 1, [{ offset: 0, color: chartPalette.negative }, { offset: 1, color: chartPalette.negativeSoft }]),
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barWidth: '60%',
    }],
  }

  return <ReactECharts className="chart-canvas" ariaLabel="Gamma exposure by expiration chart." fallbackText="Bar chart showing total gamma exposure for each expiration." option={option} notMerge={false} />
}
