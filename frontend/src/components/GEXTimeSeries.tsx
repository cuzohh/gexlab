import { ReactECharts, tooltipItems } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'
import ChartEmptyState from './ChartEmptyState'
import { chartMetricText, chartPalette, legendStyle, tooltipStyle, valueAxisStyle } from '../lib/chartTheme'

interface HistorySample {
  timestamp: string
  spot: number
  call_wall: number | null
  put_wall: number | null
  zero_gamma: number | null
  max_pain: number | null
  vol_trigger: number | null
  net_gex: number
  net_dex: number
  total_volume: number
  total_oi: number
  avg_iv: number
  wall_range_pct: number
  zero_gamma_distance_pct: number
  volume_oi_ratio: number
  dex_to_gex_ratio: number
}

interface Props {
  data: HistorySample[]
  loading?: boolean
}

const formatTimeLabel = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function GEXTimeSeries({ data, loading = false }: Props) {
  if (loading && data.length === 0) return <ChartEmptyState>Collecting intraday samples...</ChartEmptyState>
  if (data.length === 0) return <ChartEmptyState>Open this tab during market hours to start recording a one-minute GEX history.</ChartEmptyState>

  const labels = data.map((sample) => formatTimeLabel(sample.timestamp))
  const lastSample = data[data.length - 1]

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    legend: { top: 8, left: 12, itemGap: 14, ...legendStyle, textStyle: { ...legendStyle.textStyle, fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      ...tooltipStyle,
      formatter: (params: unknown) => {
        const points = tooltipItems(params)
        const sample = data[points[0]?.dataIndex ?? 0]
        return [
          `<strong>${formatTimeLabel(sample.timestamp)}</strong>`,
          `Spot: $${sample.spot.toFixed(2)}`,
          `Call Wall: ${sample.call_wall !== null ? `$${sample.call_wall.toFixed(2)}` : '---'}`,
          `Put Wall: ${sample.put_wall !== null ? `$${sample.put_wall.toFixed(2)}` : '---'}`,
          `Zero Gamma: ${sample.zero_gamma !== null ? `$${sample.zero_gamma.toFixed(2)}` : '---'}`,
          `Net GEX: ${sample.net_gex.toFixed(3)}B`,
          `Net DEX: ${sample.net_dex.toFixed(3)}B`,
          `Wall Range: ${sample.wall_range_pct.toFixed(2)}%`,
          `Volume/OI: ${(sample.volume_oi_ratio * 100).toFixed(2)}%`,
          `Avg IV: ${sample.avg_iv.toFixed(2)}%`,
        ].join('<br/>')
      },
    },
    grid: [
      { left: 70, right: 24, top: 48, height: '38%' },
      { left: 70, right: 24, top: '52%', height: '18%' },
      { left: 70, right: 24, top: '76%', height: '16%' },
    ],
    xAxis: [
      { type: 'category', boundaryGap: false, data: labels, axisLabel: { show: false }, axisLine: { lineStyle: { color: chartPalette.axis } } },
      { type: 'category', gridIndex: 1, boundaryGap: false, data: labels, axisLabel: { show: false }, axisLine: { lineStyle: { color: chartPalette.axis } } },
      {
        type: 'category',
        gridIndex: 2,
        boundaryGap: false,
        data: labels,
        axisLabel: { ...valueAxisStyle.axisLabel, interval: Math.max(0, Math.floor(labels.length / 8)) },
        axisLine: { lineStyle: { color: chartPalette.axis } },
      },
    ],
    yAxis: [
      { type: 'value', scale: true, ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `$${v.toFixed(0)}` } },
      { type: 'value', gridIndex: 1, scale: true, ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(2)}B` } },
      { type: 'value', gridIndex: 2, scale: true, ...valueAxisStyle, axisLabel: { ...valueAxisStyle.axisLabel, formatter: (v: number) => `${v.toFixed(1)}%` } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], startValue: Math.max(0, labels.length - 90), endValue: labels.length - 1 },
      { type: 'slider', xAxisIndex: [0, 1, 2], bottom: 8, height: 18, borderColor: chartPalette.axis, textStyle: { color: chartPalette.textDim }, startValue: Math.max(0, labels.length - 90), endValue: labels.length - 1 },
    ],
    graphic: [{ left: 74, top: 14, ...chartMetricText(`Last sample ${formatTimeLabel(lastSample.timestamp)} | Spot $${lastSample.spot.toFixed(2)} | Net GEX ${lastSample.net_gex.toFixed(2)}B`) }],
    series: [
      { name: 'Spot', type: 'line', data: data.map((s) => s.spot), symbol: 'none', lineStyle: { color: chartPalette.ivory, width: 4 }, areaStyle: { color: 'rgba(242, 245, 251, 0.05)' }, smooth: 0.15 },
      { name: 'Call Wall', type: 'line', data: data.map((s) => s.call_wall), symbol: 'none', step: 'end', lineStyle: { color: chartPalette.positive, width: 3.5 } },
      { name: 'Put Wall', type: 'line', data: data.map((s) => s.put_wall), symbol: 'none', step: 'end', lineStyle: { color: chartPalette.negative, width: 3.5 } },
      { name: 'Zero Gamma', type: 'line', data: data.map((s) => s.zero_gamma), symbol: 'none', step: 'end', lineStyle: { color: chartPalette.warning, width: 3, type: 'dashed' } },
      { name: 'Vol Trigger', type: 'line', data: data.map((s) => s.vol_trigger), symbol: 'none', step: 'end', lineStyle: { color: chartPalette.accent, width: 1.5, type: 'dotted' } },
      { name: 'Net GEX', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: data.map((s) => s.net_gex), symbol: 'none', smooth: 0.2, lineStyle: { color: chartPalette.positive, width: 3.5 }, areaStyle: { color: chartPalette.positiveSoft } },
      { name: 'Net DEX', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: data.map((s) => s.net_dex), symbol: 'none', smooth: 0.2, lineStyle: { color: chartPalette.accentAlt, width: 3.5 } },
      { name: 'Wall Range %', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: data.map((s) => s.wall_range_pct), symbol: 'none', smooth: 0.2, lineStyle: { color: chartPalette.warning, width: 1.8 } },
      { name: 'Volume/OI %', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: data.map((s) => s.volume_oi_ratio * 100), symbol: 'none', smooth: 0.2, lineStyle: { color: chartPalette.accent, width: 1.8 } },
      { name: 'Avg IV %', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: data.map((s) => s.avg_iv), symbol: 'none', smooth: 0.2, lineStyle: { color: chartPalette.negative, width: 1.8 } },
    ],
  }

  return <ReactECharts className="chart-canvas" ariaLabel="Intraday gamma time series chart." fallbackText={`Time series chart with ${data.length} intraday samples for spot, walls, net gamma, net delta, and volatility context.`} option={option} notMerge={false} />
}
