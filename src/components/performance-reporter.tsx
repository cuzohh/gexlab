"use client";

import { useEffect } from "react";

/**
 * Development-only Web Vitals signal. It has no production network activity
 * and gives us real page metrics before making further bundle decisions.
 */
export function PerformanceReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !("PerformanceObserver" in window)) return;
    const report = (entry: PerformanceEntry) => {
      const value = "value" in entry ? (entry as PerformanceEntry & { value: number }).value : entry.duration;
      console.info(`[GEXLab performance] ${entry.entryType}: ${value.toFixed(2)}ms`, entry);
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) report(entry);
    });
    for (const type of ["largest-contentful-paint", "layout-shift", "event"] as const) {
      try {
        observer.observe({ type, buffered: true });
      } catch {
        // Entry support varies by browser. The app must not depend on metrics.
      }
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
