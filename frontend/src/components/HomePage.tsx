/**
 * Homepage — Welcome landing page for GEXLAB.
 * Shows a hero section, feature overview, and quick-start guide.
 */

interface HomePageProps {
  onNavigate: (page: 'dashboard' | 'docs') => void
}

export default function HomePage({ onNavigate }: HomePageProps) {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.gexlabDesktop?.isDesktop)

  const features = [
    {
      icon: '◈',
      title: 'GEX Profile',
      desc: 'Visualize dealer gamma exposure by strike price. See where market makers are forced to buy or sell.',
    },
    {
      icon: '◉',
      title: 'GEX Heatmap',
      desc: 'Explore gamma exposure across every expiration and strike in a color-coded matrix.',
    },
    {
      icon: '⚡',
      title: 'Unusual Flow',
      desc: 'Spot anomalous volume concentration that may signal institutional positioning.',
    },
    {
      icon: '◎',
      title: 'Key Levels',
      desc: 'Automatically calculated Call Wall, Put Wall, Zero Gamma, Max Pain, and Vol Trigger.',
    },
    {
      icon: '⟁',
      title: 'Futures Translation',
      desc: 'SPY levels automatically converted to /ES, QQQ to /NQ, and more for futures traders.',
    },
    {
      icon: '↻',
      title: 'Auto-Refresh',
      desc: 'Data refreshes every 60 seconds to keep levels current throughout the trading session.',
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
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '4rem 2rem 8rem' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{
          fontSize: '3rem',
          fontWeight: 700,
          margin: 0,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}>
          GEX<span style={{ color: 'var(--accent)' }}>LAB</span>
        </h1>
        <p style={{
          color: 'var(--text-muted)',
          fontSize: '1.1rem',
          marginTop: '1rem',
          maxWidth: '500px',
          margin: '1rem auto 0',
          lineHeight: 1.6,
        }}>
          Free, open-source Gamma Exposure analytics.<br />
          Institutional-grade options intelligence for retail traders.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2.5rem' }}>
          <button
            onClick={() => onNavigate('dashboard')}
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              padding: '12px 28px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'transform 0.15s, box-shadow 0.15s',
              boxShadow: '0 4px 15px rgba(94, 106, 210, 0.3)',
            }}
          >
            Launch Dashboard →
          </button>
          <button
            onClick={() => onNavigate('docs')}
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              padding: '12px 28px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'border-color 0.15s',
            }}
          >
            Read the Docs
          </button>
        </div>
      </div>

      {/* Features Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.25rem',
      }}>
        {features.map(f => (
          <div key={f.title} className="panel" style={{ padding: '1.5rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{f.icon}</div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600 }}>{f.title}</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Quick Start */}
      <div className="panel" style={{ marginTop: '3rem', padding: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Quick Start</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {quickStartSteps.map(s => (
            <div key={s.step} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '6px',
                background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: 700, flexShrink: 0,
              }}>{s.step}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>{s.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '3rem', color: 'var(--text-dim)', fontSize: '12px' }}>
        GEXLAB is open source · Built with FastAPI + React + ECharts · Data from Yahoo Finance
      </div>
    </div>
  )
}
