// Bounds stored snapshot history and reclaims the freed pages.
//
// Nothing previously removed anything from snapshot_history except two macro
// namespaces, so it grew without limit. Option chains dominate it: one session
// costs roughly 24MB across the four symbols, which is about 120MB a week.
//
// Two rules per namespace. Settled sessions collapse to their final revision,
// since only the last one of a day is ever read back. Sessions past the
// retention window are dropped outright — that is the rule that actually bounds
// the file. Recent days are left whole because the current session is still
// being written and yesterday is what the prior-session walls are measured
// from.
//
//   npm run prune:history            prune, then VACUUM
//   npm run prune:history -- --dry   report what would go, change nothing

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { statSync } from "node:fs";

// Raw chains are the expensive ones and are only needed to recompute derived
// tables under a changed methodology; everything else is small enough that a
// long window costs nothing.
// About a month of trading. At ~24MB a session that settles around 470MB, which
// is the price of being able to recompute derived tables under a changed
// methodology. Drop it to 5 if only the prior-session walls matter; raise it if
// you expect to rebuild the engine's feature history from raw chains.
const RAW_SESSIONS = Number(process.env.GEXLAB_RAW_SESSIONS || 20);

const NAMESPACES = [
  { name: "options-raw", retainSessions: RAW_SESSIONS },
  { name: "macro-provider", retainSessions: 120 },
  { name: "macro-series", retainSessions: 120 },
  { name: "macro-output", retainSessions: 120 },
  { name: "events", retainSessions: 120 },
  { name: "engine-output", retainSessions: 120 },
];
const RETAIN_RECENT_DAYS = 2;

const dryRun = process.argv.includes("--dry");
const dataDirectory = process.env.GEXLAB_DATA_DIR || path.join(process.cwd(), "data");
const file = path.join(dataDirectory, "gexlab.sqlite");

function easternDayOf(iso) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function megabytes(bytes) {
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

const database = new DatabaseSync(file);
const before = statSync(file).size;
const cutoff = easternDayOf(new Date(Date.now() - RETAIN_RECENT_DAYS * 86_400_000).toISOString());
let removed = 0;
let reclaimed = 0;

for (const { name, retainSessions } of NAMESPACES) {
  const rows = database
    .prepare(`
      SELECT id, cache_key, source_time, fetched_at, LENGTH(payload) AS bytes
      FROM snapshot_history
      WHERE namespace = ?
      ORDER BY id ASC
    `)
    .all(name);
  if (rows.length < 2) continue;

  const sessionOf = (row) => easternDayOf(row.source_time ?? row.fetched_at);
  const sessions = [...new Set(rows.map(sessionOf))].sort().reverse();
  const retained = new Set(sessions.slice(0, retainSessions));
  const survivor = new Map();
  for (const row of rows) {
    const day = sessionOf(row);
    if (day >= cutoff) continue;
    survivor.set(`${row.cache_key} ${day}`, row.id);
  }
  const doomed = rows.filter((row) => {
    const day = sessionOf(row);
    if (day >= cutoff) return false;
    if (!retained.has(day)) return true;
    return survivor.get(`${row.cache_key} ${day}`) !== row.id;
  });

  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const perSession = total / Math.max(sessions.length, 1);
  const summary =
    `${name}: ${rows.length} revisions over ${sessions.length} sessions, ` +
    `${megabytes(total)} (${megabytes(perSession)}/session)`;
  if (!doomed.length) {
    console.log(`${summary} — within the ${retainSessions}-session window`);
    continue;
  }
  const bytes = doomed.reduce((sum, row) => sum + row.bytes, 0);
  console.log(`${summary} — removing ${doomed.length} ${doomed.length === 1 ? "revision" : "revisions"}, ${megabytes(bytes)}`);
  removed += doomed.length;
  reclaimed += bytes;
  if (!dryRun) {
    const statement = database.prepare("DELETE FROM snapshot_history WHERE id = ?");
    for (const row of doomed) statement.run(row.id);
  }
}

if (dryRun) {
  console.log(`\nDry run. ${removed} revisions holding ${megabytes(reclaimed)} would be removed.`);
} else if (removed) {
  console.log(`\nRemoved ${removed} revisions holding ${megabytes(reclaimed)}. Vacuuming...`);
  // Deleting alone only frees pages for reuse; VACUUM rewrites the file.
  database.exec("VACUUM");
  console.log(`Database ${megabytes(before)} -> ${megabytes(statSync(file).size)}`);
} else {
  console.log("\nNothing to remove.");
}

database.close();
