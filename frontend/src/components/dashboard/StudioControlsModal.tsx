'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, SlidersHorizontal, X } from 'lucide-react';
import { AnimatedThemeToggle } from '@/components/ui/animated-theme-toggle';
import { cn } from '@/lib/utils';
import { useWorkspacePrefs } from './WorkspacePrefsProvider';

export function StudioControlsModal({
  availableDates,
  pollerPaused,
}: {
  availableDates: string[];
  pollerPaused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
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

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  if (!hydrated) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="fixed bottom-6 right-4 z-50 inline-flex h-12 items-center gap-2 rounded-full border border-[#e4dbcc] bg-[rgba(250,247,241,0.92)] px-4 text-[#6a604f] shadow-[0_18px_40px_rgba(45,33,17,0.14)] backdrop-blur-xl transition-colors hover:border-[#d7c08a] hover:text-[#8a6400] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f2ea] dark:border-white/10 dark:bg-[rgba(16,19,24,0.9)] dark:text-[#d8cebf] dark:hover:border-[#8d7331] dark:hover:text-[#f0d78d] dark:focus-visible:ring-offset-[#101318]"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={open ? 'Close studio controls' : 'Open studio controls'}
      >
        {open ? <X size={16} /> : <SlidersHorizontal size={16} />}
        <span className="text-[10px] font-black uppercase tracking-[0.24em]">Studio</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-label="Studio controls"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed bottom-20 right-4 z-50 w-[min(19rem,calc(100vw-2rem))] rounded-[1.8rem] border border-[#e4dbcc] bg-[linear-gradient(180deg,rgba(255,252,246,0.97),rgba(246,240,231,0.95))] p-4 shadow-[0_22px_50px_rgba(45,33,17,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(23,27,34,0.98),rgba(18,22,29,0.96))] dark:shadow-[0_22px_50px_rgba(0,0,0,0.4)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">Studio Controls</p>
                <p className="mt-1 text-xs text-[#7a6f5e] dark:text-[#aa9f90]">{pollerPaused ? 'Polling paused' : sessionMode}</p>
              </div>
              <div className="flex items-center gap-2">
                <AnimatedThemeToggle className="rounded-full" />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#eadfce] bg-white/80 text-[#6a604f] transition-colors hover:border-[#d7c08a] hover:text-[#8a6400] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50 dark:border-white/10 dark:bg-white/6 dark:text-[#d8cebf] dark:hover:border-[#8d7331] dark:hover:text-[#f0d78d]"
                  aria-label="Close studio controls"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <MiniPill active={ticker === 'SPY'} onClick={() => setTicker('SPY')}>SPY</MiniPill>
                <MiniPill active={ticker === 'QQQ'} onClick={() => setTicker('QQQ')}>QQQ</MiniPill>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniPill active={priceMode === 'etf'} onClick={() => setPriceMode('etf')}>ETF</MiniPill>
                <MiniPill active={priceMode === 'futures'} onClick={() => setPriceMode('futures')}>Futures</MiniPill>
              </div>

              <label className="flex items-center gap-2 rounded-[1.1rem] border border-[#eadfce] bg-white/80 px-3 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-[#6a604f] dark:border-white/10 dark:bg-white/6 dark:text-[#d8cebf]">
                <CalendarDays size={14} />
                <select
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                  className="w-full bg-transparent outline-none"
                  aria-label="Choose live or saved data date"
                >
                  <option value="eod">EOD Mode</option>
                  <option value="live">Live Mode</option>
                  {availableDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
        'rounded-[1rem] px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition-all',
        active
          ? 'bg-[#1d1d1f] text-white shadow-sm dark:bg-[#f3efe7] dark:text-[#111317]'
          : 'border border-[#eadfce] bg-white/80 text-[#6e6456] hover:bg-[#f7edd7] hover:text-[#8a6400] dark:border-white/10 dark:bg-white/6 dark:text-[#d4cabd] dark:hover:bg-white/10 dark:hover:text-[#f0d78d]'
      )}
    >
      {children}
    </button>
  );
}
