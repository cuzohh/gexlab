/**
 * GEX Topology — 3D Surface representation of Gamma Exposure.
 * X: Strike, Y: Expiration, Z: GEX Magnitude.
 * Requires echarts-gl plugin.
 */

import ReactECharts from 'echarts-for-react'
import 'echarts-gl'

interface HeatmapPoint { strike: number; expiration: string; gex: number }
interface FuturesData { symbol: string; name: string; full_name: string; futures_price: number; ratio: number }
interface Props { data: HeatmapPoint[]; spot: number; futures?: FuturesData | null }

export default function GEXTopology({ data, spot, futures }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No topology data</div>

  // Filter strikes to ±10% of spot
  const lower = spot * 0.90, upper = spot * 1.10
  const filtered = data.filter(d => d.strike >= lower && d.strike <= upper)

  const rawStrikes = [...new Set(filtered.map(d => d.strike))].sort((a, b) => a - b)
  const expirations = [...new Set(filtered.map(d => d.expiration))].sort()

  const strikes = rawStrikes.map(s => {
    if (futures) return `${s.toFixed(2)}\n(${(s * futures.ratio).toFixed(0)})`
    return s.toFixed(2)
  })

  // echarts-gl 3D surface expects data as [xIndex, yIndex, zValue]
  // Provide raw GEX values for Z to avoid distortion, since visualMap handles coloring
  const surfaceData = filtered.map(d => {
    const xIdx = rawStrikes.indexOf(d.strike)
    const yIdx = expirations.indexOf(d.expiration)
    return [xIdx, yIdx, d.gex]
  })

  // Find abs max for symmetrical color scaling
  const absMax = Math.max(...surfaceData.map(d => Math.abs(d[2] as number)), 0.001)

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const x = rawStrikes[params.value[0]]
        const y = expirations[params.value[1]]
        const z = params.value[2]
        const fStr = futures ? ` (${futures.name} ${(x * futures.ratio).toFixed(2)})` : ''
        return `<strong>$${x.toFixed(2)}${fStr}</strong> | ${y}<br/>GEX: ${z.toFixed(4)}B`
      },
    },
    visualMap: {
      min: -absMax, max: absMax,
      calculable: false, show: false,
      inRange: {
        color: [
          '#dc2626',   // deep red
          '#1a1a22',   // neutral dark
          '#10b981',   // bright green
        ],
      },
    },
    xAxis3D: {
      type: 'category', data: strikes,
      name: 'Strike', nameTextStyle: { color: '#5c5c66' },
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 9, interval: Math.floor(strikes.length / 10) },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { show: false },
    },
    yAxis3D: {
      type: 'category', data: expirations,
      name: 'Expiration', nameTextStyle: { color: '#5c5c66' },
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 9 },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { show: false },
    },
    zAxis3D: {
      type: 'value',
      name: 'GEX', nameTextStyle: { color: '#5c5c66' },
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}B` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { show: false },
    },
    grid3D: {
      boxWidth: 200, boxDepth: 120, boxHeight: 60,
      viewControl: {
        projection: 'perspective',
        alpha: 35,    // vertical tilt
        beta: 45,     // horizontal rotation
        distance: 280,
      },
      light: {
        main: { intensity: 1.2, shadow: true },
        ambient: { intensity: 0.3 },
      },
    },
    series: [{
      type: 'surface',
      wireframe: { show: true, lineStyle: { color: 'rgba(255,255,255,0.1)', width: 1 } },
      shading: 'lambert', // adds 3D lighting highlights
      data: surfaceData,
    }],
  }

  // notMerge=true is usually safer for echarts-gl 3D components on update
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
}

