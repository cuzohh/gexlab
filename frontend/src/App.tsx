import { useState, useEffect, useCallback, useRef } from 'react'
import './index.css'
import GEXBarChart from './components/GEXBarChart'
import GEXHeatmap from './components/GEXHeatmap'
import UnusualFlowChart from './components/UnusualFlowChart'
import KeyLevelsPanel from './components/KeyLevelsPanel'
import DEXProfile from './components/DEXProfile'
import GEXByExpiration from './components/GEXByExpiration'
import CumulativeGEX from './components/CumulativeGEX'
import IVSkewChart from './components/IVSkewChart'
import PutCallRatio from './components/PutCallRatio'
import VannaExposure from './components/VannaExposure'
import OIDistribution from './components/OIDistribution'
import GEXTopology from './components/GEXTopology'
import DesktopTitleBar from './components/DesktopTitleBar'
import LogoMark from './components/LogoMark'

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
}

const API_BASE = window.gexlabDesktop?.apiBase || import.meta.env.VITE_API_URL || 'http://localhost:8000'
const AUTO_REFRESH_INTERVAL = 60_000
const isDesktop = Boolean(window.gexlabDesktop?.isDesktop)
const WEBSITE_URL = import.meta.env.VITE_GEXLAB_WEBSITE_URL || 'https://github.com/cuzohh/gexlab#readme'

type DashboardTab = 'bar' | 'heatmap' | 'topology' | 'exp' | 'cumulative' | 'dex' | 'vanna' | 'flow' | 'iv' | 'pc' | 'oi'

type TabItem = { key: DashboardTab; label: string } | { divider: string }

function App() {
  const [ticker, setTicker] = useState(() => localStorage.getItem('gexlab_ticker') || 'SPY')
  const [inputTicker, setInputTicker] = useState(() => localStorage.getItem('gexlab_ticker') || 'SPY')
  const [data, setData] = useState<GEXData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [activeTab, setActiveTab] = useState<DashboardTab>('bar')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [countdown, setCountdown] = useState(60)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const openDocs = useCallback(() => {
    if (window.gexlabDesktop?.openExternal) {
      void window.gexlabDesktop.openExternal(WEBSITE_URL)
      return
    }
    window.open(WEBSITE_URL, '_blank', 'noopener,noreferrer')
  }, [])

  const fetchData = useCallback(async (symbol: string, isBackground = false) => {
    if (!isBackground) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/gex/${symbol}`)
      const json = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setData(json)
        setLastUpdated(new Date().toLocaleTimeString())
        setCountdown(60)
      }
    } catch {
      setError('Failed to reach backend. Is it running?')
    } finally {
      if (!isBackground) setLoading(false)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('gexlab_ticker', ticker)
  }, [ticker])

  useEffect(() => {
    fetchData(ticker)
    fetch(`${API_BASE}/api/health`)
      .then(res => res.json())
      .then(d => setBackendStatus(d.status))
      .catch(() => setBackendStatus('offline'))
  }, [ticker, fetchData])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchData(ticker, true), AUTO_REFRESH_INTERVAL)
      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev <= 1 ? 60 : prev - 1))
      }, 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [autoRefresh, ticker, fetchData])

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTicker(inputTicker.toUpperCase())
  }

  const tickerGroups = [
    { label: 'Indices', tickers: ['SPY', 'QQQ', 'IWM', 'DIA'] },
    { label: 'Mega Caps', tickers: ['TSLA', 'AAPL', 'NVDA', 'AMZN', 'META'] },
    { label: 'Rates / Vol', tickers: ['TLT', 'GLD', 'SLV', 'USO'] },
  ]

  const tabs: TabItem[] = [
    { key: 'bar', label: 'GEX Profile' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'topology', label: 'Topology' },
    { key: 'exp', label: 'By Exp' },
    { key: 'cumulative', label: 'Cumulative' },
    { divider: 'Greeks' },
    { key: 'dex', label: 'DEX' },
    { key: 'vanna', label: 'Vanna' },
    { divider: 'Sentiment' },
    { key: 'flow', label: 'Flow' },
    { key: 'iv', label: 'IV Skew' },
    { key: 'pc', label: 'P/C Ratio' },
    { key: 'oi', label: 'OI Dist.' },
  ]

  const pageContent = (
    <div className="dashboard-wrapper">
      {/* Sidebar */}
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
              onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
              placeholder="e.g. SPY, QQQ, TSLA"
            />
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '0.9rem' }}>
            {tickerGroups.map(group => (
              <div key={group.label}>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {group.tickers.map(t => (
                    <button
                      key={t}
                      onClick={() => { setInputTicker(t); setTicker(t) }}
                      className="ticker-chip"
                      data-active={ticker === t}
                    >{t}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
              {data.expirations.map(exp => (
                <div key={exp} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                  {exp}
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
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                background: autoRefresh ? 'var(--positive-soft)' : 'var(--bg-base)',
                border: `1px solid ${autoRefresh ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                color: autoRefresh ? 'var(--positive)' : 'var(--text-dim)',
                padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 500,
              }}
            >{autoRefresh ? `AUTO ${countdown}s` : 'AUTO OFF'}</button>
          </div>
          {lastUpdated && (
            <div style={{ color: 'var(--text-dim)', marginTop: '4px', fontSize: '10px' }}>Last: {lastUpdated}</div>
          )}
        </div>
      </aside>

      {/* Main Content */}
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
                color: data?.net_gex && data.net_gex > 0 ? 'var(--positive)' : 'var(--negative)'
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
              disabled={loading}
              className="action-button"
            >{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </header>

        <div className="tab-strip">
          {tabs.map((item, i) => {
            if ('divider' in item) {
              return (
                <div key={`div-${i}`} className="tab-divider">
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
              activeTab === 'bar' ? (
                <GEXBarChart data={data.gex_by_strike} spot={data.spot} keyLevels={data.key_levels} futures={data.futures} />
              ) : activeTab === 'heatmap' ? (
                <GEXHeatmap data={data.heatmap_data} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'topology' ? (
                <GEXTopology data={data.heatmap_data} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'exp' ? (
                <GEXByExpiration data={data.gex_by_expiration} />
              ) : activeTab === 'cumulative' ? (
                <CumulativeGEX data={data.gex_by_strike} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'dex' ? (
                <DEXProfile data={data.dex_by_strike} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'vanna' ? (
                <VannaExposure data={data.vanna_by_strike} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'flow' ? (
                <UnusualFlowChart data={data.gex_by_strike} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'iv' ? (
                <IVSkewChart data={data.iv_skew} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'pc' ? (
                <PutCallRatio data={data.pc_ratio} spot={data.spot} futures={data.futures} />
              ) : activeTab === 'oi' ? (
                <OIDistribution data={data.pc_ratio} spot={data.spot} futures={data.futures} />
              ) : null
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
          padding: '1rem 1.5rem', background: 'var(--negative-soft)',
          border: '1px solid var(--negative)', color: 'var(--negative)',
          borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          zIndex: 1001, fontSize: '13px', maxWidth: '400px',
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )

  return (
    <div className={isDesktop ? 'desktop-shell' : 'browser-shell'}>
      <DesktopTitleBar ticker={ticker} />
      {pageContent}
    </div>
  )
}

export default App
