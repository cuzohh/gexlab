import { useEffect, useState } from 'react'
import './index.css'

function App() {
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [dataStatus, setDataStatus] = useState<boolean | null>(null)

  useEffect(() => {
    // Check backend health
    fetch('http://localhost:8000/api/health')
      .then(res => res.json())
      .then(data => setBackendStatus(data.status))
      .catch(() => setBackendStatus('offline'))

    // Check YFinance connectivity
    fetch('http://localhost:8000/api/data-status')
      .then(res => res.json())
      .then(data => setDataStatus(data.api_connected))
      .catch(() => setDataStatus(null))
  }, [])

  return (
    <div style={{ padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '1px' }}>GEXRADAR <span style={{color: 'var(--accent)'}}>// LAB</span></h1>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '14px', backgroundColor: 'var(--bg-panel)', padding: '0.5rem 1rem', borderRadius: '50px', border: '1px solid var(--border)' }}>
          <div>
            Backend:{' '}
            <span className={backendStatus === 'ok' ? 'text-positive' : 'text-negative'}>
              {backendStatus.toUpperCase()}
            </span>
          </div>
          <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border)' }}></div>
          <div>
            YFinance API:{' '}
            <span className={dataStatus ? 'text-positive' : 'text-negative'}>
              {dataStatus === null ? 'CHECKING...' : dataStatus ? 'LIVE' : 'UNREACHABLE'}
            </span>
          </div>
        </div>
      </header>

      <main>
        <div className="panel" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{marginTop: 0}}>Data Source Switched</h2>
          <p className="text-muted">
            The frontend is now configured to fetch live statuses from the FastAPI backend using Yahoo Finance (`yfinance`) data endpoints.
          </p>
          <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--bg-base)', borderRadius: '4px', border: '1px solid var(--border)' }}>
            <p>You can deploy this immediately. Render.com will host the Python FastAPI app seamlessly since `yfinance` fetches data directly from the web.</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
