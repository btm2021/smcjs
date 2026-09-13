import { toColumns, firstIndexFrom } from "../utils.js";

/**
 * FVG - Fair Value Gap.
 * A 3-candle imbalance: the wick of the candle before and after the middle
 * candle don't overlap, and the middle candle's body confirms direction.
 *
 * @param {Array} candles
 * @param {{joinConsecutive?: boolean}} options
 * @returns {Array<{fvg:1|-1|null, top:number|null, bottom:number|null, mitigatedIndex:number|null}>}
 */
export function fvg(candles, { joinConsecutive = false } = {}) {
  const { n, open, high, low, close } = toColumns(candles);

  const fvgArr = new Array(n).fill(null);
  const top = new Array(n).fill(null);
  const bottom = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const hasPrev = i - 1 >= 0;
    const hasNext = i + 1 < n;
    if (!hasPrev || !hasNext) continue;

    const bullish = high[i - 1] < low[i + 1] && close[i] > open[i];
    const bearish = low[i - 1] > high[i + 1] && close[i] < open[i];

    if (bullish) {
      fvgArr[i] = 1;
      top[i] = low[i + 1];
      bottom[i] = high[i - 1];
    } else if (bearish) {
      fvgArr[i] = -1;
      top[i] = low[i - 1];
      bottom[i] = high[i + 1];
    }
  }

  if (joinConsecutive) {
    for (let i = 0; i < n - 1; i++) {
      if (fvgArr[i] !== null && fvgArr[i] === fvgArr[i + 1]) {
        top[i + 1] = Math.max(top[i], top[i + 1]);
        bottom[i + 1] = Math.min(bottom[i], bottom[i + 1]);
        fvgArr[i] = null;
        top[i] = null;
        bottom[i] = null;
      }
    }
  }

  const mitigatedIndex = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fvgArr[i] === null) continue;
    let j = -1;
    if (fvgArr[i] === 1) {
      j = firstIndexFrom(n, i + 2, (k) => low[k] <= top[i]);
    } else if (fvgArr[i] === -1) {
      j = firstIndexFrom(n, i + 2, (k) => high[k] >= bottom[i]);
    }
    mitigatedIndex[i] = j !== -1 ? j : 0;
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { fvg: fvgArr[i], top: top[i], bottom: bottom[i], mitigatedIndex: mitigatedIndex[i] };
  }
  return result;
}
