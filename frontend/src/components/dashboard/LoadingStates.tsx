import { ActionButton, Badge, TickerToggle } from './DashboardBits';
import { RefreshCw } from 'lucide-react';

export function LoadingScreen({
  ticker,
  setTicker,
  sessionMode,
}: {
  ticker: 'SPY' | 'QQQ';
  setTicker: (ticker: 'SPY' | 'QQQ') => void;
  sessionMode: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-[linear-gradient(180deg,#f7f4ee_0%,#f8f8f6_32%,#f4f2ed_100%)] dark:bg-[linear-gradient(180deg,#0f1115_0%,#12151b_38%,#171b22_100%)] flex flex-col items-center justify-center p-10 font-sans transition-colors duration-300">
      <LoadingMark />
      <h1 className="text-2xl font-light tracking-tight text-[#1D1D1F] dark:text-[#f5efe3]">
        GexLab <span className="text-[#D4AF37] font-medium tracking-[-0.02em]">v2</span>
      </h1>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Badge tone="slate">{sessionMode}</Badge>
        <Badge tone="slate">Preparing analytics engine</Badge>
      </div>
      <p className="mt-5 max-w-md text-center text-[12px] leading-relaxed opacity-75 text-[#7b7366] dark:text-[#aba091]">
        Pulling the latest chain, calculating greeks, and shaping levels for {ticker}. The first cycle usually lands within 30 to 60 seconds.
      </p>
      <div className="mt-10 flex items-center gap-4 rounded-2xl border border-[#E5E5E7] bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/6">
        <TickerToggle active={ticker === 'SPY'} onClick={() => setTicker('SPY')} label="SPY" />
        <TickerToggle active={ticker === 'QQQ'} onClick={() => setTicker('QQQ')} label="QQQ" />
      </div>
    </div>
  );
}

function LoadingMark() {
  return (
    <div className="mb-8 grid h-20 w-20 place-items-center rounded-[1.75rem] bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.94),rgba(244,240,233,0.72))] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_14px_35px_rgba(45,33,17,0.08)] dark:bg-[radial-gradient(circle_at_30%_30%,rgba(34,39,48,0.95),rgba(18,21,27,0.9))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_35px_rgba(0,0,0,0.3)]">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-16 w-16 -rotate-90">
          <rect
            x="10"
            y="10"
            width="44"
            height="44"
            rx="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            className="text-[#e8e3d8] dark:text-white/10"
          />
          <rect
            x="10"
            y="10"
            width="44"
            height="44"
            rx="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="96 180"
            className="origin-center animate-spin text-[#D4AF37]"
          />
        </svg>
        <div className="absolute inset-[18px] rounded-[0.95rem] bg-[rgba(255,255,255,0.55)] dark:bg-white/[0.04]" />
      </div>
    </div>
  );
}

export function ErrorScreen({
  ticker,
  setTicker,
  message,
  onRetry,
}: {
  ticker: 'SPY' | 'QQQ';
  setTicker: (ticker: 'SPY' | 'QQQ') => void;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="min-h-[100dvh] bg-[linear-gradient(180deg,#f7f4ee_0%,#f8f8f6_32%,#f4f2ed_100%)] dark:bg-[linear-gradient(180deg,#0f1115_0%,#12151b_38%,#171b22_100%)] flex flex-col items-center justify-center p-10 font-sans transition-colors duration-300">
      <div className="max-w-xl rounded-[2rem] border border-[#ead8b2] bg-white px-8 py-8 text-center shadow-[0_25px_80px_rgba(45,33,17,0.08)] dark:border-[#5d4c28] dark:bg-[#171b22] dark:shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
        <p className="text-[10px] uppercase tracking-[0.34em] font-black text-[#8e7b5f] dark:text-[#d5c08a]">Engine Attention Required</p>
        <h1 className="mt-3 text-3xl font-light tracking-[-0.04em] text-[#1D1D1F] dark:text-[#f5efe3]">Dashboard waiting on data</h1>
        <p className="mt-4 text-sm leading-relaxed text-[#6d6458] dark:text-[#b1a595]">{message}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ActionButton onClick={onRetry} label="Retry Refresh" icon={<RefreshCw size={14} />} />
        </div>
        <div className="mt-8 flex items-center justify-center gap-4 rounded-2xl border border-[#ede4d6] bg-[#faf7f1] p-1 dark:border-white/10 dark:bg-white/6">
          <TickerToggle active={ticker === 'SPY'} onClick={() => setTicker('SPY')} label="SPY" />
          <TickerToggle active={ticker === 'QQQ'} onClick={() => setTicker('QQQ')} label="QQQ" />
        </div>
      </div>
    </div>
  );
}
