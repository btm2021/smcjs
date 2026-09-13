import { toColumns, toF32 } from "../utils.js";

/**
 * Liquidity.
 * Clusters swing highs (or lows) that sit within `rangePercent` of the
 * overall high-low range of each other, then reports when price finally
 * sweeps through the whole cluster.
 *
 * @param {Array} candles
 * @param {Array<{highLow:1|-1|null, level:number|null}>} swingHL
 * @param {{rangePercent?: number}} options
 */
export function liquidity(candles, swingHL, { rangePercent = 0.01 } = {}) {
  const { n, high, low } = toColumns(candles);

  let globalHigh = -Infinity;
  let globalLow = Infinity;
  for (let i = 0; i < n; i++) {
    if (high[i] > globalHigh) globalHigh = high[i];
    if (low[i] < globalLow) globalLow = low[i];
  }
  const pipRange = (globalHigh - globalLow) * rangePercent;

  // Working copy so consumed swing points can be marked used (HighLow -> 0),
  // preventing a swing point from joining more than one cluster.
  const hl = swingHL.map((r) => r.highLow ?? null);
  const level = swingHL.map((r) => r.level);

  const outLiquidity = new Array(n).fill(null);
  const outLevel = new Array(n).fill(null);
  const outEnd = new Array(n).fill(null);
  const outSwept = new Array(n).fill(null);

  function firstIndexFrom(start, predicate) {
    for (let i = start; i < n; i++) if (predicate(i)) return i;
    return -1;
  }

  // sign: 1 for swing highs, -1 for swing lows.
  // isSwept(k, rangeLow, rangeHigh): candle k's condition for sweeping the zone.
  function run(sign, isSwept) {
    const candidates = [];
    for (let i = 0; i < n; i++) if (hl[i] === sign) candidates.push(i);

    for (const i of candidates) {
      if (hl[i] !== sign) continue; // already consumed by an earlier group

      const baseLevel = level[i];
      const rangeLow = baseLevel - pipRange;
      const rangeHigh = baseLevel + pipRange;
      const groupLevels = [baseLevel];
      let groupEnd = i;

      const found = firstIndexFrom(i + 1, (k) => isSwept(k, rangeLow, rangeHigh));
      const sweptIdx = found === -1 ? 0 : found;

      for (const j of candidates) {
        if (j <= i) continue;
        if (sweptIdx && j >= sweptIdx) break;
        if (hl[j] === sign && level[j] >= rangeLow && level[j] <= rangeHigh) {
          groupLevels.push(level[j]);
          groupEnd = j;
          hl[j] = 0;
        }
      }

      if (groupLevels.length > 1) {
        const avg = groupLevels.reduce((a, b) => a + b, 0) / groupLevels.length;
        outLiquidity[i] = sign;
        outLevel[i] = toF32(avg);
        outEnd[i] = groupEnd;
        outSwept[i] = sweptIdx;
      }
    }
  }

  run(1, (k, _rangeLow, rangeHigh) => high[k] >= rangeHigh);
  run(-1, (k, rangeLow) => low[k] <= rangeLow);

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { liquidity: outLiquidity[i], level: outLevel[i], end: outEnd[i], swept: outSwept[i] };
  }
  return result;
}
