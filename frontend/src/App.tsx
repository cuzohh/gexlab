import { useState, useEffect } from 'react'
import './index.css'

interface KeyLevels {
  call_wall: number | null
  put_wall: number | null
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
}

function App() {
  const [ticker, setTicker] = useState('SPY')
  const [data, setData] = useState<GEXData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [dataStatus, setDataStatus] = useState<boolean | null>(null)

  const fetchData = async (symbol: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`http://localhost:8000/api/gex/${symbol}`)
      const json = await res.json()
      if (json.error) {
        setError(json.error)
      } else {
        setData(json)
      }
    } catch (err) {
      setError('Failed to reach backend engine')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(ticker)
    
    // Check health
    fetch('http://localhost:8000/api/health')
      .then(res => res.json())
      .then(d => setBackendStatus(d.status))
      .catch(() => setBackendStatus('offline'))
      
    fetch('http://localhost:8000/api/data-status')
      .then(res => res.json())
      .then(d => setDataStatus(d.api_connected))
      .catch(() => setDataStatus(null))
  }, [])

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchData(ticker.toUpperCase())
  }

  return (
    <div id="root">
      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, letterSpacing: '0.05em' }}>
            GEXRADAR <span style={{ color: 'var(--accent)' }}>// LAB</span>
          </h1>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <form onSubmit={handleTickerSubmit}>
            <div className="card-title">Symbol</div>
            <input 
              className="search-input"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. SPY, QQQ, TSLA"
            />
          </form>
          
          <div style={{ marginTop: '2rem' }}>
            <div className="card-title">Major Walls</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="panel" style={{ padding: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CALL WALL</div>
                <div className="stat-value" style={{ color: 'var(--positive)', fontSize: '1.1rem' }}>
                  ${data?.key_levels.call_wall?.toFixed(2) || '---'}
                </div>
              </div>
              <div className="panel" style={{ padding: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PUT WALL</div>
                <div className="stat-value" style={{ color: 'var(--negative)', fontSize: '1.1rem' }}>
                  ${data?.key_levels.put_wall?.toFixed(2) || '---'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '1.5rem', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-dim)' }}>
          Backend: <span className={backendStatus === 'ok' ? 'text-positive' : 'text-negative'}>{backendStatus.toUpperCase()}</span>
          <br />
          YFinance: <span className={dataStatus ? 'text-positive' : 'text-negative'}>{dataStatus ? 'LIVE' : 'OFFLINE'}</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="glass-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{ticker.toUpperCase()}</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              ${data?.spot.toFixed(2) || '---'}
            </div>
            {data && (
              <span className={`badge ${data.regime === 'LONG_GAMMA' ? 'badge-positive' : 'badge-negative'}`}>
                {data.regime.replace('_', ' ')} • {data.regime === 'LONG_GAMMA' ? 'STABLE' : 'VOLATILE'}
              </span>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>NET GEX</div>
              <div className="stat-value" style={{ fontSize: '0.9rem', color: data?.net_gex && data.net_gex > 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {data?.net_gex ? `${data.net_gex > 0 ? '+' : ''}${data.net_gex.toFixed(2)}B` : '---'}
              </div>
            </div>
            <div>
              <div className="card-title" style={{ margin: 0 }}>NET DEX</div>
              <div className="stat-value" style={{ fontSize: '0.9rem' }}>
                {data?.net_dex ? `${data.net_dex > 0 ? '+' : ''}${data.net_dex.toFixed(2)}B` : '---'}
              </div>
            </div>
          </div>
        </header>

        <section style={{ padding: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {/* Quick Level Overview */}
          <div className="panel">
            <div className="card-title">Gamma Flip (Zero GEX)</div>
            <div className="stat-value" style={{ color: 'var(--warning)' }}>
              ${data?.key_levels.zero_gamma?.toFixed(2) || '---'}
            </div>
            <div style={{ fontSize: '12px', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
              Market regime transition line
            </div>
          </div>
          
          <div className="panel">
            <div className="card-title">Max Pain</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>
              ${data?.key_levels.max_pain?.toFixed(2) || '---'}
            </div>
            <div style={{ fontSize: '12px', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
              Strike with minimum dollar loss for sellers
            </div>
          </div>

          <div className="panel">
            <div className="card-title">Vol Trigger</div>
            <div className="stat-value">
              ${data?.key_levels.vol_trigger?.toFixed(2) || '---'}
            </div>
            <div style={{ fontSize: '12px', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
              Volume-weighted hedging concentration
            </div>
          </div>
        </section>

        {/* Charts Placeholder - to be built in Phase 4 */}
        <section style={{ padding: '0 2rem 2rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="card-title">OI Gamma Exposure (PHASE 4)</div>
              <div style={{ color: 'var(--text-dim)', marginTop: '1rem' }}>
                Chart logic being wired in Phase 4...
              </div>
            </div>
          </div>
          
          <div className="panel" style={{ flex: 1, height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="card-title">GEX Heatmap (PHASE 4)</div>
              <div style={{ color: 'var(--text-dim)', marginTop: '1rem' }}>
                Normalised matrix rendering in Phase 4...
              </div>
            </div>
          </div>
        </section>
      </main>

      {loading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>LOADING DATA...</div>
            <div style={{ width: '200px', height: '2px', background: 'var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ width: '60%', height: '100%', background: 'var(--accent)' }}></div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', padding: '1rem 1.5rem', background: 'var(--negative)', color: 'white', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', zIndex: 1001 }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

export default App
