'use client';

import { motion } from 'framer-motion';
import { CalendarDays, ChevronDown, Radio, Waves } from 'lucide-react';
import { AnimatedThemeToggle } from '@/components/ui/animated-theme-toggle';
import { cn } from '@/lib/utils';
import { useWorkspacePrefs } from './WorkspacePrefsProvider';

export function GlobalControlBar({
  availableDates,
  pollerPaused,
}: {
  availableDates: string[];
  pollerPaused: boolean;
}) {
  const {
    hydrated,
    ticker,
    setTicker,
    priceMode,
    setPriceMode,
    selectedDate,
    setSelectedDate,
    sessionMode,
  } = useWorkspacePrefs();

  if (!hydrated) return null;

  return (
    <motion.aside
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="fixed inset-x-0 bottom-4 z-50 px-4 xl:hidden"
    >
      <div className="mx-auto flex max-w-fit flex-wrap items-center justify-center gap-2 rounded-full border border-[#e3d9c8] bg-[rgba(250,247,241,0.88)] px-3 py-2 shadow-[0_18px_48px_rgba(45,33,17,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(16,19,24,0.88)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-1 rounded-full border border-[#eadfce] bg-white/80 p-1 dark:border-white/10 dark:bg-white/6">
          <MiniPill active={ticker === 'SPY'} onClick={() => setTicker('SPY')}>
            SPY
          </MiniPill>
          <MiniPill active={ticker === 'QQQ'} onClick={() => setTicker('QQQ')}>
            QQQ
          </MiniPill>
        </div>

        <div className="hidden h-6 w-px bg-[#e6ddcf] dark:bg-white/10 md:block" />

        <div className="flex items-center gap-1 rounded-full border border-[#eadfce] bg-white/80 p-1 dark:border-white/10 dark:bg-white/6">
          <MiniPill active={priceMode === 'etf'} onClick={() => setPriceMode('etf')}>
            ETF
          </MiniPill>
          <MiniPill active={priceMode === 'futures'} onClick={() => setPriceMode('futures')}>
            Futures
          </MiniPill>
        </div>

        <div className="hidden h-6 w-px bg-[#e6ddcf] dark:bg-white/10 md:block" />

        <label className="flex items-center gap-2 rounded-full border border-[#eadfce] bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#6a604f] dark:border-white/10 dark:bg-white/6 dark:text-[#d8cebf]">
          <CalendarDays size={14} />
          <span className="hidden sm:inline">Data</span>
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="bg-transparent pr-5 outline-none"
          >
            <option value="eod">EOD</option>
            <option value="live">Live</option>
            {availableDates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="-ml-4 opacity-70" />
        </label>

        <div className="hidden h-6 w-px bg-[#e6ddcf] dark:bg-white/10 md:block" />

        <div className="hidden items-center gap-2 rounded-full border border-[#eadfce] bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#6a604f] dark:border-white/10 dark:bg-white/6 dark:text-[#d8cebf] lg:flex">
          <Radio size={12} className={cn(pollerPaused ? 'text-[#9b4f26]' : 'text-[#2f6b39]')} />
          {pollerPaused ? 'Polling Paused' : sessionMode}
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-[#eadfce] bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#6a604f] dark:border-white/10 dark:bg-white/6 dark:text-[#d8cebf] xl:flex">
          <Waves size={12} className="text-[#b8860b]" />
          {priceMode === 'futures' ? 'Futures Converted' : 'ETF Native'}
        </div>

        <AnimatedThemeToggle className="rounded-full" />
      </div>
    </motion.aside>
  );
}

function MiniPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] transition-all duration-200 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50',
        active
          ? 'bg-[#1d1d1f] text-white shadow-sm dark:bg-[#f3efe7] dark:text-[#111317]'
          : 'text-[#6e6456] hover:bg-[#f7edd7] hover:text-[#8a6400] dark:text-[#d4cabd] dark:hover:bg-white/10 dark:hover:text-[#f0d78d]'
      )}
    >
      {children}
    </button>
  );
}
