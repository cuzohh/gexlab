'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [status, setStatus] = useState<{ status: string; service: string; polling: boolean } | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/metrics/bridge');
      const data = await res.json();
      if (data.payload) {
        await navigator.clipboard.writeText(data.payload);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy bridge payload');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Health check
        const healthRes = await fetch('http://localhost:8000/api/health');
        if (!healthRes.ok) throw new Error('Backend unreachable');
        const healthData = await healthRes.json();
        setStatus(healthData);

        // Analytics data
        const analyticsRes = await fetch('http://localhost:8000/api/metrics/analytics');
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          setAnalytics(analyticsData);
        }

        setError(null);
      } catch (err) {
        setError('Backend is offline.');
        setStatus(null);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const formatDollar = (val: number) => {
    const absVal = Math.abs(val);
    if (absVal >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
    if (absVal >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
    return `$${val.toLocaleString()}`;
  };

  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans">
      <header className="mb-12 flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            GexLab v2
          </h1>
          <p className="text-zinc-500 mt-2">Institutional-Grade Options Flow Suite</p>
        </div>
        {status && (
          <div className="flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-emerald-400 uppercase">Live</span>
          </div>
        )}
      </header>

      <main className="space-y-8">
        {/* Real-time Exposure Grid */}
        <section>
          <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-[0.2em] mb-6">Market Exposure (Net)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ExposureCard 
              title="GEX" 
              value={analytics?.summary?.totalNetGex} 
              description="Dollar Gamma Exposure" 
              unit="per 1% move"
            />
            <ExposureCard 
              title="DEX" 
              value={analytics?.summary?.totalNetDex} 
              description="Delta Exposure" 
            />
            <ExposureCard 
              title="Vanna" 
              value={analytics?.strikes?.reduce((acc: any, s: any) => acc + s.vex, 0)} 
              description="Sensitivity to Vol" 
            />
            <ExposureCard 
              title="Charm" 
              value={analytics?.strikes?.reduce((acc: any, s: any) => acc + s.chex, 0)} 
              description="Delta Decay / Time" 
            />
          </div>
        </section>

        {/* Level Intelligence */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-8">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-[0.2em]">Level Intelligence</h2>
              <button 
                onClick={handleCopy}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  copied 
                    ? 'bg-emerald-500 text-black scale-95' 
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {copied ? '✓ COPIED' : 'COPY FOR TRADINGVIEW'}
              </button>
            </div>
            <div className="space-y-6">
              <LevelRow 
                label="Gamma Flip" 
                value={analytics?.levels?.gammaFlip} 
                sub="Sub-strike interpolated" 
                color="text-emerald-400"
                glow 
              />
              <LevelRow 
                label="Call Wall" 
                value={analytics?.levels?.callWall} 
                sub="Max Upside Resistance" 
                color="text-blue-400" 
              />
              <LevelRow 
                label="Put Wall" 
                value={analytics?.levels?.putWall} 
                sub="Major Floor Support" 
                color="text-orange-500" 
              />
              <LevelRow 
                label="Max Pain" 
                value={analytics?.levels?.maxPain} 
                sub="Option Value Minimum" 
                color="text-zinc-400" 
              />
            </div>
          </div>

          <div className="bg-zinc-900/10 border border-zinc-800/50 rounded-2xl p-8 flex flex-col justify-center">
             <div className="text-center">
                <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Current Regime</p>
                <div className={`text-5xl font-bold tracking-tighter ${analytics?.summary?.totalNetGex > 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                   {analytics?.summary?.totalNetGex > 0 ? 'STABLE' : 'VOLATILE'}
                </div>
                <p className="text-zinc-600 text-sm mt-4 italic">
                  {analytics?.summary?.totalNetGex > 0 
                    ? "Dealers are LONG Gamma. Expected environment: Pinned, mean-reverting." 
                    : "Dealers are SHORT Gamma. Expected environment: Expansion, trend-following."}
                </p>
             </div>
          </div>
        </section>

        {/* Core Engine Status */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12 border-t border-zinc-900">
          <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-900">
            <h2 className="text-sm font-medium text-zinc-500 mb-4">Core Engine</h2>
            {status ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-300">FastAPI: <span className="text-emerald-400 font-mono">ONLINE</span></p>
                <p className="text-sm text-zinc-300">Polling: <span className="text-emerald-400 font-mono">ACTIVE (30s)</span></p>
              </div>
            ) : (
              <p className="text-sm text-red-500 font-mono uppercase tracking-tighter underline">SYSTEM DISCONNECTED</p>
            )}
          </div>
        </section>
      </main>

      <footer className="mt-20 pt-8 border-t border-zinc-900 text-zinc-600 text-xs">
        <p>© 2026 GexLab Quants • TradingView Bridge v2.0</p>
      </footer>
    </div>
  );
}

function ExposureCard({ title, value, description, unit }: any) {
  const isPositive = (value || 0) >= 0;
  
  const formatValue = (val: number) => {
    if (val === undefined || val === null) return "---";
    const absVal = Math.abs(val);
    if (absVal >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (absVal >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    return val.toLocaleString();
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-xl hover:border-zinc-700 transition-all group">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-zinc-500 text-xs font-bold">{title}</h3>
        {value !== undefined && (
          <div className={`w-1 h-1 rounded-full ${isPositive ? 'bg-blue-400' : 'bg-orange-400'}`} />
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-4xl font-bold tracking-tighter ${isPositive ? 'text-blue-400' : 'text-orange-400'}`}>
          {formatValue(value)}
        </span>
        {unit && <span className="text-zinc-600 text-[10px] font-mono">{unit}</span>}
      </div>
      <p className="text-[10px] text-zinc-600 mt-4 group-hover:text-zinc-400 transition-colors uppercase tracking-wider">{description}</p>
    </div>
  );
}

function LevelRow({ label, value, sub, color, glow }: any) {
  return (
    <div className="flex justify-between items-center group">
      <div>
        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">{label}</p>
        <p className="text-zinc-600 text-[10px]">{sub}</p>
      </div>
      <div className="text-right">
        <p className={`text-2xl font-mono font-bold tracking-tighter ${color} ${glow ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]' : ''}`}>
          {value ? value.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '---'}
        </p>
      </div>
    </div>
  );
}
