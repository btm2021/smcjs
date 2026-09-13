// Shared helpers used across all indicators.
// Internally every indicator works on parallel typed/plain arrays extracted
// from the candle list, indexed exactly like the input candles array.

const f32 = Math.fround;

/** Normalize a candle's `time` field to milliseconds since epoch. */
function toMs(time) {
  if (time instanceof Date) return time.getTime();
  if (typeof time === "number") {
    // lightweight-charts / exchange APIs commonly use unix seconds
    return time < 1e12 ? time * 1000 : time;
  }
  if (typeof time === "string") {
    const ms = Date.parse(time);
    if (Number.isNaN(ms)) throw new TypeError(`Unparseable candle time: ${time}`);
    return ms;
  }
  throw new TypeError(`Unsupported candle time type: ${typeof time}`);
}

/**
 * Split an array of {time, open, high, low, close, volume} candles into
 * parallel plain-number arrays for fast index based access.
 */
function toColumns(candles) {
  const n = candles.length;
  const timeMs = new Array(n);
  const open = new Array(n);
  const high = new Array(n);
  const low = new Array(n);
  const close = new Array(n);
  const volume = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    timeMs[i] = toMs(c.time);
    open[i] = c.open;
    high[i] = c.high;
    low[i] = c.low;
    close[i] = c.close;
    volume[i] = c.volume ?? 0;
  }
  return { n, timeMs, open, high, low, close, volume };
}

/** Index of the first `true` in predicate(arr[i]) for i in [start, n). -1 if none. */
function firstIndexFrom(n, start, predicate) {
  for (let i = start; i < n; i++) {
    if (predicate(i)) return i;
  }
  return -1;
}

/** Round-trip a number through IEEE-754 single precision, mirroring numpy float32 arrays. */
function toF32(x) {
  return x === null || x === undefined || Number.isNaN(x) ? x : f32(x);
}

export { f32, toMs, toColumns, firstIndexFrom, toF32 };
