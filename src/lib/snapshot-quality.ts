export type SnapshotQualityTone = "good" | "caution" | "stress" | "neutral";

export type SnapshotQuality = {
  tone: SnapshotQualityTone;
  label: "Checking" | "Loaded" | "Fresh" | "Delayed" | "Saved" | "Incomplete" | "Unavailable";
  detail: string;
};

type SnapshotQualityInput = {
  state: "loading" | "ready" | "error";
  stale?: boolean;
  timestamp?: string | null;
  updateMode?: "eod" | "live";
  contractCount?: number;
  strikeCount?: number;
  expiryCount?: number;
  now?: number;
};

export function assessSnapshotQuality({
  state,
  stale = false,
  timestamp = null,
  updateMode = "eod",
  contractCount = 0,
  strikeCount = 0,
  expiryCount = 0,
  now = Date.now(),
}: SnapshotQualityInput): SnapshotQuality {
  const coverage = `${contractCount.toLocaleString()} contracts · ${expiryCount} expiries`;
  if (state === "loading") return { tone: "neutral", label: "Checking", detail: "Checking the latest snapshot" };
  if (state === "error") return { tone: "stress", label: "Unavailable", detail: "The market-data request failed" };
  if (contractCount <= 0 || strikeCount <= 0 || expiryCount <= 0) {
    return { tone: "stress", label: "Incomplete", detail: `No usable option structure · ${coverage}` };
  }
  if (stale) {
    return { tone: "caution", label: "Saved", detail: `Using the last stored snapshot · ${coverage}` };
  }

  if (updateMode === "live") {
    const observed = timestamp ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(observed)) {
      return { tone: "caution", label: "Delayed", detail: `Snapshot age is unknown · ${coverage}` };
    }
    const ageMinutes = Math.max(0, (now - observed) / 60_000);
    if (ageMinutes > 30) {
      return {
        tone: "caution",
        label: "Delayed",
        detail: `Observed ${Math.round(ageMinutes)} minutes ago · ${coverage}`,
      };
    }
    return { tone: "good", label: "Fresh", detail: `Observed ${Math.max(0, Math.round(ageMinutes))} minutes ago · ${coverage}` };
  }

  return { tone: "good", label: "Loaded", detail: `Completed snapshot · ${coverage}` };
}
