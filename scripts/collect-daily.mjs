#!/usr/bin/env node
/**
 * Records one end-of-day observation per trading session.
 *
 * The script drives the application's own endpoints rather than calling the
 * upstream providers directly. Everything it touches therefore keeps the
 * snapshot freshness checks, the request deduplication, and the conditional
 * requests that those routes already implement: if a snapshot is still fresh,
 * no upstream request is made at all.
 *
 * Politeness rules observed here:
 *   - one pass per trading day, never a polling loop
 *   - requests issued one at a time, with a pause between them, never a burst
 *   - nothing is requested on weekends or when the session has not settled
 *   - a failure ends the pass instead of retrying in a tight loop
 *
 * Usage:  node scripts/collect-daily.mjs [--base http://localhost:3000] [--force]
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = flag("base", process.env.GEXLAB_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const FORCE = args.includes("--force");
const GAP_MS = Number(flag("gap", "2000"));

/**
 * The tickers whose analyst estimates are tracked over time.
 *
 * A price target on its own is close to useless — it is anchored to the price
 * and revised slowly, so the gap widens by itself whenever a stock falls. The
 * revision is the signal, and a revision needs yesterday's reading to exist.
 * Each ticker costs one scrape a day and stores about a hundred bytes.
 *
 * Set GEXLAB_ESTIMATE_TICKERS to a comma-separated list to follow your own
 * positions instead of the default.
 */
const ESTIMATE_TICKERS = (process.env.GEXLAB_ESTIMATE_TICKERS || "NVDA,MSFT,AAPL,AMZN,META,GOOGL,TSLA")
  .split(",")
  .map((ticker) => ticker.trim().toUpperCase())
  .filter((ticker) => /^[A-Z]{1,5}$/.test(ticker));

const TARGETS = [
  "/api/options/SPX?updates=eod",
  "/api/options/SPY?updates=eod",
  "/api/options/NDX?updates=eod",
  "/api/options/QQQ?updates=eod",
  "/api/futures/ES",
  "/api/futures/NQ",
  "/api/macro",
  // Last, so the forecast is fitted after the day's option and macro
  // snapshots have settled. This pass is also what records the next
  // session's prediction before that session happens.
  "/api/engine",
  // One consensus read per followed ticker. These come after the market data
  // and before the engine so a slow scrape cannot delay the session's own
  // snapshots.
  ...ESTIMATE_TICKERS.map((ticker) => `/api/analyst/${ticker}`),
];

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date),
  };
}

function shouldRun() {
  const { weekday, minutes } = easternParts();
  if (["Sat", "Sun"].includes(weekday)) {
    return { run: false, why: `${weekday} is not a trading day.` };
  }
  // The delayed end-of-day snapshot is not final until well after the 16:00
  // close. Running before then would record a partial session.
  if (minutes < 17 * 60) {
    return { run: false, why: "The session has not settled yet; run after 17:00 Eastern." };
  }
  return { run: true, why: "" };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { date } = easternParts();
  const gate = shouldRun();
  if (!gate.run && !FORCE) {
    console.log(`[${date}] skipped — ${gate.why} Pass --force to override.`);
    return 0;
  }

  console.log(`[${date}] collecting ${TARGETS.length} endpoints from ${BASE}`);
  let failures = 0;

  for (const [index, path] of TARGETS.entries()) {
    if (index > 0) await sleep(GAP_MS);
    const started = Date.now();
    try {
      // An explicit controller rather than AbortSignal.timeout: the timer
      // behind that helper can still be pending when the process exits, and
      // tearing down around it aborts on Windows with a libuv assertion.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      let response;
      let body;
      try {
        response = await fetch(`${BASE}${path}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        body = await response.json();
      } finally {
        clearTimeout(timer);
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (!response.ok) {
        failures += 1;
        console.log(`  FAIL ${path} — ${response.status} ${body.error ?? ""}`.trimEnd());
        continue;
      }
      const detail = body.surface
        ? `${body.surface.length} smiles, snapshot ${body.timestamp ?? "?"}${body.stale ? " (stale)" : ""}`
        : body.availability
          ? `regime ${body.regime?.name ?? "?"}, skew ${body.availability.positioningSkew?.sessions ?? 0} sessions`
          : "ok";
      console.log(`  ok   ${path} — ${detail} [${elapsed}s]`);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL ${path} — ${error.message}`);
    }
  }

  console.log(
    failures
      ? `[${date}] finished with ${failures} failure(s).`
      : `[${date}] finished cleanly.`,
  );
  return failures ? 1 : 0;
}

// The exit code is set rather than forced, so the event loop drains on its own
// instead of being torn down while a socket or timer is still closing.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("collector failed:", error.message);
    process.exitCode = 1;
  });
