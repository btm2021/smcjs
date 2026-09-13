import { toColumns } from "../utils.js";

function round1(x) {
  return Math.round(x * 10) / 10;
}

/**
 * Retracement.
 * Percentage pullback of the current price from the most recent swing
 * extreme, expressed as a fraction of the current leg's range, plus the
 * deepest pullback seen so far during that leg.
 *
 * @param {Array} candles
 * @param {Array<{highLow:1|-1|null, level:number|null}>} swingHL
 */
export function retracements(candles, swingHL) {
  const { n, high, low } = toColumns(candles);

  const direction = new Array(n).fill(0);
  const current = new Array(n).fill(0);
  const deepest = new Array(n).fill(0);

  let top = 0;
  let bottom = 0;

  for (let i = 0; i < n; i++) {
    const hl = swingHL[i].highLow;
    if (hl === 1) {
      direction[i] = 1;
      top = swingHL[i].level;
    } else if (hl === -1) {
      direction[i] = -1;
      bottom = swingHL[i].level;
    } else {
      direction[i] = i > 0 ? direction[i - 1] : 0;
    }

    const prevDir = i > 0 ? direction[i - 1] : 0;

    if (prevDir === 1) {
      const divisor = top - bottom;
      current[i] = divisor !== 0 ? round1(100 - ((low[i] - bottom) / divisor) * 100) : 0;
      deepest[i] = Math.max(prevDir === 1 && i > 0 ? deepest[i - 1] : 0, current[i]);
    }
    if (direction[i] === -1) {
      const divisor = bottom - top;
      current[i] = divisor !== 0 ? round1(100 - ((high[i] - top) / divisor) * 100) : 0;
      deepest[i] = Math.max(prevDir === -1 && i > 0 ? deepest[i - 1] : 0, current[i]);
    }
  }

  // Shift everything forward by one candle (avoids look-ahead in the published series).
  const rDirection = new Array(n);
  const rCurrent = new Array(n);
  const rDeepest = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i - 1 + n) % n;
    rDirection[i] = direction[src];
    rCurrent[i] = current[src];
    rDeepest[i] = deepest[src];
  }

  // The first ~3 swing legs at the start of the series don't have enough
  // history to be meaningful; zero them out.
  let removeFirstCount = 0;
  for (let i = 0; i < n - 1; i++) {
    if (rDirection[i] !== rDirection[i + 1]) removeFirstCount++;
    rDirection[i] = 0;
    rCurrent[i] = 0;
    rDeepest[i] = 0;
    if (removeFirstCount === 3) {
      rDirection[i + 1] = 0;
      rCurrent[i + 1] = 0;
      rDeepest[i + 1] = 0;
      break;
    }
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { direction: rDirection[i], currentRetracementPct: rCurrent[i], deepestRetracementPct: rDeepest[i] };
  }
  return result;
}
