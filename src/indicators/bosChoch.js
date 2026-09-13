import { toColumns, firstIndexFrom, toF32 } from "../utils.js";

/**
 * BOS - Break of Structure / CHOCH - Change of Character.
 * Both indicate a change in market structure, anchored to a swing level that
 * must later actually be broken by price (a pending, unbroken structure point
 * is never reported).
 *
 * @param {Array} candles
 * @param {Array<{highLow:1|-1|null, level:number|null}>} swingHL - output of swingHighsLows()
 * @param {{closeBreak?: boolean}} options
 */
export function bosChoch(candles, swingHL, { closeBreak = true } = {}) {
  const { n, close, high, low } = toColumns(candles);

  const bos = new Array(n).fill(0);
  const choch = new Array(n).fill(0);
  const level = new Array(n).fill(0);

  const levelOrder = [];
  const hlOrder = [];
  const lastPositions = [];

  for (let i = 0; i < n; i++) {
    const hl = swingHL[i].highLow;
    if (hl === null) continue;

    levelOrder.push(swingHL[i].level);
    hlOrder.push(hl);

    if (levelOrder.length >= 4) {
      const idx = lastPositions[lastPositions.length - 2];
      const m = hlOrder.length;
      const H4 = hlOrder[m - 4], H3 = hlOrder[m - 3], H2 = hlOrder[m - 2], H1 = hlOrder[m - 1];
      const k = levelOrder.length;
      const L4 = levelOrder[k - 4], L3 = levelOrder[k - 3], L2 = levelOrder[k - 2], L1 = levelOrder[k - 1];

      let bosVal = H4 === -1 && H3 === 1 && H2 === -1 && H1 === 1 && L4 < L2 && L2 < L3 && L3 < L1 ? 1 : 0;
      let levelVal = bosVal !== 0 ? L3 : 0;

      if (H4 === 1 && H3 === -1 && H2 === 1 && H1 === -1 && L4 > L2 && L2 > L3 && L3 > L1) bosVal = -1;
      levelVal = bosVal !== 0 ? L3 : 0;

      let chochVal = H4 === -1 && H3 === 1 && H2 === -1 && H1 === 1 && L1 > L3 && L3 > L4 && L4 > L2 ? 1 : 0;
      levelVal = chochVal !== 0 ? L3 : levelVal;

      if (H4 === 1 && H3 === -1 && H2 === 1 && H1 === -1 && L1 < L3 && L3 < L4 && L4 < L2) chochVal = -1;
      levelVal = chochVal !== 0 ? L3 : levelVal;

      bos[idx] = bosVal;
      choch[idx] = chochVal;
      // The reference implementation stores `level` as a float32 array, and
      // uses that truncated value (not the original float64) for the later
      // break-confirmation comparisons - round here, not just at output.
      level[idx] = levelVal !== 0 ? toF32(levelVal) : 0;
    }

    lastPositions.push(i);
  }

  // Snapshot of signal positions before any break-confirmation mutation.
  const signalPositions = [];
  for (let i = 0; i < n; i++) if (bos[i] !== 0 || choch[i] !== 0) signalPositions.push(i);

  const broken = new Array(n).fill(0);

  for (const i of signalPositions) {
    const lvl = level[i];
    let predicate;
    if (bos[i] === 1 || choch[i] === 1) {
      predicate = closeBreak ? (j) => close[j] > lvl : (j) => high[j] > lvl;
    } else if (bos[i] === -1 || choch[i] === -1) {
      predicate = closeBreak ? (j) => close[j] < lvl : (j) => low[j] < lvl;
    } else {
      continue;
    }

    const j = firstIndexFrom(n, i + 2, predicate);
    if (j !== -1) {
      broken[i] = j;
      // Invalidate any still-active earlier signal that this one supersedes.
      for (let k = 0; k < i; k++) {
        if ((bos[k] !== 0 || choch[k] !== 0) && broken[k] >= j) {
          bos[k] = 0;
          choch[k] = 0;
          level[k] = 0;
        }
      }
    }
  }

  // Discard anything that was formed but never confirmed broken.
  for (let i = 0; i < n; i++) {
    if ((bos[i] !== 0 || choch[i] !== 0) && broken[i] === 0) {
      bos[i] = 0;
      choch[i] = 0;
      level[i] = 0;
    }
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = {
      bos: bos[i] !== 0 ? bos[i] : null,
      choch: choch[i] !== 0 ? choch[i] : null,
      level: level[i] !== 0 ? toF32(level[i]) : null,
      brokenIndex: broken[i] !== 0 ? broken[i] : null,
    };
  }
  return result;
}
