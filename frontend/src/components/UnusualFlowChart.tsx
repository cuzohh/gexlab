/**
 * Unusual Flow Bubble Chart — Surfaces strikes with abnormally high
 * volume or OI concentration relative to the chain.
 * 
 * X-axis: Strike price
 * Y-axis: Avg IV (%)
 * Bubble size: Volume (bigger = more flow)
 * Color: Green = net positive GEX (call-heavy), Red = net negative (put-heavy)
 * 
 * Highlights outlier strikes where volume > 2σ above average.
 */

import ReactECharts from 'echarts-for-react'

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

interface UnusualFlowChartProps {
  data: StrikeData[]
  spot: number
  futures?: FuturesData | null
}

export default function UnusualFlowChart({ data, spot, futures }: UnusualFlowChartProps) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No flow data available</div>
  }

  // Filter to ±15% of spot
  const lower = spot * 0.85
  const upper = spot * 1.15
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper && d.total_volume > 0)

  // Calculate anomaly threshold: mean + 2σ for volume
  const volumes = filtered.map(d => d.total_volume)
  const meanVol = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const stdVol = Math.sqrt(volumes.reduce((a, b) => a + (b - meanVol) ** 2, 0) / volumes.length)
  const anomalyThreshold = meanVol + 1.5 * stdVol

  // Scale bubble sizes (normalize volume to 5-60 range)
  const maxVol = Math.max(...volumes)

  const bubbleData = filtered.map(d => {
    const isAnomaly = d.total_volume > anomalyThreshold
    const size = Math.max(5, (d.total_volume / maxVol) * 55)

    return {
      value: [d.strike, d.avg_iv, size],
      itemStyle: {
        color: d.net_gex >= 0
          ? (isAnomaly ? 'rgba(16, 185, 129, 0.9)' : 'rgba(16, 185, 129, 0.3)')
          : (isAnomaly ? 'rgba(239, 68, 68, 0.9)' : 'rgba(239, 68, 68, 0.3)'),
        borderColor: isAnomaly
          ? (d.net_gex >= 0 ? '#10b981' : '#ef4444')
          : 'transparent',
        borderWidth: isAnomaly ? 2 : 0,
      },
      _raw: d,
      _isAnomaly: isAnomaly,
    }
  })

  const anomalyCount = bubbleData.filter(d => d._isAnomaly).length

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: '#16161a',
      borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const raw = params.data._raw as StrikeData
        const tag = params.data._isAnomaly ? '<span style="color:#f59e0b">⚡ UNUSUAL</span><br/>' : ''
        const fStr = futures ? ` (${futures.name} ${(raw.strike * futures.ratio).toFixed(2)})` : ''
        return `${tag}<strong>$${raw.strike.toFixed(2)}${fStr}</strong><br/>` +
          `IV: ${raw.avg_iv.toFixed(1)}%<br/>` +
          `Volume: ${raw.total_volume.toLocaleString()}<br/>` +
          `OI: ${raw.total_oi.toLocaleString()}<br/>` +
          `Net GEX: ${raw.net_gex.toFixed(4)}B<br/>` +
          `<span style="color:${raw.net_gex >= 0 ? '#10b981' : '#ef4444'}">${raw.net_gex >= 0 ? 'CALL HEAVY' : 'PUT HEAVY'}</span>`
      },
    },
    grid: {
      left: 70,
      right: 40,
      top: 40,
      bottom: 50,
    },
    xAxis: {
      type: 'value' as const,
      name: 'Strike',
      nameTextStyle: { color: '#5c5c66', fontSize: 11 },
      axisLabel: { 
        color: '#5c5c66', 
        fontFamily: 'JetBrains Mono', 
        fontSize: 10, 
        formatter: (v: number) => {
          if (futures) return `$${v.toFixed(2)}\n(${futures.name} ${(v * futures.ratio).toFixed(2)})`
          return `$${v.toFixed(2)}`
        }
      },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    yAxis: {
      type: 'value' as const,
      name: 'Avg IV %',
      nameTextStyle: { color: '#5c5c66', fontSize: 11 },
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    series: [
      {
        type: 'scatter',
        data: bubbleData,
        symbolSize: (val: number[]) => val[2],
        emphasis: {
          scale: 1.3,
          itemStyle: {
            shadowBlur: 15,
            shadowColor: 'rgba(94, 106, 210, 0.5)',
          },
        },
      },
    ],
    graphic: [
      {
        type: 'text',
        right: 20,
        top: 10,
        style: {
          text: `${anomalyCount} unusual strike${anomalyCount !== 1 ? 's' : ''} detected`,
          fill: anomalyCount > 0 ? '#f59e0b' : '#5c5c66',
          fontSize: 12,
          fontFamily: 'Inter',
          fontWeight: 500,
        },
      },
    ],
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '100%', width: '100%' }}
      notMerge={true}
    />
  )
}
