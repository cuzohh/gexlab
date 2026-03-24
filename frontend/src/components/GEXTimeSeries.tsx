import { ReactECharts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

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

const formatTimeLabel = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function GEXTimeSeries({ data, loading = false }: Props) {
  if (loading && data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>Collecting intraday samples...</div>
  }

  if (data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>Open this tab during market hours to start recording a one-minute GEX history.</div>
  }

  const labels = data.map((sample) => formatTimeLabel(sample.timestamp))
  const spot = data.map((sample) => sample.spot)
  const callWall = data.map((sample) => sample.call_wall)
  const putWall = data.map((sample) => sample.put_wall)
  const zeroGamma = data.map((sample) => sample.zero_gamma)
  const volTrigger = data.map((sample) => sample.vol_trigger)
  const netGex = data.map((sample) => sample.net_gex)
  const netDex = data.map((sample) => sample.net_dex)
  const wallRange = data.map((sample) => sample.wall_range_pct)
  const volumeOiRatio = data.map((sample) => sample.volume_oi_ratio * 100)
  const avgIv = data.map((sample) => sample.avg_iv)
  const lastSample = data[data.length - 1]

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    legend: {
      top: 8,
      left: 12,
      textStyle: { color: '#8a8a93', fontFamily: 'Inter', fontSize: 11 },
      itemGap: 14,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#16161a',
      borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const points = Array.isArray(params) ? params : [params]
        const index = points[0]?.dataIndex ?? 0
        const sample = data[index]
        const rows = [
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
        ]
        return rows.join('<br/>')
      },
    },
    grid: [
      { left: 70, right: 24, top: 48, height: '38%' },
      { left: 70, right: 24, top: '52%', height: '18%' },
      { left: 70, right: 24, top: '76%', height: '16%' },
    ],
    xAxis: [
      {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#26262f' } },
      },
      {
        type: 'category',
        gridIndex: 1,
        boundaryGap: false,
        data: labels,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#26262f' } },
      },
      {
        type: 'category',
        gridIndex: 2,
        boundaryGap: false,
        data: labels,
        axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, interval: Math.max(0, Math.floor(labels.length / 8)) },
        axisLine: { lineStyle: { color: '#26262f' } },
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `$${v.toFixed(0)}` },
        axisLine: { lineStyle: { color: '#26262f' } },
        splitLine: { lineStyle: { color: '#1a1a22' } },
      },
      {
        type: 'value',
        gridIndex: 1,
        scale: true,
        axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}B` },
        axisLine: { lineStyle: { color: '#26262f' } },
        splitLine: { lineStyle: { color: '#1a1a22' } },
      },
      {
        type: 'value',
        gridIndex: 2,
        scale: true,
        axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
        axisLine: { lineStyle: { color: '#26262f' } },
        splitLine: { lineStyle: { color: '#1a1a22' } },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], startValue: Math.max(0, labels.length - 90), endValue: labels.length - 1 },
      { type: 'slider', xAxisIndex: [0, 1, 2], bottom: 8, height: 18, borderColor: '#26262f', textStyle: { color: '#5c5c66' }, startValue: Math.max(0, labels.length - 90), endValue: labels.length - 1 },
    ],
    graphic: [
      {
        type: 'text',
        left: 74,
        top: 14,
        style: {
          text: `Last sample ${formatTimeLabel(lastSample.timestamp)} | Spot $${lastSample.spot.toFixed(2)} | Net GEX ${lastSample.net_gex.toFixed(2)}B`,
          fill: '#8a8a93',
          fontSize: 11,
          fontFamily: 'Inter',
        },
      },
    ],
    series: [
      {
        name: 'Spot',
        type: 'line',
        data: spot,
        symbol: 'none',
        lineStyle: { color: '#ededf0', width: 4 },
        areaStyle: { color: 'rgba(237, 237, 240, 0.05)' },
        smooth: 0.15,
      },
      {
        name: 'Call Wall',
        type: 'line',
        data: callWall,
        symbol: 'none',
        step: 'end',
        lineStyle: { color: '#10b981', width: 3.5 },
      },
      {
        name: 'Put Wall',
        type: 'line',
        data: putWall,
        symbol: 'none',
        step: 'end',
        lineStyle: { color: '#ef4444', width: 3.5 },
      },
      {
        name: 'Zero Gamma',
        type: 'line',
        data: zeroGamma,
        symbol: 'none',
        step: 'end',
        lineStyle: { color: '#f59e0b', width: 3, type: 'dashed' },
      },
      {
        name: 'Vol Trigger',
        type: 'line',
        data: volTrigger,
        symbol: 'none',
        step: 'end',
        lineStyle: { color: '#5e6ad2', width: 1.5, type: 'dotted' },
      },
      {
        name: 'Net GEX',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: netGex,
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: '#10b981', width: 3.5 },
        areaStyle: { color: 'rgba(16, 185, 129, 0.08)' },
      },
      {
        name: 'Net DEX',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: netDex,
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: '#60a5fa', width: 3.5 },
      },
      {
        name: 'Wall Range %',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: wallRange,
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: '#f59e0b', width: 1.8 },
      },
      {
        name: 'Volume/OI %',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: volumeOiRatio,
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: '#c084fc', width: 1.8 },
      },
      {
        name: 'Avg IV %',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: avgIv,
        symbol: 'none',
        smooth: 0.2,
        lineStyle: { color: '#fb7185', width: 1.8 },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}
