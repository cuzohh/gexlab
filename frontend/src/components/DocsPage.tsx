import { useState } from 'react'
import LogoMark from './LogoMark'

interface DocsPageProps {
  onNavigate: (page: 'home' | 'dashboard') => void
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '3rem' }} className="animate-fadeIn">
      <h2 style={{
        fontSize: '1.25rem', fontWeight: 700,
        margin: '0 0 1rem', paddingBottom: '0.5rem',
        borderBottom: '1px solid var(--border)',
      }}>{title}</h2>
      {children}
    </section>
  )
}

function Term({ name, icon, children }: { name: string; icon?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon && <span style={{ fontSize: '1.2rem' }}>{icon}</span>}
        {name}
      </h3>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

function TText({ text, tooltip }: { text: string; tooltip: string }) {
  return (
    <span className="def-tooltip" data-tooltip={tooltip}>
      {text}
    </span>
  )
}

export default function DocsPage({ onNavigate }: DocsPageProps) {
  const [activeTab, setActiveTab] = useState<'intro' | 'levels' | 'dashboard' | 'math'>('intro')

  const tabs = [
    { id: 'intro', label: '1. Introduction' },
    { id: 'levels', label: '2. Key Levels' },
    { id: 'dashboard', label: '3. Reading the Dashboard' },
    { id: 'math', label: '4. Math & Data' },
  ] as const

  return (
    <div style={{ display: 'flex', maxWidth: '1160px', margin: '0 auto', padding: '2rem 2rem 7rem', gap: '3rem', width: '100%' }}>
      <nav style={{
        width: '240px', flexShrink: 0,
        position: 'sticky', top: '2rem',
        height: 'fit-content',
        display: 'flex', flexDirection: 'column', gap: '1.5rem'
      }}>
        <button
          onClick={() => onNavigate('home')}
          style={{
            background: 'none', border: 'none', color: 'var(--text-dim)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '12px',
            textAlign: 'left', padding: 0, fontWeight: 500, transition: 'color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent-2)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
        >Back to Home</button>

        <div className="panel" style={{ padding: '1rem 1rem 1.15rem' }}>
          <div style={{ marginBottom: '0.85rem' }}><LogoMark /></div>
          <div className="card-title" style={{ marginBottom: '0.75rem' }}>Documentation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  textAlign: 'left',
                  background: activeTab === tab.id ? 'var(--accent-soft)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--accent-2)' : 'var(--text-dim)',
                  border: `1px solid ${activeTab === tab.id ? 'rgba(56,189,248,0.35)' : 'transparent'}`,
                  padding: '8px 12px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => onNavigate('dashboard')}
          className="action-button"
          style={{ width: '100%' }}
        >Launch App</button>
      </nav>

      <article style={{ flex: 1, minWidth: 0 }}>
        {activeTab === 'intro' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Introduction to GEX</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>The absolute basics of Gamma Exposure and why it drives the market.</p>

            <Section id="what-is-gex" title="What is GEX?">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                <strong style={{ color: 'var(--text-main)' }}>GEX (Gamma Exposure)</strong> measures the total dollar amount
                that options <TText text="market makers" tooltip="Large financial institutions (dealers) that provide liquidity by taking the opposite side of retail and institutional options trades." /> need to buy or sell to <TText text="hedge" tooltip="To reduce risk. Since market makers only want to profit off the spread, they buy or sell the underlying stock so their net directional risk stays near zero." /> their portfolios
                for every 1% move in the underlying stock or ETF.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginTop: '0.75rem' }}>
                When you buy a call option, the market maker is now short that call. To stay neutral, they must buy shares of the underlying stock.
                <strong style={{ color: 'var(--text-main)' }}> Gamma</strong> tells them how much to buy or sell as the price moves.
                GEX aggregates that hedging pressure across every open contract on every strike and expiration.
              </p>
            </Section>

            <Section id="gamma-regime" title="The Gamma Regime">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginBottom: '1.5rem' }}>
                The total Net GEX defines the regime or tone of the market for the day.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="panel" style={{ padding: '1.5rem', borderColor: 'rgba(16,185,129,0.2)', backgroundColor: 'rgba(16,185,129,0.02)' }}>
                  <div className="badge badge-positive" style={{ marginBottom: '1rem', display: 'inline-block' }}>Positive Gamma</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: 0 }}>
                    Dealers are structurally forced to buy dips and sell rips to stay hedged. This tends to dampen market movement.
                  </p>
                </div>
                <div className="panel" style={{ padding: '1.5rem', borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.02)' }}>
                  <div className="badge badge-negative" style={{ marginBottom: '1rem', display: 'inline-block' }}>Negative Gamma</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: 0 }}>
                    Dealers are structurally forced to sell sell-offs and buy rallies. This tends to amplify market movement.
                  </p>
                </div>
              </div>
            </Section>
          </div>
        )}

        {activeTab === 'levels' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Key Levels</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>The magnetic and repelling price points calculated by the GEX engine.</p>

            <Section id="levels-explained" title="The 5 Major Levels">
              <Term name="Zero Gamma (Gamma Flip)" icon="ZG">
                The most critical level on the board. This is the exact price where the total <TText text="cumulative GEX" tooltip="The running sum of GEX from all strikes below the current price." /> crosses from negative to positive.
              </Term>
              <Term name="Call Wall" icon="CW">
                The strike price containing the highest amount of positive Call GEX. It often behaves like resistance.
              </Term>
              <Term name="Put Wall" icon="PW">
                The strike price containing the largest amount of negative Put GEX. It often behaves like support.
              </Term>
              <Term name="Vol Trigger" icon="VT">
                The strike with the highest volume-weighted GEX. This often acts like an intraday pivot.
              </Term>
              <Term name="Max Pain" icon="MP">
                The strike price where the total dollar value of all options expires worthless.
              </Term>
            </Section>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Reading the Dashboard</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>How to interpret the main charts and futures translation.</p>

            <Section id="the-charts" title="1. GEX Profile">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                The signature chart maps the exact structure of the walls and the net gamma shape by strike.
              </p>
            </Section>

            <Section id="the-heatmap" title="2. GEX Heatmap">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                The heatmap breaks down total GEX by expiration date on the Y-axis so near-dated pressure is obvious.
              </p>
            </Section>

            <Section id="unusual-flow" title="3. Unusual Flow">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                This chart flags abnormal options activity by strike, volume, and implied volatility.
              </p>
            </Section>

            <Section id="futures" title="Futures Translation">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                GEXLAB calculates a live ratio between the ETF and futures contract and applies it to every key level.
              </p>
            </Section>
          </div>
        )}

        {activeTab === 'math' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Math and Data Specs</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>Transparent breakdowns of how GEXLAB computes its numbers.</p>

            <Section id="the-formula" title="The GEX Formula">
              <div className="panel" style={{ padding: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '1rem', textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--border-bright)' }}>
                GEX = Gamma x OI x 100 x Spot^2 x 0.01 / 1,000,000,000
              </div>
            </Section>

            <Section id="data-source" title="Data and Limitations">
              <Term name="Source: Yahoo Finance API">
                GEXLAB uses Yahoo Finance-derived options data for free. Intraday data can lag, and the standard dealer-positioning assumptions are approximations.
              </Term>
            </Section>

            <Section id="disclaimer" title="Disclaimer">
              <div style={{ color: 'var(--negative)', fontSize: '0.85rem', lineHeight: 1.6, padding: '1rem', background: 'var(--negative-soft)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                GEXLAB is provided for informational and educational purposes only. It is not financial advice.
              </div>
            </Section>
          </div>
        )}
      </article>
    </div>
  )
}
