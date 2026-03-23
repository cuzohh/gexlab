/**
 * GEX Heatmap — Per-expiry √-normalised heatmap showing which strikes
 * carry the most dealer exposure across every live expiration.
 * 
 * X-axis: Strikes, Y-axis: Expirations, Color intensity: GEX magnitude.
 * Green = positive GEX (call dominated), Red = negative GEX (put dominated).
 */

import { ReactECharts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface HeatmapPoint {
  strike: number
  expiration: string
  gex: number
}

interface FuturesData {
  symbol: string
  name: string
  full_name: string
  futures_price: number
  ratio: number
}

interface GEXHeatmapProps {
  data: HeatmapPoint[]
  spot: number
  futures?: FuturesData | null
}

export default function GEXHeatmap({ data, spot, futures }: GEXHeatmapProps) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No heatmap data available</div>
  }

  // Filter strikes to ±10% of spot
  const lowerBound = spot * 0.90
  const upperBound = spot * 1.10
  const filtered = data.filter(d => d.strike >= lowerBound && d.strike <= upperBound)

  // Get unique strikes and expirations
  const strikes = [...new Set(filtered.map(d => d.strike))].sort((a, b) => a - b)
  const expirations = [...new Set(filtered.map(d => d.expiration))].sort()

  // Apply sqrt normalization
  const heatmapData = filtered.map(d => {
    const xIdx = strikes.indexOf(d.strike)
    const yIdx = expirations.indexOf(d.expiration)
    // √-normalization preserves sign but compresses magnitude
    const normalized = d.gex >= 0 ? Math.sqrt(Math.abs(d.gex)) : -Math.sqrt(Math.abs(d.gex))
    return [xIdx, yIdx, normalized]
  })

  // Get max value for visual map range
  const absMax = Math.max(...heatmapData.map(d => Math.abs(d[2] as number)), 0.001)

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: '#16161a',
      borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const strike = strikes[params.value[0]]
        const exp = expirations[params.value[1]]
        const rawGex = filtered.find(d => d.strike === strike && d.expiration === exp)?.gex || 0
        const fStr = futures ? ` (${futures.name} ${(strike * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${strike.toFixed(2)}${fStr}</strong> | ${exp}<br/>GEX: ${rawGex.toFixed(4)}B`
      },
    },
    grid: {
      left: 100,
      right: 20,
      top: 20,
      bottom: 60,
    },
      xAxis: {
      type: 'category',
      data: strikes.map(s => {
        if (futures) return `$${s.toFixed(2)}\n(${futures.name} ${(s * futures.ratio).toFixed(2)})`
        return `$${s.toFixed(2)}`
      }),
      axisLabel: {
        color: '#5c5c66',
        fontFamily: 'JetBrains Mono',
        fontSize: 9,
        rotate: 45,
        interval: Math.max(0, Math.floor(strikes.length / 20)),
      },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: expirations,
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 10 },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitArea: { show: false },
    },
    visualMap: {
      min: -absMax,
      max: absMax,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 120,
      textStyle: { color: '#5c5c66', fontSize: 10 },
      inRange: {
        color: [
          '#dc2626',   // deep red (strong negative GEX)
          '#7f1d1d',   // dark red
          '#1a1a22',   // neutral center
          '#064e3b',   // dark green  
          '#10b981',   // bright green (strong positive GEX)
        ],
      },
    },
    series: [
      {
        name: 'GEX',
        type: 'heatmap',
        data: heatmapData,
        emphasis: {
          itemStyle: {
            borderColor: '#ededf0',
            borderWidth: 1,
          },
        },
        itemStyle: {
          borderColor: '#0a0a0c',
          borderWidth: 1,
          borderRadius: 2,
        },
      },
    ],
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '100%', width: '100%' }}
      notMerge={false}
    />
  )
}

