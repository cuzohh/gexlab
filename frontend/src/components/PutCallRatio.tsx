/**
 * Put/Call Ratio - OI-based P/C ratio across strikes.
 */

import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { categoryAxisStyle, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface PCData { strike: number; call_oi: number; put_oi: number; pc_ratio: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: PCData[]; spot: number; futures?: FuturesData | null }

export default function PutCallRatio({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <ChartEmptyState>No put/call data available.</ChartEmptyState>

  const filtered = data.filter((d) => d.strike >= spot * 0.88 && d.strike <= spot * 1.12 && (d.call_oi > 0 || d.put_oi > 0))
  const strikes = filtered.map((d) => futures ? `${d.strike.toFixed(2)} (${(d.strike * futures.ratio).toFixed(2)})` : d.strike.toFixed(2))

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const items = tooltipItems(params)
        const index = items[0]?.dataIndex
        if (index === undefined) return ''
        const entry = filtered[index]
        const futuresLabel = futures ? ` (${futures.name} ${(entry.strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${entry.strike.toFixed(2)}${futuresLabel}</strong><br/>Call OI: ${entry.call_oi.toLocaleString()}<br/>Put OI: ${entry.put_oi.toLocaleString()}<br/>P/C Ratio: <strong>${entry.pc_ratio.toFixed(2)}</strong>`
      },
    },
    legend: { data: ['Call OI', 'Put OI', 'P/C Ratio'], ...legendStyle, top: 10, right: 20 },
    grid: { left: 70, right: 70, top: 50, bottom: 30 },
    xAxis: { type: 'category', data: strikes, ...categoryAxisStyle, axisLabel: { ...categoryAxisStyle.axisLabel, color: chartPalette.textDim, fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(filtered.length / 20)) } },
    yAxis: [
      { type: 'value', name: 'Open Interest', ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}` } },
      { type: 'value', name: 'P/C Ratio', axisLabel: { ...valueAxisStyle.axisLabel, color: chartPalette.warning }, axisLine: { lineStyle: { color: chartPalette.warning } }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Call OI', type: 'bar', stack: 'oi', yAxisIndex: 0, data: filtered.map((d) => d.call_oi), itemStyle: { color: chartPalette.positiveSoft } },
      { name: 'Put OI', type: 'bar', stack: 'oi', yAxisIndex: 0, data: filtered.map((d) => d.put_oi), itemStyle: { color: chartPalette.negativeSoft } },
      {
        name: 'P/C Ratio',
        type: 'line',
        yAxisIndex: 1,
        data: filtered.map((d) => d.pc_ratio),
        smooth: true,
        lineStyle: { color: chartPalette.warning, width: 2 },
        itemStyle: { color: chartPalette.warning },
        symbol: 'none',
        markLine: {
          silent: true,
          animation: false,
          data: [{ yAxis: 1, lineStyle: { color: chartPalette.warning, type: 'dashed', width: 1 }, label: { formatter: '1.0', color: chartPalette.warning, fontSize: 10 } }],
        },
      },
    ],
  }

  return <ReactECharts className="chart-canvas" ariaLabel={`Put call ratio chart around spot ${spot.toFixed(2)}.`} fallbackText={`Combined chart showing call open interest, put open interest, and put-call ratio by strike around spot ${spot.toFixed(2)}.`} option={option} notMerge={false} />
}
