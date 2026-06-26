'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchAnalytics, fetchHealth, fetchRawMetrics } from '../lib/api';
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

export function useMarketData(ticker: Ticker): UseMarketDataResult {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [basis, setBasis] = useState<BasisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const mountedRef = useRef(true);

  const lastUpdated = analytics?.summary?.timestamp ?? null;

  const refresh = async () => {
    if (!mountedRef.current) return;

    const hasExistingData = Boolean(analytics);
    setStatus(hasExistingData ? 'stale' : 'loading');

    try {
      const [healthData, analyticsData, rawMetrics] = await Promise.all([
        fetchHealth(),
        fetchAnalytics(ticker),
        fetchRawMetrics(),
      ]);

      if (!mountedRef.current) return;

      setHealth(healthData);
      setAnalytics(analyticsData);
      setBasis(rawMetrics.basis?.[ticker] ?? null);
      setError(null);
      setStatus('ready');
      setAgeMs(analyticsData.summary?.timestamp ? Date.now() - new Date(analyticsData.summary.timestamp).getTime() : null);
    } catch (err) {
      if (!mountedRef.current) return;

      if (err instanceof ApiError && err.status === 503) {
        setStatus('loading');
        return;
      }

      setError(err instanceof Error ? err.message : 'Unable to reach the analytics engine.');
      setStatus(hasExistingData ? 'stale' : 'error');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const shouldPause = getSessionMode() === 'Overnight Session';
    setPollingPaused(shouldPause);

    if (shouldPause && !analytics) {
      setStatus('idle');
    }

    const poll = window.setInterval(() => {
      const nextPause = getSessionMode() === 'Overnight Session';
      setPollingPaused(nextPause);
      if (!nextPause) {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    const ageTimer = window.setInterval(() => {
      if (!mountedRef.current) return;
      if (!lastUpdated) {
        setAgeMs(null);
        return;
      }

      const nextAge = Date.now() - new Date(lastUpdated).getTime();
      setAgeMs(nextAge);
      if (nextAge > STALE_AFTER_MS) {
        setStatus((current) => (current === 'ready' ? 'stale' : current));
      }
    }, 1000);

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
