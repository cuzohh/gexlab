import LogoMark from './LogoMark'

interface HomePageProps {
  onNavigate: (page: 'dashboard' | 'docs') => void
}

export default function HomePage({ onNavigate }: HomePageProps) {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.gexlabDesktop?.isDesktop)

  const features = [
    {
      title: 'GEX Profile',
      desc: 'Visualize dealer gamma exposure by strike price and see where dealer hedging becomes market structure.',
    },
    {
      title: 'Heatmap',
      desc: 'Read gamma concentration across strikes and expirations in a fast, spatial view.',
    },
    {
      title: 'Unusual Flow',
      desc: 'Spot abnormal volume concentration that can signal institutional positioning or hedging.',
    },
    {
      title: 'Key Levels',
      desc: 'Track call wall, put wall, zero gamma, max pain, and vol trigger automatically.',
    },
    {
      title: 'Futures Mapping',
      desc: 'Translate ETF-derived levels to futures equivalents such as SPY to ES and QQQ to NQ.',
    },
    {
      title: 'Auto Refresh',
      desc: 'Keep the board current during the session without manually reloading each view.',
    },
  ]

  const quickStartSteps = isDesktop
    ? [
        { step: '1', text: 'Launch the installed GEXLAB desktop app.' },
        { step: '2', text: 'Wait a few seconds for the bundled Python engine to start in the background.' },
        { step: '3', text: 'Choose a ticker and begin your analysis directly inside the app window.' },
      ]
    : [
        { step: '1', text: 'Run `run_backend.bat` to start the Python GEX engine on port 8000.' },
        { step: '2', text: 'Run `run_frontend.bat` to start the React dashboard on port 3000.' },
        { step: '3', text: 'Open `http://localhost:3000` and select a ticker to begin your analysis.' },
      ]

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', padding: '4rem 2rem 7rem' }}>
      <div className="hero-panel" style={{ marginBottom: '3rem' }}>
        <div className="hero-copy">
          <div className="hero-kicker">Dealer positioning, rendered cleanly</div>
          <h1 className="hero-title">
            <LogoMark size={34} />
            <span>Gamma structure for the session, not just another chart.</span>
          </h1>
          <p className="hero-description">
            GEXLAB turns options positioning into a local analytics terminal for traders who want call walls, gamma flips,
            expiration pressure, and futures translation in one place.
          </p>
          <div className="hero-actions">
            <button className="action-button" onClick={() => onNavigate('dashboard')}>Launch Dashboard</button>
            <button className="secondary-button" onClick={() => onNavigate('docs')}>Read the Docs</button>
          </div>
          <div className="hero-note">
            {isDesktop ? 'Desktop mode active: custom window chrome and bundled backend enabled.' : 'For regular usage, the local desktop app is the recommended path.'}
          </div>
        </div>
        <div className="hero-metrics panel">
          <div className="hero-metric-row">
            <div className="card-title">Focus</div>
            <div className="stat-value" style={{ fontSize: '1.15rem' }}>Gamma, DEX, vanna</div>
          </div>
          <div className="hero-metric-row">
            <div className="card-title">Best Path</div>
            <div style={{ color: 'var(--accent-2)', fontWeight: 600 }}>Local desktop app</div>
          </div>
          <div className="hero-metric-row">
            <div className="card-title">Rate Limits</div>
            <div style={{ color: 'var(--warning)', fontWeight: 600 }}>Web can bottleneck</div>
          </div>
        </div>
      </div>

      <div className="feature-grid">
        {features.map((f, index) => (
          <div key={f.title} className="panel feature-card">
            <div className="feature-index">0{index + 1}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: '3rem', padding: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Quick Start</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {quickStartSteps.map(s => (
            <div key={s.step} style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
              <div className="step-badge">{s.step}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>{s.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '3rem', color: 'var(--text-dim)', fontSize: '12px' }}>
        GEXLAB is open source. Built with FastAPI, React, and ECharts. Data sourced through Yahoo Finance.
      </div>
    </div>
  )
}
