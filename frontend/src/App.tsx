import { useState, useEffect, useCallback } from 'react'
import './index.css'
import GEXBarChart from './components/GEXBarChart'
import GEXHeatmap from './components/GEXHeatmap'
import KeyLevelsPanel from './components/KeyLevelsPanel'

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

interface GEXData {
  spot: number
  regime: string
  net_gex: number
  net_dex: number
  key_levels: KeyLevels
  expirations: string[]
  gex_by_strike: StrikeData[]
  heatmap_data: HeatmapPoint[]
}

const API_BASE = 'http://localhost:8000'

function App() {
  const [ticker, setTicker] = useState('SPY')
  const [inputTicker, setInputTicker] = useState('SPY')
  const [data, setData] = useState<GEXData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [activeTab, setActiveTab] = useState<'bar' | 'heatmap'>('bar')

  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/gex/${symbol}`)
      const json = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setData(json)
        setLastUpdated(new Date().toLocaleTimeString())
      }
    } catch {
      setError('Failed to reach backend. Is it running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(ticker)

    fetch(`${API_BASE}/api/health`)
      .then(res => res.json())
      .then(d => setBackendStatus(d.status))
      .catch(() => setBackendStatus('offline'))
  }, [ticker, fetchData])

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTicker(inputTicker.toUpperCase())
  }

  const tickerGroups = [
    { label: 'Indices', tickers: ['SPY', 'QQQ', 'IWM', 'DIA'] },
    { label: 'Mega Caps', tickers: ['TSLA', 'AAPL', 'NVDA', 'AMZN', 'META'] },
    { label: 'Rates / Vol', tickers: ['TLT', 'GLD', 'SLV', 'USO'] },
  ]

  return (
    <>
      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, letterSpacing: '0.05em' }}>
            GEX<span style={{ color: 'var(--accent)' }}>LAB</span>
          </h1>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>Gamma Exposure Dashboard</div>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
            {tickerGroups.map(group => (
              <div key={group.label}>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {group.tickers.map(t => (
                    <button
                      key={t}
                      onClick={() => { setInputTicker(t); setTicker(t) }}
                      style={{
                        background: ticker === t ? 'var(--accent-soft)' : 'var(--bg-base)',
                        border: `1px solid ${ticker === t ? 'var(--accent)' : 'var(--border)'}`,
                        color: ticker === t ? 'var(--accent)' : 'var(--text-muted)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        fontWeight: 500,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Key Levels */}
        {data && (
          <div style={{ padding: '0 1.25rem', flex: 1, overflowY: 'auto' }}>
            <div className="card-title" style={{ marginTop: '0.5rem' }}>Daily Key Levels</div>
            <KeyLevelsPanel keyLevels={data.key_levels} spot={data.spot} />

            <div className="card-title" style={{ marginTop: '1.5rem' }}>Expirations Used</div>
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
          <div style={{ color: 'var(--text-dim)' }}>
            Backend: <span style={{ color: backendStatus === 'ok' ? 'var(--positive)' : 'var(--negative)' }}>{backendStatus.toUpperCase()}</span>
          </div>
          {lastUpdated && (
            <div style={{ color: 'var(--text-dim)', marginTop: '2px' }}>
              Updated: {lastUpdated}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Header Bar */}
        <header className="glass-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ticker}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem' }}>
              ${data?.spot.toFixed(2) || '---'}
            </div>
            {data && (
              <span className={`badge ${data.regime === 'LONG_GAMMA' ? 'badge-positive' : 'badge-negative'}`}>
                {data.regime === 'LONG_GAMMA' ? '◉ POSITIVE GAMMA' : '◉ NEGATIVE GAMMA'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>Net GEX</div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.95rem',
                fontWeight: 600,
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
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '12px',
                opacity: loading ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {loading ? 'Loading...' : '↻ Refresh'}
            </button>
          </div>
        </header>

        {/* Chart Tabs */}
        <div style={{ display: 'flex', gap: '0', padding: '1rem 2rem 0' }}>
          {(['bar', 'heatmap'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === tab ? 'var(--text-main)' : 'var(--text-dim)',
                border: `1px solid ${activeTab === tab ? 'var(--border)' : 'transparent'}`,
                borderBottom: activeTab === tab ? '1px solid var(--bg-panel)' : '1px solid var(--border)',
                padding: '8px 20px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.15s ease',
              }}
            >
              {tab === 'bar' ? '◈ OI Gamma Exposure' : '◉ GEX Heatmap'}
            </button>
          ))}
        </div>

        {/* Charts */}
        <section style={{ padding: '0 2rem 2rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="panel" style={{
            flex: 1,
            minHeight: '500px',
            borderRadius: '0 12px 12px 12px',
            overflow: 'hidden',
          }}>
            {data ? (
              activeTab === 'bar' ? (
                <GEXBarChart
                  data={data.gex_by_strike}
                  spot={data.spot}
                  keyLevels={data.key_levels}
                />
              ) : (
                <GEXHeatmap
                  data={data.heatmap_data}
                  spot={data.spot}
                />
              )
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                  {loading ? 'Calculating GEX...' : error || 'Enter a ticker to begin'}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Loading Overlay */}
      {loading && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '1rem' }}>
              COMPUTING GAMMA EXPOSURE...
            </div>
            <div style={{
              width: '200px', height: '2px',
              background: 'var(--border)',
              borderRadius: '10px',
              overflow: 'hidden',
              marginTop: '1rem',
            }}>
              <div style={{
                width: '60%', height: '100%',
                background: 'linear-gradient(90deg, var(--accent), var(--positive))',
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && !loading && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem',
          padding: '1rem 1.5rem',
          background: 'var(--negative-soft)',
          border: '1px solid var(--negative)',
          color: 'var(--negative)',
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          zIndex: 1001,
          fontSize: '13px',
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </>
  )
}

export default App
