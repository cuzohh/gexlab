/**
 * GEX by Expiration — Shows how much GEX each expiration date contributes.
 * Near-term expirations carry more weight in the current gamma landscape.
 */

import { ReactECharts, echarts } from '../lib/echarts'
import type { EChartsOption } from '../lib/echarts'

interface ExpGEX { expiration: string; total_gex: number }
interface Props { data: ExpGEX[] }

export default function GEXByExpiration({ data }: Props) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '3rem' }}>No expiration data</div>

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: '#16161a', borderColor: '#26262f',
      textStyle: { color: '#ededf0', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: any) => {
        const d = params as any
        return `<strong>${d.name}</strong><br/>GEX: ${d.value?.toFixed(4)}B<br/>${d.value > 0 ? '<span style="color:#10b981">POSITIVE</span>' : '<span style="color:#ef4444">NEGATIVE</span>'}`
      },
    },
    grid: { left: 80, right: 30, top: 30, bottom: 50 },
    xAxis: {
      type: 'category', data: data.map(d => d.expiration),
      axisLabel: { color: '#8a8a93', fontFamily: 'JetBrains Mono', fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: '#26262f' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#5c5c66', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}B` },
      axisLine: { lineStyle: { color: '#26262f' } },
      splitLine: { lineStyle: { color: '#1a1a22' } },
    },
    series: [{
      type: 'bar',
      data: data.map(d => ({
        value: d.total_gex,
        itemStyle: {
          color: d.total_gex >= 0
            ? new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(16,185,129,0.9)'},{offset:1,color:'rgba(16,185,129,0.3)'}])
            : new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(239,68,68,0.9)'},{offset:1,color:'rgba(239,68,68,0.3)'}]),
          borderRadius: [4,4,0,0],
        },
      })),
      barWidth: '60%',
    }],
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={false} />
}

