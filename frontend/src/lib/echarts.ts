import { createElement } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { use } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { CanvasRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'

use([
  BarChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

export { echarts }
export type { EChartsOption }

const MissingChartWrapper = () => createElement(
  'div',
  {
    style: {
      height: '100%',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-dim)',
      paddingTop: '3rem',
    },
  },
  'Chart module failed to load.',
)

export const ReactECharts = (ReactEChartsCore ?? MissingChartWrapper) as typeof ReactEChartsCore
