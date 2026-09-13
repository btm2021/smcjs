import { toColumns, toF32 } from "../utils.js";

function searchLastBefore(sortedIndices, closeIndex) {
  // Equivalent to numpy searchsorted(side='left') then stepping back one.
  let lo = 0;
  let hi = sortedIndices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedIndices[mid] < closeIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? sortedIndices[lo - 1] : null;
}

function resetSlot(idx, { ob, topArr, bottomArr, obVolume, lowVolume, highVolume, mitigatedIndex, percentage }) {
  ob[idx] = 0;
  topArr[idx] = 0;
  bottomArr[idx] = 0;
  obVolume[idx] = 0;
  lowVolume[idx] = 0;
  highVolume[idx] = 0;
  mitigatedIndex[idx] = 0;
  percentage[idx] = 0;
}

/**
 * OB - Order Blocks.
 * Detects the last opposing candle before an impulsive break of a swing
 * point, tracking mitigation ("breaker") state and eventual invalidation.
 *
 * @param {Array} candles - must include numeric `volume`
 * @param {Array<{highLow:1|-1|null, level:number|null}>} swingHL
 * @param {{closeMitigation?: boolean}} options
 */
export function orderBlocks(candles, swingHL, { closeMitigation = false } = {}) {
  if (candles.some((c) => c.volume === undefined || c.volume === null)) {
    throw new Error("orderBlocks() requires every candle to have a numeric `volume`");
  }

  const { n, open, high, low, close, volume } = toColumns(candles);

  const crossed = new Array(n).fill(false);
  const ob = new Array(n).fill(0);
  const topArr = new Array(n).fill(0);
  const bottomArr = new Array(n).fill(0);
  const obVolume = new Array(n).fill(0);
  const lowVolume = new Array(n).fill(0);
  const highVolume = new Array(n).fill(0);
  const percentage = new Array(n).fill(0);
  const mitigatedIndex = new Array(n).fill(0);
  const breaker = new Array(n).fill(false);
  const state = { ob, topArr, bottomArr, obVolume, lowVolume, highVolume, mitigatedIndex, percentage };

  const swingHighIndices = [];
  const swingLowIndices = [];
  for (let i = 0; i < n; i++) {
    if (swingHL[i].highLow === 1) swingHighIndices.push(i);
    else if (swingHL[i].highLow === -1) swingLowIndices.push(i);
  }

  // ---- Bullish order blocks ----
  let activeBullish = [];
  for (let closeIndex = 0; closeIndex < n; closeIndex++) {
    for (const idx of activeBullish.slice()) {
      if (breaker[idx]) {
        if (high[closeIndex] > topArr[idx]) {
          resetSlot(idx, state);
          activeBullish = activeBullish.filter((x) => x !== idx);
        }
      } else {
        const mitigated = closeMitigation
          ? Math.min(open[closeIndex], close[closeIndex]) < bottomArr[idx]
          : low[closeIndex] < bottomArr[idx];
        if (mitigated) {
          breaker[idx] = true;
          mitigatedIndex[idx] = closeIndex - 1;
        }
      }
    }

    const lastTopIndex = searchLastBefore(swingHighIndices, closeIndex);
    if (lastTopIndex !== null && close[closeIndex] > high[lastTopIndex] && !crossed[lastTopIndex]) {
      crossed[lastTopIndex] = true;
      const defaultIndex = closeIndex - 1;
      let obBtm = high[defaultIndex];
      let obTop = low[defaultIndex];
      let obIndex = defaultIndex;

      if (closeIndex - lastTopIndex > 1) {
        const start = lastTopIndex + 1;
        const end = closeIndex;
        if (end > start) {
          let minVal = Infinity;
          for (let k = start; k < end; k++) if (low[k] < minVal) minVal = low[k];
          let candidateIndex = -1;
          for (let k = start; k < end; k++) if (low[k] === minVal) candidateIndex = k;
          obBtm = low[candidateIndex];
          obTop = high[candidateIndex];
          obIndex = candidateIndex;
        }
      }

      ob[obIndex] = 1;
      topArr[obIndex] = toF32(obTop);
      bottomArr[obIndex] = toF32(obBtm);
      const volCur = volume[closeIndex];
      const volPrev1 = closeIndex >= 1 ? volume[closeIndex - 1] : 0;
      const volPrev2 = closeIndex >= 2 ? volume[closeIndex - 2] : 0;
      obVolume[obIndex] = toF32(volCur + volPrev1 + volPrev2);
      lowVolume[obIndex] = toF32(volPrev2);
      highVolume[obIndex] = toF32(volCur + volPrev1);
      const maxVol = Math.max(highVolume[obIndex], lowVolume[obIndex]);
      percentage[obIndex] = toF32(
        maxVol !== 0 ? (Math.min(highVolume[obIndex], lowVolume[obIndex]) / maxVol) * 100 : 100
      );
      activeBullish.push(obIndex);
    }
  }

  // ---- Bearish order blocks (separate, sequential pass) ----
  let activeBearish = [];
  for (let closeIndex = 0; closeIndex < n; closeIndex++) {
    for (const idx of activeBearish.slice()) {
      if (breaker[idx]) {
        if (low[closeIndex] < bottomArr[idx]) {
          resetSlot(idx, state);
          activeBearish = activeBearish.filter((x) => x !== idx);
        }
      } else {
        const mitigated = closeMitigation
          ? Math.max(open[closeIndex], close[closeIndex]) > topArr[idx]
          : high[closeIndex] > topArr[idx];
        if (mitigated) {
          breaker[idx] = true;
          mitigatedIndex[idx] = closeIndex;
        }
      }
    }

    const lastBtmIndex = searchLastBefore(swingLowIndices, closeIndex);
    if (lastBtmIndex !== null && close[closeIndex] < low[lastBtmIndex] && !crossed[lastBtmIndex]) {
      crossed[lastBtmIndex] = true;
      const defaultIndex = closeIndex - 1;
      let obTop = high[defaultIndex];
      let obBtm = low[defaultIndex];
      let obIndex = defaultIndex;

      if (closeIndex - lastBtmIndex > 1) {
        const start = lastBtmIndex + 1;
        const end = closeIndex;
        if (end > start) {
          let maxVal = -Infinity;
          for (let k = start; k < end; k++) if (high[k] > maxVal) maxVal = high[k];
          let candidateIndex = -1;
          for (let k = start; k < end; k++) if (high[k] === maxVal) candidateIndex = k;
          obTop = high[candidateIndex];
          obBtm = low[candidateIndex];
          obIndex = candidateIndex;
        }
      }

      ob[obIndex] = -1;
      topArr[obIndex] = toF32(obTop);
      bottomArr[obIndex] = toF32(obBtm);
      const volCur = volume[closeIndex];
      const volPrev1 = closeIndex >= 1 ? volume[closeIndex - 1] : 0;
      const volPrev2 = closeIndex >= 2 ? volume[closeIndex - 2] : 0;
      obVolume[obIndex] = toF32(volCur + volPrev1 + volPrev2);
      lowVolume[obIndex] = toF32(volCur + volPrev1);
      highVolume[obIndex] = toF32(volPrev2);
      const maxVol = Math.max(highVolume[obIndex], lowVolume[obIndex]);
      percentage[obIndex] = toF32(
        maxVol !== 0 ? (Math.min(highVolume[obIndex], lowVolume[obIndex]) / maxVol) * 100 : 100
      );
      activeBearish.push(obIndex);
    }
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] =
      ob[i] !== 0
        ? {
            ob: ob[i],
            top: topArr[i],
            bottom: bottomArr[i],
            obVolume: obVolume[i],
            mitigatedIndex: mitigatedIndex[i],
            percentage: percentage[i],
          }
        : { ob: null, top: null, bottom: null, obVolume: null, mitigatedIndex: null, percentage: null };
  }
  return result;
}
