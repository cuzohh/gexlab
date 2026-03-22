import { useEffect, useState } from 'react'
import './index.css'

function App() {
  const [backendStatus, setBackendStatus] = useState<string>('checking...')
  const [thetaStatus, setThetaStatus] = useState<boolean | null>(null)

  useEffect(() => {
    // Check backend health
    fetch('http://localhost:8000/api/health')
      .then(res => res.json())
      .then(data => setBackendStatus(data.status))
      .catch(() => setBackendStatus('offline'))

    // Check ThetaData connectivity
    fetch('http://localhost:8000/api/theta-status')
      .then(res => res.json())
      .then(data => setThetaStatus(data.terminal_connected))
      .catch(() => setThetaStatus(null))
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
            ThetaTerminal:{' '}
            <span className={thetaStatus ? 'text-positive' : 'text-negative'}>
              {thetaStatus === null ? 'CHECKING...' : thetaStatus ? 'LIVE' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
      </header>

      <main>
        <div className="panel" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{marginTop: 0}}>Phase 1 Complete</h2>
          <p className="text-muted">
            The frontend is scaffolded with our custom dark theme and configured to fetch live statuses from the FastAPI backend. 
          </p>
          <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--bg-base)', borderRadius: '4px', border: '1px solid var(--border)' }}>
            <p>If ThetaTerminal is DISCONNECTED, please ensure Java 11+ is installed and the terminal is running locally on port 25510.</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
