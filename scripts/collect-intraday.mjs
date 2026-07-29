#!/usr/bin/env node
/**
 * Records one intraday observation of option positioning.
 *
 * The application already refreshes the option chain on the quarter hour and
 * keys each snapshot by its own source time, so this script does not poll or
 * loop: it makes one pass and exits. Run it from a scheduler every fifteen
 * minutes during regular trading hours.
 *
 * The reason it exists is that dealer positioning cannot be downloaded after
 * the fact. A daily reading needs roughly three years to support an honest
 * walk-forward test; sampling at the rate the data actually arrives reaches
 * the same number of observations in months, on a horizon that matches how
 * hedging flows actually act — inside the session.
 *
 * Politeness rules observed here:
 *   - one pass per invocation, never an internal loop
 *   - nothing is requested outside regular trading hours or on weekends
 *   - requests issued one at a time with a pause between them
 *   - the upstream fetch is conditional and shared, so a pass that finds no
 *     new snapshot costs a cached read rather than a download
 *
 * Usage:  node scripts/collect-intraday.mjs [--base http://localhost:3000] [--force]
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = flag("base", process.env.GEXLAB_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const FORCE = args.includes("--force");
const GAP_MS = Number(flag("gap", "1500"));

// Index options only. The ETFs track the same exposure and would double the
// outbound requests for a correlated copy of the same signal.
const TARGETS = ["/api/options/NDX?updates=live", "/api/options/SPX?updates=live"];

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
    stamp: `${get("hour")}:${get("minute")}`,
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date),
  };
}

function shouldRun() {
  const { weekday, minutes } = easternParts();
  if (["Sat", "Sun"].includes(weekday)) {
    return { run: false, why: `${weekday} is not a trading day.` };
  }
  // The feed is delayed, so the first useful observation of the session is a
  // little after the open and the last one a little after the close.
  if (minutes < 9 * 60 + 45) {
    return { run: false, why: "The session has not opened yet." };
  }
  if (minutes > 16 * 60 + 15) {
    return { run: false, why: "The session has closed; the daily pass records the settled reading." };
  }
  return { run: true, why: "" };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { date, stamp } = easternParts();
  const gate = shouldRun();
  if (!gate.run && !FORCE) {
    console.log(`[${date} ${stamp}] skipped — ${gate.why} Pass --force to override.`);
    return 0;
  }

  let failures = 0;
  for (const [index, path] of TARGETS.entries()) {
    if (index > 0) await sleep(GAP_MS);
    try {
      // An explicit controller rather than AbortSignal.timeout: the timer
      // behind that helper can still be pending at exit, and tearing the
      // process down around it aborts on Windows.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      let body;
      let response;
      try {
        response = await fetch(`${BASE}${path}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        body = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        failures += 1;
        console.log(`  FAIL ${path} — ${response.status} ${body.error ?? ""}`.trimEnd());
        continue;
      }
      console.log(
        `  ok   ${path} — spot ${body.spot ?? "?"}, snapshot ${body.timestamp ?? "?"}` +
          `${body.stale ? " (stale)" : ""}`,
      );
    } catch (error) {
      failures += 1;
      console.log(`  FAIL ${path} — ${error.message}`);
    }
  }

  console.log(
    failures
      ? `[${date} ${stamp}] finished with ${failures} failure(s).`
      : `[${date} ${stamp}] recorded.`,
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
    console.error("intraday collector failed:", error.message);
    process.exitCode = 1;
  });
