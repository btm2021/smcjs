import { toColumns } from "../utils.js";

/**
 * Swing Highs and Lows.
 * A swing high is a candle whose high is the highest in a window spanning
 * `swingLength` candles before it (inclusive) and `swingLength` candles after it.
 *
 * @param {Array} candles - {open,high,low,close,volume,time}[]
 * @param {{swingLength?: number}} options
 * @returns {Array<{highLow: 1|-1|null, level: number|null}>}
 */
export function swingHighsLows(candles, { swingLength = 50 } = {}) {
  const { n, high, low } = toColumns(candles);
  const SL = swingLength;
  const L = SL * 2;

  // highLow[i]: 1 swing high, -1 swing low, null = none.
  const highLow = new Array(n).fill(null);

  // Valid detection range mirrors pandas: shift(-SL) then rolling(L) with
  // default min_periods=L, i.e. i must have L samples of history AND the
  // shifted lookahead must not fall past the end of the series.
  const start = L - 1;
  const end = n - 1 - SL;

  for (let i = start; i <= end; i++) {
    const loStart = i - SL + 1;
    const hiEnd = i + SL;
    let windowHighMax = -Infinity;
    let windowLowMin = Infinity;
    for (let j = loStart; j <= hiEnd; j++) {
      if (high[j] > windowHighMax) windowHighMax = high[j];
      if (low[j] < windowLowMin) windowLowMin = low[j];
    }
    if (high[i] === windowHighMax) {
      highLow[i] = 1;
    } else if (low[i] === windowLowMin) {
      highLow[i] = -1;
    }
  }

  // Fixed-point reduction: among adjacent confirmed swings of the SAME type,
  // keep only the more extreme one, until the sequence strictly alternates.
  for (;;) {
    const positions = [];
    for (let i = 0; i < n; i++) if (highLow[i] !== null) positions.push(i);
    if (positions.length < 2) break;

    const toRemove = new Array(positions.length).fill(false);

    for (let k = 0; k < positions.length - 1; k++) {
      const pA = positions[k];
      const pB = positions[k + 1];
      const typeA = highLow[pA];
      const typeB = highLow[pB];

      if (typeA === 1 && typeB === 1) {
        if (high[pA] < high[pB]) toRemove[k] = true;
        if (high[pA] >= high[pB]) toRemove[k + 1] = true;
      } else if (typeA === -1 && typeB === -1) {
        if (low[pA] > low[pB]) toRemove[k] = true;
        if (low[pA] <= low[pB]) toRemove[k + 1] = true;
      }
    }

    if (!toRemove.some(Boolean)) break;
    for (let k = 0; k < positions.length; k++) {
      if (toRemove[k]) highLow[positions[k]] = null;
    }
  }

  // Force the series to start/end in alternation. The two `if`s per edge are
  // intentionally sequential (not else-if): when the edge candle IS the swing
  // point itself, the second condition re-reads the just-mutated value.
  const positions = [];
  for (let i = 0; i < n; i++) if (highLow[i] !== null) positions.push(i);

  if (positions.length > 0) {
    const p0 = positions[0];
    if (highLow[p0] === 1) highLow[0] = -1;
    if (highLow[p0] === -1) highLow[0] = 1;

    const pN = positions[positions.length - 1];
    if (highLow[pN] === -1) highLow[n - 1] = 1;
    if (highLow[pN] === 1) highLow[n - 1] = -1;
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    const hl = highLow[i];
    result[i] = {
      highLow: hl,
      level: hl === 1 ? high[i] : hl === -1 ? low[i] : null,
    };
  }
  return result;
}
