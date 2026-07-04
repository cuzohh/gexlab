'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchAnalytics, fetchBasisMetrics, fetchHealth } from '../lib/api';
import type { AnalyticsResponse, BasisData, HealthResponse } from '../types/analytics';

type Ticker = 'SPY' | 'QQQ';
type DataStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

interface UseMarketDataResult {
  health: HealthResponse | null;
  analytics: AnalyticsResponse | null;
  basis: BasisData | null;
  error: string | null;
  status: DataStatus;
  lastUpdated: string | null;
  ageMs: number | null;
  pollingPaused: boolean;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 15000;
const STALE_AFTER_MS = 45000;
const AGE_TICK_MS = 5000;

// NYSE observed holidays (YYYY-MM-DD). Update annually.
const NYSE_HOLIDAYS = new Set([
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

function isNonTradingDay(): boolean {
  const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const dayOfWeek = new Date(`${etDate}T00:00:00`).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6 || NYSE_HOLIDAYS.has(etDate);
}

function getSessionMode(): string {
  if (isNonTradingDay()) return 'Market Closed';

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

export function useMarketData(ticker: Ticker): UseMarketDataResult {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [basis, setBasis] = useState<BasisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);
  // Ref so the ageTimer interval always reads the latest timestamp without
  // needing to re-register the interval on every analytics update.
  const lastUpdatedRef = useRef<string | null>(null);

  const lastUpdated = analytics?.summary?.timestamp ?? null;
  lastUpdatedRef.current = lastUpdated;

  const refresh = async () => {
    if (!mountedRef.current) return;

    const hasExistingData = Boolean(analytics);
    setStatus(hasExistingData ? 'stale' : 'loading');

    try {
      const [healthResult, analyticsData, basisMetrics] = await Promise.all([
        fetchHealth().catch(() => null),
        fetchAnalytics(ticker),
        fetchBasisMetrics(),
      ]);

      if (!mountedRef.current) return;

      if (healthResult) setHealth(healthResult);
      setAnalytics(analyticsData);
      setBasis(basisMetrics.basis?.[ticker] ?? null);
      hasDataRef.current = true;
      setError(null);
      setStatus('ready');
      setAgeMs(analyticsData.summary?.timestamp ? Date.now() - new Date(analyticsData.summary.timestamp).getTime() : null);
    } catch (err) {
      if (!mountedRef.current) return;

      const isNetworkError = err instanceof TypeError && err.message === 'Failed to fetch';
      const is503 = err instanceof ApiError && err.status === 503;

      if (isNetworkError || is503) {
        // Backend is still starting up — keep loading state, keep polling.
        if (!hasExistingData) setStatus('loading');
        return;
      }

      setError(err instanceof Error ? err.message : 'Unable to reach the analytics engine.');
      setStatus(hasExistingData ? 'stale' : 'error');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const mode = getSessionMode();
    const shouldPause = mode === 'Overnight Session' || mode === 'Market Closed';
    setPollingPaused(shouldPause);

    // Only go idle before 4am — no data worth showing yet.
    // On weekends/holidays keep loading EOD data from last session.
    if (mode === 'Overnight Session' && !analytics) {
      setStatus('idle');
    }

    const poll = window.setInterval(() => {
      const nextMode = getSessionMode();
      const nextPause = nextMode === 'Overnight Session' || nextMode === 'Market Closed';
      setPollingPaused(nextPause);
      if (!nextPause || !hasDataRef.current) {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    const ageTimer = window.setInterval(() => {
      if (!mountedRef.current) return;
      const ts = lastUpdatedRef.current;
      if (!ts) {
        setAgeMs(null);
        return;
      }

      const nextAge = Date.now() - new Date(ts).getTime();
      setAgeMs(nextAge);
      if (nextAge > STALE_AFTER_MS) {
        setStatus((current) => (current === 'ready' || current === 'loading' ? 'stale' : current));
      }
    }, AGE_TICK_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(poll);
      window.clearInterval(ageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  return {
    health,
    analytics,
    basis,
    error,
    status,
    lastUpdated,
    ageMs,
    pollingPaused,
    refresh,
  };
}
