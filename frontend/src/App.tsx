import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import KeyLevelsPanel from './components/KeyLevelsPanel'
import DesktopTitleBar from './components/DesktopTitleBar'
import LogoMark from './components/LogoMark'
import ChartEmptyState from './components/ChartEmptyState'

const GEXBarChart = lazy(() => import('./components/GEXBarChart'))
const GEXHeatmap = lazy(() => import('./components/GEXHeatmap'))
const UnusualFlowChart = lazy(() => import('./components/UnusualFlowChart'))
const DEXProfile = lazy(() => import('./components/DEXProfile'))
const GEXByExpiration = lazy(() => import('./components/GEXByExpiration'))
const CumulativeGEX = lazy(() => import('./components/CumulativeGEX'))
const GEXTimeSeries = lazy(() => import('./components/GEXTimeSeries'))
const IVSkewChart = lazy(() => import('./components/IVSkewChart'))
const PutCallRatio = lazy(() => import('./components/PutCallRatio'))
const VannaExposure = lazy(() => import('./components/VannaExposure'))
const OIDistribution = lazy(() => import('./components/OIDistribution'))
const GEXTopology = lazy(() => import('./components/GEXTopology'))

interface StrikeData {
  strike: number
  call_gex: number
  put_gex: number
  net_gex: number
  total_oi: number
  total_volume: number
  avg_iv: number
}

interface HeatmapPoint {
  strike: number
  expiration: string
  gex: number
}

interface KeyLevels {
  call_wall: number | null
  call_wall_gex: number
  put_wall: number | null
  put_wall_gex: number
  zero_gamma: number | null
  max_pain: number | null
  vol_trigger: number | null
}

interface FuturesData {
  symbol: string
  name: string
  full_name: string
  futures_price: number
  ratio: number
}

interface ApiMeta {
  source: string
  generated_at: string
  cache_hit: boolean
  cache_age_seconds: number
}

interface ApiErrorPayload {
  error?: string
  detail?: string
  retry_after_seconds?: number
}

interface ErrorDetails {
  kind: ErrorKind
  message: string
}

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

interface HistoryPayload {
  symbol: string
  count: number
  samples: HistorySample[]
}

interface DEXStrike { strike: number; call_dex: number; put_dex: number; net_dex: number }
interface ExpGEX { expiration: string; total_gex: number }
interface IVPoint { strike: number; call_iv: number; put_iv: number }
interface PCPoint { strike: number; call_oi: number; put_oi: number; pc_ratio: number }
interface VannaPoint { strike: number; vanna_exposure: number }

interface GEXData {
  spot: number
  regime: string
  net_gex: number
  net_dex: number
  key_levels: KeyLevels
  expirations: string[]
  gex_by_strike: StrikeData[]
  heatmap_data: HeatmapPoint[]
  futures: FuturesData | null
  dex_by_strike: DEXStrike[]
  gex_by_expiration: ExpGEX[]
  iv_skew: IVPoint[]
  pc_ratio: PCPoint[]
  vanna_by_strike: VannaPoint[]
  meta?: ApiMeta
}

const API_BASE = window.gexlabDesktop?.apiBase || import.meta.env.VITE_API_URL || 'http://localhost:8000'
const AUTO_REFRESH_INTERVAL = 60_000
const isDesktop = Boolean(window.gexlabDesktop?.isDesktop)
const WEBSITE_URL = import.meta.env.VITE_GEXLAB_WEBSITE_URL || 'https://github.com/cuzohh/gexlab#readme'
const DEFAULT_TICKER = 'SPY'
const MAX_TICKER_LENGTH = 15
const tickerPattern = /[^A-Z0-9.^/-]/g

type DashboardTab = 'bar' | 'heatmap' | 'topology' | 'exp' | 'cumulative' | 'timeseries' | 'dex' | 'vanna' | 'flow' | 'iv' | 'pc' | 'oi'
type ErrorKind = 'rate_limited' | 'generic' | null

type TabItem = { key: DashboardTab; label: string } | { divider: string }

const tabs: TabItem[] = [
  { key: 'bar', label: 'GEX Profile' },
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'topology', label: 'Topology' },
  { key: 'exp', label: 'By Exp' },
  { key: 'cumulative', label: 'Cumulative' },
  { key: 'timeseries', label: 'Time Series' },
  { divider: 'Greeks' },
  { key: 'dex', label: 'DEX' },
  { key: 'vanna', label: 'Vanna' },
  { divider: 'Sentiment' },
  { key: 'flow', label: 'Flow' },
  { key: 'iv', label: 'IV Skew' },
  { key: 'pc', label: 'P/C Ratio' },
  { key: 'oi', label: 'OI Dist.' },
]

const mobileTabGroups: Array<{ label: string; items: Array<{ key: DashboardTab; label: string }> }> = [
  {
    label: 'Gamma',
    items: [
      { key: 'bar', label: 'GEX Profile' },
      { key: 'heatmap', label: 'Heatmap' },
      { key: 'topology', label: 'Topology' },
      { key: 'exp', label: 'By Expiration' },
      { key: 'cumulative', label: 'Cumulative' },
      { key: 'timeseries', label: 'Time Series' },
    ],
  },
  {
    label: 'Greeks',
    items: [
      { key: 'dex', label: 'DEX' },
      { key: 'vanna', label: 'Vanna' },
    ],
  },
  {
    label: 'Sentiment',
    items: [
      { key: 'flow', label: 'Flow' },
      { key: 'iv', label: 'IV Skew' },
      { key: 'pc', label: 'P/C Ratio' },
      { key: 'oi', label: 'OI Distribution' },
    ],
  },
]

const tabKeys = tabs.flatMap((item) => ('key' in item ? [item.key] : []))
const tickerGroups = [
  { label: 'Indices', tickers: ['SPY', 'QQQ', 'IWM', 'DIA'] },
  { label: 'Mega Caps', tickers: ['TSLA', 'AAPL', 'NVDA', 'AMZN', 'META'] },
  { label: 'Rates / Vol', tickers: ['TLT', 'GLD', 'SLV', 'USO'] },
]
const quickTickers = [...new Set(tickerGroups.flatMap((group) => group.tickers))]

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeTicker(value: string) {
  return value.toUpperCase().replace(tickerPattern, '').slice(0, MAX_TICKER_LENGTH)
}

function normalizeApiError(payload: unknown): ApiErrorPayload | null {
  const record = asRecord(payload)
  if (!record) {
    return null
  }

  return {
    error: safeString(record.error) || undefined,
    detail: safeString(record.detail) || undefined,
    retry_after_seconds: safeNumber(record.retry_after_seconds, 0) || undefined,
  }
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function getApiErrorDetails(status: number, payload: ApiErrorPayload | null): ErrorDetails {
  const detail = payload?.detail || payload?.error || 'We could not load this market view.'

  if (status === 429 || payload?.error === 'rate_limited') {
    return {
      kind: 'rate_limited',
      message: detail,
    }
  }

  if (status === 400) {
    return { kind: 'generic', message: detail || 'That symbol did not look valid. Check it and try again.' }
  }

  if (status === 401) {
    return { kind: 'generic', message: 'The dashboard could not sign in to the data source. Try again in a moment.' }
  }

  if (status === 403) {
    return { kind: 'generic', message: 'The data source denied this request. Try again in a moment.' }
  }

  if (status === 404) {
    return { kind: 'generic', message: 'No options exposure data was found for that symbol.' }
  }

  if (status >= 500) {
    return { kind: 'generic', message: 'The data service hit an internal error. Try again in a moment.' }
  }

  return { kind: 'generic', message: detail }
}

function normalizeHistorySample(sample: unknown): HistorySample | null {
  const record = asRecord(sample)
  if (!record) {
    return null
  }

  return {
    timestamp: safeString(record.timestamp),
    spot: safeNumber(record.spot),
    call_wall: safeNullableNumber(record.call_wall),
    put_wall: safeNullableNumber(record.put_wall),
    zero_gamma: safeNullableNumber(record.zero_gamma),
    max_pain: safeNullableNumber(record.max_pain),
    vol_trigger: safeNullableNumber(record.vol_trigger),
    net_gex: safeNumber(record.net_gex),
    net_dex: safeNumber(record.net_dex),
    total_volume: safeNumber(record.total_volume),
    total_oi: safeNumber(record.total_oi),
    avg_iv: safeNumber(record.avg_iv),
    wall_range_pct: safeNumber(record.wall_range_pct),
    zero_gamma_distance_pct: safeNumber(record.zero_gamma_distance_pct),
    volume_oi_ratio: safeNumber(record.volume_oi_ratio),
    dex_to_gex_ratio: safeNumber(record.dex_to_gex_ratio),
  }
}

function normalizeHistoryPayload(payload: unknown): HistoryPayload {
  const record = asRecord(payload)
  const rawSamples = Array.isArray(record?.samples) ? record.samples : []
  const samples = rawSamples
    .map((sample) => normalizeHistorySample(sample))
    .filter((sample): sample is HistorySample => sample !== null)

  return {
    symbol: sanitizeTicker(safeString(record?.symbol)) || DEFAULT_TICKER,
    count: samples.length,
    samples,
  }
}

function normalizeDashboardData(payload: unknown): GEXData {
  const record = asRecord(payload)
  const keyLevelsRecord = asRecord(record?.key_levels)
  const futuresRecord = asRecord(record?.futures)
  const metaRecord = asRecord(record?.meta)

  return {
    spot: safeNumber(record?.spot),
    regime: safeString(record?.regime, 'NEGATIVE_GAMMA'),
    net_gex: safeNumber(record?.net_gex),
    net_dex: safeNumber(record?.net_dex),
    key_levels: {
      call_wall: safeNullableNumber(keyLevelsRecord?.call_wall),
      call_wall_gex: safeNumber(keyLevelsRecord?.call_wall_gex),
      put_wall: safeNullableNumber(keyLevelsRecord?.put_wall),
      put_wall_gex: safeNumber(keyLevelsRecord?.put_wall_gex),
      zero_gamma: safeNullableNumber(keyLevelsRecord?.zero_gamma),
      max_pain: safeNullableNumber(keyLevelsRecord?.max_pain),
      vol_trigger: safeNullableNumber(keyLevelsRecord?.vol_trigger),
    },
    expirations: Array.isArray(record?.expirations) ? record.expirations.map((item) => safeString(item)).filter(Boolean) : [],
    gex_by_strike: Array.isArray(record?.gex_by_strike)
      ? record.gex_by_strike.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            call_gex: safeNumber(row?.call_gex),
            put_gex: safeNumber(row?.put_gex),
            net_gex: safeNumber(row?.net_gex),
            total_oi: safeNumber(row?.total_oi),
            total_volume: safeNumber(row?.total_volume),
            avg_iv: safeNumber(row?.avg_iv),
          }
        })
      : [],
    heatmap_data: Array.isArray(record?.heatmap_data)
      ? record.heatmap_data.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            expiration: safeString(row?.expiration),
            gex: safeNumber(row?.gex),
          }
        })
      : [],
    futures: futuresRecord
      ? {
          symbol: safeString(futuresRecord.symbol),
          name: safeString(futuresRecord.name),
          full_name: safeString(futuresRecord.full_name),
          futures_price: safeNumber(futuresRecord.futures_price),
          ratio: safeNumber(futuresRecord.ratio, 1),
        }
      : null,
    dex_by_strike: Array.isArray(record?.dex_by_strike)
      ? record.dex_by_strike.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            call_dex: safeNumber(row?.call_dex),
            put_dex: safeNumber(row?.put_dex),
            net_dex: safeNumber(row?.net_dex),
          }
        })
      : [],
    gex_by_expiration: Array.isArray(record?.gex_by_expiration)
      ? record.gex_by_expiration.map((item) => {
          const row = asRecord(item)
          return {
            expiration: safeString(row?.expiration),
            total_gex: safeNumber(row?.total_gex),
          }
        })
      : [],
    iv_skew: Array.isArray(record?.iv_skew)
      ? record.iv_skew.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            call_iv: safeNumber(row?.call_iv),
            put_iv: safeNumber(row?.put_iv),
          }
        })
      : [],
    pc_ratio: Array.isArray(record?.pc_ratio)
      ? record.pc_ratio.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            call_oi: safeNumber(row?.call_oi),
            put_oi: safeNumber(row?.put_oi),
            pc_ratio: safeNumber(row?.pc_ratio),
          }
        })
      : [],
    vanna_by_strike: Array.isArray(record?.vanna_by_strike)
      ? record.vanna_by_strike.map((item) => {
          const row = asRecord(item)
          return {
            strike: safeNumber(row?.strike),
            vanna_exposure: safeNumber(row?.vanna_exposure),
          }
        })
      : [],
    meta: metaRecord
      ? {
          source: safeString(metaRecord.source),
          generated_at: safeString(metaRecord.generated_at),
          cache_hit: safeBoolean(metaRecord.cache_hit),
          cache_age_seconds: safeNumber(metaRecord.cache_age_seconds),
        }
      : undefined,
  }
}

function App() {
  const [ticker, setTicker] = useState(() => {
    try { return sanitizeTicker(localStorage.getItem('gexlab_ticker') || DEFAULT_TICKER) || DEFAULT_TICKER } catch { return DEFAULT_TICKER }
  })
  const [inputTicker, setInputTicker] = useState(() => {
    try { return sanitizeTicker(localStorage.getItem('gexlab_ticker') || DEFAULT_TICKER) || DEFAULT_TICKER } catch { return DEFAULT_TICKER }
  })
  const [data, setData] = useState<GEXData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind>(null)
  const [tickerInputError, setTickerInputError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [activeTab, setActiveTab] = useState<DashboardTab>('bar')
  const [historyData, setHistoryData] = useState<HistorySample[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const isMarketOpen = useMemo(() => {
    const nyTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/New_York"}))
    const day = nyTime.getDay()
    const time = nyTime.getHours() * 60 + nyTime.getMinutes()
    return day !== 0 && day !== 6 && time >= 570 && time <= 960
  }, [])
  const [isLiveMode, setIsLiveMode] = useState(isMarketOpen)
  const [autoRefresh, setAutoRefresh] = useState(isLiveMode)
  const [countdown, setCountdown] = useState(60)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [rateLimitRemaining, setRateLimitRemaining] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchControllerRef = useRef<AbortController | null>(null)
  const historyControllerRef = useRef<AbortController | null>(null)
  const healthControllerRef = useRef<AbortController | null>(null)
  const activeTabRef = useRef<DashboardTab>(activeTab)
  const historyLoadedForRef = useRef<string | null>(null)

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  const openDocs = useCallback(() => {
    try {
      if (window.gexlabDesktop?.openExternal) {
        void window.gexlabDesktop.openExternal(WEBSITE_URL)
        return
      }
      window.open(WEBSITE_URL, '_blank', 'noopener,noreferrer')
    } catch {
      setErrorKind('generic')
      setError('Unable to open the documentation link from this environment.')
    }
  }, [])

  const fetchBackendHealth = useCallback(async () => {
    healthControllerRef.current?.abort()
    const controller = new AbortController()
    healthControllerRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
      const payload = asRecord(await readJsonSafely(res))
      setBackendStatus(safeString(payload?.status, 'ok'))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      setBackendStatus('offline')
    }
  }, [])

  const fetchHistory = useCallback(async (symbol: string, force = false) => {
    if (!force && historyLoadedForRef.current === symbol) {
      return
    }

    setHistoryLoading(true)
    historyControllerRef.current?.abort()
    const controller = new AbortController()
    historyControllerRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/gex/${symbol}/history?limit=390`, { signal: controller.signal })
      const payload = await readJsonSafely(res)

      if (!res.ok) {
        historyLoadedForRef.current = null
        setHistoryData([])
        return
      }

      const normalizedPayload = normalizeHistoryPayload(payload)
      historyLoadedForRef.current = symbol
      setHistoryData(normalizedPayload.samples)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      historyLoadedForRef.current = null
      setHistoryData([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const applyApiError = useCallback((status: number, payload: ApiErrorPayload | null) => {
    const details = getApiErrorDetails(status, payload)

    if (details.kind === 'rate_limited') {
      const retryAfter = Math.max(15, Number(payload?.retry_after_seconds || 60))
      setRateLimitUntil(Date.now() + retryAfter * 1000)
      setRateLimitRemaining(retryAfter)
      setAutoRefresh(false)
      setErrorKind('rate_limited')
      setError(isDesktop ? details.message : `${details.message} The website gets rate-limited often; the local desktop app is more reliable.`)
      return
    }

    setErrorKind(details.kind)
    setError(details.message)
  }, [])

  const fetchData = useCallback(async (symbol: string, isBackground = false) => {
    if (isBackground && rateLimitUntil && Date.now() < rateLimitUntil) {
      return
    }

    if (!isBackground) {
      setLoading(true)
    }

    setError(null)
    setErrorKind(null)
    setTickerInputError(null)
    fetchControllerRef.current?.abort()
    const controller = new AbortController()
    fetchControllerRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/gex/${symbol}`, { signal: controller.signal })
      const payload = await readJsonSafely(res)

      if (!res.ok) {
        applyApiError(res.status, normalizeApiError(payload))
        return
      }

      setData(normalizeDashboardData(payload))
      if (activeTabRef.current === 'timeseries') {
        void fetchHistory(symbol, true)
      }
      setLastUpdated(new Date().toLocaleTimeString())
      setCountdown(60)
      setRateLimitUntil(null)
      setRateLimitRemaining(0)
      setBackendStatus('ok')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      setErrorKind('generic')
      setError('Failed to reach backend. Is it running?')
      setBackendStatus('offline')
    } finally {
      if (!isBackground) {
        setLoading(false)
      }
    }
  }, [applyApiError, fetchHistory, rateLimitUntil])

  useEffect(() => {
    try { localStorage.setItem('gexlab_ticker', ticker) } catch { /* ignore */ }
  }, [ticker])

  useEffect(() => {
    historyLoadedForRef.current = null
    setHistoryData([])
    fetchData(ticker)
  }, [ticker, fetchData])

  useEffect(() => {
    if (activeTab === 'timeseries') {
      void fetchHistory(ticker)
    }
  }, [activeTab, fetchHistory, ticker])

  useEffect(() => {
    fetchBackendHealth()
  }, [fetchBackendHealth])

  useEffect(() => () => {
    fetchControllerRef.current?.abort()
    historyControllerRef.current?.abort()
    healthControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!rateLimitUntil) {
      setRateLimitRemaining(0)
      return
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000))
      setRateLimitRemaining(remaining)
      if (remaining === 0) {
        setRateLimitUntil(null)
      }
    }

    updateRemaining()
    const intervalId = setInterval(updateRemaining, 1000)
    return () => clearInterval(intervalId)
  }, [rateLimitUntil])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    if (autoRefresh && !rateLimitUntil) {
      timerRef.current = setInterval(() => fetchData(ticker, true), AUTO_REFRESH_INTERVAL)
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? 60 : prev - 1))
      }, 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [autoRefresh, fetchData, rateLimitUntil, ticker])

  const handleTickerSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const nextTicker = sanitizeTicker(inputTicker)

    if (!nextTicker) {
      const nextError = 'Enter a valid ticker using letters, numbers, ".", "/", "-", or "^".'
      setTickerInputError(nextError)
      setErrorKind('generic')
      setError(nextError)
      setInputTicker('')
      return
    }

    setTickerInputError(null)
    setInputTicker(nextTicker)
    setTicker(nextTicker)
  }

  const chartContent = useMemo(() => {
    if (!data) {
      return null
    }

    switch (activeTab) {
      case 'bar':
        return <GEXBarChart data={data.gex_by_strike} spot={data.spot} keyLevels={data.key_levels} futures={data.futures} />
      case 'heatmap':
        return <GEXHeatmap data={data.heatmap_data} spot={data.spot} futures={data.futures} />
      case 'topology':
        return <GEXTopology data={data.heatmap_data} spot={data.spot} futures={data.futures} />
      case 'exp':
        return <GEXByExpiration data={data.gex_by_expiration} />
      case 'cumulative':
        return <CumulativeGEX data={data.gex_by_strike} spot={data.spot} futures={data.futures} />
      case 'timeseries':
        return <GEXTimeSeries data={historyData} loading={historyLoading} />
      case 'dex':
        return <DEXProfile data={data.dex_by_strike} spot={data.spot} futures={data.futures} />
      case 'vanna':
        return <VannaExposure data={data.vanna_by_strike} spot={data.spot} futures={data.futures} />
      case 'flow':
        return <UnusualFlowChart data={data.gex_by_strike} spot={data.spot} futures={data.futures} />
      case 'iv':
        return <IVSkewChart data={data.iv_skew} spot={data.spot} futures={data.futures} />
      case 'pc':
        return <PutCallRatio data={data.pc_ratio} spot={data.spot} futures={data.futures} />
      case 'oi':
        return <OIDistribution data={data.pc_ratio} spot={data.spot} futures={data.futures} />
      default:
        return null
    }
  }, [activeTab, data, historyData, historyLoading])

  const cacheLabel = data?.meta
    ? data.meta.cache_hit
      ? `Cached ${Math.round(data.meta.cache_age_seconds)}s`
      : 'Fresh'
    : '---'

  const manualRefreshDisabled = loading || rateLimitRemaining > 0
  const activeTabMeta = tabs.find((item): item is Extract<TabItem, { key: DashboardTab; label: string }> => 'key' in item && item.key === activeTab)
  const activeTabLabel = activeTabMeta?.label ?? 'Chart'
  const spotDisplay = data?.spot !== undefined ? data.spot.toFixed(2).split('.') : null
  const tabPanelId = 'dashboard-tabpanel'
  const activeTabId = `tab-${activeTab}`
  const modeLabel = backendStatus === 'ok' ? (isLiveMode ? 'Live updates on' : 'End-of-day snapshot') : 'Connection offline'
  const statusSummary = [modeLabel, lastUpdated ? `Updated ${lastUpdated}` : null, data?.meta ? `Source ${cacheLabel}` : null]
    .filter(Boolean)
    .join(' | ')
  const moveToTab = useCallback((nextTab: DashboardTab) => {
    setActiveTab(nextTab)
    requestAnimationFrame(() => {
      document.getElementById(`tab-${nextTab}`)?.focus()
    })
  }, [])

  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, currentTab: DashboardTab) => {
    const currentIndex = tabKeys.indexOf(currentTab)
    if (currentIndex === -1) {
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveToTab(tabKeys[(currentIndex + 1) % tabKeys.length])
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveToTab(tabKeys[(currentIndex - 1 + tabKeys.length) % tabKeys.length])
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      moveToTab(tabKeys[0])
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      moveToTab(tabKeys[tabKeys.length - 1])
    }
  }, [moveToTab])

  return (
    <div className={isDesktop ? 'desktop-shell' : 'browser-shell'}>
      <DesktopTitleBar ticker={ticker} />
      <div className="dashboard-wrapper">
        <aside className="sidebar">
          <div className="sidebar-brand-block">
            <div className="sidebar-brand-row">
              <button type="button" className="brand-button" aria-label="Open GEXLAB documentation" onClick={openDocs}>
                <LogoMark />
              </button>
            </div>
            <p className="sidebar-brand-subtitle">Dealer positioning at a glance</p>
          </div>

          <section className="sidebar-section sidebar-setup">
            <form onSubmit={handleTickerSubmit} aria-labelledby="ticker-heading" className="sidebar-form">
              <label className="sr-only" htmlFor="ticker-input">Ticker symbol</label>
              <h2 id="ticker-heading" className="card-title">Ticker</h2>
              <input
                id="ticker-input"
                className="search-input"
                value={inputTicker}
                onChange={(event) => {
                  setTickerInputError(null)
                  setInputTicker(sanitizeTicker(event.target.value))
                }}
                placeholder="e.g. SPY, QQQ, TSLA"
                aria-describedby={tickerInputError ? 'ticker-help ticker-error' : 'ticker-help'}
                aria-invalid={tickerInputError ? 'true' : 'false'}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_TICKER_LENGTH}
              />
              <div id="ticker-help" className="sr-only">Enter a ticker such as SPY, QQQ, BRK.B, or ^VIX, then press Enter to load the market view.</div>
              {tickerInputError && (
                <div id="ticker-error" className="field-error" role="alert">
                  {tickerInputError}
                </div>
              )}
            </form>

            <div className="ticker-group-list">
              <div className="ticker-group">
                <div className="ticker-chip-list" aria-label="Quick ticker picks">
                  {quickTickers.map((groupTicker) => (
                    <button
                      type="button"
                      key={groupTicker}
                      onClick={() => {
                        const nextTicker = sanitizeTicker(groupTicker)
                        setInputTicker(nextTicker)
                        setTicker(nextTicker)
                      }}
                      className="ticker-chip compact-control"
                      data-active={ticker === groupTicker}
                    >{groupTicker}</button>
                  ))}
                </div>
              </div>
            </div>

            {errorKind === 'rate_limited' && !isDesktop && (
              <div className="panel rate-limit-panel rate-limit-panel-compact">
                <h2 className="card-title card-title-warning">Website Rate Limit</h2>
                <div className="status-note">The web data source is throttling requests right now. For steadier live use, install the desktop app.</div>
                <button type="button" className="secondary-button panel-action-full" onClick={openDocs}>View Install Guide</button>
              </div>
            )}
          </section>

          {data && (
            <section className="animate-fadeIn sidebar-scroll-section">
              <div className="sidebar-analysis-block">
                <h2 className="card-title section-title section-title-tight">
                  Key Levels
                  {data.futures && (
                    <span className="inline-detail wrap-anywhere inline-detail-accent">
                      ({data.futures.name})
                    </span>
                  )}
                </h2>
                <KeyLevelsPanel
                  keyLevels={data.key_levels}
                  spot={data.spot}
                  futures={data.futures ? { name: data.futures.name, ratio: data.futures.ratio } : undefined}
                />
              </div>

              <details className="sidebar-disclosure">
                <summary className="sidebar-disclosure-summary">
                  <span className="card-title disclosure-title">Expirations</span>
                  <span className="sidebar-disclosure-meta">
                    {data.expirations.length > 0 ? `${data.expirations.length} dates` : 'No dates yet'}
                  </span>
                </summary>
                <div className="sidebar-disclosure-panel">
                  <div className="sidebar-disclosure-content">
                    <div className="expiration-list">
                      {data.expirations.length > 0 ? data.expirations.map((expiration) => (
                        <div key={expiration} className="expiration-item wrap-anywhere">
                          {expiration}
                        </div>
                      )) : (
                        <div className="status-note wrap-anywhere">No expiration dates are available for this symbol yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </details>
            </section>
          )}

          <section className="sidebar-footer">
            <div className="sidebar-footer-row">
              <div className="segmented-control" role="group" aria-label="Data mode">
                <button
                  type="button"
                  onClick={() => { setIsLiveMode(false); setAutoRefresh(false); }}
                  aria-pressed={!isLiveMode}
                  className="segmented-control-button compact-control"
                  data-active={!isLiveMode}
                >Close</button>
                <button
                  type="button"
                  onClick={() => { setIsLiveMode(true); setAutoRefresh(true); }}
                  aria-pressed={isLiveMode}
                  className="segmented-control-button compact-control"
                  data-live="true"
                  data-active={isLiveMode}
                >Live</button>
              </div>
              <button
                type="button"
                onClick={() => setAutoRefresh((current) => !current)}
                aria-pressed={autoRefresh}
                className="compact-control control-pill auto-toggle"
                data-active={autoRefresh}
              >
                {rateLimitRemaining > 0 ? `Wait ${rateLimitRemaining}s` : autoRefresh ? `Auto refresh ${countdown}s` : 'Auto refresh off'}
              </button>
            </div>
            <div className="sidebar-status-line">
              <span className={`refresh-indicator ${backendStatus === 'ok' ? 'live' : ''}`} />
              <span className="sidebar-meta">{statusSummary}</span>
            </div>
          </section>
        </aside>

        <main className="main-content app-screen">
          <header className="glass-header">
            <div className="shell-header">
              <div className="shell-header-primary">
                <div className="shell-header-copy">
                  <div className="shell-ticker">{ticker}</div>
                  <div className="shell-overview-line">
                    <div className="shell-price-cluster">
                      <h1 className="shell-price">
                        {spotDisplay ? (
                          <>
                            <span className="shell-currency">$</span>
                            <span className="shell-price-whole">{spotDisplay[0]}</span>
                            <span className="shell-price-decimal">.{spotDisplay[1]}</span>
                          </>
                        ) : '---'}
                      </h1>
                    </div>
                    {data && (
                      <span className={`badge ${data.regime === 'LONG_GAMMA' ? 'badge-positive' : 'badge-negative'}`}>
                        {data.regime === 'LONG_GAMMA' ? 'Supportive Gamma' : 'Reactive Gamma'}
                      </span>
                    )}
                  </div>
                  {data?.futures && (
                    <p className="shell-subprice wrap-anywhere">
                      {data.futures.name} {data.futures.futures_price.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="shell-header-secondary">
              <div className="market-metrics-block">
                <div className="market-metrics">
                  <div className="metric-block">
                    <h2 className="card-title metric-title">Net GEX</h2>
                    <div
                      className="metric-value"
                      data-positive={Boolean(data?.net_gex && data.net_gex > 0)}
                    >
                      {data?.net_gex !== undefined ? `${data.net_gex > 0 ? '+' : ''}${data.net_gex.toFixed(2)}B` : '---'}
                    </div>
                  </div>
                  <div className="metric-block">
                    <h2 className="card-title metric-title">Net DEX</h2>
                    <div className="metric-value">
                      {data?.net_dex !== undefined ? `${data.net_dex > 0 ? '+' : ''}${data.net_dex.toFixed(2)}B` : '---'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <section
            className="animate-fadeIn chart-stage"
            role="tabpanel"
            id={tabPanelId}
            aria-labelledby={activeTabId}
          >
            <div className="chart-stage-shell">
              <div className="tab-strip-frame">
                <div className="mobile-tab-picker">
                  <label className="sr-only" htmlFor="dashboard-view-select">Dashboard view</label>
                  <select
                    id="dashboard-view-select"
                    className="mobile-tab-select compact-control"
                    value={activeTab}
                    onChange={(event) => setActiveTab(event.target.value as DashboardTab)}
                    aria-label="Choose dashboard view"
                  >
                    {mobileTabGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((item) => (
                          <option key={item.key} value={item.key}>{item.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <div className="mobile-tab-summary" aria-hidden="true">
                    <span className="mobile-tab-kicker">View</span>
                    <span className="mobile-tab-value">{activeTabLabel}</span>
                  </div>
                </div>
                <div className="tab-strip" role="tablist" aria-label="Dashboard views">
                  {tabs.map((item, index) => {
                    if ('divider' in item) {
                      return (
                        <div key={`divider-${index}`} className="tab-divider">
                          <div className="tab-divider-line" />
                          <span>{item.divider}</span>
                        </div>
                      )
                    }
                    return (
                      <button
                        type="button"
                        key={item.key}
                        onClick={() => setActiveTab(item.key)}
                        onKeyDown={(event) => handleTabKeyDown(event, item.key)}
                        className="tab-button"
                        data-active={activeTab === item.key}
                        role="tab"
                        id={`tab-${item.key}`}
                        aria-selected={activeTab === item.key}
                        aria-controls={tabPanelId}
                        tabIndex={activeTab === item.key ? 0 : -1}
                      >{item.label}</button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => fetchData(ticker)}
                  disabled={manualRefreshDisabled}
                  className="action-button market-refresh-button"
                >{loading ? 'Refreshing...' : rateLimitRemaining > 0 ? `Try again in ${rateLimitRemaining}s` : 'Refresh data'}</button>
              </div>

              <div className="chart-panel-region">
                <div className="panel chart-shell chart-panel">
                  <div key={data ? activeTab : 'empty'} className="chart-panel-content animate-chartSwap">
                    {data ? (
                      <Suspense fallback={<div className="chart-suspense">Loading chart...</div>}>
                        {chartContent}
                      </Suspense>
                    ) : (
                      <ChartEmptyState>
                        {loading ? 'Building the market read...' : error || 'Enter a ticker to load the market read.'}
                      </ChartEmptyState>
                    )}
                  </div>
                  {loading && (
                    <div className="chart-loading-overlay">
                      <div className="loading-stack">
                        <div className="loading-banner">Analyzing dealer positioning...</div>
                        <div className="loading-bar">
                          <div className="loading-bar-fill" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>

        {error && !loading && (
          <div
            className="animate-slideUp app-toast"
            role="alert"
            aria-live="assertive"
            data-tone={errorKind === 'rate_limited' ? 'warning' : 'danger'}
          >
            <strong>{errorKind === 'rate_limited' ? 'Slow down:' : 'Could not load data:'}</strong> {error}
          </div>
        )}
        <div className="sr-only" aria-live="polite">
          {loading ? `Loading ${ticker} ${activeTabLabel}.` : `Showing ${ticker} ${activeTabLabel}. Connection status: ${backendStatus}.`}
        </div>
      </div>
    </div>
  )
}

export default App
