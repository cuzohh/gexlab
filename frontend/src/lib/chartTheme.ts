import { echarts } from './echarts'

function readCssToken(name: string, fallback: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export const chartPalette = {
  tooltipBg: readCssToken('--bg-surface', '#121821'),
  tooltipBorder: readCssToken('--border-bright', 'rgba(176, 190, 210, 0.2)'),
  textMain: readCssToken('--text-main', '#eef2f7'),
  textMuted: readCssToken('--text-muted', '#a2adbd'),
  textDim: readCssToken('--text-dim', '#758195'),
  axis: readCssToken('--border-bright', 'rgba(176, 190, 210, 0.2)'),
  grid: readCssToken('--border', 'rgba(160, 173, 193, 0.12)'),
  panelEdge: readCssToken('--text-main', '#eef2f7'),
  surface: readCssToken('--bg-base', '#0c1016'),
  surfaceSoft: readCssToken('--bg-surface', '#121821'),
  positive: readCssToken('--positive', '#5ba986'),
  positiveSoft: readCssToken('--positive-soft', 'rgba(91, 169, 134, 0.12)'),
  negative: readCssToken('--negative', '#c77a7f'),
  negativeSoft: readCssToken('--negative-soft', 'rgba(199, 122, 127, 0.12)'),
  warning: readCssToken('--warning', '#c39a66'),
  warningSoft: readCssToken('--warning-soft', 'rgba(195, 154, 102, 0.12)'),
  accent: readCssToken('--accent', '#8c96c9'),
  accentSoft: readCssToken('--accent-soft', 'rgba(140, 150, 201, 0.12)'),
  accentAlt: readCssToken('--accent-2', '#8aa5b8'),
  accentAltSoft: readCssToken('--accent-2-soft', 'rgba(138, 165, 184, 0.12)'),
  ivory: readCssToken('--hero-ink', '#f4ead7'),
} as const

const chartFonts = {
  sans: readCssToken('--font-sans', "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"),
  mono: readCssToken('--font-mono', "'Cascadia Code', Consolas, monospace"),
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

export function chartGrid(overrides: Record<string, unknown> = {}) {
  return {
    containLabel: true,
    left: 24,
    right: 40,
    top: 40,
    bottom: 36,
    ...overrides,
  }
}

export function chartAxisInterval(length: number, targetTicks = 12) {
  return Math.max(0, Math.floor(length / Math.max(1, targetTicks)))
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
