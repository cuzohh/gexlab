/**
 * DocsPage — Comprehensive documentation explaining every concept, metric,
 * and feature in GEXLAB. Designed for absolute beginners.
 */

interface DocsPageProps {
  onNavigate: (page: 'home' | 'dashboard') => void
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '3rem' }}>
      <h2 style={{
        fontSize: '1.25rem', fontWeight: 700,
        margin: '0 0 1rem',
        paddingBottom: '0.5rem',
        borderBottom: '1px solid var(--border)',
      }}>{title}</h2>
      {children}
    </section>
  )
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent)' }}>{name}</h3>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

export default function DocsPage({ onNavigate }: DocsPageProps) {
  const tocItems = [
    { id: 'what-is-gex', label: 'What is GEX?' },
    { id: 'why-it-matters', label: 'Why It Matters' },
    { id: 'key-levels', label: 'Key Levels Explained' },
    { id: 'gamma-regime', label: 'Gamma Regime' },
    { id: 'the-charts', label: 'Reading the Charts' },
    { id: 'unusual-flow', label: 'Unusual Flow' },
    { id: 'futures', label: 'Futures Translation' },
    { id: 'the-formula', label: 'The GEX Formula' },
    { id: 'data-source', label: 'Data Source & Limitations' },
    { id: 'faq', label: 'FAQ' },
  ]

  return (
    <div style={{ display: 'flex', maxWidth: '1100px', margin: '0 auto', padding: '2rem', gap: '3rem' }}>
      {/* Sticky Table of Contents */}
      <nav style={{
        width: '200px', flexShrink: 0,
        position: 'sticky', top: '2rem',
        height: 'fit-content',
      }}>
        <button
          onClick={() => onNavigate('home')}
          style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px',
            padding: '0 0 1rem', fontWeight: 600,
          }}
        >← Home</button>

        <div className="card-title" style={{ marginBottom: '0.75rem' }}>Contents</div>
        {tocItems.map(item => (
          <a
            key={item.id}
            href={`#${item.id}`}
            style={{
              display: 'block',
              color: 'var(--text-dim)',
              fontSize: '12px',
              textDecoration: 'none',
              padding: '4px 0',
              transition: 'color 0.15s',
              lineHeight: 1.5,
            }}
          >{item.label}</a>
        ))}

        <button
          onClick={() => onNavigate('dashboard')}
          style={{
            background: 'var(--accent)', color: 'white', border: 'none',
            padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '12px',
            marginTop: '1.5rem', width: '100%',
          }}
        >Open Dashboard →</button>
      </nav>

      {/* Content */}
      <article style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
          GEXLAB Documentation
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 3rem', fontSize: '0.9rem' }}>
          Everything you need to understand Gamma Exposure and how to use this dashboard.
        </p>

        <Section id="what-is-gex" title="What is GEX?">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8 }}>
            <strong style={{ color: 'var(--text-main)' }}>GEX (Gamma Exposure)</strong> measures the total dollar amount
            that options market makers (dealers) need to hedge for every 1% move in the underlying stock or ETF. It is expressed
            in <strong style={{ color: 'var(--text-main)' }}>billions of dollars</strong>.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, marginTop: '0.75rem' }}>
            When you buy a call option from a market maker, the market maker is now <em>short</em> that call. To stay neutral
            (which is their entire business model), they must buy shares of the underlying stock to hedge. <strong style={{ color: 'var(--text-main)' }}>Gamma</strong> tells
            them <em>how much</em> to buy or sell as the price moves. GEX aggregates all of this hedging activity across every
            open contract on every strike and expiration.
          </p>
          <div className="panel" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--accent-soft)', borderColor: 'rgba(94,106,210,0.2)' }}>
            <strong style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>💡 Think of it this way:</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.5rem 0 0', lineHeight: 1.6 }}>
              GEX is a map of <em>where market makers are forced to trade</em>. It creates invisible walls and magnets in the market
              that influence price behavior — even if most traders can't see them.
            </p>
          </div>
        </Section>

        <Section id="why-it-matters" title="Why It Matters for Trading">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8 }}>
            GEX directly impacts how volatile or stable a stock will be on any given day. Here's why:
          </p>
          <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 2, paddingLeft: '1.5rem' }}>
            <li><strong style={{ color: 'var(--positive)' }}>Positive GEX (Long Gamma):</strong> Dealers buy dips and sell rips, <em>dampening</em> volatility. The market tends to chop in a range. Think "sticky" price action.</li>
            <li><strong style={{ color: 'var(--negative)' }}>Negative GEX (Short Gamma):</strong> Dealers are forced to sell into sell-offs and buy into rallies, <em>amplifying</em> moves. This is when you see violent selloffs and squeezes.</li>
          </ul>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, marginTop: '0.5rem' }}>
            Knowing the GEX regime before the market opens gives you a massive edge in setting expectations for the day's range and behavior.
          </p>
        </Section>

        <Section id="key-levels" title="Key Levels Explained">
          <Term name="🟢 Call Wall">
            The strike price with the <strong>highest positive (call) GEX</strong>. This acts as a <strong>resistance level</strong> because
            as price approaches it, dealers who sold calls must sell more stock to stay hedged, creating selling pressure.
            The market often "pins" to the Call Wall during positive gamma regimes.
          </Term>
          <Term name="🔴 Put Wall">
            The strike price with the <strong>most negative (put) GEX</strong>. This acts as a <strong>support level</strong> because
            dealers who sold puts must buy stock as price approaches, providing a natural floor. Breaking below the Put Wall
            in a short gamma environment can trigger violent cascading moves.
          </Term>
          <Term name="🟡 Zero Gamma (Gamma Flip)">
            The most important level. This is the price where <strong>cumulative GEX crosses from positive to negative</strong>.
            Above this level, dealers stabilize the market (positive gamma). Below it, dealers amplify moves (negative gamma).
            Think of it as the "mood switch" of the entire market.
          </Term>
          <Term name="🟣 Max Pain">
            The strike price where the <strong>total dollar value of all options expires worthless</strong>. In other words, this is
            the price at which option sellers (market makers) make the most money. Stocks tend to drift toward Max Pain, especially
            during the last week before monthly expirations (known as "OpEx pinning").
          </Term>
          <Term name="💜 Vol Trigger">
            The strike with the <strong>highest volume-weighted GEX concentration</strong>. This represents where the most active
            hedging flow is occurring, and often acts as a pivot point for intraday trading.
          </Term>
        </Section>

        <Section id="gamma-regime" title="Gamma Regime">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
            <div className="panel" style={{ padding: '1.25rem', borderColor: 'rgba(16,185,129,0.2)' }}>
              <div className="badge badge-positive" style={{ marginBottom: '0.75rem' }}>◉ POSITIVE GAMMA</div>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.8, paddingLeft: '1rem', margin: 0 }}>
                <li>Net GEX is positive</li>
                <li>Price is above the Zero Gamma level</li>
                <li>Low volatility environment</li>
                <li>Range-bound, mean-reverting</li>
                <li>Good for selling premium, fading moves</li>
              </ul>
            </div>
            <div className="panel" style={{ padding: '1.25rem', borderColor: 'rgba(239,68,68,0.2)' }}>
              <div className="badge badge-negative" style={{ marginBottom: '0.75rem' }}>◉ NEGATIVE GAMMA</div>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.8, paddingLeft: '1rem', margin: 0 }}>
                <li>Net GEX is negative</li>
                <li>Price is below the Zero Gamma level</li>
                <li>High volatility environment</li>
                <li>Trend-following, breakout-prone</li>
                <li>Good for buying premium, riding momentum</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="the-charts" title="Reading the Charts">
          <Term name="◈ GEX Profile (Bar Chart)">
            This is the primary chart. Each horizontal bar represents a strike price:
            <ul style={{ paddingLeft: '1rem', marginTop: '0.5rem' }}>
              <li><strong style={{ color: '#10b981' }}>Green bars (right)</strong> = Call GEX — dealers are net-long gamma at this strike</li>
              <li><strong style={{ color: '#ef4444' }}>Red bars (left)</strong> = Put GEX — dealers are net-short gamma at this strike</li>
              <li>The <strong>tallest green bar</strong> is the Call Wall</li>
              <li>The <strong>tallest red bar</strong> is the Put Wall</li>
              <li>Horizontal lines mark the Spot Price, Zero Gamma, Call Wall, and Put Wall</li>
            </ul>
          </Term>
          <Term name="◉ GEX Heatmap">
            A 2D matrix where the X-axis is strike price and Y-axis is expiration date. Color intensity shows
            how much gamma exposure is concentrated at each intersection:
            <ul style={{ paddingLeft: '1rem', marginTop: '0.5rem' }}>
              <li><strong style={{ color: '#10b981' }}>Green</strong> = positive (call-dominated) GEX</li>
              <li><strong style={{ color: '#ef4444' }}>Red</strong> = negative (put-dominated) GEX</li>
              <li>Bright spots reveal where the most hedging pressure is concentrated</li>
              <li>Near-term expirations have stronger gamma effects</li>
            </ul>
          </Term>
        </Section>

        <Section id="unusual-flow" title="Unusual Flow">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8 }}>
            The Unusual Flow bubble chart highlights strikes where trading volume is <strong>statistically anomalous</strong> — 
            more than 1.5 standard deviations above the average volume across all strikes.
          </p>
          <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 2, paddingLeft: '1.5rem' }}>
            <li><strong>Bubble size</strong> = relative volume (bigger = more contracts traded)</li>
            <li><strong>Y-axis</strong> = average implied volatility (higher = more expensive options)</li>
            <li><strong>Color</strong> = green for call-heavy, red for put-heavy</li>
            <li><strong>Bright borders</strong> = anomaly detected (⚡ UNUSUAL tag in tooltip)</li>
          </ul>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, marginTop: '0.5rem' }}>
            Unusual flow can signal large institutional orders, hedging activity, or speculative bets that haven't yet been reflected
            in the price.
          </p>
        </Section>

        <Section id="futures" title="Futures Translation">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8 }}>
            For futures traders, GEXLAB automatically converts ETF-based levels to their futures equivalent using a <strong>live price ratio</strong>:
          </p>
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>ETF</th>
                  <th style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>Futures</th>
                  <th style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>Description</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text-main)' }}>
                {[
                  ['SPY', '/ES', 'S&P 500 E-mini'],
                  ['QQQ', '/NQ', 'Nasdaq 100 E-mini'],
                  ['IWM', '/RTY', 'Russell 2000 E-mini'],
                  ['DIA', '/YM', 'Dow E-mini'],
                  ['TLT', '/ZN', '10-Year Note'],
                  ['GLD', '/GC', 'Gold'],
                  ['SLV', '/SI', 'Silver'],
                  ['USO', '/CL', 'Crude Oil'],
                ].map(([etf, fut, desc]) => (
                  <tr key={etf} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{etf}</td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{fut}</td>
                    <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.7, marginTop: '0.75rem' }}>
            The conversion uses a <em>live ratio</em>: <code style={{ background: 'var(--bg-base)', padding: '2px 6px', borderRadius: '4px' }}>futures_level = etf_level × (futures_price / etf_price)</code>.
            This is recalculated on every refresh to account for basis differences.
          </p>
        </Section>

        <Section id="the-formula" title="The GEX Formula">
          <div className="panel" style={{ padding: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', textAlign: 'center', background: 'var(--bg-base)' }}>
            GEX = Gamma × OI × 100 × Spot² × 0.01 / 1,000,000,000
          </div>
          <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 2, paddingLeft: '1.5rem', marginTop: '1rem' }}>
            <li><strong>Gamma</strong> = Black-Scholes gamma (how much delta changes per $1 of spot)</li>
            <li><strong>OI</strong> = Open Interest (number of open contracts at the strike)</li>
            <li><strong>100</strong> = each option contract represents 100 shares</li>
            <li><strong>Spot²</strong> = squared spot price (converts gamma dollars to notional)</li>
            <li><strong>0.01</strong> = normalizes to a 1% move</li>
            <li><strong>÷ 1B</strong> = converts to billions for readability</li>
          </ul>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, marginTop: '0.5rem' }}>
            Greeks (Delta and Gamma) are computed using the <strong>Black-Scholes model</strong> with implied volatility
            from Yahoo Finance. GEXLAB uses pure Python math (no scipy dependency) for maximum portability.
          </p>
        </Section>

        <Section id="data-source" title="Data Source & Limitations">
          <Term name="Yahoo Finance (yfinance)">
            GEXLAB uses Yahoo Finance for all options data. This is a free data source with the following characteristics:
            <ul style={{ paddingLeft: '1rem', marginTop: '0.5rem' }}>
              <li><strong>Intraday data:</strong> ~15 minute delay from real-time</li>
              <li><strong>EOD data:</strong> Full accuracy, updated after market close</li>
              <li><strong>Greeks:</strong> Not provided directly; GEXLAB calculates them using Black-Scholes</li>
              <li><strong>Unusual flow:</strong> Based on daily volume/OI concentration, not individual trade prints</li>
            </ul>
          </Term>
          <Term name="Important Caveats">
            <ul style={{ paddingLeft: '1rem', marginTop: '0.25rem' }}>
              <li>GEX assumes <em>all</em> open interest is dealer-short (the standard convention). In reality, some OI is dealer-long.</li>
              <li>The data does not distinguish between opening and closing trades.</li>
              <li>Intraday levels may shift as new trades flow in — use the auto-refresh feature.</li>
              <li>This tool is for <strong>educational and informational purposes only</strong>. It is not financial advice.</li>
            </ul>
          </Term>
        </Section>

        <Section id="faq" title="FAQ">
          <Term name="What time should I check the dashboard?">
            The best time is <strong>before the market opens</strong> (9:00–9:30 AM ET) to set your levels for the day.
            Then check again at <strong>midday</strong> and <strong>into the close</strong> as large flows can shift the gamma landscape.
          </Term>
          <Term name="Why does the data take a few seconds to load?">
            GEXLAB fetches the full options chain (all strikes across multiple expirations), then computes Black-Scholes
            Greeks for every single contract. This is thousands of calculations in real time.
          </Term>
          <Term name="Can I use this for crypto or forex?">
            No. GEX analysis only applies to instruments with listed options (stocks, ETFs, indices). Crypto and forex
            markets do not have centralized options exchanges with public OI data.
          </Term>
          <Term name="Is this financial advice?">
            <strong>No.</strong> GEXLAB is an open-source educational tool. Always do your own research and consult with
            a qualified financial advisor before making trading decisions.
          </Term>
        </Section>
      </article>
    </div>
  )
}
