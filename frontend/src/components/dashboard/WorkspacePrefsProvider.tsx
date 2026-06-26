'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import type { PriceMode } from '../../lib/pricing';

type Ticker = 'SPY' | 'QQQ';
type ThemeMode = 'light' | 'dark';

type WorkspacePrefsContextValue = {
  hydrated: boolean;
  ticker: Ticker;
  setTicker: (ticker: Ticker) => void;
  priceMode: PriceMode;
  setPriceMode: (mode: PriceMode) => void;
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode | ((current: ThemeMode) => ThemeMode)) => void;
  sessionMode: string;
  navOrder: string[];
  setNavOrder: (order: string[] | ((current: string[]) => string[])) => void;
};

const TICKER_STORAGE_KEY = 'gexlab:ticker';
const PRICE_MODE_STORAGE_KEY = 'gexlab:price-mode';
const SNAPSHOT_DATE_STORAGE_KEY = 'gexlab:snapshot-date';
const NAV_ORDER_STORAGE_KEY = 'gexlab:nav-order';
const DEFAULT_NAV_ORDER = ['/', '/levels', '/exposure', '/dex', '/volatility', '/chain', '/vega', '/charm', '/events', '/ledger', '/settings'] as const;

function normalizeNavOrder(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_NAV_ORDER];

  const valid = value.filter((entry): entry is string => typeof entry === 'string' && DEFAULT_NAV_ORDER.includes(entry as (typeof DEFAULT_NAV_ORDER)[number]));
  const unique = valid.filter((entry, index) => valid.indexOf(entry) === index);
  const missing = DEFAULT_NAV_ORDER.filter((entry) => !unique.includes(entry));
  return [...unique, ...missing];
}

const WorkspacePrefsContext = createContext<WorkspacePrefsContextValue | null>(null);

function getSessionMode(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: 'America/New_York',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes < 4 * 60) return 'Overnight Session';
  if (totalMinutes < 9 * 60 + 30) return 'Premarket';
  if (totalMinutes < 16 * 60) return 'Regular Hours';
  if (totalMinutes < 20 * 60) return 'After Hours';
  return 'Late Session';
}

export function WorkspacePrefsProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme: setNextTheme } = useTheme();
  const [hydrated, setHydrated] = useState(false);
  const [ticker, setTicker] = useState<Ticker>('SPY');
  const [priceMode, setPriceMode] = useState<PriceMode>('etf');
  const [selectedDate, setSelectedDate] = useState<string>('eod');
  const [sessionMode, setSessionMode] = useState('Market Session');
  const [navOrder, setNavOrder] = useState<string[]>([...DEFAULT_NAV_ORDER]);

  useEffect(() => {
    const storedTicker = window.localStorage.getItem(TICKER_STORAGE_KEY);
    const storedPriceMode = window.localStorage.getItem(PRICE_MODE_STORAGE_KEY);
    const storedSnapshotDate = window.localStorage.getItem(SNAPSHOT_DATE_STORAGE_KEY);
    const storedNavOrder = window.localStorage.getItem(NAV_ORDER_STORAGE_KEY);

    if (storedTicker === 'SPY' || storedTicker === 'QQQ') setTicker(storedTicker);
    if (storedPriceMode === 'etf' || storedPriceMode === 'futures') setPriceMode(storedPriceMode);
    if (storedSnapshotDate) setSelectedDate(storedSnapshotDate);
    if (storedNavOrder) {
      try {
        setNavOrder(normalizeNavOrder(JSON.parse(storedNavOrder)));
      } catch {
        setNavOrder([...DEFAULT_NAV_ORDER]);
      }
    }
    setSessionMode(getSessionMode());
    setHydrated(true);

    const timer = window.setInterval(() => {
      setSessionMode(getSessionMode());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TICKER_STORAGE_KEY, ticker);
  }, [hydrated, ticker]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PRICE_MODE_STORAGE_KEY, priceMode);
  }, [hydrated, priceMode]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SNAPSHOT_DATE_STORAGE_KEY, selectedDate);
  }, [hydrated, selectedDate]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(navOrder));
  }, [hydrated, navOrder]);

  const theme: ThemeMode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const setTheme = (value: ThemeMode | ((current: ThemeMode) => ThemeMode)) => {
    const nextTheme = typeof value === 'function' ? value(theme) : value;
    setNextTheme(nextTheme);
  };

  const value = useMemo(
    () => ({
      hydrated,
      ticker,
      setTicker,
      priceMode,
      setPriceMode,
      selectedDate,
      setSelectedDate,
      theme,
      setTheme,
      sessionMode,
      navOrder,
      setNavOrder,
    }),
    [hydrated, ticker, priceMode, selectedDate, theme, sessionMode, navOrder, setNextTheme]
  );

  return <WorkspacePrefsContext.Provider value={value}>{children}</WorkspacePrefsContext.Provider>;
}

export function useWorkspacePrefs() {
  const context = useContext(WorkspacePrefsContext);
  if (!context) {
    throw new Error('useWorkspacePrefs must be used within WorkspacePrefsProvider');
  }

  return context;
}
