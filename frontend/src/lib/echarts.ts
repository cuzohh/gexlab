/**
 * Shared ECharts barrel – tree-shakes chart types & components,
 * then re-exports a pre-wired <ReactECharts> wrapper so every
 * consumer gets the `echarts` instance injected automatically.
 */

import { createElement, type CSSProperties } from 'react'
import _ReactEChartsCore from 'echarts-for-react/lib/core'
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AriaComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { use as registerECharts } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { CanvasRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'

// Register only the pieces we actually use (tree-shaking).
registerECharts([
  AriaComponent,
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

interface AccessibleEChartsOption extends EChartsOption {
  aria?: {
    enabled?: boolean
    description?: string
  }
}

export interface TooltipAxisParam {
  axisValue?: string | number
  value?: number | string | number[] | null
  seriesName?: string
  marker?: string
  dataIndex?: number
  name?: string
  data?: unknown
}

export type TooltipFormatterParams = TooltipAxisParam | TooltipAxisParam[]

export function tooltipItems(params: unknown): TooltipAxisParam[] {
  if (Array.isArray(params)) {
    return params.filter(isTooltipAxisParam)
  }
  return isTooltipAxisParam(params) ? [params] : []
}

function isTooltipAxisParam(value: unknown): value is TooltipAxisParam {
  return typeof value === 'object' && value !== null
}

interface EChartsWrapperProps {
  option?: AccessibleEChartsOption
  style?: CSSProperties
  className?: string
  ariaLabel?: string
  fallbackText?: string
  role?: string
  [key: string]: unknown
}

const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

// echarts-for-react/lib/core may resolve to { default: Component }
// under CJS interop in production builds. Unwrap if needed.
const CoreComponent =
  typeof _ReactEChartsCore === 'function'
    ? _ReactEChartsCore
    : ((_ReactEChartsCore as { default?: typeof _ReactEChartsCore })?.default)

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

// The "core" variant requires the `echarts` object as an explicit prop.
// Wrap it so consumers never have to pass it manually.
function EChartsWrapper(props: EChartsWrapperProps) {
  if (typeof CoreComponent !== 'function') {
    return MissingChartWrapper()
  }

  const {
    option,
    style,
    className,
    ariaLabel,
    fallbackText,
    role = 'img',
    ...restProps
  } = props

  const description = fallbackText ?? ariaLabel
  const enhancedOption = option
    ? {
        ...option,
        aria: {
          enabled: true,
          description,
          ...option.aria,
        },
      }
    : option

  return createElement(
    'div',
    {
      role,
      'aria-label': ariaLabel ?? description,
      className,
      style: {
        ...style,
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
      },
    },
    description
      ? createElement('span', { style: visuallyHiddenStyle }, description)
      : null,
    createElement(CoreComponent as never, {
      ...restProps,
      option: enhancedOption,
      style: { height: '100%', width: '100%' },
      echarts,
    }),
  )
}

export const ReactECharts = EChartsWrapper
