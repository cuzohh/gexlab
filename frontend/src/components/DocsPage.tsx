import { useState } from 'react'

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
    <div style={{ display: 'flex', maxWidth: '1100px', margin: '0 auto', padding: '2rem 2rem 4rem', gap: '3rem', width: '100%' }}>
      {/* Sidebar Navigation */}
      <nav style={{
        width: '220px', flexShrink: 0,
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
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
        >← Back to Home</button>

        <div>
          <div className="card-title" style={{ marginBottom: '0.75rem' }}>Documentation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  textAlign: 'left',
                  background: activeTab === tab.id ? 'var(--accent-soft)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-dim)',
                  border: `1px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                  padding: '8px 12px',
                  borderRadius: '6px',
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
          style={{
            background: 'var(--accent)', color: 'white', border: 'none',
            padding: '10px 16px', borderRadius: '8px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '13px',
            marginTop: '1rem', width: '100%',
            boxShadow: '0 4px 15px rgba(94, 106, 210, 0.3)',
          }}
        >Launch App →</button>
      </nav>

      {/* Main Content Area */}
      <article style={{ flex: 1, minWidth: 0 }}>
        {activeTab === 'intro' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Introduction to GEX</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>The absolute basics of Gamma Exposure and why it drives the market.</p>

            <Section id="what-is-gex" title="What is GEX?">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                <strong style={{ color: 'var(--text-main)' }}>GEX (Gamma Exposure)</strong> measures the total dollar amount
                that options <TText text="market makers" tooltip="Large financial institutions (dealers) that provide liquidity by taking the opposite side of retail and institutional options trades." /> need to buy or sell to <TText text="hedge" tooltip="To reduce risk. Since market makers only want to profit off the spread, they buy/sell the underlying stock so their net directional risk (Delta) stays at zero." /> their portfolios
                for every 1% move in the underlying stock or ETF.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginTop: '0.75rem' }}>
                When you buy a call option, the market maker is now <em>short</em> that call. To stay neutral, they must buy shares of the underlying stock.
                <strong style={{ color: 'var(--text-main)' }}> Gamma</strong> tells them <em>how much</em> to buy or sell as the price moves.
                GEX aggregates all of this hedging activity across every open contract on every strike and expiration.
              </p>
              <div className="panel" style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(94, 106, 210, 0.1)', borderColor: 'rgba(94,106,210,0.2)' }}>
                <strong style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>💡 The Invisible Hand</strong>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.5rem 0 0', lineHeight: 1.6 }}>
                  GEX is a map of <em>where market makers are forced to trade</em>. It creates invisible walls and magnets in the market
                  that influence price behavior. If you know where the walls are, you have a massive advantage.
                </p>
              </div>
            </Section>

            <Section id="gamma-regime" title="The Gamma Regime">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginBottom: '1.5rem' }}>
                The total Net GEX defines the "regime" or mood of the market for the day.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="panel" style={{ padding: '1.5rem', borderColor: 'rgba(16,185,129,0.2)', backgroundColor: 'rgba(16,185,129,0.02)' }}>
                  <div className="badge badge-positive" style={{ marginBottom: '1rem', display: 'inline-block' }}>◉ POSITIVE GAMMA</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: 0 }}>
                    Dealers are structurally forced to <strong>buy dips and sell rips</strong> to stay hedged. This actively dampens market movement.
                  </p>
                  <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, paddingLeft: '1.2rem', margin: '1rem 0 0' }}>
                    <li>Low volatility environment</li>
                    <li>Price tends to chop in a narrow range</li>
                    <li>Excellent conditions for mean-reversion trading</li>
                  </ul>
                </div>
                <div className="panel" style={{ padding: '1.5rem', borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.02)' }}>
                  <div className="badge badge-negative" style={{ marginBottom: '1rem', display: 'inline-block' }}>◉ NEGATIVE GAMMA</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: 0 }}>
                    Dealers are structurally forced to <strong>sell into sell-offs and buy into rallies</strong>. This actively amplifies market movement.
                  </p>
                  <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, paddingLeft: '1.2rem', margin: '1rem 0 0' }}>
                    <li>High volatility environment</li>
                    <li>Prone to violent sell-offs and short squeezes</li>
                    <li>Excellent conditions for trend and momentum trading</li>
                  </ul>
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
              <Term name="Zero Gamma (Gamma Flip)" icon="🟡">
                The most critical level on the board. This is the exact price where the total <TText text="cumulative GEX" tooltip="The running sum of GEX from all strikes below the current price." /> crosses from negative to positive. 
                <br /><br />
                Think of it as the <strong>equator</strong>. Above Zero Gamma, the market is in a Positive Gamma regime (calm). Below Zero Gamma, it enters a Negative Gamma regime (volatile). When price crosses this line intraday, market behavior often shifts dramatically.
              </Term>

              <Term name="Call Wall" icon="🟢">
                The strike price containing the absolute highest amount of positive Call GEX. 
                <br /><br />
                This acts as the ultimate <strong>ceiling or resistance level</strong>. When the market rallies toward the Call Wall, market makers who sold those calls must sell the underlying stock to stay hedged, which suppresses further upside. During bull markets, the price often "pins" right below this level.
              </Term>

              <Term name="Put Wall" icon="🔴">
                The strike price containing the absolute largest amount of negative Put GEX. 
                <br /><br />
                This acts as the ultimate <strong>floor or support level</strong>. When the market drops toward the Put Wall, market makers must buy stock to stay hedged, cushioning the fall. However, if the market crashes <em>through</em> the Put Wall (which is rare), it unleashes massive dealer selling, leading to flash crashes.
              </Term>

              <Term name="Vol Trigger" icon="💜">
                The strike with the highest <strong>volume-weighted GEX</strong>. While the Call/Put walls are based on Open Interest (long-term positions), the Vol Trigger factors in today's live trading volume. 
                <br /><br />
                This acts as an intraday pivot. If price falls below the Vol Trigger, short-term volatility usually expands.
              </Term>

              <Term name="Max Pain" icon="🟣">
                The strike price where the total dollar value of all options expires worthless. 
                <br /><br />
                Because market makers are net sellers of options, this is the price where they make the most profit at expiration. While controversial, there is empirical evidence that markets tend to gravitate toward Max Pain on <TText text="OpEx" tooltip="Options Expiration day, usually the third Friday of the month." /> days.
              </Term>
            </Section>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Reading the Dashboard</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>How to interpret the 3 main charts and futures translation.</p>

            <Section id="the-charts" title="1. GEX Profile (Bar Chart)">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                The signature chart of GEXLAB. It maps out the exact structure of the walls.
              </p>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, paddingLeft: '1.2rem' }}>
                <li><strong style={{ color: '#10b981' }}>Green bars extending right</strong> represent positive Call GEX.</li>
                <li><strong style={{ color: '#ef4444' }}>Red bars extending left</strong> represent negative Put GEX.</li>
                <li>The absolute tallest green bar is automatically your Call Wall.</li>
                <li>The absolute longest red bar is automatically your Put Wall.</li>
              </ul>
            </Section>

            <Section id="the-heatmap" title="2. GEX Heatmap">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                The heatmap breaks down the total GEX by <strong>expiration date</strong> on the Y-axis.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                This is crucial because <TText text="Gamma is highest for short-dated options" tooltip="Options expiring today (0DTE) or tomorrow have massively higher gamma than options expiring in 6 months, because their delta changes violently as they approach expiration." />. A large green cluster at the top of the heatmap (near-term expirations) exerts much more pull on the market today than a large cluster at the bottom.
              </p>
            </Section>

            <Section id="unusual-flow" title="3. Unusual Flow (Bubble Chart)">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                This chart automatically flags anomalous options activity.
              </p>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, paddingLeft: '1.2rem' }}>
                <li><strong>X-axis:</strong> Strike Price</li>
                <li><strong>Y-axis:</strong> Implied Volatility (IV). Higher IV means options are more expensive.</li>
                <li><strong>Bubble Size:</strong> Represents the sheer volume of contracts traded today.</li>
                <li><strong>Glowing Borders:</strong> Any bubble with a bright glowing border has volume more than <strong>1.5 standard deviations</strong> above the daily mean.</li>
              </ul>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                When you see a massive, glowing bubble far away from the spot price, it usually indicates an institution placing a massive directional bet or hedge.
              </p>
            </Section>

            <Section id="futures" title="Futures Translation">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                You can't trade SPY options based on ES futures levels directly because they trade at different prices (due to interest rates and dividends affecting the <TText text="basis" tooltip="The numerical price difference between a futures contract and its underlying asset." />).
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
                GEXLAB handles this automatically. It calculates a live ratio `(Futures Price / ETF Price)` and applies it to every key level. In your sidebar, you will see exactly where the SPY Call Wall maps onto your /ES or /NQ chart in real-time.
              </p>
            </Section>
          </div>
        )}

        {activeTab === 'math' && (
          <div className="animate-slideUp">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Math & Data Specs</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', margin: '0 0 3rem' }}>Transparent breakdowns of how GEXLAB computes its numbers.</p>

            <Section id="the-formula" title="The GEX Formula">
              <div className="panel" style={{ padding: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '1rem', textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--border-bright)' }}>
                GEX = Γ × OI × 100 × Spot² × 0.01 / 1,000,000,000
              </div>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 2, paddingLeft: '1.5rem', marginTop: '1.5rem' }}>
                <li><strong>Γ (Gamma)</strong> = Black-Scholes gamma. Derived live using Yahoo Finance's Implied Volatility.</li>
                <li><strong>OI</strong> = Open Interest. The number of active contracts held.</li>
                <li><strong>100</strong> = Standard option contract multiplier (1 contract = 100 shares).</li>
                <li><strong>Spot²</strong> = Converting the dollar-gamma into a notional exposure value.</li>
                <li><strong>0.01</strong> = Scaling the formula to represent a 1% move in the underlying asset.</li>
                <li><strong>÷ 1B</strong> = Dividing by a billion to make the huge numbers readable on the dashboard.</li>
              </ul>
            </Section>

            <Section id="data-source" title="Data & Limitations">
              <Term name="Source: Yahoo Finance API">
                GEXLAB uses `yfinance` to scrape options data for free. Be aware of the constraints:
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  <li><strong>Latency:</strong> Intraday data is delayed by roughly 15 minutes.</li>
                  <li><strong>Assumptions:</strong> The standard GEX model assumes <em>all</em> calls are sold by dealers (positive gamma) and <em>all</em> puts are sold by dealers (negative gamma). In reality, customers also sell options. </li>
                  <li><strong>Updates:</strong> The 60-second auto-refresh keeps your data as fresh as Yahoo allows. The levels become perfectly accurate at End-of-Day (EOD).</li>
                </ul>
              </Term>
            </Section>
            
            <Section id="disclaimer" title="Disclaimer">
              <div style={{ color: 'var(--negative)', fontSize: '0.85rem', lineHeight: 1.6, padding: '1rem', background: 'var(--negative-soft)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                GEXLAB is provided for informational and educational purposes only. Options trading involves high risk and is not suitable for all investors. The levels provided are mathematical derivations based on delayed data, not trading signals. Never risk money you cannot afford to lose.
              </div>
            </Section>
          </div>
        )}
      </article>
    </div>
  )
}
