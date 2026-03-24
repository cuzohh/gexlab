import { echarts } from './echarts'

export const chartPalette = {
  tooltipBg: 'var(--bg-surface)',
  tooltipBorder: 'var(--border-bright)',
  textMain: 'var(--text-main)',
  textMuted: 'var(--text-muted)',
  textDim: 'var(--text-dim)',
  axis: 'var(--border-bright)',
  grid: 'var(--border)',
  panelEdge: 'var(--text-main)',
  surface: 'var(--bg-base)',
  surfaceSoft: 'var(--bg-surface)',
  positive: 'var(--positive)',
  positiveSoft: 'var(--positive-soft)',
  negative: 'var(--negative)',
  negativeSoft: 'var(--negative-soft)',
  warning: 'var(--warning)',
  warningSoft: 'var(--warning-soft)',
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
  accentAlt: 'var(--accent-2)',
  accentAltSoft: 'var(--accent-2-soft)',
  ivory: 'var(--hero-ink)',
} as const

const chartFonts = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const

export const tooltipStyle = {
  backgroundColor: chartPalette.tooltipBg,
  borderColor: chartPalette.tooltipBorder,
  textStyle: {
    color: chartPalette.textMain,
    fontFamily: chartFonts.sans,
    fontSize: 12,
  },
}

export const legendStyle = {
  textStyle: {
    color: chartPalette.textMuted,
    fontFamily: chartFonts.sans,
  },
}

export const valueAxisStyle = {
  axisLabel: {
    color: chartPalette.textDim,
    fontFamily: chartFonts.mono,
    fontSize: 10,
  },
  axisLine: { lineStyle: { color: chartPalette.axis } },
  splitLine: { lineStyle: { color: chartPalette.grid } },
}

export const categoryAxisStyle = {
  axisLabel: {
    color: chartPalette.textMuted,
    fontFamily: chartFonts.mono,
    fontSize: 10,
  },
  axisLine: { lineStyle: { color: chartPalette.axis } },
}

export function chartLinearGradient(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stops: Array<{ offset: number; color: string }>,
) {
  return new echarts.graphic.LinearGradient(x1, y1, x2, y2, stops)
}

export function chartMetricText(text: string, emphasis = false) {
  return {
    type: 'text',
    style: {
      text,
      fill: emphasis ? chartPalette.warning : chartPalette.textMuted,
      fontSize: 11,
      fontFamily: chartFonts.sans,
      fontWeight: emphasis ? 600 : 500,
    },
  }
}
