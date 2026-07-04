'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Check, Copy, Download, Radio, RefreshCw, Waves } from 'lucide-react';
import GexStrikeChart from '../GexStrikeChart';
import IvSkewChart from '../IvSkewChart';
import IvSurface from '../IvSurface';
import GexHeatmap from '../GexHeatmap';
import GexLadder from '../GexLadder';
import OptionChainTable from '../OptionChainTable';
import { ActionButton, AristocratMetric, Badge, EmptyPanel, InsightChip, LevelPill, PanelShell, StatusMessage, TickerToggle } from './DashboardBits';
import { ErrorScreen, LoadingScreen } from './LoadingStates';
import { StrikeInspector } from './StrikeInspector';
import { LevelsBoard } from './LevelsBoard';
import { DashboardSidebar } from './DashboardSidebar';
import { TermStructureCharts } from './TermStructureCharts';
import { StudioControlsModal } from './StudioControlsModal';
import { useMarketData } from '../../hooks/useMarketData';
import { fetchCombinedBridge, fetchHistoricalSnapshot, fetchMacroEvents, fetchSnapshotDates } from '../../lib/api';
import { formatAge, formatCompactNumber, formatCurrency, formatDistanceFromSpot, formatPercent } from '../../lib/format';
import { CUSTOM_MARKET_EVENTS } from '../../lib/marketEvents';
import { PINE_SCRIPT } from '../../lib/pineScript';
import { convertAnalyticsForDisplay } from '../../lib/pricing';
import { copyToClipboard } from '../../lib/utils';
import type { AnalyticsResponse, BasisData, HistoricalSnapshotResponse, MacroEvent, RawContract } from '../../types/analytics';
import { useWorkspacePrefs } from './WorkspacePrefsProvider';

type DashboardView = 'overview' | 'exposure' | 'dex' | 'vega' | 'charm' | 'speed' | 'zomma' | 'vomma' | 'chain' | 'events' | 'volatility' | 'ledger' | 'levels' | 'settings';

const NAV_ITEMS: Array<{ href: string; label: string; view: DashboardView; blurb: string }> = [
  { href: '/', label: 'Overview', view: 'overview', blurb: 'Regime, levels, ladder' },
  { href: '/levels', label: 'Levels', view: 'levels', blurb: 'Grouped market landmarks' },
  { href: '/exposure', label: 'Exposure', view: 'exposure', blurb: 'Gamma map and heat' },
  { href: '/dex', label: 'DEX', view: 'dex', blurb: 'Directional delta pressure by strike' },
  { href: '/volatility', label: 'Volatility', view: 'volatility', blurb: 'Surface and skew' },
  { href: '/chain', label: 'Chain', view: 'chain', blurb: 'Expiry structure and contract mix' },
  { href: '/vega', label: 'Vega', view: 'vega', blurb: 'Vol sensitivity by strike' },
  { href: '/charm', label: 'Charm', view: 'charm', blurb: 'Time-decay flow pressure' },
  { href: '/speed', label: 'Speed', view: 'speed', blurb: 'Gamma instability and acceleration zones' },
  { href: '/zomma', label: 'Zomma', view: 'zomma', blurb: 'Vol-sensitive gamma concentration' },
  { href: '/vomma', label: 'Vomma', view: 'vomma', blurb: 'Vega convexity and vol-buying pressure' },
  { href: '/events', label: 'Events', view: 'events', blurb: 'Macro calendar and impact map' },
  { href: '/ledger', label: 'Ledger', view: 'ledger', blurb: 'Contract-by-contract view' },
  { href: '/settings', label: 'Settings', view: 'settings', blurb: 'Bridge, exports, and Pine setup' },
];
const SCROLL_STORAGE_KEY = 'gexlab:scroll-positions';

export function DashboardWorkspace({ view }: { view: DashboardView }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const { hydrated, ticker, setTicker, theme, priceMode, setPriceMode, selectedDate, setSelectedDate, sessionMode, navOrder, setNavOrder } = useWorkspacePrefs();
  const [copied, setCopied] = useState(false);
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [highlightedStrike, setHighlightedStrike] = useState<number | null>(null);
  const [pinnedStrike, setPinnedStrike] = useState<number | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDte, setSelectedDte] = useState<number | 'all'>('all');
  const [historicalSnapshot, setHistoricalSnapshot] = useState<HistoricalSnapshotResponse | null>(null);
  const [overnightFallbackSnapshot, setOvernightFallbackSnapshot] = useState<HistoricalSnapshotResponse | null>(null);
  const [comparisonSnapshot, setComparisonSnapshot] = useState<HistoricalSnapshotResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [datesLoading, setDatesLoading] = useState(true);
  const [macroEvents, setMacroEvents] = useState<MacroEvent[]>([]);
  const { health, analytics, basis, error, status, ageMs, pollingPaused, refresh } = useMarketData(ticker);

  useEffect(() => {
    setHighlightedStrike(null);
    setPinnedStrike(null);
  }, [ticker]);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 900);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
        const positions = stored ? (JSON.parse(stored) as Record<string, number>) : {};
        const nextY = positions[pathname] ?? 0;
        window.scrollTo({ top: nextY, behavior: 'auto' });
      } catch {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      try {
        const stored = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
        const positions = stored ? (JSON.parse(stored) as Record<string, number>) : {};
        positions[pathname] = window.scrollY;
        window.sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
      } catch {
        // Ignore session storage issues and fall back to normal browser behavior.
      }
    };
  }, [hydrated, pathname]);

  useEffect(() => {
    setSelectedDte('all');
  }, [ticker, selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setDatesLoading(true);

    const loadDates = async () => {
      try {
        const response = await fetchSnapshotDates(ticker);
        if (cancelled) return;
        setAvailableDates(response.dates);
        if (selectedDate !== 'live' && selectedDate !== 'eod' && !response.dates.includes(selectedDate)) {
          setSelectedDate('eod');
        }
      } catch (err) {
        if (cancelled) return;
        setAvailableDates([]);
        setHistoryError(err instanceof Error ? err.message : 'Unable to list saved dates.');
      } finally {
        if (!cancelled) setDatesLoading(false);
      }
    };

    void loadDates();

    return () => {
      cancelled = true;
    };
  }, [ticker, selectedDate]);

  // Resolve EOD to the most recent snapshot strictly before today (America/New_York).
  // Falls back to availableDates[0] only when no prior-day data exists yet.
  const eodTargetDate = useMemo(() => {
    if (availableDates.length === 0) return null;
    const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    return availableDates.find((date) => date < todayET) ?? availableDates[0];
  }, [availableDates]);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      if (selectedDate === 'live') {
        setHistoricalSnapshot(null);
        setHistoryError(null);
        setHistoryLoading(false);
        return;
      }

      if (selectedDate === 'eod' && availableDates.length === 0) {
        return;
      }
      const targetDate = selectedDate === 'eod' ? eodTargetDate : selectedDate;

      try {
        setHistoryLoading(true);
        const snapshot = await fetchHistoricalSnapshot(ticker, targetDate!);
        if (cancelled) return;
        setHistoricalSnapshot(snapshot);
        setHistoryError(null);
        setHistoryLoading(false);
      } catch (err) {
        if (cancelled) return;
        setHistoricalSnapshot(null);
        setHistoryError(err instanceof Error ? err.message : 'Unable to load saved snapshot.');
        setHistoryLoading(false);
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [ticker, selectedDate, availableDates, eodTargetDate]);

  useEffect(() => {
    let cancelled = false;

    const loadOvernightFallback = async () => {
      if (selectedDate !== 'live' || !pollingPaused || analytics || availableDates.length === 0) {
        setOvernightFallbackSnapshot(null);
        return;
      }

      try {
        const latestDate = availableDates[0];
        const snapshot = await fetchHistoricalSnapshot(ticker, latestDate);
        if (cancelled) return;
        setOvernightFallbackSnapshot(snapshot);
      } catch {
        if (cancelled) return;
        setOvernightFallbackSnapshot(null);
      }
    };

    void loadOvernightFallback();

    return () => {
      cancelled = true;
    };
  }, [ticker, selectedDate, pollingPaused, analytics, availableDates]);

  useEffect(() => {
    let cancelled = false;

    const loadComparisonSnapshot = async () => {
      if (availableDates.length === 0) {
        setComparisonSnapshot(null);
        return;
      }

      let comparisonDate: string | null = null;
      if (selectedDate === 'live') {
        comparisonDate = availableDates[0] ?? null;
      } else {
        const activeDate = selectedDate === 'eod' ? availableDates[0] : selectedDate;
        const currentIndex = availableDates.findIndex((date) => date === activeDate);
        comparisonDate = currentIndex >= 0 ? (availableDates[currentIndex + 1] ?? null) : null;
      }

      if (!comparisonDate) {
        setComparisonSnapshot(null);
        return;
      }

      try {
        const snapshot = await fetchHistoricalSnapshot(ticker, comparisonDate);
        if (cancelled) return;
        setComparisonSnapshot(snapshot);
      } catch {
        if (cancelled) return;
        setComparisonSnapshot(null);
      }
    };

    void loadComparisonSnapshot();

    return () => {
      cancelled = true;
    };
  }, [ticker, selectedDate, availableDates]);

  useEffect(() => {
    let cancelled = false;

    const loadMacroEvents = async () => {
      try {
        const response = await fetchMacroEvents();
        if (cancelled) return;
        setMacroEvents(response.events);
      } catch {
        if (cancelled) return;
        setMacroEvents([]);
      }
    };

    void loadMacroEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  const isLive = selectedDate === 'live';
  const sourceAnalytics =
    isLive
      ? analytics ?? overnightFallbackSnapshot?.analytics ?? null
      : historicalSnapshot?.analytics ?? null;
  const sourceBasis: BasisData | null =
    isLive
      ? basis ?? overnightFallbackSnapshot?.basis ?? null
      : historicalSnapshot?.basis ?? null;
  const displayAnalytics = useMemo(() => convertAnalyticsForDisplay(sourceAnalytics, ticker, sourceBasis, priceMode), [sourceAnalytics, ticker, sourceBasis, priceMode]);
  const comparisonAnalytics = useMemo(
    () => convertAnalyticsForDisplay(comparisonSnapshot?.analytics ?? null, ticker, comparisonSnapshot?.basis ?? null, priceMode),
    [comparisonSnapshot, ticker, priceMode]
  );
  const selectedStrike = pinnedStrike ?? highlightedStrike;
  const selectedStrikeData = displayAnalytics?.strikes.find((row) => row.strike === selectedStrike) ?? null;
  const selectedContracts = useMemo(() => displayAnalytics?.raw.filter((row) => row.strike === selectedStrike) ?? [], [displayAnalytics, selectedStrike]);
  const showingOvernightFallback = isLive && !analytics && Boolean(overnightFallbackSnapshot);
  const panelStatus = !isLive
    ? (historyLoading ? 'Loading Snapshot' : 'Snapshot')
    : showingOvernightFallback
      ? 'Saved Fallback'
      : status === 'ready'
        ? 'Live'
        : status === 'stale'
          ? 'Stale'
          : status === 'error'
            ? 'Offline'
            : 'Loading';

  const expiryBuckets = useMemo(() => buildExpiryBuckets(displayAnalytics?.raw ?? [], comparisonAnalytics?.raw ?? []), [displayAnalytics, comparisonAnalytics?.raw]);
  const insights = useMemo(() => buildInsights(displayAnalytics, expiryBuckets), [displayAnalytics, expiryBuckets]);
  const overallRatios = useMemo(() => buildOverallRatios(displayAnalytics?.raw ?? []), [displayAnalytics]);
  const regimeSummary = useMemo(() => displayAnalytics ? buildDealerRegimeSummary(displayAnalytics, expiryBuckets) : '', [displayAnalytics, expiryBuckets]);
  const eventMarkers = useMemo(() => buildEventMarkers(ticker, expiryBuckets, macroEvents), [ticker, expiryBuckets, macroEvents]);
  const availableDteLevels = displayAnalytics?.levels?.byDte ?? [];
  const activeLevels = selectedDte === 'all'
    ? displayAnalytics?.levels
    : availableDteLevels.find((entry) => entry.dte === selectedDte) ?? displayAnalytics?.levels;
  const levelCards = useMemo(
    () =>
      activeLevels && displayAnalytics?.summary
        ? [
            { label: 'Gamma Flip', value: activeLevels.gammaFlip, tone: 'amber' as const },
            { label: 'Call Wall', value: activeLevels.callWall, tone: 'blue' as const },
            { label: 'Put Wall', value: activeLevels.putWall, tone: 'orange' as const },
            { label: 'Max Pain', value: activeLevels.maxPain, tone: 'slate' as const },
            { label: 'Vanna Peak', value: activeLevels.vannaMagnet, tone: 'rose' as const },
          ]
        : [],
    [activeLevels, displayAnalytics]
  );
  const orderedNavItems = useMemo(() => orderNavItems(NAV_ITEMS, navOrder), [navOrder]);

  if (!hydrated) {
    return <LoadingScreen ticker={ticker} setTicker={setTicker} sessionMode="Syncing Workspace" />;
  }

  if (!displayAnalytics && isLive && status === 'loading') {
    return <LoadingScreen ticker={ticker} setTicker={setTicker} sessionMode={sessionMode} />;
  }

  if (!displayAnalytics && isLive && status === 'idle') {
    return <LoadingScreen ticker={ticker} setTicker={setTicker} sessionMode={pollingPaused ? 'Overnight Pause' : sessionMode} />;
  }

  if (!displayAnalytics && isLive && status === 'error') {
    return <ErrorScreen ticker={ticker} setTicker={setTicker} message={error ?? 'The analytics engine is offline.'} onRetry={() => void refresh()} />;
  }

  if (!displayAnalytics && !isLive && (historyLoading || datesLoading)) {
    return <LoadingScreen ticker={ticker} setTicker={setTicker} sessionMode={`Loading ${selectedDate}`} />;
  }

  if (!displayAnalytics && !isLive) {
    return <ErrorScreen ticker={ticker} setTicker={setTicker} message={historyError ?? 'The saved snapshot could not be loaded.'} onRetry={() => setSelectedDate('eod')} />;
  }

  if (!displayAnalytics) {
    return null;
  }

  const handleBridgeCopy = async () => {
    let payload = '';

    if (isLive && !showingOvernightFallback) {
      payload = (await fetchCombinedBridge()).pine;
    } else {
      const snapshotDate = getBridgeSnapshotDate(selectedDate, eodTargetDate, availableDates);
      const bridgeTargetDate = showingOvernightFallback
        ? getNextTradingDate(snapshotDate ?? getTodayEtDate())
        : getBridgeTargetDate(selectedDate, eodTargetDate) ?? getTodayEtDate();
      payload = await buildSavedFuturesBridgePayload(
        ticker,
        sourceAnalytics,
        sourceBasis,
        bridgeTargetDate,
        snapshotDate
      );
    }

    if (!payload) return;
    await copyToClipboard(payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleSnapshotCopy = async () => {
    if (!displayAnalytics) return;
    const snapshot = [
      `${ticker} Snapshot (${priceMode === 'futures' ? sourceBasis?.futures_ticker ?? 'Futures' : ticker})`,
      `Spot: ${formatCurrency(displayAnalytics.summary.spotPrice)}`,
      `Net GEX: ${formatCompactNumber(displayAnalytics.summary.totalNetGex)}`,
      `Net DEX: ${formatCompactNumber(displayAnalytics.summary.totalNetDex)}`,
      `Gamma Flip: ${formatCurrency(displayAnalytics.levels?.gammaFlip)}`,
      `Call Wall: ${formatCurrency(displayAnalytics.levels?.callWall)}`,
      `Put Wall: ${formatCurrency(displayAnalytics.levels?.putWall)}`,
      `Updated: ${displayAnalytics.summary.timestamp}`,
    ].join('\n');
    await copyToClipboard(snapshot);
    setSnapshotCopied(true);
    window.setTimeout(() => setSnapshotCopied(false), 1800);
  };

  const handleExportCsv = () => {
    if (!displayAnalytics?.raw?.length) return;
    const headers = ['expiry', 'type', 'strike', 'delta', 'gamma', 'vanna', 'iv', 'gex', 'openInterest', 'volume'];
    const rows = displayAnalytics.raw.map((row) => headers.map((header) => (row[header as keyof RawContract] ?? '')).join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${ticker.toLowerCase()}-contracts.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPineScript = async () => {
    await copyToClipboard(PINE_SCRIPT);
    setScriptCopied(true);
    window.setTimeout(() => setScriptCopied(false), 1800);
  };

  return (
    <>
      <div className={`${theme === 'dark' ? 'dark' : ''} min-h-[100dvh] bg-[linear-gradient(180deg,#f7f4ee_0%,#f8f8f6_32%,#f4f2ed_100%)] p-4 pb-28 font-sans leading-normal text-[#1D1D1F] selection:bg-[#D4AF37] selection:text-white transition-colors duration-300 dark:bg-[linear-gradient(180deg,#0f1115_0%,#12151b_38%,#171b22_100%)] dark:text-[#f5efe3] md:p-8 md:pb-32 xl:p-6 xl:pb-16 2xl:p-8`}>
        <div className="mx-auto max-w-[1720px] xl:flex xl:gap-6">
          <DashboardSidebar
            pollerPaused={pollingPaused}
            navItems={orderedNavItems}
            onReorder={(draggedHref, targetHref) => {
              setNavOrder((current) => reorderNavOrder(current, draggedHref, targetHref));
            }}
          />

          <div className="min-w-0 flex-1 space-y-5">
        <header className="rounded-2xl border border-[#e7e1d5] bg-[rgba(255,255,255,0.88)] px-5 py-3 shadow-[0_8px_30px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-[rgba(22,25,32,0.94)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#f5efe3]">
                Gex<span className="text-[#b8860b]">Lab</span>
              </span>
              <div className="hidden sm:flex items-center gap-2">
                <Badge tone={status === 'ready' ? 'green' : status === 'stale' ? 'amber' : status === 'error' ? 'orange' : 'slate'}>{panelStatus}</Badge>
                {ageMs !== null && <Badge tone="slate">{formatAge(ageMs)}</Badge>}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-[1.1rem] border border-[#e5ddcf] bg-white/80 p-1 shadow-sm dark:border-white/10 dark:bg-white/6">
              <TickerToggle active={ticker === 'SPY'} onClick={() => setTicker('SPY')} label="SPY" />
              <TickerToggle active={ticker === 'QQQ'} onClick={() => setTicker('QQQ')} label="QQQ" />
              <select
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-xl border border-[#e5ddcf] bg-[#faf7f1] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#5f5648] dark:border-white/10 dark:bg-[#1d222b] dark:text-[#d8cebf]"
              >
                <option value="eod">EOD</option>
                <option value="live">Live</option>
                {availableDates.map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </div>
          </div>

          <nav className="scrollbar-none mt-3 flex gap-2 overflow-x-auto border-t border-[#e8e1d6] pt-3 dark:border-white/10 xl:hidden">
            {orderedNavItems.filter((item) => item.view !== 'settings').map((item) => {
              const active = item.view === view || pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] transition-all ${active ? 'border-[#d7c08a] bg-[linear-gradient(135deg,#fffaf0,#f8edd2)] text-[#5a4305] shadow-[0_8px_20px_rgba(95,70,10,0.09)] dark:border-[#8d7331] dark:bg-[linear-gradient(135deg,#241d12,#171b22)] dark:text-[#f0d78d]' : 'border-[#e5ddcf] bg-white/75 text-[#7a6e5d] hover:border-[#d7c08a] hover:bg-[#fffaf2] dark:border-white/10 dark:bg-white/5 dark:text-[#c8bbab] dark:hover:border-[#8d7331] dark:hover:bg-white/8'}`}
                >
                  {item.label}
                </Link>
              );
            })}
            <span className="mx-1 self-center border-l border-[#e5ddcf] py-1 dark:border-white/10" style={{ height: '1.25rem' }} />
            {orderedNavItems.filter((item) => item.view === 'settings').map((item) => {
              const active = item.view === view || pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] transition-all ${active ? 'border-[#d7c08a] bg-[linear-gradient(135deg,#fffaf0,#f8edd2)] text-[#5a4305] shadow-[0_8px_20px_rgba(95,70,10,0.09)] dark:border-[#8d7331] dark:bg-[linear-gradient(135deg,#241d12,#171b22)] dark:text-[#f0d78d]' : 'border-[#e5ddcf] bg-white/75 text-[#7a6e5d] hover:border-[#d7c08a] hover:bg-[#fffaf2] dark:border-white/10 dark:bg-white/5 dark:text-[#c8bbab] dark:hover:border-[#8d7331] dark:hover:bg-white/8'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {view === 'overview' && (
          <>
            <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-2xl border border-[#e6dfd3] bg-white/85 p-5 shadow-[0_4px_16px_rgba(45,33,17,0.04)] dark:border-white/10 dark:bg-white/6 dark:shadow-[0_4px_16px_rgba(0,0,0,0.22)]">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#857867] dark:text-[#b7ab9a]">Session Regime</p>
                    <h2 className="mt-1 text-2xl font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">
                      {displayAnalytics.summary.totalNetGex > 0 ? 'Positive Gamma Bias' : 'Negative Gamma Pressure'}
                    </h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-[#8f816d] dark:text-[#b7ab9a]">{priceMode === 'futures' ? sourceBasis?.futures_ticker ?? 'Futures Spot' : 'Spot'}</p>
                    <p className="mt-1 text-lg font-medium tabular-nums text-[#1D1D1F] dark:text-[#f5efe3]">{formatCurrency(displayAnalytics.summary.spotPrice)}</p>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {insights.map((item) => <InsightChip key={item.label} {...item} />)}
                </div>
                <div className="mt-3 rounded-xl border border-[#eadfcf] bg-[#fcf8f1] px-4 py-3 text-sm leading-relaxed text-[#6a604f] dark:border-white/10 dark:bg-white/5 dark:text-[#d7cbbb]">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">Dealer Summary</p>
                  <p className="mt-1.5">{regimeSummary}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e7dece] bg-[linear-gradient(160deg,rgba(255,250,241,0.96),rgba(247,238,219,0.92))] p-5 text-[#3d3120] shadow-[0_4px_16px_rgba(45,33,17,0.06)] dark:border-white/10 dark:bg-[linear-gradient(160deg,rgba(38,35,30,0.96),rgba(58,50,40,0.94))] dark:text-[#f5efe3] dark:shadow-[0_4px_16px_rgba(0,0,0,0.22)]">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8d7242] dark:text-[#d7cab3]">Key Levels</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDte('all')}
                    className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/40 ${selectedDte === 'all' ? 'border-[#d7c08a] bg-[#fff6df] text-[#6d520a] dark:border-[#f0ddb0] dark:bg-[#f7ecd0] dark:text-[#5a4305]' : 'border-[#ddcfb4] bg-white/55 text-[#7b6540] dark:border-white/10 dark:bg-white/5 dark:text-[#e7dac3]'}`}
                  >
                    All Expiries
                  </button>
                  {availableDteLevels.map((entry) => (
                    <button
                      key={entry.dte}
                      type="button"
                      onClick={() => setSelectedDte(entry.dte)}
                      className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/40 ${selectedDte === entry.dte ? 'border-[#d7c08a] bg-[#fff6df] text-[#6d520a] dark:border-[#f0ddb0] dark:bg-[#f7ecd0] dark:text-[#5a4305]' : 'border-[#ddcfb4] bg-white/55 text-[#7b6540] dark:border-white/10 dark:bg-white/5 dark:text-[#e7dac3]'}`}
                    >
                      {entry.dte} DTE
                    </button>
                  ))}
                </div>
                {selectedDte !== 'all' && activeLevels && 'expiry' in activeLevels && (
                  <p className="mt-3 text-[11px] uppercase tracking-[0.24em] text-[#8d7242] dark:text-[#d7cab3]">
                    Expiry {activeLevels.expiry}
                  </p>
                )}
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {levelCards.map((level) => <LevelPill key={level.label} {...level} distance={formatDistanceFromSpot(level.value, displayAnalytics.summary.spotPrice)} />)}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr_1fr]">
              <PanelShell title="Call / Put Ratios" subtitle="Overall participation balance for current contracts and positioning." status="Flow Split">
                <div className="grid gap-3">
                  <RelevantLevelCard label="Volume Ratio" value={overallRatios.volumeRatio} detail="Call volume divided by put volume across the loaded chain." />
                  <RelevantLevelCard label="OI Ratio" value={overallRatios.oiRatio} detail="Call open interest divided by put open interest across the loaded chain." />
                  <RelevantLevelCard label="Freshness Proxy" value={overallRatios.volumeVsOi} detail="Volume as a share of OI. Higher values usually mean fresher participation." />
                </div>
              </PanelShell>

              <PanelShell title="Event Markers" subtitle="Structural dates and macro releases with timing and recent print context." status="Decision Context">
                <div className="grid gap-3">
                  {eventMarkers.length ? eventMarkers.map((event) => (
                    <div key={`${event.date}-${event.label}`} className="rounded-xl border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{event.label}</p>
                          <EventImpactBadge impact={event.impact} />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:text-[#b7ab9a]">
                          {event.date}{event.releaseTimeEt ? ` • ${event.releaseTimeEt}` : ''}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{event.note}</p>
                      {(event.actual || event.expected || event.previous) && (
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em]">
                          {event.actual && <span className="rounded-full bg-[#eef8ee] px-2.5 py-1 text-[#2f6b39] dark:bg-[#16231a] dark:text-[#9fdbab]">Actual {event.actual}</span>}
                          {event.expected && <span className="rounded-full bg-[#fff7e2] px-2.5 py-1 text-[#8a6400] dark:bg-[#231d12] dark:text-[#f2d482]">Expected {event.expected}</span>}
                          {event.previous && <span className="rounded-full bg-[#f1ede6] px-2.5 py-1 text-[#6e6254] dark:bg-white/8 dark:text-[#c8bbab]">Previous {event.previous}</span>}
                        </div>
                      )}
                    </div>
                  )) : (
                    <EmptyPanel title="No markers configured" detail="OPEX and near-term expiry markers appear automatically." />
                  )}
                </div>
              </PanelShell>
            </section>

          </>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${view}-${selectedDte === 'all' ? 'all' : selectedDte}`}
            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderView({
              view,
              panelStatus,
              displayAnalytics,
              levelsForDisplay: activeLevels,
              expiryBuckets,
              overallRatios,
              eventMarkers,
              selectedStrike,
              selectedStrikeData,
              selectedContracts,
              ageMs,
              error,
              status,
              ticker,
              priceMode,
              selectedDate,
              setSelectedDate,
              refresh,
              copied,
              snapshotCopied,
              scriptCopied,
              handleBridgeCopy,
              handleSnapshotCopy,
              handleExportCsv,
              handleCopyPineScript,
              highlightedStrike,
              pinnedStrike,
              setHighlightedStrike,
              setPinnedStrike,
              isLive,
            })}
          </motion.div>
        </AnimatePresence>
          </div>
        </div>
      </div>
      <StudioControlsModal availableDates={availableDates} pollerPaused={pollingPaused} />
      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#e4dbcc] bg-[rgba(250,247,241,0.92)] text-[#6a604f] shadow-[0_18px_40px_rgba(45,33,17,0.14)] backdrop-blur-xl transition-colors hover:border-[#d7c08a] hover:text-[#8a6400] dark:border-white/10 dark:bg-[rgba(16,19,24,0.9)] dark:text-[#d8cebf] dark:hover:border-[#8d7331] dark:hover:text-[#f0d78d] xl:bottom-6"
          aria-label="Back to top"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </>
  );
}

function renderView({
  view,
  panelStatus,
  displayAnalytics,
  levelsForDisplay,
  expiryBuckets,
  overallRatios,
  eventMarkers,
  selectedStrike,
  selectedStrikeData,
  selectedContracts,
  ageMs,
  error,
  status,
  ticker,
  priceMode,
  selectedDate,
  setSelectedDate,
  refresh,
  copied,
  snapshotCopied,
  scriptCopied,
  handleBridgeCopy,
  handleSnapshotCopy,
  handleExportCsv,
  handleCopyPineScript,
  highlightedStrike,
  pinnedStrike,
  setHighlightedStrike,
  setPinnedStrike,
  isLive,
}: {
  view: DashboardView;
  panelStatus: string;
  displayAnalytics: AnalyticsResponse;
  levelsForDisplay: AnalyticsResponse['levels'];
  expiryBuckets: ReturnType<typeof buildExpiryBuckets>;
  overallRatios: ReturnType<typeof buildOverallRatios>;
  eventMarkers: DisplayEvent[];
  selectedStrike: number | null;
  selectedStrikeData: AnalyticsResponse['strikes'][number] | null;
  selectedContracts: RawContract[];
  ageMs: number | null;
  error: string | null;
  status: string;
  ticker: 'SPY' | 'QQQ';
  priceMode: 'etf' | 'futures';
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  refresh: () => Promise<void>;
  copied: boolean;
  snapshotCopied: boolean;
  scriptCopied: boolean;
  handleBridgeCopy: () => Promise<void>;
  handleSnapshotCopy: () => Promise<void>;
  handleExportCsv: () => void;
  handleCopyPineScript: () => Promise<void>;
  highlightedStrike: number | null;
  pinnedStrike: number | null;
  setHighlightedStrike: (strike: number | null) => void;
  setPinnedStrike: (strike: number | null) => void;
  isLive: boolean;
}) {
  if (view === 'overview') {
    return (
      <main className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <AristocratMetric cardTitle="Net GEX" value={displayAnalytics.summary.totalNetGex} descriptor="Dealer gamma footprint" />
            <AristocratMetric cardTitle="Net DEX" value={displayAnalytics.summary.totalNetDex} descriptor="Directional pressure" />
            <AristocratMetric cardTitle="Vanna Gravity" value={displayAnalytics.strikes.reduce((sum, row) => sum + row.vex, 0)} descriptor="Volatility sensitivity" />
            <AristocratMetric cardTitle="Refresh Age" valueLabel={formatAge(ageMs)} descriptor="Clock since last successful cycle" icon={<Waves size={18} />} />
          </div>

          <StrikeInspector
            selectedStrike={selectedStrike}
            selectedStrikeData={selectedStrikeData}
            contracts={selectedContracts}
            spot={displayAnalytics.summary.spotPrice}
            onClearPin={() => setPinnedStrike(null)}
            pinned={pinnedStrike != null}
          />

          <PanelShell title="Price Ladder" subtitle="Pin a strike to carry it with you across the routed studio." status={panelStatus}>
            <GexLadder
              strikes={displayAnalytics.strikes}
              levels={levelsForDisplay}
              spot={displayAnalytics.summary.spotPrice}
              aristocratic
              highlightedStrike={selectedStrike}
              pinnedStrike={pinnedStrike}
              onHoverStrike={setHighlightedStrike}
              onPinStrike={setPinnedStrike}
            />
          </PanelShell>
        </div>

        <div className="space-y-6">
          <PanelShell title="Relevant Levels" subtitle="A compact read of gamma, OI, aggression, and skew landmarks for the current expiry scope." status={selectedDteLabel(levelsForDisplay)}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {buildRelevantLevelEntries(levelsForDisplay, displayAnalytics.summary.spotPrice).map((entry) => (
                <RelevantLevelCard key={entry.label} label={entry.label} value={entry.value} detail={entry.detail} />
              ))}
            </div>
          </PanelShell>

          <div className="grid gap-6 lg:grid-cols-2">
            <PanelShell title="Gamma Concentration" subtitle="A focused preview of dealer pressure around the active strike." status={panelStatus}>
              {displayAnalytics.strikes.length ? (
                <GexStrikeChart
                  data={displayAnalytics.strikes}
                  highlightedStrike={highlightedStrike}
                  pinnedStrike={pinnedStrike}
                  onHoverStrike={setHighlightedStrike}
                  onPinStrike={setPinnedStrike}
                />
              ) : (
                <EmptyPanel title="No strike aggregation yet" detail="The concentration map will populate after the next analytics cycle." />
              )}
            </PanelShell>
            <PanelShell title="Volatility Skew" subtitle="A quick read before diving into the full surface page." status={panelStatus}>
              {displayAnalytics.strikes.length ? (
                <IvSkewChart data={displayAnalytics.strikes} highlightedStrike={selectedStrike} />
              ) : (
                <EmptyPanel title="No skew curve yet" detail="Implied volatility by strike will appear here once contract data is available." />
              )}
            </PanelShell>
          </div>

          <StatusMessage status={status} error={error} />
        </div>
      </main>
    );
  }

  if (view === 'settings') {
    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Active Ticker" valueLabel={ticker} descriptor="Current dashboard symbol" />
          <AristocratMetric cardTitle="Pricing Mode" valueLabel={priceMode === 'futures' ? 'Futures' : 'ETF'} descriptor="Display conversion mode" />
          <AristocratMetric cardTitle="Data Source" valueLabel={isLive ? 'Live' : selectedDate === 'eod' ? 'EOD' : selectedDate} descriptor="Current snapshot context" />
          <AristocratMetric cardTitle="Bridge Ready" valueLabel={displayAnalytics.levels ? 'Yes' : 'No'} descriptor="Levels available for TradingView payloads" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
          <PanelShell title="Studio Actions" subtitle="Exports and workflow tools moved out of the main header for a cleaner daily read." status="Workspace">
            <div className="grid gap-4 md:grid-cols-2">
              <ActionButton
                onClick={() => isLive ? void refresh() : setSelectedDate('eod')}
                label={isLive ? 'Refresh' : 'Back To EOD'}
                icon={<RefreshCw size={14} />}
                subtle
              />
              <ActionButton
                onClick={() => void handleBridgeCopy()}
                label={copied ? 'Payload Copied' : 'Copy Bridge'}
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
              />
              <ActionButton
                onClick={() => void handleSnapshotCopy()}
                label={snapshotCopied ? 'Snapshot Copied' : 'Copy Snapshot'}
                icon={snapshotCopied ? <Check size={14} /> : <Radio size={14} />}
                subtle
              />
              <ActionButton
                onClick={handleExportCsv}
                label="Export CSV"
                icon={<Download size={14} />}
                subtle
              />
            </div>
            <div className="mt-5 rounded-[1.5rem] border border-[#eadfcf] bg-[#fcf8f1] px-4 py-4 text-sm leading-relaxed text-[#6a604f] dark:border-white/10 dark:bg-white/5 dark:text-[#d7cbbb]">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">Bridge Notes</p>
              <p className="mt-2">Use <strong>Copy Bridge</strong> for TradingView payload transfer, <strong>Copy Snapshot</strong> for quick note-taking, and <strong>Export CSV</strong> for contract-level analysis outside the app.</p>
              <p className="mt-2">The default Pine bridge copies compact ES/MES and NQ/MNQ packs: live uses current <strong>0DTE</strong>/<strong>1DTE</strong>; saved EOD uses the next two unexpired expiry buckets.</p>
            </div>
          </PanelShell>

          <PanelShell title="TradingView Bridge" subtitle="Everything needed to move the current market map into Pine in one place." status="TV">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">Main Levels</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <RelevantLevelCard label="Gamma Flip" value={formatCurrency(displayAnalytics.levels?.gammaFlip)} detail="Core flip line in the bridge payload." />
              <RelevantLevelCard label="Call Wall" value={formatCurrency(displayAnalytics.levels?.callWall)} detail="Primary upside wall." />
              <RelevantLevelCard label="Put Wall" value={formatCurrency(displayAnalytics.levels?.putWall)} detail="Primary downside wall." />
              <RelevantLevelCard label="Max Pain" value={formatCurrency(displayAnalytics.levels?.maxPain)} detail="Payout-minimizing reference." />
            </div>
            <p className="mb-3 mt-5 text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">Greek Levels</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <RelevantLevelCard label="Vanna Flip" value={formatCurrency(displayAnalytics.levels?.vanna?.flip)} detail="Vanna zero-cross — volatility sensitivity reversal." />
              <RelevantLevelCard label="Vanna CW" value={formatCurrency(displayAnalytics.levels?.vanna?.callWall)} detail="Peak upside vanna exposure." />
              <RelevantLevelCard label="Vanna PW" value={formatCurrency(displayAnalytics.levels?.vanna?.putWall)} detail="Peak downside vanna exposure." />
              <RelevantLevelCard label="Charm Flip" value={formatCurrency(displayAnalytics.levels?.charm?.flip)} detail="Charm zero-cross — time-decay pressure reversal." />
              <RelevantLevelCard label="Charm CW" value={formatCurrency(displayAnalytics.levels?.charm?.callWall)} detail="Peak upside charm exposure." />
              <RelevantLevelCard label="Charm PW" value={formatCurrency(displayAnalytics.levels?.charm?.putWall)} detail="Peak downside charm exposure." />
              <RelevantLevelCard label="Speed Flip" value={formatCurrency(displayAnalytics.levels?.speed?.flip)} detail="Speed zero-cross — gamma acceleration reversal." />
              <RelevantLevelCard label="Speed CW" value={formatCurrency(displayAnalytics.levels?.speed?.callWall)} detail="Fastest upside gamma acceleration zone." />
              <RelevantLevelCard label="Speed PW" value={formatCurrency(displayAnalytics.levels?.speed?.putWall)} detail="Fastest downside gamma acceleration zone." />
              <RelevantLevelCard label="Zomma Flip" value={formatCurrency(displayAnalytics.levels?.zomma?.flip)} detail="Zomma zero-cross — vol-sensitive gamma reversal." />
              <RelevantLevelCard label="Zomma CW" value={formatCurrency(displayAnalytics.levels?.zomma?.callWall)} detail="Peak vol-sensitive gamma above spot." />
              <RelevantLevelCard label="Zomma PW" value={formatCurrency(displayAnalytics.levels?.zomma?.putWall)} detail="Peak vol-sensitive gamma below spot." />
            </div>
            <div className="mt-5 rounded-[1.5rem] border border-[#eadfcf] bg-[#fcf8f1] px-4 py-4 text-sm leading-relaxed text-[#6a604f] dark:border-white/10 dark:bg-white/5 dark:text-[#d7cbbb]">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">Workflow</p>
              <p className="mt-2">1. Copy the bridge payload. 2. Paste into the Pine indicator input. 3. Adjust the box width if needed. 4. Re-copy any time the saved map changes.</p>
            </div>
          </PanelShell>
        </div>

        <PanelShell title="Pine Script" subtitle="Bundled futures indicator scaffold for the compact gamma level packs." status="Code">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <ActionButton
              onClick={() => void handleCopyPineScript()}
              label={scriptCopied ? 'Pine Copied' : 'Copy Pine Script'}
              icon={scriptCopied ? <Check size={14} /> : <Copy size={14} />}
            />
          </div>
          <pre className="scrollbar-none overflow-x-auto rounded-[1.6rem] border border-[#e5ddcf] bg-[#171b22] p-5 text-xs leading-6 text-[#e7dac3] dark:border-white/10 dark:bg-[#0f1115]">
            <code>{PINE_SCRIPT}</code>
          </pre>
        </PanelShell>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'exposure') {
    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Net GEX" value={displayAnalytics.summary.totalNetGex} descriptor="Aggregate gamma support" />
          <AristocratMetric cardTitle="Positive Walls" valueLabel={String(displayAnalytics.levels?.majorWalls?.calls.length ?? 0)} descriptor="Call resistance clusters" />
          <AristocratMetric cardTitle="Negative Walls" valueLabel={String(displayAnalytics.levels?.majorWalls?.puts.length ?? 0)} descriptor="Put support clusters" />
          <AristocratMetric cardTitle="Active Strike" valueLabel={selectedStrike != null ? formatCurrency(selectedStrike, 2) : 'None'} descriptor="Hover or pin to inspect" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Gamma Concentration" subtitle="Primary strike histogram with synchronized hover and pin behavior." status={panelStatus}>
            {displayAnalytics.strikes.length ? (
              <GexStrikeChart
                data={displayAnalytics.strikes}
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No strike aggregation yet" detail="The concentration map will populate after the next analytics cycle." />
            )}
          </PanelShell>

          <PanelShell title="Price Ladder" subtitle="Keep the nearby ladder visible while reading concentration." status={panelStatus}>
            <GexLadder
              strikes={displayAnalytics.strikes}
              levels={levelsForDisplay}
              spot={displayAnalytics.summary.spotPrice}
              aristocratic
              highlightedStrike={selectedStrike}
              pinnedStrike={pinnedStrike}
              onHoverStrike={setHighlightedStrike}
              onPinStrike={setPinnedStrike}
            />
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Risk Intensity" subtitle="Relative pressure map for a fast scan of hot strikes." status={panelStatus}>
            {displayAnalytics.strikes.length ? (
              <GexHeatmap
                data={displayAnalytics.strikes}
                aristocratic
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No heatmap yet" detail="Risk intensity appears after the first successful analytics cycle." />
            )}
          </PanelShell>

          <StrikeInspector
            selectedStrike={selectedStrike}
            selectedStrikeData={selectedStrikeData}
            contracts={selectedContracts}
            spot={displayAnalytics.summary.spotPrice}
            onClearPin={() => setPinnedStrike(null)}
            pinned={pinnedStrike != null}
          />
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'vega') {
    const vegaStrikes = aggregateMetricByStrike(displayAnalytics.raw, 'vega');
    const vegaLeader = vegaStrikes[0]?.vega ?? 0;

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Net Vega" value={sumMetric(displayAnalytics.raw, 'vega')} descriptor="Aggregate implied-vol sensitivity" />
          <AristocratMetric cardTitle="VEX" value={sumMetric(displayAnalytics.strikes, 'vex')} descriptor="Dealer vanna exposure footprint" />
          <AristocratMetric cardTitle="Top Vega Strike" valueLabel={vegaStrikes[0] ? formatCurrency(vegaStrikes[0].strike, 2) : '--'} descriptor="Largest absolute vega node" />
          <AristocratMetric cardTitle="Top Vega Size" value={vegaLeader} descriptor="Peak strike-level vega cluster" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Vega Concentration" subtitle="Strike-by-strike IV sensitivity using contract-level vega aggregation." status={panelStatus}>
            {vegaStrikes.length ? (
              <GexStrikeChart
                data={vegaStrikes}
                metricKey="vega"
                metricLabel="Vega"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No vega map yet" detail="Vega concentration will appear once the engine has contract-level greek inputs." />
            )}
          </PanelShell>

          <PanelShell title="Price Ladder" subtitle="Keep nearby strikes visible while reading vol sensitivity." status={panelStatus}>
            <GexLadder
              strikes={vegaStrikes}
              levels={levelsForDisplay}
              spot={displayAnalytics.summary.spotPrice}
              aristocratic
              highlightedStrike={selectedStrike}
              pinnedStrike={pinnedStrike}
              onHoverStrike={setHighlightedStrike}
              onPinStrike={setPinnedStrike}
            />
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Vega Heat" subtitle="Relative strike intensity for vol sensitivity." status={panelStatus}>
            {vegaStrikes.length ? (
              <GexHeatmap
                data={vegaStrikes}
                metricKey="vega"
                metricLabel="Vega"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No vega heat yet" detail="This panel fills once enough chain data has been processed." />
            )}
          </PanelShell>

          <PanelShell title="Vega Notes" subtitle="High vega clusters matter most when they overlap major walls or rich skew pockets." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                Use this page to spot where a volatility expansion or crush can hit positioning hardest. High vega with high OI often becomes the most important part of the term structure around events.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                Best next additions here: term-vega by expiry, earnings/event markers, and a front-vs-back-month vega split for clearer calendar pressure.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'dex') {
    const dexLevels = levelsForDisplay?.dex;
    const dexBuckets = expiryBuckets.filter((bucket) => typeof bucket.dex === 'number' && Math.abs(bucket.dex) > 0);
    const callDex = sumDexByType(displayAnalytics.raw, 'call');
    const putDex = sumDexByType(displayAnalytics.raw, 'put');
    const dexSkew = Math.abs(putDex) > 0 ? `${(callDex / Math.abs(putDex)).toFixed(2)}x` : '--';
    const strongestDexBucket = dexBuckets[0] ?? null;

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Net DEX" value={displayAnalytics.summary.totalNetDex} descriptor="Aggregate directional dealer pressure" />
          <AristocratMetric cardTitle="DEX Flip" valueLabel={formatCurrency(dexLevels?.flip)} descriptor="Zero-delta exposure transition level" />
          <AristocratMetric cardTitle="DEX Call Wall" valueLabel={formatCurrency(dexLevels?.callWall)} descriptor="Largest positive directional wall" />
          <AristocratMetric cardTitle="DEX Put Wall" valueLabel={formatCurrency(dexLevels?.putWall)} descriptor="Largest negative directional wall" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="DEX Concentration" subtitle="Strike-by-strike directional exposure showing where dealer delta pressure clusters." status={panelStatus}>
            {displayAnalytics.strikes.length ? (
              <GexStrikeChart
                data={displayAnalytics.strikes}
                metricKey="dex"
                metricLabel="DEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No DEX map yet" detail="Directional concentration appears after the next analytics cycle." />
            )}
          </PanelShell>

          <PanelShell title="DEX Levels" subtitle="Directional walls and the DEX transition level for the current expiry scope." status={selectedDteLabel(levelsForDisplay)}>
            <div className="grid gap-3">
              <RelevantLevelCard label="DEX Flip" value={formatCurrency(dexLevels?.flip)} detail={dexLevels?.flip ? `Distance ${formatDistanceFromSpot(dexLevels.flip, displayAnalytics.summary.spotPrice)}` : 'No DEX flip available.'} />
              <RelevantLevelCard label="DEX Call Wall" value={formatCurrency(dexLevels?.callWall)} detail={dexLevels?.callWall ? `Distance ${formatDistanceFromSpot(dexLevels.callWall, displayAnalytics.summary.spotPrice)}` : 'No DEX call wall available.'} />
              <RelevantLevelCard label="DEX Put Wall" value={formatCurrency(dexLevels?.putWall)} detail={dexLevels?.putWall ? `Distance ${formatDistanceFromSpot(dexLevels.putWall, displayAnalytics.summary.spotPrice)}` : 'No DEX put wall available.'} />
              <RelevantLevelCard label="DEX Wall Range" value={`${formatDistanceFromSpot(dexLevels?.putWall, displayAnalytics.summary.spotPrice)} / ${formatDistanceFromSpot(dexLevels?.callWall, displayAnalytics.summary.spotPrice)}`} detail="Put wall below and call wall above for directional exposure." />
            </div>
          </PanelShell>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <PanelShell title="DEX Term Structure" subtitle="Net, call, and put DEX by expiry so directional pressure is readable across maturities." status="By Expiry">
            {dexBuckets.length ? (
              <TermStructureCharts data={dexBuckets} mode="dex" />
            ) : (
              <EmptyPanel title="No DEX term structure yet" detail="Expiry-level DEX appears once the loaded chain includes directional exposure across maturities." />
            )}
          </PanelShell>

          <PanelShell title="Call / Put DEX Split" subtitle="Directional bias becomes clearer when you separate upside call pressure from downside put pressure." status="Split Read">
            <div className="grid gap-3">
              <RelevantLevelCard label="Call DEX" value={formatCompactNumber(callDex)} detail="Aggregate call-side delta exposure across the current expiry scope." />
              <RelevantLevelCard label="Put DEX" value={formatCompactNumber(putDex)} detail="Aggregate put-side delta exposure across the current expiry scope." />
              <RelevantLevelCard label="Call / Put DEX" value={dexSkew} detail="Call DEX divided by the absolute value of put DEX." />
              <RelevantLevelCard
                label="Strongest DEX Bucket"
                value={strongestDexBucket ? `${strongestDexBucket.dte} DTE` : '--'}
                detail={strongestDexBucket ? `${strongestDexBucket.expiry} carrying ${formatCompactNumber(strongestDexBucket.dex)} net DEX.` : 'No directional bucket concentration available.'}
              />
            </div>
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="DEX Heat" subtitle="Relative strike intensity for directional exposure." status={panelStatus}>
            {displayAnalytics.strikes.length ? (
              <GexHeatmap
                data={displayAnalytics.strikes}
                metricKey="dex"
                metricLabel="DEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No DEX heat yet" detail="This panel fills once directional exposure is available across strikes." />
            )}
          </PanelShell>

          <PanelShell title="DEX Notes" subtitle="DEX matters most when directional pressure aligns with gamma walls, trend acceleration, or large spot dislocations." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                Use DEX to see where dealer directional sensitivity may amplify or dampen price travel even when gamma structure looks stable.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                Read this page alongside gamma: aligned DEX and GEX usually matter more than either signal alone, while front-expiry DEX clustering can dominate tape behavior even when back-month structure looks calm.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'charm') {
    const charmStrikes = aggregateMetricByStrike(displayAnalytics.raw, 'charm', 'chex');

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Net Charm" value={sumMetric(displayAnalytics.raw, 'charm')} descriptor="Aggregate time-decay sensitivity" />
          <AristocratMetric cardTitle="CHEX" value={sumMetric(displayAnalytics.strikes, 'chex')} descriptor="Dealer charm exposure footprint" />
          <AristocratMetric cardTitle="Top Charm Strike" valueLabel={charmStrikes[0] ? formatCurrency(charmStrikes[0].strike, 2) : '--'} descriptor="Largest absolute charm node" />
          <AristocratMetric cardTitle="Pinned Strike" valueLabel={selectedStrike != null ? formatCurrency(selectedStrike, 2) : 'None'} descriptor="Shared inspection focus" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Charm Concentration" subtitle="Where time decay can reshape dealer hedging fastest." status={panelStatus}>
            {charmStrikes.length ? (
              <GexStrikeChart
                data={charmStrikes}
                metricKey="charm"
                metricLabel="Charm"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No charm map yet" detail="Charm concentration will appear once the engine has enough time-value context." />
            )}
          </PanelShell>

          <PanelShell title="Time-Decay Heat" subtitle="Fast scan of positive and negative charm pockets." status={panelStatus}>
            {charmStrikes.length ? (
              <GexHeatmap
                data={charmStrikes}
                metricKey="charm"
                metricLabel="Charm"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No charm heat yet" detail="This panel fills after contract greeks are refreshed." />
            )}
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <StrikeInspector
            selectedStrike={selectedStrike}
            selectedStrikeData={selectedStrikeData}
            contracts={selectedContracts}
            spot={displayAnalytics.summary.spotPrice}
            onClearPin={() => setPinnedStrike(null)}
            pinned={pinnedStrike != null}
          />

          <PanelShell title="Charm Notes" subtitle="Charm tends to matter most into expiry, around large gamma nodes, and during low-liquidity sessions." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                Positive charm can help stabilize hedging over time, while negative charm can create pressure for dealers to chase the move as the clock burns down.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                Best next additions here: DTE-bucket charm strips, opening-vs-closing decay pressure, and charm normalized by OI so small noisy strikes do not dominate.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'speed') {
    const speedStrikes = aggregateMetricByStrike(displayAnalytics.raw, 'speed', 'spex');
    const speedLevels = levelsForDisplay?.speed;

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Speed Flip" valueLabel={formatCurrency(speedLevels?.flip)} descriptor="Gamma instability zero-cross" />
          <AristocratMetric cardTitle="Speed Call Wall" valueLabel={formatCurrency(speedLevels?.callWall)} descriptor="Peak positive speed zone" />
          <AristocratMetric cardTitle="Speed Put Wall" valueLabel={formatCurrency(speedLevels?.putWall)} descriptor="Peak negative speed zone" />
          <AristocratMetric cardTitle="SPEX" value={sumMetric(displayAnalytics.strikes, 'spex')} descriptor="Aggregate speed exposure" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Speed Concentration" subtitle="Where gamma changes fastest as price moves — breakout and reversal acceleration nodes." status={panelStatus}>
            {speedStrikes.length ? (
              <GexStrikeChart
                data={speedStrikes}
                metricKey="spex"
                metricLabel="SPEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No speed data yet" detail="Speed concentration appears once the analytics engine has completed a full cycle." />
            )}
          </PanelShell>

          <PanelShell title="Speed Heat" subtitle="Relative intensity of gamma instability by strike." status={panelStatus}>
            {speedStrikes.length ? (
              <GexHeatmap
                data={speedStrikes}
                metricKey="spex"
                metricLabel="SPEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No speed heat yet" detail="This panel fills after contract greeks are refreshed." />
            )}
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Speed Levels" subtitle="Speed flip and walls mark where gamma rebalancing accelerates violently." status={panelStatus}>
            <div className="grid gap-3">
              <RelevantLevelCard label="Speed Flip" value={formatCurrency(speedLevels?.flip)} detail={speedLevels?.flip ? `Distance ${formatDistanceFromSpot(speedLevels.flip, displayAnalytics.summary.spotPrice)}` : 'Speed flip unavailable.'} />
              <RelevantLevelCard label="Speed Call Wall" value={formatCurrency(speedLevels?.callWall)} detail="Fastest upside gamma acceleration zone." />
              <RelevantLevelCard label="Speed Put Wall" value={formatCurrency(speedLevels?.putWall)} detail="Fastest downside gamma acceleration zone." />
            </div>
          </PanelShell>

          <PanelShell title="Speed Notes" subtitle="Speed (dΓ/dS) marks where a move self-amplifies through dealer rehedging." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                Speed zero-crossings are where gamma transitions from accelerating to decelerating. Crossing one intraday often marks the transition from a measured move to a squeeze or to a fade.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                High SPEX strikes with high GEX nearby are the most dangerous acceleration zones — dealer rehedging can feed on itself until the next speed zero-cross acts as a ceiling or floor.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'zomma') {
    const zommaStrikes = aggregateMetricByStrike(displayAnalytics.raw, 'zomma', 'zomex');
    const zommaLevels = levelsForDisplay?.zomma;

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Zomma Flip" valueLabel={formatCurrency(zommaLevels?.flip)} descriptor="Vol-sensitive gamma zero-cross" />
          <AristocratMetric cardTitle="Zomma Call Wall" valueLabel={formatCurrency(zommaLevels?.callWall)} descriptor="Highest vol-gamma sensitivity above spot" />
          <AristocratMetric cardTitle="Zomma Put Wall" valueLabel={formatCurrency(zommaLevels?.putWall)} descriptor="Highest vol-gamma sensitivity below spot" />
          <AristocratMetric cardTitle="ZOMEX" value={sumMetric(displayAnalytics.strikes, 'zomex')} descriptor="Aggregate zomma exposure" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Zomma Concentration" subtitle="Where gamma becomes most sensitive to volatility — hidden reversal zones that activate on vol spikes." status={panelStatus}>
            {zommaStrikes.length ? (
              <GexStrikeChart
                data={zommaStrikes}
                metricKey="zomex"
                metricLabel="ZOMEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No zomma data yet" detail="Zomma concentration appears once the analytics engine has completed a full cycle." />
            )}
          </PanelShell>

          <PanelShell title="Zomma Heat" subtitle="Strikes where a vol spike would most dramatically change dealer gamma exposure." status={panelStatus}>
            {zommaStrikes.length ? (
              <GexHeatmap
                data={zommaStrikes}
                metricKey="zomex"
                metricLabel="ZOMEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No zomma heat yet" detail="This panel fills after contract greeks are refreshed." />
            )}
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Zomma Levels" subtitle="Strikes where a volatility change would most impact dealer gamma." status={panelStatus}>
            <div className="grid gap-3">
              <RelevantLevelCard label="Zomma Flip" value={formatCurrency(zommaLevels?.flip)} detail={zommaLevels?.flip ? `Distance ${formatDistanceFromSpot(zommaLevels.flip, displayAnalytics.summary.spotPrice)}` : 'Zomma flip unavailable.'} />
              <RelevantLevelCard label="Call Wall" value={formatCurrency(zommaLevels?.callWall)} detail="Upside strike most sensitive to vol expansion." />
              <RelevantLevelCard label="Put Wall" value={formatCurrency(zommaLevels?.putWall)} detail="Downside strike most sensitive to vol expansion." />
            </div>
          </PanelShell>

          <PanelShell title="Zomma Notes" subtitle="Zomma (dΓ/dσ) reveals where vol expansion changes the dealer hedging landscape." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                High zomma strikes are &quot;sleeping giants&quot; — quiet on low-vol days but suddenly significant when the VIX moves. These are the levels to watch when you expect a vol regime change.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                Look for zomma concentration near key GEX walls — when both align, a vol spike can cause a sudden regime shift in dealer hedging pressure at that strike.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'vomma') {
    const vommaStrikes = aggregateMetricByStrike(displayAnalytics.raw, 'vomma', 'vomex');
    const vommaLevels = levelsForDisplay?.vomma;

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Vomma Call Wall" valueLabel={formatCurrency(vommaLevels?.callWall)} descriptor="Peak vol-convexity above spot" />
          <AristocratMetric cardTitle="Vomma Put Wall" valueLabel={formatCurrency(vommaLevels?.putWall)} descriptor="Peak vol-convexity below spot" />
          <AristocratMetric cardTitle="VOMEX" value={sumMetric(displayAnalytics.strikes, 'vomex')} descriptor="Aggregate vomma exposure" />
          <AristocratMetric cardTitle="Net Vomma" value={sumMetric(displayAnalytics.raw, 'vomma')} descriptor="Total vega convexity in chain" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <PanelShell title="Vomma Concentration" subtitle="Where rising vol creates exponentially more vega — vol-buying pressure zones." status={panelStatus}>
            {vommaStrikes.length ? (
              <GexStrikeChart
                data={vommaStrikes}
                metricKey="vomex"
                metricLabel="VOMEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No vomma data yet" detail="Vomma concentration appears once the analytics engine has completed a full cycle." />
            )}
          </PanelShell>

          <PanelShell title="Vomma Heat" subtitle="Where vol convexity is most concentrated — high vomma means vol buying accelerates." status={panelStatus}>
            {vommaStrikes.length ? (
              <GexHeatmap
                data={vommaStrikes}
                metricKey="vomex"
                metricLabel="VOMEX"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No vomma heat yet" detail="This panel fills after contract greeks are refreshed." />
            )}
          </PanelShell>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Vomma Levels" subtitle="Strikes where vol convexity creates the most dealer buying pressure on rising vol." status={panelStatus}>
            <div className="grid gap-3">
              <RelevantLevelCard label="Vomma Call Wall" value={formatCurrency(vommaLevels?.callWall)} detail={vommaLevels?.callWall ? `Distance ${formatDistanceFromSpot(vommaLevels.callWall, displayAnalytics.summary.spotPrice)}` : 'Vomma call wall unavailable.'} />
              <RelevantLevelCard label="Vomma Put Wall" value={formatCurrency(vommaLevels?.putWall)} detail={vommaLevels?.putWall ? `Distance ${formatDistanceFromSpot(vommaLevels.putWall, displayAnalytics.summary.spotPrice)}` : 'Vomma put wall unavailable.'} />
            </div>
          </PanelShell>

          <PanelShell title="Vomma Notes" subtitle="Vomma (d²V/dσ²) measures the convexity of vega — how fast vol-buying pressure accelerates." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                High vomma strikes are where a sustained vol expansion creates a self-reinforcing buying cascade — as vol rises, these strikes get more valuable faster, creating additional demand.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                Vomma is highest for OTM options, especially those near but not at key GEX walls. On big vol crush days, these strikes tend to normalize fastest as the convexity premium collapses.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'chain') {
    const expiryRows = buildExpiryRows(displayAnalytics.raw);

    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Tracked Expiries" valueLabel={String(expiryRows.length)} descriptor="Distinct expiries in the loaded chain" />
          <AristocratMetric cardTitle="Total Contracts" valueLabel={displayAnalytics.raw.length.toLocaleString()} descriptor="Rows across all expiries" />
          <AristocratMetric cardTitle="Total OI" value={sumMetric(displayAnalytics.raw, 'openInterest')} descriptor="Combined open interest footprint" />
          <AristocratMetric cardTitle="Total Volume" value={sumMetric(displayAnalytics.raw, 'volume')} descriptor="Observed flow in the loaded chain" />
        </div>

        <PanelShell title="Expiry Structure" subtitle="A higher-level read of where the chain is concentrated by date." status={panelStatus}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {expiryRows.map((row) => (
              <div key={row.expiry} className="rounded-[1.6rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">{row.expiry}</p>
                <div className="mt-3 grid gap-2 text-sm text-[#6d6255] dark:text-[#a79b8b]">
                  <div className="flex items-center justify-between"><span>Contracts</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{row.contracts.toLocaleString()}</span></div>
                  <div className="flex items-center justify-between"><span>Open Interest</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatCompactNumber(row.openInterest)}</span></div>
                  <div className="flex items-center justify-between"><span>Volume</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatCompactNumber(row.volume)}</span></div>
                  <div className="flex items-center justify-between"><span>Avg IV</span><span className="font-medium text-[#D4AF37]">{row.iv != null ? `${(row.iv * 100).toFixed(1)}%` : '--'}</span></div>
                  <div className="flex items-center justify-between"><span>Call / Put OI</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatCompactNumber(row.callOi)} / {formatCompactNumber(row.putOi)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </PanelShell>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
          <PanelShell title="Term Structure By Expiry" subtitle="Net GEX, vega, charm, and positioning by expiry bucket." status="Buckets">
            <div className="space-y-4">
              <TermStructureCharts data={expiryBuckets} />
              <div className="grid gap-3">
              {expiryBuckets.map((bucket) => (
                <div key={bucket.expiry} className="grid gap-3 rounded-[1.5rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5 md:grid-cols-5">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{bucket.expiry}</p>
                    <p className="mt-1 text-xs text-[#746857] dark:text-[#a79b8b]">{bucket.dte} DTE</p>
                  </div>
                  <MetricMini label="Net GEX" value={formatCompactNumber(bucket.gex)} />
                  <MetricMini label="Net Vega" value={formatCompactNumber(bucket.vega)} />
                  <MetricMini label="Net Charm" value={formatCompactNumber(bucket.charm)} />
                  <MetricMini label="Vol / OI" value={formatPercent(bucket.volumeVsOi, 1)} />
                </div>
              ))}
              </div>
            </div>
          </PanelShell>

          <PanelShell title="Flow Versus Positioning" subtitle="Fresh aggression proxy now, with OI delta versus prior saved snapshot when available." status="Context">
            <div className="grid gap-3">
              {expiryBuckets.slice(0, 6).map((bucket) => (
                <div key={bucket.expiry} className="rounded-[1.5rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{bucket.expiry}</p>
                    <span className="text-[10px] uppercase tracking-[0.22em] text-[#7c725f] dark:text-[#b7ab9a]">{bucket.dte} DTE</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-[#6d6255] dark:text-[#a79b8b]">
                    <div className="flex items-center justify-between"><span>Call / Put Vol</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatRatio(bucket.callVolume, bucket.putVolume)}</span></div>
                    <div className="flex items-center justify-between"><span>Call / Put OI</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatRatio(bucket.callOi, bucket.putOi)}</span></div>
                    <div className="flex items-center justify-between"><span>Volume vs OI</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatPercent(bucket.volumeVsOi, 1)}</span></div>
                    <div className="flex items-center justify-between"><span>OI Delta</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{bucket.oiDelta == null ? '--' : formatCompactNumber(bucket.oiDelta)}</span></div>
                    <div className="flex items-center justify-between"><span>Gamma Flip</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatCurrency(bucket.gammaFlip)}</span></div>
                    <div className="flex items-center justify-between"><span>Call / Put Walls</span><span className="font-medium text-[#1D1D1F] dark:text-[#f5efe3]">{formatCurrency(bucket.callWall)} / {formatCurrency(bucket.putWall)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </PanelShell>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.7fr]">
          <StrikeInspector
            selectedStrike={selectedStrike}
            selectedStrikeData={selectedStrikeData}
            contracts={selectedContracts}
            spot={displayAnalytics.summary.spotPrice}
            onClearPin={() => setPinnedStrike(null)}
            pinned={pinnedStrike != null}
          />

          <PanelShell title="Chain Ledger" subtitle="A richer contract table for expiry, IV, flow, and greek inspection." status={panelStatus}>
            {displayAnalytics.raw.length ? (
              <OptionChainTable
                data={displayAnalytics.raw}
                mode="chain"
                highlightedStrike={selectedStrike}
                pinnedStrike={pinnedStrike}
                onHoverStrike={setHighlightedStrike}
                onPinStrike={setPinnedStrike}
              />
            ) : (
              <EmptyPanel title="No chain available" detail="The full chain view fills after the backend pulls option rows." />
            )}
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'events') {
    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Upcoming Events" valueLabel={String(eventMarkers.length)} descriptor="Structural and official macro markers" />
          <AristocratMetric cardTitle="High Impact" valueLabel={String(eventMarkers.filter((event) => event.impact === 'high').length)} descriptor="Highest-volatility catalyst tags" />
          <AristocratMetric cardTitle="Timed Releases" valueLabel={String(eventMarkers.filter((event) => Boolean(event.releaseTimeEt)).length)} descriptor="Events with a scheduled ET release time" />
          <AristocratMetric cardTitle="Macro Prints" valueLabel={String(eventMarkers.filter((event) => Boolean(event.actual)).length)} descriptor="Events carrying a latest reported value" />
        </div>

        <PanelShell title="Macro Timeline" subtitle="Macro releases and structural expiry markers with timing and print context." status="Calendar">
          <div className="grid gap-4">
            {eventMarkers.map((event) => (
              <div key={`${event.date}-${event.label}`} className="grid gap-3 rounded-[1.6rem] border border-[#e6ddcf] bg-[#fcf8f1] p-5 dark:border-white/10 dark:bg-white/5 md:grid-cols-[0.95fr_1.7fr_1.1fr]">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{event.date}</p>
                  {event.releaseTimeEt && <p className="mt-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#9b8d78] dark:text-[#b7ab9a]">{event.releaseTimeEt}</p>}
                  <div className="mt-2"><EventImpactBadge impact={event.impact} /></div>
                </div>
                <div>
                  <p className="text-lg font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{event.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{event.note}</p>
                </div>
                <div className="md:text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">Print Context</p>
                  <div className="mt-2 grid gap-2 text-sm text-[#6d6255] dark:text-[#a79b8b]">
                    {event.actual && <p><span className="font-semibold text-[#1D1D1F] dark:text-[#f5efe3]">Actual:</span> {event.actual}</p>}
                    {event.expected && <p><span className="font-semibold text-[#1D1D1F] dark:text-[#f5efe3]">Expected:</span> {event.expected}</p>}
                    {event.previous && <p><span className="font-semibold text-[#1D1D1F] dark:text-[#f5efe3]">Previous:</span> {event.previous}</p>}
                    {!event.actual && !event.expected && !event.previous && <p>Timing-focused event with no comparable print value.</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PanelShell>

        <PanelShell title="Event Notes" subtitle="These are macro catalysts and structural dates, not a full live news feed." status="Guide">
          <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
            <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
              High-impact tags are assigned to events that tend to move rates, index vol, or broad positioning most directly, like FOMC, CPI, and unemployment.
            </p>
            <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
              Structural markers like 0DTE and OPEX are generated from your own chain context, so they stay useful even without a third-party news feed.
            </p>
          </div>
        </PanelShell>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'volatility') {
    return (
      <main className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AristocratMetric cardTitle="Surface Expiries" valueLabel={String(displayAnalytics.surface.expiries.length)} descriptor="Distinct expiries in the mesh" />
          <AristocratMetric cardTitle="Surface Strikes" valueLabel={String(displayAnalytics.surface.strikes.length)} descriptor="Price nodes across the curve" />
          <AristocratMetric cardTitle="ATM Proxy" valueLabel={displayAnalytics.strikes[0] ? `${(displayAnalytics.strikes[0].iv * 100).toFixed(1)}%` : '--'} descriptor="Front-pocket implied vol" />
          <AristocratMetric cardTitle="Pinned Strike" valueLabel={selectedStrike != null ? formatCurrency(selectedStrike, 2) : 'None'} descriptor="Overlay shared across views" />
        </div>

        <PanelShell title="Implied Volatility Surface" subtitle="Thematic terrain view by expiry and strike." status={panelStatus}>
          {displayAnalytics.surface.matrix.length ? (
            <IvSurface surfaceData={displayAnalytics.surface} />
          ) : (
            <EmptyPanel title="Surface unavailable" detail="The current dataset does not have enough IV points to build a surface yet." />
          )}
        </PanelShell>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <PanelShell title="Volatility Skew" subtitle="Cross-section of strike IV with the active strike overlaid." status={panelStatus}>
            {displayAnalytics.strikes.length ? (
              <IvSkewChart data={displayAnalytics.strikes} highlightedStrike={selectedStrike} />
            ) : (
              <EmptyPanel title="No skew curve yet" detail="Implied volatility by strike will appear here once contract data is available." />
            )}
          </PanelShell>

          <PanelShell title="Volatility Notes" subtitle="Use the surface for shape, then the skew for precision at the active strike." status="Guide">
            <div className="grid gap-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/6">
                Elevated ridges usually point to crowding around event expiries or concentrated downside demand. Compare them with nearby walls to see whether vol and gamma are reinforcing each other.
              </p>
              <p className="rounded-[1.4rem] border border-[#e6dece] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                When you pin a strike from another page, come here to judge whether the local IV pocket is rich, flat, or collapsing relative to the rest of the term structure.
              </p>
            </div>
          </PanelShell>
        </div>

        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  if (view === 'levels') {
    return (
      <main className="space-y-6">
        <LevelsBoard levels={levelsForDisplay} spot={displayAnalytics.summary.spotPrice} statusLabel={selectedDteLabel(levelsForDisplay)} />
        <StatusMessage status={status} error={error} />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AristocratMetric cardTitle="Contracts" valueLabel={displayAnalytics.raw.length.toLocaleString()} descriptor="Rows in the current ledger" />
        <AristocratMetric cardTitle="Call Contracts" valueLabel={String(displayAnalytics.raw.filter((row) => row.type === 'call').length)} descriptor="Call-side records" />
        <AristocratMetric cardTitle="Put Contracts" valueLabel={String(displayAnalytics.raw.filter((row) => row.type === 'put').length)} descriptor="Put-side records" />
        <AristocratMetric cardTitle="Pinned Strike" valueLabel={selectedStrike != null ? formatCurrency(selectedStrike, 2) : 'None'} descriptor="Shared inspection focus" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.7fr]">
        <StrikeInspector
          selectedStrike={selectedStrike}
          selectedStrikeData={selectedStrikeData}
          contracts={selectedContracts}
          spot={displayAnalytics.summary.spotPrice}
          onClearPin={() => setPinnedStrike(null)}
          pinned={pinnedStrike != null}
        />

        <PanelShell title="Contract Ledger" subtitle="Raw contract view with synchronized strike highlighting." status={panelStatus}>
          {displayAnalytics.raw.length ? (
            <OptionChainTable
              data={displayAnalytics.raw}
              highlightedStrike={selectedStrike}
              pinnedStrike={pinnedStrike}
              onHoverStrike={setHighlightedStrike}
              onPinStrike={setPinnedStrike}
            />
          ) : (
            <EmptyPanel title="No contracts available" detail="The ledger fills after the backend pulls options chain data." />
          )}
        </PanelShell>
      </div>

      <StatusMessage status={status} error={error} />
    </main>
  );
}

function QuickRouteCard({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <Link href={href} className="rounded-[1.5rem] border border-[#e5ddcf] bg-white p-4 transition-all hover:border-[#d7c08a] hover:bg-[#fffaf0] dark:border-white/10 dark:bg-white/5 dark:hover:border-[#8d7331] dark:hover:bg-white/8">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{detail}</p>
    </Link>
  );
}

function RelevantLevelCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[1.45rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">{label}</p>
      <p className="mt-2 text-lg font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{value}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{detail}</p>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-[#e6ddcf] bg-white/70 px-3 py-3 dark:border-white/10 dark:bg-white/6">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{label}</p>
      <p className="mt-2 text-base font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{value}</p>
    </div>
  );
}

function EventImpactBadge({ impact }: { impact: string }) {
  const tone =
    impact === 'high'
      ? 'bg-[#fff1ea] text-[#9b4f26] dark:bg-[#261810] dark:text-[#f0b390]'
      : impact === 'medium'
        ? 'bg-[#fff7e2] text-[#8a6400] dark:bg-[#231d12] dark:text-[#f2d482]'
        : 'bg-[#eef8ee] text-[#2f6b39] dark:bg-[#16231a] dark:text-[#9fdbab]';

  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${tone}`}>{impact}</span>;
}

type DisplayEvent = {
  date: string;
  label: string;
  note: string;
  impact: string;
  source: string;
  releaseTimeEt?: string;
  expected?: string | null;
  actual?: string | null;
  previous?: string | null;
};

function buildRelevantLevelEntries(levels: AnalyticsResponse['levels'], spot: number) {
  if (!levels) return [];

  const derived = levels.derived;
  return [
    { label: 'Aggregated Call Wall', value: formatCurrency(levels.callWall), detail: `Distance ${formatDistanceFromSpot(levels.callWall, spot)}` },
    { label: 'Aggregated Put Wall', value: formatCurrency(levels.putWall), detail: `Distance ${formatDistanceFromSpot(levels.putWall, spot)}` },
    { label: 'Max Pain', value: formatCurrency(levels.maxPain), detail: 'Payout-minimizing strike for the selected expiry scope.' },
    { label: 'OI Call Wall', value: formatCurrency(derived?.oiCallWall), detail: 'Highest aggregated call open interest strike.' },
    { label: 'OI Put Wall', value: formatCurrency(derived?.oiPutWall), detail: 'Highest aggregated put open interest strike.' },
    { label: 'Weak Call OI', value: formatCurrency(derived?.weakCallOIStrike), detail: 'Thin call open-interest pocket that can speed upside travel.' },
    { label: 'Weak Put OI', value: formatCurrency(derived?.weakPutOIStrike), detail: 'Thin put open-interest pocket that can speed downside travel.' },
    { label: 'Protected Gamma High', value: formatCurrency(derived?.protectedGammaHigh), detail: 'Positive-gamma resistance shelf above spot.' },
    { label: 'Protected Gamma Low', value: formatCurrency(derived?.protectedGammaLow), detail: 'Positive-gamma support shelf below spot.' },
    { label: 'Aggressive Call Ceiling', value: formatCurrency(derived?.aggressiveCallCeiling), detail: 'Most active call-volume strike above spot.' },
    { label: 'Aggressive Put Floor', value: formatCurrency(derived?.aggressivePutFloor), detail: 'Most active put-volume strike below spot.' },
    { label: 'Skew Rich Strike', value: formatCurrency(derived?.skewRichStrike), detail: 'Highest average implied volatility strike.' },
    { label: 'Skew Cheap Strike', value: formatCurrency(derived?.skewCheapStrike), detail: 'Lowest average implied volatility strike.' },
  ].filter((entry) => entry.value !== '--');
}

function orderNavItems<T extends { href: string }>(items: T[], navOrder: string[]) {
  const orderMap = new Map(navOrder.map((href, index) => [href, index]));
  return [...items].sort((a, b) => (orderMap.get(a.href) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.href) ?? Number.MAX_SAFE_INTEGER));
}

function reorderNavOrder(currentOrder: string[], draggedHref: string, targetHref: string) {
  const base = currentOrder.length ? [...currentOrder] : NAV_ITEMS.map((item) => item.href);
  const fromIndex = base.indexOf(draggedHref);
  const targetIndex = base.indexOf(targetHref);
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return base;

  const [moved] = base.splice(fromIndex, 1);
  base.splice(targetIndex, 0, moved);
  return base;
}

function selectedDteLabel(levels: AnalyticsResponse['levels']) {
  if (levels && 'dte' in levels && typeof levels.dte === 'number') {
    return `${levels.dte} DTE`;
  }
  return 'All Expiries';
}

function buildInsights(
  analytics: AnalyticsResponse | null,
  expiryBuckets: Array<{ dte: number; dex?: number; callDex?: number; putDex?: number }>
) {
  if (!analytics) return [];
  const frontBucket = expiryBuckets.find((bucket) => bucket.dte <= 7);
  const frontDex = frontBucket?.dex ?? 0;
  const dexBias = analytics.summary.totalNetDex >= 0 ? 'Positive Delta Bias' : 'Negative Delta Bias';
  const frontDexNote = frontBucket
    ? `${frontBucket.dte}DTE holds ${formatCompactNumber(frontDex)} net DEX.`
    : 'No front-expiry DEX bucket is currently loaded.';

  const spot = analytics.summary.spotPrice;
  return [
    {
      label: 'Gamma Regime',
      value: analytics.summary.totalNetGex >= 0 ? 'Supportive' : 'Fragile',
      hint: analytics.summary.totalNetGex >= 0 ? 'Mean reversion is more likely while spot stays supported.' : 'Expect faster directional travel and thinner dealer support.',
      tone: analytics.summary.totalNetGex >= 0 ? 'blue' as const : 'orange' as const,
    },
    {
      label: 'Flip Distance',
      value: formatDistanceFromSpot(analytics.levels?.gammaFlip, spot),
      hint: 'How far spot is from the zero-gamma transition level.',
      tone: 'amber' as const,
    },
    {
      label: 'Wall Range',
      value: `${formatDistanceFromSpot(analytics.levels?.putWall, spot)} / ${formatDistanceFromSpot(analytics.levels?.callWall, spot)}`,
      hint: 'Put wall below and call wall above, both measured versus spot.',
      tone: 'slate' as const,
    },
    {
      label: 'DEX Bias',
      value: dexBias,
      hint: frontDexNote,
      tone: analytics.summary.totalNetDex >= 0 ? 'blue' as const : 'orange' as const,
    },
  ];
}

function formatRatio(numerator: number, denominator: number) {
  if (!denominator) return '--';
  return `${(numerator / denominator).toFixed(2)}x`;
}

function sumDexByType(raw: RawContract[], type: 'call' | 'put') {
  return raw.reduce((sum, row) => {
    if (row.type !== type) return sum;
    return sum + (typeof row.dex === 'number' ? row.dex : 0);
  }, 0);
}

function sumMetric<T, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((sum, row) => {
    const value = row[key];
    return sum + (typeof value === 'number' ? value : 0);
  }, 0);
}

type RawNumericMetric = 'vega' | 'charm' | 'speed' | 'zomma' | 'vomma';
type ExposureMetric = 'vex' | 'chex' | 'spex' | 'zomex' | 'vomex';

function aggregateMetricByStrike(raw: RawContract[], rawMetric: RawNumericMetric, exposureMetric?: ExposureMetric) {
  const grouped = new Map<number, { strike: number; gex: number; dex: number; vex: number; chex: number; spex: number; zomex: number; vomex: number; vega: number; charm: number; speed: number; zomma: number; vomma: number; openInterest: number; volume: number; iv: number; count: number }>();

  for (const row of raw) {
    const current = grouped.get(row.strike) ?? {
      strike: row.strike,
      gex: 0, dex: 0, vex: 0, chex: 0, spex: 0, zomex: 0, vomex: 0,
      vega: 0, charm: 0, speed: 0, zomma: 0, vomma: 0,
      openInterest: 0, volume: 0, iv: 0, count: 0,
    };

    current[rawMetric] += typeof row[rawMetric] === 'number' ? (row[rawMetric] as number) : 0;
    if (exposureMetric) current[exposureMetric] += typeof row[exposureMetric] === 'number' ? (row[exposureMetric] as number) : 0;
    current.openInterest += typeof row.openInterest === 'number' ? row.openInterest : 0;
    current.volume += typeof row.volume === 'number' ? row.volume : 0;
    current.iv += typeof row.iv === 'number' ? row.iv : 0;
    current.count += typeof row.iv === 'number' ? 1 : 0;

    grouped.set(row.strike, current);
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      iv: row.count > 0 ? row.iv / row.count : 0,
    }))
    .sort((a, b) => Math.abs(b[rawMetric]) - Math.abs(a[rawMetric]));
}

function buildExpiryRows(raw: RawContract[]) {
  const grouped = new Map<string, { expiry: string; contracts: number; openInterest: number; volume: number; ivTotal: number; ivCount: number; callOi: number; putOi: number }>();

  for (const row of raw) {
    const current = grouped.get(row.expiry) ?? {
      expiry: row.expiry,
      contracts: 0,
      openInterest: 0,
      volume: 0,
      ivTotal: 0,
      ivCount: 0,
      callOi: 0,
      putOi: 0,
    };

    current.contracts += 1;
    current.openInterest += typeof row.openInterest === 'number' ? row.openInterest : 0;
    current.volume += typeof row.volume === 'number' ? row.volume : 0;
    if (typeof row.iv === 'number') {
      current.ivTotal += row.iv;
      current.ivCount += 1;
    }
    if (row.type === 'call') current.callOi += typeof row.openInterest === 'number' ? row.openInterest : 0;
    if (row.type === 'put') current.putOi += typeof row.openInterest === 'number' ? row.openInterest : 0;

    grouped.set(row.expiry, current);
  }

  return [...grouped.values()]
    .map((row) => ({
      expiry: row.expiry,
      contracts: row.contracts,
      openInterest: row.openInterest,
      volume: row.volume,
      iv: row.ivCount > 0 ? row.ivTotal / row.ivCount : null,
      callOi: row.callOi,
      putOi: row.putOi,
    }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

function buildExpiryBuckets(raw: RawContract[], comparisonRaw: RawContract[]) {
  const comparisonByExpiry = new Map<string, number>();
  for (const row of comparisonRaw) {
    comparisonByExpiry.set(
      row.expiry,
      (comparisonByExpiry.get(row.expiry) ?? 0) + (typeof row.openInterest === 'number' ? row.openInterest : 0)
    );
  }

  const grouped = new Map<string, {
    expiry: string;
    dte: number;
    gex: number;
    dex: number;
    callDex: number;
    putDex: number;
    vega: number;
    charm: number;
    openInterest: number;
    volume: number;
    callOi: number;
    putOi: number;
    callVolume: number;
    putVolume: number;
  }>();

  const today = new Date();

  for (const row of raw) {
    const expiryDate = new Date(`${row.expiry}T00:00:00`);
    const dte = Math.max(0, Math.round((expiryDate.getTime() - today.getTime()) / 86_400_000));
    const current = grouped.get(row.expiry) ?? {
      expiry: row.expiry,
      dte,
      gex: 0,
      dex: 0,
      callDex: 0,
      putDex: 0,
      vega: 0,
      charm: 0,
      openInterest: 0,
      volume: 0,
      callOi: 0,
      putOi: 0,
      callVolume: 0,
      putVolume: 0,
    };

    current.gex += typeof row.gex === 'number' ? row.gex : 0;
    current.dex += typeof row.dex === 'number' ? row.dex : 0;
    current.vega += typeof row.vega === 'number' ? row.vega : 0;
    current.charm += typeof row.charm === 'number' ? row.charm : 0;
    current.openInterest += typeof row.openInterest === 'number' ? row.openInterest : 0;
    current.volume += typeof row.volume === 'number' ? row.volume : 0;
    if (row.type === 'call') {
      current.callDex += typeof row.dex === 'number' ? row.dex : 0;
      current.callOi += typeof row.openInterest === 'number' ? row.openInterest : 0;
      current.callVolume += typeof row.volume === 'number' ? row.volume : 0;
    } else {
      current.putDex += typeof row.dex === 'number' ? row.dex : 0;
      current.putOi += typeof row.openInterest === 'number' ? row.openInterest : 0;
      current.putVolume += typeof row.volume === 'number' ? row.volume : 0;
    }

    grouped.set(row.expiry, current);
  }

  return [...grouped.values()]
    .map((bucket) => {
      const expiryRows = raw.filter((row) => row.expiry === bucket.expiry);
      const strikeAgg = aggregateStrikeExposure(expiryRows);
      const walls = identifyWallsFromAgg(strikeAgg);

      return {
        ...bucket,
        oiDelta: comparisonByExpiry.has(bucket.expiry) ? bucket.openInterest - (comparisonByExpiry.get(bucket.expiry) ?? 0) : null,
        volumeVsOi: bucket.openInterest > 0 ? bucket.volume / bucket.openInterest : 0,
        gammaFlip: calculateGammaFlipFromAgg(strikeAgg),
        callWall: walls.callWall,
        putWall: walls.putWall,
        dexFlip: calculateMetricFlipFromAgg(strikeAgg, 'dex'),
        dexCallWall: identifyMetricWallsFromAgg(strikeAgg, 'dex').callWall,
        dexPutWall: identifyMetricWallsFromAgg(strikeAgg, 'dex').putWall,
      };
    })
    .sort((a, b) => a.dte - b.dte || a.expiry.localeCompare(b.expiry));
}

function calculateMetricFlipFromAgg(agg: Array<{ strike: number; [key: string]: number }>, key: 'gex' | 'dex') {
  const sorted = [...agg].sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return null;

  const first = sorted[0];
  if (!sorted.some((row) => typeof row[key] === 'number')) return null;

  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    const leftValue = typeof left[key] === 'number' ? left[key] : 0;
    const rightValue = typeof right[key] === 'number' ? right[key] : 0;
    if ((leftValue <= 0 && rightValue >= 0) || (leftValue >= 0 && rightValue <= 0)) {
      if (rightValue === leftValue) return right.strike;
      return left.strike + ((0 - leftValue) * (right.strike - left.strike)) / (rightValue - leftValue);
    }
  }

  return sorted.reduce((closest, row) => {
    const rowValue = typeof row[key] === 'number' ? row[key] : 0;
    const closestValue = typeof closest[key] === 'number' ? closest[key] : 0;
    return Math.abs(rowValue) < Math.abs(closestValue) ? row : closest;
  }, first).strike;
}

function identifyMetricWallsFromAgg(agg: Array<{ strike: number; [key: string]: number }>, key: 'gex' | 'dex') {
  if (!agg.length) return { callWall: null as number | null, putWall: null as number | null };

  const positive = [...agg].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))[0];
  const negative = [...agg].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0))[0];

  return {
    callWall: positive ? positive.strike : null,
    putWall: negative ? negative.strike : null,
  };
}

function buildNearTermBuckets<
  T extends {
    dte: number;
  }
>(expiryBuckets: T[]) {
  const explicit = expiryBuckets.filter((bucket) => bucket.dte <= 1);
  if (explicit.length > 0) return explicit.slice(0, 2);
  return expiryBuckets.slice(0, 2);
}

function buildDealerRegimeSummary(analytics: AnalyticsResponse, expiryBuckets: Array<{ dte: number; gex: number; vega: number; charm: number }>) {
  const gammaTone = analytics.summary.totalNetGex >= 0 ? 'supportive gamma' : 'fragile gamma';
  const dexTone = analytics.summary.totalNetDex >= 0 ? 'positive delta bias' : 'negative delta bias';
  const vegaTone = sumMetric(analytics.raw, 'vega') >= 0 ? 'long-vol sensitivity' : 'short-vol sensitivity';
  const charmTone = sumMetric(analytics.raw, 'charm') >= 0 ? 'stabilizing charm' : 'destabilizing charm';
  const nearTerm = expiryBuckets.find((bucket) => bucket.dte <= 1);
  const nearTermTone = nearTerm
    ? `Near-term pressure is centered in ${nearTerm.dte}DTE where net GEX is ${formatCompactNumber(nearTerm.gex)} and net charm is ${formatCompactNumber(nearTerm.charm)}.`
    : 'No immediate 0DTE or 1DTE pressure bucket is dominating the chain right now.';

  return `The book is currently showing ${gammaTone}, ${dexTone}, ${vegaTone}, and ${charmTone}. ${nearTermTone}`;
}

function buildOverallRatios(raw: RawContract[]) {
  const callVolume = raw.filter((row) => row.type === 'call').reduce((sum, row) => sum + (typeof row.volume === 'number' ? row.volume : 0), 0);
  const putVolume = raw.filter((row) => row.type === 'put').reduce((sum, row) => sum + (typeof row.volume === 'number' ? row.volume : 0), 0);
  const callOi = raw.filter((row) => row.type === 'call').reduce((sum, row) => sum + (typeof row.openInterest === 'number' ? row.openInterest : 0), 0);
  const putOi = raw.filter((row) => row.type === 'put').reduce((sum, row) => sum + (typeof row.openInterest === 'number' ? row.openInterest : 0), 0);
  const totalVolume = callVolume + putVolume;
  const totalOi = callOi + putOi;

  return {
    volumeRatio: formatRatio(callVolume, putVolume),
    oiRatio: formatRatio(callOi, putOi),
    volumeVsOi: formatPercent(totalOi > 0 ? totalVolume / totalOi : 0, 1),
  };
}

function aggregateStrikeExposure(rows: RawContract[]) {
  const grouped = new Map<number, { strike: number; gex: number }>();
  for (const row of rows) {
    const current = grouped.get(row.strike) ?? { strike: row.strike, gex: 0 };
    current.gex += typeof row.gex === 'number' ? row.gex : 0;
    grouped.set(row.strike, current);
  }
  return [...grouped.values()].sort((a, b) => a.strike - b.strike);
}

async function buildSavedFuturesBridgePayload(
  activeTicker: 'SPY' | 'QQQ',
  activeAnalytics: AnalyticsResponse | null,
  activeBasis: BasisData | null,
  targetDate: string,
  snapshotDate: string | null
) {
  let esSection = activeTicker === 'SPY'
    ? buildFuturesBridgeSection(activeTicker, activeAnalytics, activeBasis, targetDate)
    : '';
  let nqSection = activeTicker === 'QQQ'
    ? buildFuturesBridgeSection(activeTicker, activeAnalytics, activeBasis, targetDate)
    : '';

  const otherTicker = activeTicker === 'SPY' ? 'QQQ' : 'SPY';
  if (snapshotDate) {
    try {
      const otherSnapshot = await fetchHistoricalSnapshot(otherTicker, snapshotDate);
      const otherSection = buildFuturesBridgeSection(
        otherTicker,
        otherSnapshot.analytics,
        otherSnapshot.basis,
        targetDate
      );
      if (otherTicker === 'SPY') {
        esSection = otherSection;
      } else {
        nqSection = otherSection;
      }
    } catch {
      // Keep the active ticker section usable if the paired snapshot is missing.
    }
  }

  if (!esSection && !nqSection) return '';
  return `${esSection}|${nqSection}`;
}

function buildFuturesBridgeSection(
  ticker: 'SPY' | 'QQQ',
  analytics: AnalyticsResponse | null,
  basis: BasisData | null,
  targetDate: string | null
) {
  const byDte = analytics?.levels?.byDte ?? [];
  const sortedBuckets = byDte
    .filter((row) => normalizeDateString(row.expiry))
    .sort((a, b) => normalizeDateString(a.expiry).localeCompare(normalizeDateString(b.expiry)));
  const selectedBuckets = targetDate
    ? sortedBuckets
        .filter((row) => normalizeDateString(row.expiry) >= targetDate)
        .slice(0, 2)
    : [
        byDte.find((row) => row.dte === 0),
        byDte.find((row) => row.dte === 1),
      ];
  const d0 = selectedBuckets[0];
  const d1 = selectedBuckets[1];
  const targetExpiries = [d0?.expiry, d1?.expiry].map(normalizeDateString).filter(Boolean);
  const lambdaBands = deriveLambdaBands(analytics, targetExpiries) ?? analytics?.levels?.lambda?.bands;
  const vanna = withDerivedGreekLevels(analytics, analytics?.levels?.vanna, 'vex');
  const charm = withDerivedGreekLevels(analytics, analytics?.levels?.charm, 'chex');
  const speed = withDerivedGreekLevels(analytics, analytics?.levels?.speed, 'spex');
  const zomma = withDerivedGreekLevels(analytics, analytics?.levels?.zomma, 'zomex');
  const rawValues = [
    d0?.callWall,
    d0?.putWall,
    d0?.gammaFlip,
    d1?.callWall,
    d1?.putWall,
    d1?.gammaFlip,
    vanna?.flip,
    vanna?.callWall,
    vanna?.putWall,
    charm?.flip,
    charm?.callWall,
    charm?.putWall,
    lambdaBands?.up1,
    lambdaBands?.down1,
    lambdaBands?.up2,
    lambdaBands?.down2,
    speed?.flip,
    speed?.callWall,
    speed?.putWall,
    zomma?.flip,
    zomma?.callWall,
    zomma?.putWall,
  ];
  if (!rawValues.some((value) => typeof value === 'number' && value !== 0)) return '';
  const multiplier = ticker === 'QQQ' ? 40 : 10;

  const convert = (value: number | undefined) => {
    if (typeof value !== 'number' || value === 0) return '0';
    const futurePrice = basis?.future_price ?? 0;
    const etfPrice = basis?.etf_price ?? 0;
    const converted = futurePrice > 0 && etfPrice > 0
      ? value * (futurePrice / etfPrice)
      : (value * multiplier) + (basis?.basis ?? 0);
    const rounded = Math.round(converted * 4) / 4;
    return rounded.toFixed(2).replace(/\.?0+$/, '');
  };

  return rawValues.map(convert).join(',');
}

type BridgeGreekMetric = 'vex' | 'chex' | 'spex' | 'zomex';

function withDerivedGreekLevels(
  analytics: AnalyticsResponse | null,
  levels: { flip?: number; callWall?: number; putWall?: number } | undefined,
  metric: BridgeGreekMetric
) {
  const derived = deriveGreekLevelsFromStrikes(analytics, metric) ?? deriveGreekLevelsFromRaw(analytics, metric);
  const pick = (value: number | undefined, fallback: number | undefined) =>
    typeof value === 'number' && value !== 0 ? value : fallback;
  return {
    flip: pick(levels?.flip, derived?.flip),
    callWall: pick(levels?.callWall, derived?.callWall),
    putWall: pick(levels?.putWall, derived?.putWall),
  };
}

function deriveGreekLevelsFromRows(rows: Array<{ strike: number; value: number }>, spot: number) {
  const sortedRows = rows
    .filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.value) && row.value !== 0)
    .sort((a, b) => a.strike - b.strike);
  if (!sortedRows.length) return null;

  const upsideRows = spot > 0 ? sortedRows.filter((row) => row.strike >= spot) : sortedRows;
  const downsideRows = spot > 0 ? sortedRows.filter((row) => row.strike <= spot) : sortedRows;
  const callWall = [...(upsideRows.length ? upsideRows : sortedRows)]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const putWall = [...(downsideRows.length ? downsideRows : sortedRows)]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const crossings: number[] = [];
  for (let index = 1; index < sortedRows.length; index += 1) {
    const left = sortedRows[index - 1];
    const right = sortedRows[index];
    if (Math.sign(left.value) === Math.sign(right.value)) continue;
    const denominator = right.value - left.value;
    crossings.push(
      denominator === 0
        ? right.strike
        : left.strike + ((0 - left.value) * (right.strike - left.strike)) / denominator
    );
  }

  const flip = crossings.length
    ? (spot > 0 ? crossings.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0] : crossings[0])
    : undefined;

  return {
    flip,
    callWall: callWall?.strike,
    putWall: putWall?.strike,
  };
}

function deriveGreekLevelsFromStrikes(analytics: AnalyticsResponse | null, metric: BridgeGreekMetric) {
  const rows = (analytics?.strikes ?? [])
    .filter((row) => typeof row.strike === 'number' && typeof row[metric] === 'number')
    .map((row) => ({ strike: row.strike, value: row[metric] as number }))
  return deriveGreekLevelsFromRows(rows, analytics?.summary?.spotPrice ?? 0);
}

function deriveGreekLevelsFromRaw(analytics: AnalyticsResponse | null, metric: BridgeGreekMetric) {
  if (metric !== 'spex' && metric !== 'zomex') return null;
  const spot = analytics?.summary?.spotPrice ?? 0;
  const raw = analytics?.raw ?? [];
  if (spot <= 0 || !raw.length) return null;

  const byStrike = new Map<number, number>();
  for (const row of raw) {
    const strike = row.strike;
    const value = row[metric];
    if (!strike || typeof value !== 'number') continue;
    byStrike.set(strike, (byStrike.get(strike) ?? 0) + value);
  }

  return deriveGreekLevelsFromRows(
    [...byStrike.entries()].map(([strike, value]) => ({ strike, value })),
    spot
  );
}

function deriveLambdaBands(analytics: AnalyticsResponse | null, targetExpiries: string[] = []): { up1: number; down1: number; up2: number; down2: number } | null {
  const spot = analytics?.summary?.spotPrice ?? 0;
  const rows = analytics?.raw ?? [];
  if (!spot || !rows.length) return null;

  const referenceDate = normalizeDateString(analytics?.summary?.timestamp) || getTodayEtDate();
  const expirySet = new Set(targetExpiries);
  const weightedRows = rows.flatMap((row) => {
    const oi = row.openInterest ?? 0;
    const delta = row.delta ?? 0;
    const bid = Number((row as RawContract & { bid?: number }).bid ?? 0);
    const ask = Number((row as RawContract & { ask?: number }).ask ?? 0);
    const last = Number((row as RawContract & { lastPrice?: number }).lastPrice ?? 0);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
    const iv = Math.min(Math.max(row.iv ?? row.impliedVolatility ?? 0, 0.01), 3);
    const expiry = normalizeDateString(row.expiry);
    if (expirySet.size && !expirySet.has(expiry)) return [];
    if (!oi || mid < 0.05 || !expiry) return [];
    const optionLambda = Math.max(Math.min((delta * spot) / Math.max(mid, 0.05), 50), -50);
    const weight = Math.abs(oi * optionLambda * 100);
    const dte = Math.min(Math.max(daysBetween(referenceDate, expiry), 1), 30);
    return weight > 0 ? [{ weight, iv, dte }] : [];
  });

  const totalWeight = weightedRows.reduce((sum, row) => sum + row.weight, 0);
  if (!totalWeight) {
    // Thin OI for front expiries — retry with full chain.
    return targetExpiries.length ? deriveLambdaBands(analytics, []) : null;
  }
  const weightedIv = weightedRows.reduce((sum, row) => sum + row.iv * row.weight, 0) / totalWeight;
  const weightedDte = weightedRows.reduce((sum, row) => sum + row.dte * row.weight, 0) / totalWeight;
  const sigmaMove = spot * weightedIv * Math.sqrt(weightedDte / 252);
  return {
    up1: spot + sigmaMove,
    down1: spot - sigmaMove,
    up2: spot + 2 * sigmaMove,
    down2: spot - 2 * sigmaMove,
  };
}

function getBridgeTargetDate(selectedDate: string, eodTargetDate: string | null) {
  if (selectedDate === 'eod') return getNextTradingDate(eodTargetDate ?? getTodayEtDate());
  if (selectedDate === 'live') return null;
  return getNextTradingDate(selectedDate);
}

function getBridgeSnapshotDate(selectedDate: string, eodTargetDate: string | null, availableDates: string[]) {
  if (selectedDate === 'eod') return eodTargetDate;
  if (selectedDate === 'live') return availableDates[0] ?? eodTargetDate;
  return selectedDate;
}

function getTodayEtDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addCalendarDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// NYSE observed holidays (YYYY-MM-DD). Keep in sync with useMarketData.ts.
const NYSE_HOLIDAYS_SET = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01',
  '2025-11-27', '2025-12-25',
  // 2026 (Jul 4 falls Saturday → observed Fri Jul 3)
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
  '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26',
  '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
  '2027-11-25', '2027-12-24',
]);

function getNextTradingDate(dateString: string) {
  let next = addCalendarDays(dateString, 1) ?? getTodayEtDate();
  while (isWeekendDate(next)) {
    next = addCalendarDays(next, 1) ?? next;
  }
  return next;
}

function isWeekendDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6 || NYSE_HOLIDAYS_SET.has(dateString);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.round((end - start) / 86_400_000);
}

function normalizeDateString(dateString: string | undefined) {
  if (!dateString) return '';
  return dateString.slice(0, 10);
}

function calculateGammaFlipFromAgg(agg: Array<{ strike: number; gex: number }>) {
  if (!agg.length) return undefined;
  const signChanges = agg.findIndex((row, index) => index > 0 && Math.sign(row.gex) !== Math.sign(agg[index - 1].gex));
  if (signChanges <= 0) {
    return agg.reduce((closest, row) => Math.abs(row.gex) < Math.abs(closest.gex) ? row : closest, agg[0]).strike;
  }
  const left = agg[signChanges - 1];
  const right = agg[signChanges];
  if (right.gex === left.gex) return right.strike;
  return left.strike + (0 - left.gex) * (right.strike - left.strike) / (right.gex - left.gex);
}

function identifyWallsFromAgg(agg: Array<{ strike: number; gex: number }>) {
  if (!agg.length) return { callWall: undefined, putWall: undefined };
  const callWall = agg.reduce((best, row) => row.gex > best.gex ? row : best, agg[0]);
  const putWall = agg.reduce((best, row) => row.gex < best.gex ? row : best, agg[0]);
  return { callWall: callWall.strike, putWall: putWall.strike };
}

function buildAggressionFlags(expiryBuckets: ReturnType<typeof buildExpiryBuckets>) {
  return expiryBuckets
    .flatMap((bucket) => {
      const flags = [];
      const callVsPutVol = bucket.putVolume > 0 ? bucket.callVolume / bucket.putVolume : bucket.callVolume > 0 ? 9 : 1;
      const putVsCallVol = bucket.callVolume > 0 ? bucket.putVolume / bucket.callVolume : bucket.putVolume > 0 ? 9 : 1;

      if (callVsPutVol >= 1.8 && bucket.volumeVsOi >= 0.12) {
        flags.push({
          expiry: bucket.expiry,
          label: 'Call Sweep Watch',
          note: `Call-side flow is materially outpacing puts with ${callVsPutVol.toFixed(2)}x relative volume and elevated freshness versus OI.`,
        });
      }

      if (putVsCallVol >= 1.8 && bucket.volumeVsOi >= 0.12) {
        flags.push({
          expiry: bucket.expiry,
          label: 'Put Sweep Watch',
          note: `Put-side flow is materially outpacing calls with ${putVsCallVol.toFixed(2)}x relative volume and elevated freshness versus OI.`,
        });
      }

      return flags;
    })
    .slice(0, 6);
}

function buildTravelBands(
  analytics: AnalyticsResponse | null,
  expiryBuckets: ReturnType<typeof buildExpiryBuckets>
) {
  if (!analytics) return [];
  const spot = analytics.summary.spotPrice;
  const gammaSupportive = analytics.summary.totalNetGex >= 0;
  const nearTerm = expiryBuckets[0];

  const evaluate = (label: string, target: number | undefined, direction: 'up' | 'down') => {
    if (typeof target !== 'number') return null;
    const distance = Math.abs(target - spot);
    const distanceScore = Math.max(0, 1 - distance / Math.max(spot * 0.025, 1));
    const gammaAdjustment = gammaSupportive ? (direction === 'up' ? -0.1 : -0.1) : 0.12;
    const flowAdjustment = nearTerm ? Math.min(0.18, nearTerm.volumeVsOi * 0.6) : 0;
    const score = Math.max(0.05, Math.min(0.92, distanceScore + gammaAdjustment + flowAdjustment));
    const band = score >= 0.66 ? 'High' : score >= 0.38 ? 'Medium' : 'Low';
    return {
      label,
      target: formatCurrency(target),
      band,
      note: `${formatDistanceFromSpot(target, spot)} from spot. Heuristic reach score ${(score * 100).toFixed(0)} based on distance, gamma regime, and near-term flow freshness.`,
    };
  };

  return [
    evaluate('Travel To Call Wall', analytics.levels?.callWall, 'up'),
    evaluate('Travel To Put Wall', analytics.levels?.putWall, 'down'),
    evaluate('Travel To DEX Call Wall', analytics.levels?.dex?.callWall, 'up'),
    evaluate('Travel To DEX Put Wall', analytics.levels?.dex?.putWall, 'down'),
  ].filter((item): item is NonNullable<typeof item> => item != null);
}

function buildSessionChangeBadges(
  analytics: AnalyticsResponse | null,
  comparison: AnalyticsResponse | null
) {
  if (!analytics) return [];

  const buildDelta = (current: number | undefined, prior: number | undefined, formatter: (value: number | undefined) => string) => {
    if (typeof current !== 'number') return { current: '--', delta: 'No Data', tone: 'flat' as const };
    if (typeof prior !== 'number') return { current: formatter(current), delta: 'No Prior Ref', tone: 'flat' as const };
    const diff = current - prior;
    const sign = diff > 0 ? '+' : '';
    return {
      current: formatter(current),
      delta: `${sign}${formatter(diff)}`,
      tone: diff > 0 ? 'up' as const : diff < 0 ? 'down' as const : 'flat' as const,
    };
  };

  return [
    { label: 'Spot', ...buildDelta(analytics.summary.spotPrice, comparison?.summary.spotPrice, (value) => formatCurrency(value)) },
    { label: 'Net GEX', ...buildDelta(analytics.summary.totalNetGex, comparison?.summary.totalNetGex, (value) => formatCompactNumber(value)) },
    { label: 'Net DEX', ...buildDelta(analytics.summary.totalNetDex, comparison?.summary.totalNetDex, (value) => formatCompactNumber(value)) },
    { label: 'Gamma Flip', ...buildDelta(analytics.levels?.gammaFlip, comparison?.levels?.gammaFlip, (value) => formatCurrency(value)) },
    { label: 'DEX Flip', ...buildDelta(analytics.levels?.dex?.flip, comparison?.levels?.dex?.flip, (value) => formatCurrency(value)) },
  ];
}

function buildDexInventory(
  analytics: AnalyticsResponse | null,
  expiryBuckets: ReturnType<typeof buildExpiryBuckets>
) {
  if (!analytics) {
    return {
      callPutRatio: '--',
      frontBackRatio: '--',
      biasLabel: '--',
      biasNote: 'No DEX inventory available.',
      frontBucketLabel: '--',
      frontBucketNote: 'No front-expiry bucket available.',
    };
  }

  const callDex = sumDexByType(analytics.raw, 'call');
  const putDex = sumDexByType(analytics.raw, 'put');
  const frontDex = expiryBuckets.filter((bucket) => bucket.dte <= 7).reduce((sum, bucket) => sum + (bucket.dex ?? 0), 0);
  const backDex = expiryBuckets.filter((bucket) => bucket.dte > 7).reduce((sum, bucket) => sum + (bucket.dex ?? 0), 0);
  const leadBucket = expiryBuckets
    .filter((bucket) => typeof bucket.dex === 'number')
    .sort((a, b) => Math.abs((b.dex ?? 0)) - Math.abs((a.dex ?? 0)))[0];

  return {
    callPutRatio: Math.abs(putDex) > 0 ? `${(callDex / Math.abs(putDex)).toFixed(2)}x` : '--',
    frontBackRatio: Math.abs(backDex) > 0 ? `${(frontDex / Math.abs(backDex)).toFixed(2)}x` : '--',
    biasLabel: analytics.summary.totalNetDex >= 0 ? 'Upside Pressure' : 'Downside Pressure',
    biasNote: analytics.summary.totalNetDex >= 0
      ? 'Net directional inventory leans call-heavy, which can reinforce upside follow-through when gamma is not strongly suppressive.'
      : 'Net directional inventory leans put-heavy, which can reinforce downside follow-through when spot loses support.',
    frontBucketLabel: leadBucket ? `${leadBucket.dte} DTE` : '--',
    frontBucketNote: leadBucket
      ? `${leadBucket.expiry} carries ${formatCompactNumber(leadBucket.dex)} net DEX, with ${formatCompactNumber(leadBucket.callDex)} call DEX and ${formatCompactNumber(leadBucket.putDex)} put DEX.`
      : 'No concentrated DEX expiry bucket is currently visible.',
  };
}

function isThirdFriday(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21;
}

function buildEventMarkers(
  ticker: 'SPY' | 'QQQ',
  expiryBuckets: Array<{ expiry: string; dte: number; openInterest: number }>,
  macroEvents: MacroEvent[]
): DisplayEvent[] {
  const structural = expiryBuckets.slice(0, 5).flatMap((bucket) => {
    const markers: DisplayEvent[] = [];
    if (bucket.dte === 0) {
        markers.push({ date: bucket.expiry, label: '0DTE In Play', note: 'Same-day expiry is active, so hedging pressure can change quickly around spot.', impact: 'high', source: 'Structure' });
      }
      if (bucket.dte === 1) {
        markers.push({ date: bucket.expiry, label: '1DTE Roll', note: 'Tomorrow’s expiry can start pulling positioning forward, especially near major walls.', impact: 'medium', source: 'Structure' });
      }
      if (isThirdFriday(bucket.expiry)) {
        markers.push({ date: bucket.expiry, label: 'Monthly OPEX', note: 'Third-Friday monthly options expiration often concentrates dealer positioning and pinning behavior.', impact: 'high', source: 'Structure' });
      }
      return markers;
  });

  const positioningFocus = expiryBuckets[0]
    ? [{
        date: expiryBuckets[0].expiry,
        label: 'Largest Positioning Bucket',
        note: `The nearest heavy expiry for ${ticker} currently carries the most open interest in the loaded chain.`,
        impact: 'medium',
        source: 'Structure',
      }]
    : [];

  const custom = CUSTOM_MARKET_EVENTS
    .filter((event) => event.ticker == null || event.ticker === 'ALL' || event.ticker === ticker)
    .map((event) => ({
      date: event.date,
      label: event.label,
      note: `${event.type.toUpperCase()} marker from local config.`,
      impact: event.type === 'macro' ? 'high' : 'medium',
      source: 'Local Config',
    }));

  const officialMacro = macroEvents.map((event) => ({
    date: event.date,
    label: event.label,
    note: event.note,
    impact: event.impact,
    source: event.source,
    releaseTimeEt: event.releaseTimeEt,
    expected: event.expected,
    actual: event.actual,
    previous: event.previous,
  }));

  return [...structural, ...positioningFocus, ...officialMacro, ...custom]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
}
