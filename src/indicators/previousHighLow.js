import { toColumns, toMs, toF32 } from "../utils.js";

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const EPOCH_SUNDAY_MS = Date.UTC(1970, 0, 4); // 1970-01-04 was a Sunday

function parseTimeFrame(tf) {
  const m = /^(\d+)\s*(m|H|h|D|d|W|w|M)$/.exec(tf.trim());
  if (!m) throw new Error(`Unsupported timeFrame "${tf}". Use e.g. "15m", "1H", "4H", "1D", "1W", "1M".`);
  const count = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "m") return { kind: "fixed", ms: count * MIN_MS, labelSide: "left" };
  if (unit === "H" || unit === "h") return { kind: "fixed", ms: count * HOUR_MS, labelSide: "left" };
  if (unit === "D" || unit === "d") return { kind: "fixed", ms: count * DAY_MS, labelSide: "left" };
  if (unit === "W" || unit === "w") return { kind: "week", count, labelSide: "right" };
  if (unit === "M") return { kind: "month", count, labelSide: "right" };
  throw new Error(`Unsupported timeFrame unit in "${tf}"`);
}

function lastDayOfMonthMs(year, monthIndex) {
  // Date.UTC day=0 means "the day before day 1", i.e. the last day of the previous month.
  return Date.UTC(year, monthIndex + 1, 0);
}

/**
 * Start-of-bucket timestamp (ms) that candle time `ms` belongs to.
 *
 * For "week"/"month" the grid is deliberately aligned to match pandas'
 * anchored-offset bin edges exactly (Sunday instants for 'W-SUN', calendar
 * month-end instants for 'M') so that `bucketStart(k+1)` can be used
 * directly as that resample's index label - see previousHighLow() docs.
 */
function bucketStart(ms, tf) {
  if (tf.kind === "fixed") {
    return Math.floor(ms / tf.ms) * tf.ms;
  }
  if (tf.kind === "week") {
    const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
    const dow = new Date(dayStart).getUTCDay(); // 0=Sun..6=Sat
    const sunday = dayStart - dow * DAY_MS;
    if (tf.count === 1) return sunday;
    const weeks = Math.floor((sunday - EPOCH_SUNDAY_MS) / (7 * DAY_MS));
    const bucketWeeks = Math.floor(weeks / tf.count) * tf.count;
    return EPOCH_SUNDAY_MS + bucketWeeks * 7 * DAY_MS;
  }
  if (tf.kind === "month") {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const thisMonthEnd = lastDayOfMonthMs(y, mo);
    // If ms is already on-or-after this month's own last calendar day, it
    // belongs to the bucket that starts there (mirrors the week case).
    const anchorTotalMonths = ms < thisMonthEnd ? y * 12 + mo - 1 : y * 12 + mo;
    if (tf.count === 1) return lastDayOfMonthMs(Math.floor(anchorTotalMonths / 12), anchorTotalMonths % 12);
    const totalMonths = anchorTotalMonths;
    const bucketMonths = Math.floor(totalMonths / tf.count) * tf.count;
    return lastDayOfMonthMs(Math.floor(bucketMonths / 12), bucketMonths % 12);
  }
  throw new Error("unreachable");
}

/**
 * Previous High/Low.
 * Reports the high/low of the previous completed `timeFrame` bucket relative
 * to each candle, and latches Broken flags once price trades through it.
 *
 * @param {Array} candles
 * @param {{timeFrame?: string}} options
 */
export function previousHighLow(candles, { timeFrame = "1D" } = {}) {
  const { n, high, low } = toColumns(candles);
  const tf = parseTimeFrame(timeFrame);

  // Pass 1: assign each candle a (local, sequential) bucket index and
  // aggregate bucket high/low. Buckets with zero candles never get created,
  // mirroring pandas' resample(...).dropna().
  const bucketOf = new Array(n);
  const isAtBoundary = new Array(n).fill(false);
  const bucketHighs = [];
  const bucketLows = [];
  const bucketStarts = [];

  let curStart = null;
  for (let i = 0; i < n; i++) {
    const ms = toMs(candles[i].time);
    const start = bucketStart(ms, tf);
    if (curStart === null || start !== curStart) {
      curStart = start;
      bucketStarts.push(start);
      bucketHighs.push(-Infinity);
      bucketLows.push(Infinity);
    }
    isAtBoundary[i] = ms === start;
    const b = bucketStarts.length - 1;
    bucketOf[i] = b;
    if (high[i] > bucketHighs[b]) bucketHighs[b] = high[i];
    if (low[i] < bucketLows[b]) bucketLows[b] = low[i];
  }

  if (bucketStarts.length < 2) {
    const result = new Array(n);
    for (let i = 0; i < n; i++) result[i] = { previousHigh: null, previousLow: null, brokenHigh: 0, brokenLow: 0 };
    return result;
  }

  const previousHigh = new Array(n).fill(null);
  const previousLow = new Array(n).fill(null);
  const brokenHigh = new Array(n).fill(0);
  const brokenLow = new Array(n).fill(0);

  // Pass 2: replicate pandas' searchsorted-derived "periods_before" (whose
  // formula depends on whether the resample label is the bucket's own start
  // - fixed/day frequencies - or its end - week/month) and the
  // per-reference-group running max/min used to latch Broken flags.
  let prevRefIdx = null;
  let runHigh = -Infinity;
  let runLow = Infinity;

  for (let i = 0; i < n; i++) {
    const kOwn = bucketOf[i];
    const periodsBefore = tf.labelSide === "left" ? (isAtBoundary[i] ? kOwn : kOwn + 1) : isAtBoundary[i] ? kOwn - 1 : kOwn;
    const refIdx = periodsBefore - 2;
    const valid = periodsBefore > 1;

    if (refIdx !== prevRefIdx) {
      prevRefIdx = refIdx;
      runHigh = high[i];
      runLow = low[i];
    } else {
      if (high[i] > runHigh) runHigh = high[i];
      if (low[i] < runLow) runLow = low[i];
    }

    if (valid) {
      const ph = toF32(bucketHighs[refIdx]);
      const pl = toF32(bucketLows[refIdx]);
      previousHigh[i] = ph;
      previousLow[i] = pl;
      brokenHigh[i] = runHigh > ph ? 1 : 0;
      brokenLow[i] = runLow < pl ? 1 : 0;
    }
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = {
      previousHigh: previousHigh[i],
      previousLow: previousLow[i],
      brokenHigh: brokenHigh[i],
      brokenLow: brokenLow[i],
    };
  }
  return result;
}
