import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredSnapshot<T> = {
  namespace: string;
  key: string;
  payload: T;
  sourceTime: string | null;
  fetchedAt: string;
  refreshAfter: string;
  methodologyVersion: string;
};

type DatabaseGlobal = typeof globalThis & {
  __gexlabDatabase?: DatabaseSync;
};

function database() {
  const shared = globalThis as DatabaseGlobal;
  if (shared.__gexlabDatabase) return shared.__gexlabDatabase;

  const dataDirectory =
    process.env.GEXLAB_DATA_DIR || path.join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, "gexlab.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS snapshots (
      namespace TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      checksum TEXT NOT NULL,
      source_time TEXT,
      fetched_at TEXT NOT NULL,
      refresh_after TEXT NOT NULL,
      methodology_version TEXT NOT NULL,
      PRIMARY KEY (namespace, cache_key)
    );

    CREATE TABLE IF NOT EXISTS snapshot_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      checksum TEXT NOT NULL,
      source_time TEXT,
      fetched_at TEXT NOT NULL,
      methodology_version TEXT NOT NULL,
      UNIQUE (namespace, cache_key, checksum, source_time)
    );

    CREATE INDEX IF NOT EXISTS snapshot_history_lookup
      ON snapshot_history(namespace, cache_key, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS macro_observations (
      series_id TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      value REAL NOT NULL,
      vintage_date TEXT NOT NULL,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      PRIMARY KEY (series_id, observation_date, vintage_date)
    );

    CREATE INDEX IF NOT EXISTS macro_observations_latest
      ON macro_observations(series_id, vintage_date DESC, observation_date);

    CREATE TABLE IF NOT EXISTS data_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    -- One row per (symbol, snapshot, expiry). This is the surface reduced to
    -- its shape summary, which is what the historical comparisons actually
    -- read. Retaining whole raw chains for the same purpose costs roughly ten
    -- megabytes per symbol per day.
    CREATE TABLE IF NOT EXISTS iv_surface_history (
      symbol TEXT NOT NULL,
      source_time TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      expiry TEXT NOT NULL,
      dte INTEGER NOT NULL,
      forward REAL NOT NULL,
      atm_iv REAL NOT NULL,
      put_iv_25 REAL,
      call_iv_25 REAL,
      risk_reversal_25 REAL,
      butterfly_25 REAL,
      retrieved_at TEXT NOT NULL,
      PRIMARY KEY (symbol, source_time, expiry)
    );

    CREATE INDEX IF NOT EXISTS iv_surface_history_lookup
      ON iv_surface_history(symbol, dte, observation_date DESC);

    -- Forecasts are written before the session they describe and scored
    -- afterwards from the same price series everything else uses. A model is
    -- only credible if its live record is kept where it cannot be edited after
    -- the fact.
    CREATE TABLE IF NOT EXISTS engine_predictions (
      target_date TEXT NOT NULL,
      target TEXT NOT NULL,
      probability REAL,
      expected_move REAL,
      model_version TEXT NOT NULL,
      predicted_at TEXT NOT NULL,
      PRIMARY KEY (target_date, target, model_version)
    );

    CREATE INDEX IF NOT EXISTS engine_predictions_lookup
      ON engine_predictions(target_date DESC);

    -- Positioning features cannot be reconstructed after the fact: no public
    -- archive carries yesterday's option chain. They are recorded one session
    -- at a time so a model can use them once enough sessions exist. Stored
    -- long rather than wide so a new feature does not require a migration.
    CREATE TABLE IF NOT EXISTS engine_feature_log (
      observation_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      feature TEXT NOT NULL,
      value REAL NOT NULL,
      source_time TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (observation_date, symbol, feature)
    );

    CREATE INDEX IF NOT EXISTS engine_feature_log_lookup
      ON engine_feature_log(symbol, feature, observation_date DESC);

    -- The same positioning features at every distinct snapshot time rather
    -- than once per session. Dealer hedging acts within the session, so this
    -- is both the better-matched sampling frequency and roughly twenty-six
    -- times faster to accumulate. Keyed by source time, so repeated requests
    -- inside one refresh window collapse to a single row.
    CREATE TABLE IF NOT EXISTS engine_intraday_log (
      source_time TEXT NOT NULL,
      symbol TEXT NOT NULL,
      feature TEXT NOT NULL,
      value REAL NOT NULL,
      observation_date TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (source_time, symbol, feature)
    );

    CREATE INDEX IF NOT EXISTS engine_intraday_log_lookup
      ON engine_intraday_log(symbol, feature, source_time DESC);
  `);
  const emptyCsvMigration = "macro-empty-csv-v2";
  db.exec("BEGIN IMMEDIATE");
  try {
    const claim = db
      .prepare(`
        INSERT OR IGNORE INTO data_migrations (migration_id, applied_at)
        VALUES (?, datetime('now'))
      `)
      .run(emptyCsvMigration);
    if (claim.changes === 1) {
      db.exec(`
        DELETE FROM macro_observations WHERE source = 'Economic release mirror';
        DELETE FROM snapshots WHERE namespace IN ('macro-series', 'macro-output');
        DELETE FROM snapshot_history WHERE namespace IN ('macro-series', 'macro-output');
      `);
    }
    // Rows recorded on the expiry's own settlement, back when the listing kept
    // an expiry until midnight rather than dropping it at settlement. The solve
    // divides by the square root of the remaining year fraction, so these came
    // back at 115%, 159%, 233% and 354% against a real 26-38%, and the
    // constant-days-to-expiry lookup was reading them as the prior session's
    // baseline. There is no way to recover a correct value after the fact — the
    // quotes they were solved from are gone — so they are deleted rather than
    // recomputed. Only same-day rows taken at or after 15:00 Eastern qualify:
    // a 0DTE reading from the morning has hours left and is comparable.
    const settledSurfaceMigration = "iv-surface-settled-rows-v1";
    const surfaceClaim = db
      .prepare(`
        INSERT OR IGNORE INTO data_migrations (migration_id, applied_at)
        VALUES (?, datetime('now'))
      `)
      .run(settledSurfaceMigration);
    if (surfaceClaim.changes === 1) {
      db.exec(`
        DELETE FROM iv_surface_history
        WHERE expiry <= observation_date
          AND time(source_time) >= '19:00:00';
      `);
      // Days to expiry used to be measured from the reading date rather than the
      // observation, so every row written from a stale snapshot was filed in a
      // bucket nearer than the chain it came from. Unlike the readings above
      // this is recoverable: the bucket is a pure function of two columns the
      // row already carries, so it is recomputed instead of dropped.
      db.exec(`
        UPDATE iv_surface_history
        SET dte = MAX(0, CAST(ROUND(julianday(expiry) - julianday(observation_date)) AS INTEGER))
        WHERE dte <> MAX(0, CAST(ROUND(julianday(expiry) - julianday(observation_date)) AS INTEGER));
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  shared.__gexlabDatabase = db;
  return db;
}

function checksum(payload: string) {
  return createHash("sha256").update(payload).digest("hex");
}

export function getSnapshot<T>(namespace: string, key: string): StoredSnapshot<T> | null {
  const row = database()
    .prepare(`
      SELECT namespace, cache_key, payload, source_time, fetched_at,
             refresh_after, methodology_version
      FROM snapshots
      WHERE namespace = ? AND cache_key = ?
    `)
    .get(namespace, key) as
    | {
        namespace: string;
        cache_key: string;
        payload: string;
        source_time: string | null;
        fetched_at: string;
        refresh_after: string;
        methodology_version: string;
      }
    | undefined;

  if (!row) return null;
  try {
    return {
      namespace: row.namespace,
      key: row.cache_key,
      payload: JSON.parse(row.payload) as T,
      sourceTime: row.source_time,
      fetchedAt: row.fetched_at,
      refreshAfter: row.refresh_after,
      methodologyVersion: row.methodology_version,
    };
  } catch {
    database()
      .prepare("DELETE FROM snapshots WHERE namespace = ? AND cache_key = ?")
      .run(namespace, key);
    return null;
  }
}

export function putSnapshot<T>(input: {
  namespace: string;
  key: string;
  payload: T;
  sourceTime?: string | null;
  fetchedAt?: string;
  refreshAfter: string;
  methodologyVersion: string;
}) {
  const payload = JSON.stringify(input.payload);
  const digest = checksum(payload);
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const sourceTime = input.sourceTime ?? null;
  const db = database();

  db.prepare(`
    INSERT OR IGNORE INTO snapshot_history (
      namespace, cache_key, payload, checksum, source_time, fetched_at, methodology_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.namespace,
    input.key,
    payload,
    digest,
    sourceTime,
    fetchedAt,
    input.methodologyVersion,
  );

  db.prepare(`
    INSERT INTO snapshots (
      namespace, cache_key, payload, checksum, source_time, fetched_at,
      refresh_after, methodology_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(namespace, cache_key) DO UPDATE SET
      payload = excluded.payload,
      checksum = excluded.checksum,
      source_time = excluded.source_time,
      fetched_at = excluded.fetched_at,
      refresh_after = excluded.refresh_after,
      methodology_version = excluded.methodology_version
  `).run(
    input.namespace,
    input.key,
    payload,
    digest,
    sourceTime,
    fetchedAt,
    input.refreshAfter,
    input.methodologyVersion,
  );
}

export function snapshotIsFresh(snapshot: StoredSnapshot<unknown>, now = Date.now()) {
  return Date.parse(snapshot.refreshAfter) > now;
}

function easternDayOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Bounds stored snapshot history, which nothing previously did.
 *
 * Two rules. Sessions older than `retainRecentDays` collapse to their final
 * revision, because a live session writes one every quarter hour and only the
 * last one of a settled day is ever read back — that is what the prior-session
 * walls are measured from. Then sessions beyond `retainSessions` are dropped
 * outright.
 *
 * The second rule is the one that matters for option chains. A single session
 * costs roughly 24MB across the four symbols, so retention rather than
 * deduplication is what keeps the file from growing without limit. The window
 * has to cover the previous session for the walls plus enough depth to
 * recompute derived tables if the methodology changes; past that the data is
 * unrecoverable in the sense that it can never be re-fetched, which is why the
 * window is generous rather than tight.
 *
 * Deleting rows does not shrink the file on its own, since SQLite reuses the
 * freed pages. `npm run prune:history` runs this and then VACUUMs.
 */
export function pruneSnapshotHistory(
  namespace: string,
  options: { retainRecentDays?: number; retainSessions?: number } = {},
) {
  const retainRecentDays = options.retainRecentDays ?? 2;
  const retainSessions = options.retainSessions ?? Number.POSITIVE_INFINITY;
  const rows = database()
    .prepare(`
      SELECT id, cache_key, source_time, fetched_at
      FROM snapshot_history
      WHERE namespace = ?
      ORDER BY id ASC
    `)
    .all(namespace) as Array<{
      id: number;
      cache_key: string;
      source_time: string | null;
      fetched_at: string;
    }>;
  if (rows.length < 2) return 0;

  const sessionOf = (row: (typeof rows)[number]) =>
    easternDayOf(row.source_time ?? row.fetched_at);
  const cutoff = easternDayOf(
    new Date(Date.now() - retainRecentDays * 86_400_000).toISOString(),
  );
  // Rows are ordered oldest first, so the last id seen for a session is that
  // session's final revision and the one worth keeping.
  // Sessions are ranked across the namespace rather than per key, so a cache
  // key left behind by an older naming scheme ages out with everything else
  // instead of surviving forever by virtue of having only one revision.
  const sessions = [...new Set(rows.map(sessionOf))].sort().reverse();
  const retained = new Set(
    Number.isFinite(retainSessions) ? sessions.slice(0, retainSessions) : sessions,
  );
  const survivor = new Map<string, number>();
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
  if (!doomed.length) return 0;

  const statement = database().prepare("DELETE FROM snapshot_history WHERE id = ?");
  for (const row of doomed) statement.run(row.id);
  return doomed.length;
}

export type SurfaceHistoryRow = {
  observationDate: string;
  sourceTime: string;
  expiry: string;
  dte: number;
  forward: number;
  atmIv: number;
  putIv25: number | null;
  callIv25: number | null;
  riskReversal25: number | null;
  butterfly25: number | null;
};

/**
 * Below this much time to settlement an at-the-money implied volatility stops
 * meaning anything. The solve divides by the square root of the year fraction,
 * so as that goes to zero any residual option value implies an unbounded vol.
 * Measured on the recorded snapshots: NDX printed 354% at the settlement instant
 * and 40% eight minutes before it, against 26% for the next day's expiry.
 *
 * Days to expiry cannot express this — a 0DTE slice at 10:00 has six hours left
 * and compares fine against the next session's 0DTE at 10:00. It is proximity to
 * settlement that breaks the solve, not the calendar. yearsToExpiry floors at an
 * hour and so cannot tell eight minutes from sixty, which is why the caller
 * measures the real remaining time.
 *
 * This table exists only to compare one session's surface shape against
 * another's, so a reading that cannot be compared does not belong in it. The
 * live response still carries the slice; it is only the history that refuses it.
 */
export const MINIMUM_COMPARABLE_SECONDS = 3600;

export function saveSurfaceHistory(
  symbol: string,
  sourceTime: string,
  observationDate: string,
  slices: Array<
    Omit<SurfaceHistoryRow, "observationDate" | "sourceTime"> & {
      /** Real time left, unfloored. Undefined means the caller could not tell. */
      secondsToSettlement?: number | null;
    }
  >,
) {
  if (!slices.length) return;
  const statement = database().prepare(`
    INSERT OR REPLACE INTO iv_surface_history (
      symbol, source_time, observation_date, expiry, dte, forward, atm_iv,
      put_iv_25, call_iv_25, risk_reversal_25, butterfly_25, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const retrievedAt = new Date().toISOString();
  for (const slice of slices) {
    if (!Number.isFinite(slice.atmIv) || !Number.isFinite(slice.forward)) continue;
    // An unknown remaining time is kept: that is missing evidence, not evidence
    // the reading is bad.
    const secondsLeft = slice.secondsToSettlement;
    if (typeof secondsLeft === "number" && secondsLeft < MINIMUM_COMPARABLE_SECONDS) continue;
    statement.run(
      symbol,
      sourceTime,
      observationDate,
      slice.expiry,
      slice.dte,
      slice.forward,
      slice.atmIv,
      slice.putIv25,
      slice.callIv25,
      slice.riskReversal25,
      slice.butterfly25,
      retrievedAt,
    );
  }
}

/**
 * Reads back the recorded surface shape. Expiry dates roll forward, so history
 * is most useful compared at a constant days-to-expiry rather than at a fixed
 * calendar date; callers pass the bucket they want.
 */
export function loadSurfaceHistory(
  symbol: string,
  options: { dte?: number; dteTolerance?: number; limit?: number } = {},
): SurfaceHistoryRow[] {
  const limit = options.limit ?? 400;
  const clauses = ["symbol = ?"];
  const params: Array<string | number> = [symbol];
  // Ordering by dte ascending returned the shortest-dated row within the
  // tolerance rather than the closest to the bucket asked for, so a request for
  // 1DTE was answered with a 0DTE row whenever one existed — the one reading
  // whose implied volatility is least trustworthy. Distance from the target,
  // then the shorter side to break a tie.
  let ordering = "ORDER BY observation_date DESC, dte ASC";
  if (options.dte !== undefined) {
    const tolerance = options.dteTolerance ?? 2;
    clauses.push("dte BETWEEN ? AND ?");
    params.push(options.dte - tolerance, options.dte + tolerance);
    ordering = `ORDER BY observation_date DESC, ABS(dte - ${Number(options.dte)}) ASC, dte ASC`;
  }
  const rows = database()
    .prepare(`
      SELECT observation_date, source_time, expiry, dte, forward, atm_iv,
             put_iv_25, call_iv_25, risk_reversal_25, butterfly_25
      FROM iv_surface_history
      WHERE ${clauses.join(" AND ")}
      ${ordering}
      LIMIT ?
    `)
    .all(...params, limit) as Array<{
      observation_date: string;
      source_time: string;
      expiry: string;
      dte: number;
      forward: number;
      atm_iv: number;
      put_iv_25: number | null;
      call_iv_25: number | null;
      risk_reversal_25: number | null;
      butterfly_25: number | null;
    }>;
  return rows.map((row) => ({
    observationDate: row.observation_date,
    sourceTime: row.source_time,
    expiry: row.expiry,
    dte: row.dte,
    forward: row.forward,
    atmIv: row.atm_iv,
    putIv25: row.put_iv_25,
    callIv25: row.call_iv_25,
    riskReversal25: row.risk_reversal_25,
    butterfly25: row.butterfly_25,
  }));
}

export type EnginePrediction = {
  targetDate: string;
  target: string;
  probability: number | null;
  expectedMove: number | null;
  modelVersion: string;
  predictedAt: string;
};

/**
 * Records a forecast for a session that has not happened yet. The primary key
 * makes the first write for a session the one that stands, so a later refresh
 * on the same day cannot quietly improve a prediction after the fact.
 */
export function saveEnginePrediction(prediction: EnginePrediction) {
  database()
    .prepare(`
      INSERT OR IGNORE INTO engine_predictions (
        target_date, target, probability, expected_move, model_version, predicted_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      prediction.targetDate,
      prediction.target,
      prediction.probability,
      prediction.expectedMove,
      prediction.modelVersion,
      prediction.predictedAt,
    );
}

export function loadEnginePredictions(limit = 120): EnginePrediction[] {
  const rows = database()
    .prepare(`
      SELECT target_date, target, probability, expected_move, model_version, predicted_at
      FROM engine_predictions
      ORDER BY target_date DESC, predicted_at DESC
    `)
    .all() as Array<{
      target_date: string;
      target: string;
      probability: number | null;
      expected_move: number | null;
      model_version: string;
      predicted_at: string;
    }>;

  const unique = new Map<string, EnginePrediction>();
  for (const row of rows) {
    const key = `${row.target_date}-${row.target}`;
    if (!unique.has(key)) {
      unique.set(key, {
        targetDate: row.target_date,
        target: row.target,
        probability: row.probability,
        expectedMove: row.expected_move,
        modelVersion: row.model_version,
        predictedAt: row.predicted_at,
      });
    }
    if (unique.size >= limit) break;
  }
  
  return [...unique.values()];
}

/**
 * Records one session's positioning features.
 *
 * The first write for a session wins. A later intraday refresh must not
 * overwrite the settled reading with a different one, because the whole point
 * of the log is that each row is what was observable at that session's close.
 */
export function saveEngineFeatures(
  observationDate: string,
  symbol: string,
  sourceTime: string,
  features: Record<string, number | null>,
) {
  const statement = database().prepare(`
    INSERT OR IGNORE INTO engine_feature_log (
      observation_date, symbol, feature, value, source_time, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const recordedAt = new Date().toISOString();
  let written = 0;
  for (const [feature, value] of Object.entries(features)) {
    if (value === null || !Number.isFinite(value)) continue;
    const result = statement.run(observationDate, symbol, feature, value, sourceTime, recordedAt);
    written += Number(result.changes);
  }
  return written;
}

/**
 * Records one intraday observation of the positioning features. Keyed by the
 * snapshot's own source time, so viewing the page repeatedly inside a refresh
 * window writes one row rather than many.
 */
export function saveIntradayFeatures(
  sourceTime: string,
  observationDate: string,
  symbol: string,
  features: Record<string, number | null>,
) {
  const statement = database().prepare(`
    INSERT OR IGNORE INTO engine_intraday_log (
      source_time, symbol, feature, value, observation_date, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const recordedAt = new Date().toISOString();
  let written = 0;
  for (const [feature, value] of Object.entries(features)) {
    if (value === null || !Number.isFinite(value)) continue;
    const result = statement.run(sourceTime, symbol, feature, value, observationDate, recordedAt);
    written += Number(result.changes);
  }
  return written;
}

export type IntradayObservation = {
  sourceTime: string;
  observationDate: string;
  values: Record<string, number>;
};

/**
 * Reads the intraday log back as one row per snapshot time with its features
 * grouped, which is the shape a labelling pass needs: consecutive rows give
 * both the features and the price path they are measured against.
 */
export function loadIntradayObservations(symbol: string, limit = 20000): IntradayObservation[] {
  const rows = database()
    .prepare(`
      SELECT source_time, observation_date, feature, value
      FROM engine_intraday_log
      WHERE symbol = ?
      ORDER BY source_time
      LIMIT ?
    `)
    .all(symbol, limit) as Array<{
      source_time: string;
      observation_date: string;
      feature: string;
      value: number;
    }>;
  const grouped = new Map<string, IntradayObservation>();
  for (const row of rows) {
    const entry = grouped.get(row.source_time) ?? {
      sourceTime: row.source_time,
      observationDate: row.observation_date,
      values: {},
    };
    entry.values[row.feature] = row.value;
    grouped.set(row.source_time, entry);
  }
  return [...grouped.values()];
}

export function loadIntradayCoverage() {
  const rows = database()
    .prepare(`
      SELECT symbol,
             COUNT(DISTINCT source_time) AS observations,
             COUNT(DISTINCT observation_date) AS sessions,
             MIN(observation_date) AS first_date,
             MAX(observation_date) AS last_date
      FROM engine_intraday_log
      GROUP BY symbol
      ORDER BY symbol
    `)
    .all() as Array<{
      symbol: string;
      observations: number;
      sessions: number;
      first_date: string | null;
      last_date: string | null;
    }>;
  return rows.map((row) => ({
    symbol: row.symbol,
    observations: row.observations,
    sessions: row.sessions,
    firstDate: row.first_date,
    lastDate: row.last_date,
  }));
}

export type EngineFeatureRow = { date: string; feature: string; value: number };

export function loadEngineFeatures(symbol: string, limit = 2000): EngineFeatureRow[] {
  const rows = database()
    .prepare(`
      SELECT observation_date, feature, value
      FROM engine_feature_log
      WHERE symbol = ?
      ORDER BY observation_date DESC
      LIMIT ?
    `)
    .all(symbol, limit) as Array<{ observation_date: string; feature: string; value: number }>;
  return rows.map((row) => ({ date: row.observation_date, feature: row.feature, value: row.value }));
}

export function loadEngineFeatureCoverage() {
  const rows = database()
    .prepare(`
      SELECT symbol,
             COUNT(DISTINCT observation_date) AS sessions,
             COUNT(DISTINCT feature) AS features,
             MIN(observation_date) AS first_date,
             MAX(observation_date) AS last_date
      FROM engine_feature_log
      GROUP BY symbol
      ORDER BY symbol
    `)
    .all() as Array<{
      symbol: string;
      sessions: number;
      features: number;
      first_date: string | null;
      last_date: string | null;
    }>;
  return rows.map((row) => ({
    symbol: row.symbol,
    sessions: row.sessions,
    features: row.features,
    firstDate: row.first_date,
    lastDate: row.last_date,
  }));
}

export type MacroObservation = { date: string; value: number };

export function saveMacroObservations(
  seriesId: string,
  observations: MacroObservation[],
  source: string,
  vintageDate = new Date().toISOString().slice(0, 10),
) {
  if (!observations.length) return;
  const db = database();
  const existingRows = db.prepare(`
    SELECT observation_date, value
    FROM macro_observations AS observation
    WHERE series_id = ?
      AND vintage_date = (
        SELECT MAX(vintage_date)
        FROM macro_observations
        WHERE series_id = observation.series_id
          AND observation_date = observation.observation_date
      )
  `).all(seriesId) as Array<{ observation_date: string; value: number }>;
  const existing = new Map(existingRows.map((row) => [row.observation_date, row.value]));
  const statement = db.prepare(`
    INSERT OR REPLACE INTO macro_observations (
      series_id, observation_date, value, vintage_date, source, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const retrievedAt = new Date().toISOString();
  for (const observation of observations) {
    if (!Number.isFinite(observation.value) || !/^\d{4}-\d{2}-\d{2}$/.test(observation.date)) continue;
    if (existing.get(observation.date) === observation.value) continue;
    statement.run(seriesId, observation.date, observation.value, vintageDate, source, retrievedAt);
  }
}

/**
 * Writes an as-published copy of a series. Unlike the live path this stores
 * every observation unconditionally: an older vintage legitimately disagrees
 * with what is already on file, and that disagreement is the point.
 */
export function saveVintageObservations(
  seriesId: string,
  observations: MacroObservation[],
  source: string,
  vintageDate: string,
) {
  if (!observations.length) return 0;
  const statement = database().prepare(`
    INSERT OR REPLACE INTO macro_observations (
      series_id, observation_date, value, vintage_date, source, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const retrievedAt = new Date().toISOString();
  let written = 0;
  for (const observation of observations) {
    if (!Number.isFinite(observation.value)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.date)) continue;
    statement.run(seriesId, observation.date, observation.value, vintageDate, source, retrievedAt);
    written += 1;
  }
  return written;
}

export type VintageRow = {
  seriesId: string;
  date: string;
  value: number;
  vintage: string;
};

/**
 * Reads every stored point-in-time observation for the given series from one
 * ingestion source. Rows are returned flat and grouped by the caller, because
 * the scoring pass needs them keyed by vintage rather than by date.
 */
export function loadVintageObservations(seriesIds: string[], source: string): VintageRow[] {
  if (!seriesIds.length) return [];
  const placeholders = seriesIds.map(() => "?").join(", ");
  const rows = database()
    .prepare(`
      SELECT series_id, observation_date, value, vintage_date
      FROM macro_observations
      WHERE source = ? AND series_id IN (${placeholders})
      ORDER BY series_id, vintage_date, observation_date
    `)
    .all(source, ...seriesIds) as Array<{
      series_id: string;
      observation_date: string;
      value: number;
      vintage_date: string;
    }>;
  return rows.map((row) => ({
    seriesId: row.series_id,
    date: row.observation_date,
    value: row.value,
    vintage: row.vintage_date,
  }));
}

export function loadLatestMacroObservations(
  seriesId: string,
  vintageDate = "9999-12-31",
): MacroObservation[] {
  const rows = database()
    .prepare(`
      SELECT observation_date, value
      FROM macro_observations AS observation
      WHERE series_id = ?
        AND vintage_date = (
          SELECT MAX(vintage_date)
          FROM macro_observations
          WHERE series_id = observation.series_id
            AND observation_date = observation.observation_date
            AND vintage_date <= ?
        )
      ORDER BY observation_date
    `)
    .all(seriesId, vintageDate) as Array<{ observation_date: string; value: number }>;
  return rows.map((row) => ({ date: row.observation_date, value: row.value }));
}
