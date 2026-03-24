import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import KeyLevelsPanel from './components/KeyLevelsPanel'
import DesktopTitleBar from './components/DesktopTitleBar'
import LogoMark from './components/LogoMark'

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

const tickerGroups = [
  { label: 'Indices', tickers: ['SPY', 'QQQ', 'IWM', 'DIA'] },
  { label: 'Mega Caps', tickers: ['TSLA', 'AAPL', 'NVDA', 'AMZN', 'META'] },
  { label: 'Rates / Vol', tickers: ['TLT', 'GLD', 'SLV', 'USO'] },
]

function App() {
  const [ticker, setTicker] = useState(() => localStorage.getItem('gexlab_ticker') || 'SPY')
  const [inputTicker, setInputTicker] = useState(() => localStorage.getItem('gexlab_ticker') || 'SPY')
  const [data, setData] = useState<GEXData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [activeTab, setActiveTab] = useState<DashboardTab>('bar')
  const [historyData, setHistoryData] = useState<HistorySample[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [countdown, setCountdown] = useState(60)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [rateLimitRemaining, setRateLimitRemaining] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const openDocs = useCallback(() => {
    if (window.gexlabDesktop?.openExternal) {
      void window.gexlabDesktop.openExternal(WEBSITE_URL)
      return
    }
    window.open(WEBSITE_URL, '_blank', 'noopener,noreferrer')
  }, [])

  const fetchBackendHealth = useCallback(() => {
    fetch(`${API_BASE}/api/health`)
      .then((res) => res.json())
      .then((payload) => setBackendStatus(payload.status ?? 'ok'))
      .catch(() => setBackendStatus('offline'))
  }, [])

  const fetchHistory = useCallback(async (symbol: string) => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/gex/${symbol}/history?limit=390`)
      const payload = (await res.json()) as HistoryPayload | ApiErrorPayload

      if (!res.ok) {
        setHistoryData([])
        return
      }

      setHistoryData((payload as HistoryPayload).samples ?? [])
    } catch {
      setHistoryData([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const applyApiError = useCallback((status: number, payload: ApiErrorPayload | null) => {
    const detail = payload?.detail || 'Failed to load GEX data.'

    if (status === 429 || payload?.error === 'rate_limited') {
      const retryAfter = Math.max(15, Number(payload?.retry_after_seconds || 60))
      setRateLimitUntil(Date.now() + retryAfter * 1000)
      setRateLimitRemaining(retryAfter)
      setAutoRefresh(false)
      setErrorKind('rate_limited')
      setError(isDesktop ? detail : `${detail} The website gets rate-limited often; the local desktop app is more reliable.`)
      return
    }

    setErrorKind('generic')
    setError(detail)
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

    try {
      const query = new URLSearchParams()
      if (activeTab === 'timeseries') {
        query.set('fresh', 'true')
        query.set('track_history', 'true')
      }

      const endpoint = query.toString()
        ? `${API_BASE}/api/gex/${symbol}?${query.toString()}`
        : `${API_BASE}/api/gex/${symbol}`

      const res = await fetch(endpoint)
      const payload = (await res.json()) as GEXData | ApiErrorPayload

      if (!res.ok) {
        applyApiError(res.status, payload as ApiErrorPayload)
        return
      }

      setData(payload as GEXData)
      if (activeTab === 'timeseries') {
        void fetchHistory(symbol)
      }
      setLastUpdated(new Date().toLocaleTimeString())
      setCountdown(60)
      setRateLimitUntil(null)
      setRateLimitRemaining(0)
      fetchBackendHealth()
    } catch {
      setErrorKind('generic')
      setError('Failed to reach backend. Is it running?')
      setBackendStatus('offline')
    } finally {
      if (!isBackground) {
        setLoading(false)
      }
    }
  }, [activeTab, applyApiError, fetchBackendHealth, fetchHistory, rateLimitUntil])

  useEffect(() => {
    localStorage.setItem('gexlab_ticker', ticker)
  }, [ticker])

  useEffect(() => {
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
    setTicker(inputTicker.toUpperCase())
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

  return (
    <div className={isDesktop ? 'desktop-shell' : 'browser-shell'}>
      <DesktopTitleBar ticker={ticker} />
      <div className="dashboard-wrapper">
        <aside className="sidebar">
          <div className="sidebar-brand-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button type="button" className="brand-button" aria-label="GEXLAB dashboard">
                <LogoMark />
              </button>
              <button
                onClick={openDocs}
                style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)',
                  padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 600,
                }}
              >WEBSITE</button>
            </div>
            <div className="sidebar-brand-subtitle">Gamma Exposure Dashboard</div>
          </div>

          <div style={{ padding: '1.25rem' }}>
            <form onSubmit={handleTickerSubmit}>
              <div className="card-title">Symbol</div>
              <input
                className="search-input"
                value={inputTicker}
                onChange={(event) => setInputTicker(event.target.value.toUpperCase())}
                placeholder="e.g. SPY, QQQ, TSLA"
              />
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '0.9rem' }}>
              {tickerGroups.map((group) => (
                <div key={group.label}>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {group.tickers.map((groupTicker) => (
                      <button
                        key={groupTicker}
                        onClick={() => { setInputTicker(groupTicker); setTicker(groupTicker) }}
                        className="ticker-chip"
                        data-active={ticker === groupTicker}
                      >{groupTicker}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {errorKind === 'rate_limited' && !isDesktop && (
              <div className="panel rate-limit-panel" style={{ marginTop: '1rem', padding: '0.9rem 1rem' }}>
                <div className="card-title" style={{ color: 'var(--warning)' }}>Website Limited</div>
                <div className="status-note">Yahoo is throttling the website path. The local desktop app is the recommended way to use GEXLAB.</div>
                <button type="button" className="secondary-button" style={{ marginTop: '0.85rem', width: '100%' }} onClick={openDocs}>Open Install Docs</button>
              </div>
            )}
          </div>

          {data && (
            <div className="animate-fadeIn" style={{ padding: '0 1.25rem', flex: 1, overflowY: 'auto' }}>
              <div className="card-title" style={{ marginTop: '0.5rem' }}>
                Key Levels
                {data.futures && (
                  <span style={{ color: 'var(--accent-2)', marginLeft: '6px', fontWeight: 500, textTransform: 'none' }}>
                    ({data.futures.name})
                  </span>
                )}
              </div>
              <KeyLevelsPanel
                keyLevels={data.key_levels}
                spot={data.spot}
                futures={data.futures ? { name: data.futures.name, ratio: data.futures.ratio } : undefined}
              />

              <div className="card-title" style={{ marginTop: '1.5rem' }}>Expirations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {data.expirations.map((expiration) => (
                  <div key={expiration} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                    {expiration}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border)', fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ color: 'var(--text-dim)' }}>
                <span className={`refresh-indicator ${backendStatus === 'ok' ? 'live' : ''}`} />
                {backendStatus === 'ok' ? 'LIVE' : 'OFFLINE'}
              </div>
              <button
                onClick={() => setAutoRefresh((current) => !current)}
                style={{
                  background: autoRefresh ? 'var(--positive-soft)' : 'var(--bg-base)',
                  border: `1px solid ${autoRefresh ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                  color: autoRefresh ? 'var(--positive)' : 'var(--text-dim)',
                  padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 500,
                }}
              >
                {rateLimitRemaining > 0 ? `COOLDOWN ${rateLimitRemaining}s` : autoRefresh ? `AUTO ${countdown}s` : 'AUTO OFF'}
              </button>
            </div>
            {lastUpdated && (
              <div style={{ color: 'var(--text-dim)', marginTop: '4px', fontSize: '10px' }}>Last: {lastUpdated}</div>
            )}
            {data?.meta && (
              <div style={{ color: 'var(--text-dim)', marginTop: '4px', fontSize: '10px' }}>Cache: {cacheLabel}</div>
            )}
          </div>
        </aside>

        <main className="main-content app-screen">
          <header className="glass-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <div className="ticker-sigil">{ticker}</div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem' }}>
                    ${data?.spot.toFixed(2) || '---'}
                  </div>
                  {data?.futures && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {data.futures.name} {data.futures.futures_price.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
              {data && (
                <span className={`badge ${data.regime === 'LONG_GAMMA' ? 'badge-positive' : 'badge-negative'}`}>
                  {data.regime === 'LONG_GAMMA' ? 'Positive Gamma' : 'Negative Gamma'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
              <div>
                <div className="card-title" style={{ margin: 0 }}>Net GEX</div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600,
                  color: data?.net_gex && data.net_gex > 0 ? 'var(--positive)' : 'var(--negative)',
                }}>
                  {data?.net_gex !== undefined ? `${data.net_gex > 0 ? '+' : ''}${data.net_gex.toFixed(2)}B` : '---'}
                </div>
              </div>
              <div>
                <div className="card-title" style={{ margin: 0 }}>Net DEX</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600 }}>
                  {data?.net_dex !== undefined ? `${data.net_dex > 0 ? '+' : ''}${data.net_dex.toFixed(2)}B` : '---'}
                </div>
              </div>
              <button
                onClick={() => fetchData(ticker)}
                disabled={manualRefreshDisabled}
                className="action-button"
              >{loading ? 'Loading...' : rateLimitRemaining > 0 ? `Retry ${rateLimitRemaining}s` : 'Refresh'}</button>
            </div>
          </header>

          <div className="tab-strip">
            {tabs.map((item, index) => {
              if ('divider' in item) {
                return (
                  <div key={`divider-${index}`} className="tab-divider">
                    <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
                    <span>{item.divider}</span>
                  </div>
                )
              }
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className="tab-button"
                  data-active={activeTab === item.key}
                >{item.label}</button>
              )
            })}
          </div>

          <section className="animate-fadeIn" style={{ padding: '0 2rem 2rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="panel chart-shell" style={{ flex: 1, minHeight: '500px', borderRadius: '0 18px 18px 18px', overflow: 'hidden' }}>
              {data ? (
                <Suspense fallback={<div className="chart-suspense">Loading chart module...</div>}>
                  {chartContent}
                </Suspense>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <div style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                    {loading ? 'Calculating GEX...' : error || 'Enter a ticker to begin'}
                  </div>
                </div>
              )}
              {loading && (
                <div className="chart-loading-overlay">
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                      COMPUTING GAMMA EXPOSURE...
                    </div>
                    <div style={{
                      width: '200px', height: '2px', background: 'var(--border)',
                      borderRadius: '10px', overflow: 'hidden', margin: '0 auto',
                    }}>
                      <div style={{
                        width: '40%', height: '100%',
                        background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                        animation: 'pulse 1.2s ease-in-out infinite',
                      }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        {error && !loading && (
          <div className="animate-slideUp" style={{
            position: 'fixed', bottom: '2rem', right: '2rem',
            padding: '1rem 1.5rem', background: errorKind === 'rate_limited' ? 'rgba(245, 158, 11, 0.12)' : 'var(--negative-soft)',
            border: `1px solid ${errorKind === 'rate_limited' ? 'var(--warning)' : 'var(--negative)'}`,
            color: errorKind === 'rate_limited' ? 'var(--warning)' : 'var(--negative)',
            borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            zIndex: 1001, fontSize: '13px', maxWidth: '420px',
          }}>
            <strong>{errorKind === 'rate_limited' ? 'Rate Limit:' : 'Error:'}</strong> {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
