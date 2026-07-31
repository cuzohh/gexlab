/**
 * Large option trades, from end-of-day chains.
 *
 * This is not order flow. Detecting an iceberg means watching a resting order
 * refresh after each fill, which needs tick-level prints and book depth that no
 * account-free source publishes. What a daily chain does support is the thing
 * an iceberg is usually a means to: someone building or unwinding real size.
 * Volume says how much traded, the change in open interest says how much of it
 * stayed on, and the two together separate a position from a day trade.
 *
 * The alignment matters more than the arithmetic. Open interest in these
 * snapshots lags the session by one: the change between two consecutive
 * snapshots is produced by the volume reported in the *earlier* one. Measured
 * across the stored NDX chains, pairing it that way leaves 0.2% of contracts
 * showing an impossible change — open interest growing by more than the
 * contracts traded — against 7.6% when paired the intuitive way. So a session's
 * volume is matched to the open-interest change that arrives the following day,
 * which means intent is knowable one session in arrears while size is knowable
 * immediately. Both are reported, and which is which is stated.
 *
 * The residual 0.2% is exercise, assignment and exchange corrections, none of
 * which pass through volume. Those contracts are marked rather than dropped.
 */

export type ChainContract = {
  /** The full OCC symbol, which is what pairs a contract across sessions. */
  contract: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  openInterest: number;
  volume: number;
  bid: number;
  ask: number;
  last: number;
};

export type FlowIntent =
  /** Open interest rose by most of what traded: size went on. */
  | "opened"
  /** Open interest fell by most of what traded: size came off. */
  | "closed"
  /** Traded heavily and left little behind — turned over intraday. */
  | "churned"
  /** The next session's open interest is not in yet. */
  | "pending"
  /** Expired in the session that traded it, so no later reading can resolve it. */
  | "expired"
  /** Open interest moved by more than traded: exercise, assignment or a correction. */
  | "unexplained";

export type FlowRow = {
  contract: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  volume: number;
  /** Open interest as it stood before the session traded. */
  priorOpenInterest: number;
  /** Net position change the session produced, once it is known. */
  openInterestChange: number | null;
  intent: FlowIntent;
  /** Volume against the open interest that already existed. */
  turnover: number | null;
  /** Contracts times 100 times the mid, or the last trade when unquoted. */
  notional: number | null;
  /** The part of that premium that is not already intrinsic value. */
  extrinsicNotional: number | null;
  /** Distance from spot, in percent, signed. */
  moneyness: number;
};

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * Per-contract price. The mid is preferred; a crossed or absent quote falls back
 * to the last trade, and a contract with neither is left without a notional
 * rather than being assigned a made-up one.
 */
function contractPrice(row: ChainContract) {
  const mid = row.bid > 0 && row.ask > 0 && row.ask >= row.bid ? (row.bid + row.ask) / 2 : null;
  const price = mid ?? (row.last > 0 ? row.last : null);
  return price;
}

function classify(volume: number, change: number | null, expired: boolean): FlowIntent {
  // A contract that expired in the session that traded it has no later open
  // interest to be resolved against, ever. Calling that "pending" would promise
  // an answer that is never coming.
  if (change === null) return expired ? "expired" : "pending";
  if (Math.abs(change) > volume) return "unexplained";
  // Half of what traded staying on is enough to call it a position: the other
  // side of a large print is frequently a market maker who hedges it away
  // within the session, so demanding a one-to-one match would reject most real
  // size.
  if (change >= volume * 0.5) return "opened";
  if (-change >= volume * 0.5) return "closed";
  return "churned";
}

export type FlowOptions = {
  spot: number;
  /** The session being ranked, used to tell an expired contract from a pending one. */
  sessionDate?: string;
  /** Ignore anything smaller; the tail of a chain is thousands of one-lots. */
  minimumVolume?: number;
  /** Ignore anything worth less than this in premium at risk. */
  minimumNotional?: number;
  limit?: number;
};

/**
 * The part of a contract's price that is not already intrinsic.
 *
 * Ranking on total premium buries the book under deep in-the-money contracts,
 * whose price is mostly the difference between strike and spot rather than
 * anything anyone is betting on: 365 lots of a 30,000 put against a 27,192 spot
 * prices at $112m and says almost nothing. Extrinsic value is the capital
 * actually placed on an opinion, so that is what the ranking uses. Total premium
 * is kept on the row, because for a roll or a hedge the gross figure is the
 * relevant one.
 */
function extrinsicValue(row: ChainContract, price: number, spot: number) {
  const intrinsic =
    row.type === "call" ? Math.max(0, spot - row.strike) : Math.max(0, row.strike - spot);
  return Math.max(0, price - intrinsic);
}

/**
 * Ranks a session's chain by the size that actually traded.
 *
 * `next` is the following session's chain, which carries the open interest that
 * resolves intent. Pass null for the most recent session: everything still
 * reports, with intent "pending", because size is worth seeing on the day and
 * waiting for confirmation would make the panel a day late for no gain.
 */
export function sessionFlow(
  session: ChainContract[],
  next: ChainContract[] | null,
  options: FlowOptions,
): FlowRow[] {
  const { spot } = options;
  const sessionDate = options.sessionDate ?? null;
  const minimumVolume = options.minimumVolume ?? 250;
  const minimumNotional = options.minimumNotional ?? 100_000;
  const limit = options.limit ?? 40;
  const following = new Map((next ?? []).map((row) => [row.contract, row]));

  const rows: FlowRow[] = [];
  for (const row of session) {
    if (row.volume < minimumVolume) continue;
    const price = contractPrice(row);
    const notional = price === null ? null : price * row.volume * 100;
    const extrinsicNotional =
      price === null ? null : extrinsicValue(row, price, spot) * row.volume * 100;
    if (extrinsicNotional !== null && extrinsicNotional < minimumNotional) continue;
    // Without a price there is no size test, so an unpriced contract is only
    // kept when its volume alone is emphatic.
    if (notional === null && row.volume < minimumVolume * 4) continue;
    const after = following.get(row.contract);
    const change = after ? after.openInterest - row.openInterest : null;
    rows.push({
      contract: row.contract,
      expiry: row.expiry,
      strike: row.strike,
      type: row.type,
      volume: row.volume,
      priorOpenInterest: row.openInterest,
      openInterestChange: change,
      intent: classify(row.volume, change, sessionDate !== null && row.expiry <= sessionDate),
      turnover: row.openInterest > 0 ? round(row.volume / row.openInterest) : null,
      notional: notional === null ? null : Math.round(notional),
      extrinsicNotional: extrinsicNotional === null ? null : Math.round(extrinsicNotional),
      moneyness: spot > 0 ? round(((row.strike - spot) / spot) * 100) : 0,
    });
  }

  // Premium at risk is the honest ranking. Contract count would put a thousand
  // far out-of-the-money lots worth a few thousand dollars above a hundred
  // at-the-money contracts worth a million; gross premium goes the other way and
  // fills the list with deep in-the-money strikes whose price is mostly
  // intrinsic.
  rows.sort((left, right) => (right.extrinsicNotional ?? 0) - (left.extrinsicNotional ?? 0));
  return rows.slice(0, limit);
}

export type FlowSummary = {
  contracts: number;
  callNotional: number;
  putNotional: number;
  openedNotional: number;
  closedNotional: number;
  /** Share of ranked premium in calls, or null when nothing is priced. */
  callShare: number | null;
  resolved: boolean;
};

/**
 * What the ranked flow adds up to.
 *
 * Call and put premium are kept apart rather than netted. A day of heavy buying
 * on both sides is a different thing from a quiet one, and a single net number
 * cannot tell them apart.
 */
export function summariseFlow(rows: FlowRow[]): FlowSummary {
  let callNotional = 0;
  let putNotional = 0;
  let openedNotional = 0;
  let closedNotional = 0;
  for (const row of rows) {
    // Summed on premium at risk, to match what the ranking is built on.
    const notional = row.extrinsicNotional ?? 0;
    if (row.type === "call") callNotional += notional;
    else putNotional += notional;
    if (row.intent === "opened") openedNotional += notional;
    if (row.intent === "closed") closedNotional += notional;
  }
  const total = callNotional + putNotional;
  return {
    contracts: rows.length,
    callNotional,
    putNotional,
    openedNotional,
    closedNotional,
    callShare: total > 0 ? round(callNotional / total, 4) : null,
    resolved: rows.some((row) => row.intent !== "pending"),
  };
}
