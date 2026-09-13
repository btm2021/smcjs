// src/utils.js
var f32 = Math.fround;
function toMs(time) {
  if (time instanceof Date) return time.getTime();
  if (typeof time === "number") {
    return time < 1e12 ? time * 1e3 : time;
  }
  if (typeof time === "string") {
    const ms = Date.parse(time);
    if (Number.isNaN(ms)) throw new TypeError(`Unparseable candle time: ${time}`);
    return ms;
  }
  throw new TypeError(`Unsupported candle time type: ${typeof time}`);
}
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
function firstIndexFrom(n, start, predicate) {
  for (let i = start; i < n; i++) {
    if (predicate(i)) return i;
  }
  return -1;
}
function toF32(x) {
  return x === null || x === void 0 || Number.isNaN(x) ? x : f32(x);
}

// src/indicators/swingHighsLows.js
function swingHighsLows(candles, { swingLength = 50 } = {}) {
  const { n, high, low } = toColumns(candles);
  const SL = swingLength;
  const L = SL * 2;
  const highLow = new Array(n).fill(null);
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
  for (; ; ) {
    const positions2 = [];
    for (let i = 0; i < n; i++) if (highLow[i] !== null) positions2.push(i);
    if (positions2.length < 2) break;
    const toRemove = new Array(positions2.length).fill(false);
    for (let k = 0; k < positions2.length - 1; k++) {
      const pA = positions2[k];
      const pB = positions2[k + 1];
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
    for (let k = 0; k < positions2.length; k++) {
      if (toRemove[k]) highLow[positions2[k]] = null;
    }
  }
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
      level: hl === 1 ? high[i] : hl === -1 ? low[i] : null
    };
  }
  return result;
}

// src/indicators/bosChoch.js
function bosChoch(candles, swingHL, { closeBreak = true } = {}) {
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
      level[idx] = levelVal !== 0 ? toF32(levelVal) : 0;
    }
    lastPositions.push(i);
  }
  const signalPositions = [];
  for (let i = 0; i < n; i++) if (bos[i] !== 0 || choch[i] !== 0) signalPositions.push(i);
  const broken = new Array(n).fill(0);
  for (const i of signalPositions) {
    const lvl = level[i];
    let predicate;
    if (bos[i] === 1 || choch[i] === 1) {
      predicate = closeBreak ? (j2) => close[j2] > lvl : (j2) => high[j2] > lvl;
    } else if (bos[i] === -1 || choch[i] === -1) {
      predicate = closeBreak ? (j2) => close[j2] < lvl : (j2) => low[j2] < lvl;
    } else {
      continue;
    }
    const j = firstIndexFrom(n, i + 2, predicate);
    if (j !== -1) {
      broken[i] = j;
      for (let k = 0; k < i; k++) {
        if ((bos[k] !== 0 || choch[k] !== 0) && broken[k] >= j) {
          bos[k] = 0;
          choch[k] = 0;
          level[k] = 0;
        }
      }
    }
  }
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
      brokenIndex: broken[i] !== 0 ? broken[i] : null
    };
  }
  return result;
}

// src/indicators/fvg.js
function fvg(candles, { joinConsecutive = false } = {}) {
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

// src/indicators/orderBlocks.js
function searchLastBefore(sortedIndices, closeIndex) {
  let lo = 0;
  let hi = sortedIndices.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
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
function orderBlocks(candles, swingHL, { closeMitigation = false } = {}) {
  if (candles.some((c) => c.volume === void 0 || c.volume === null)) {
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
  let activeBullish = [];
  for (let closeIndex = 0; closeIndex < n; closeIndex++) {
    for (const idx of activeBullish.slice()) {
      if (breaker[idx]) {
        if (high[closeIndex] > topArr[idx]) {
          resetSlot(idx, state);
          activeBullish = activeBullish.filter((x) => x !== idx);
        }
      } else {
        const mitigated = closeMitigation ? Math.min(open[closeIndex], close[closeIndex]) < bottomArr[idx] : low[closeIndex] < bottomArr[idx];
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
        maxVol !== 0 ? Math.min(highVolume[obIndex], lowVolume[obIndex]) / maxVol * 100 : 100
      );
      activeBullish.push(obIndex);
    }
  }
  let activeBearish = [];
  for (let closeIndex = 0; closeIndex < n; closeIndex++) {
    for (const idx of activeBearish.slice()) {
      if (breaker[idx]) {
        if (low[closeIndex] < bottomArr[idx]) {
          resetSlot(idx, state);
          activeBearish = activeBearish.filter((x) => x !== idx);
        }
      } else {
        const mitigated = closeMitigation ? Math.max(open[closeIndex], close[closeIndex]) > topArr[idx] : high[closeIndex] > topArr[idx];
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
        maxVol !== 0 ? Math.min(highVolume[obIndex], lowVolume[obIndex]) / maxVol * 100 : 100
      );
      activeBearish.push(obIndex);
    }
  }
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = ob[i] !== 0 ? {
      ob: ob[i],
      top: topArr[i],
      bottom: bottomArr[i],
      obVolume: obVolume[i],
      mitigatedIndex: mitigatedIndex[i],
      percentage: percentage[i]
    } : { ob: null, top: null, bottom: null, obVolume: null, mitigatedIndex: null, percentage: null };
  }
  return result;
}

// src/indicators/liquidity.js
function liquidity(candles, swingHL, { rangePercent = 0.01 } = {}) {
  const { n, high, low } = toColumns(candles);
  let globalHigh = -Infinity;
  let globalLow = Infinity;
  for (let i = 0; i < n; i++) {
    if (high[i] > globalHigh) globalHigh = high[i];
    if (low[i] < globalLow) globalLow = low[i];
  }
  const pipRange = (globalHigh - globalLow) * rangePercent;
  const hl = swingHL.map((r) => r.highLow ?? null);
  const level = swingHL.map((r) => r.level);
  const outLiquidity = new Array(n).fill(null);
  const outLevel = new Array(n).fill(null);
  const outEnd = new Array(n).fill(null);
  const outSwept = new Array(n).fill(null);
  function firstIndexFrom2(start, predicate) {
    for (let i = start; i < n; i++) if (predicate(i)) return i;
    return -1;
  }
  function run(sign, isSwept) {
    const candidates = [];
    for (let i = 0; i < n; i++) if (hl[i] === sign) candidates.push(i);
    for (const i of candidates) {
      if (hl[i] !== sign) continue;
      const baseLevel = level[i];
      const rangeLow = baseLevel - pipRange;
      const rangeHigh = baseLevel + pipRange;
      const groupLevels = [baseLevel];
      let groupEnd = i;
      const found = firstIndexFrom2(i + 1, (k) => isSwept(k, rangeLow, rangeHigh));
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

// src/indicators/previousHighLow.js
var MIN_MS = 6e4;
var HOUR_MS = 60 * MIN_MS;
var DAY_MS = 24 * HOUR_MS;
var EPOCH_SUNDAY_MS = Date.UTC(1970, 0, 4);
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
  return Date.UTC(year, monthIndex + 1, 0);
}
function bucketStart(ms, tf) {
  if (tf.kind === "fixed") {
    return Math.floor(ms / tf.ms) * tf.ms;
  }
  if (tf.kind === "week") {
    const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
    const dow = new Date(dayStart).getUTCDay();
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
    const anchorTotalMonths = ms < thisMonthEnd ? y * 12 + mo - 1 : y * 12 + mo;
    if (tf.count === 1) return lastDayOfMonthMs(Math.floor(anchorTotalMonths / 12), anchorTotalMonths % 12);
    const totalMonths = anchorTotalMonths;
    const bucketMonths = Math.floor(totalMonths / tf.count) * tf.count;
    return lastDayOfMonthMs(Math.floor(bucketMonths / 12), bucketMonths % 12);
  }
  throw new Error("unreachable");
}
function previousHighLow(candles, { timeFrame = "1D" } = {}) {
  const { n, high, low } = toColumns(candles);
  const tf = parseTimeFrame(timeFrame);
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
    const result2 = new Array(n);
    for (let i = 0; i < n; i++) result2[i] = { previousHigh: null, previousLow: null, brokenHigh: 0, brokenLow: 0 };
    return result2;
  }
  const previousHigh = new Array(n).fill(null);
  const previousLow = new Array(n).fill(null);
  const brokenHigh = new Array(n).fill(0);
  const brokenLow = new Array(n).fill(0);
  let prevRefIdx = null;
  let runHigh = -Infinity;
  let runLow = Infinity;
  for (let i = 0; i < n; i++) {
    const kOwn = bucketOf[i];
    const periodsBefore = tf.labelSide === "left" ? isAtBoundary[i] ? kOwn : kOwn + 1 : isAtBoundary[i] ? kOwn - 1 : kOwn;
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
      brokenLow: brokenLow[i]
    };
  }
  return result;
}

// src/indicators/sessions.js
var DEFAULT_SESSIONS = {
  Sydney: { start: "21:00", end: "06:00" },
  Tokyo: { start: "00:00", end: "09:00" },
  London: { start: "07:00", end: "16:00" },
  "New York": { start: "13:00", end: "22:00" },
  "Asian kill zone": { start: "00:00", end: "04:00" },
  "London open kill zone": { start: "06:00", end: "09:00" },
  "New York kill zone": { start: "11:00", end: "14:00" },
  "london close kill zone": { start: "14:00", end: "16:00" }
};
function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function offsetMsForParity(timeZone) {
  if (timeZone === "UTC") return 0;
  const m = /^(?:UTC|GMT)\s*([+-]?\d+(?:\.\d+)?)$/.exec(timeZone.trim());
  if (!m) throw new Error(`Unsupported time_zone "${timeZone}". Use "UTC" or e.g. "UTC+5" / "GMT-3".`);
  const hours = parseFloat(m[1]);
  return hours * 60 * 60 * 1e3;
}
function sessions(candles, { session, startTime = "", endTime = "", timeZone = "UTC" } = {}) {
  if (session === "Custom" && (startTime === "" || endTime === "")) {
    throw new Error("Custom session requires a start and end time");
  }
  const def = session === "Custom" ? { start: startTime, end: endTime } : DEFAULT_SESSIONS[session];
  if (!def) throw new Error(`Unknown session "${session}"`);
  const start = minutesOfDay(def.start);
  const end = minutesOfDay(def.end);
  const deltaMs = offsetMsForParity(timeZone);
  const { n, high, low } = toColumns(candles);
  const active = new Array(n).fill(0);
  const outHigh = new Array(n).fill(0);
  const outLow = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const utcMs = toMs(candles[i].time) + deltaMs;
    const d = new Date(utcMs);
    const cur = d.getUTCHours() * 60 + d.getUTCMinutes();
    const isActive = start <= end && start <= cur && cur <= end || start >= end && (cur >= start || cur <= end);
    if (isActive) {
      active[i] = 1;
      outHigh[i] = Math.max(high[i], i > 0 ? outHigh[i - 1] : 0);
      outLow[i] = Math.min(low[i], i > 0 && outLow[i - 1] !== 0 ? outLow[i - 1] : Infinity);
    }
  }
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { active: active[i], high: outHigh[i], low: outLow[i] };
  }
  return result;
}

// src/indicators/retracements.js
function round1(x) {
  return Math.round(x * 10) / 10;
}
function retracements(candles, swingHL) {
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
      current[i] = divisor !== 0 ? round1(100 - (low[i] - bottom) / divisor * 100) : 0;
      deepest[i] = Math.max(prevDir === 1 && i > 0 ? deepest[i - 1] : 0, current[i]);
    }
    if (direction[i] === -1) {
      const divisor = bottom - top;
      current[i] = divisor !== 0 ? round1(100 - (high[i] - top) / divisor * 100) : 0;
      deepest[i] = Math.max(prevDir === -1 && i > 0 ? deepest[i - 1] : 0, current[i]);
    }
  }
  const rDirection = new Array(n);
  const rCurrent = new Array(n);
  const rDeepest = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i - 1 + n) % n;
    rDirection[i] = direction[src];
    rCurrent[i] = current[src];
    rDeepest[i] = deepest[src];
  }
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

// src/indicators/atrBot.js
function atrBot(candles, {
  maType = "VIDYA",
  source = "close",
  cmoLength = 14,
  maLength = 21,
  atrLength = 14,
  atrMult = 2
} = {}) {
  const { n, high, low, close } = toColumns(candles);
  if (n === 0) return [];
  const src = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (source === "hl2") src[i] = (high[i] + low[i]) / 2;
    else if (source === "hlc3") src[i] = (high[i] + low[i] + close[i]) / 3;
    else src[i] = close[i];
  }
  const ma = new Float64Array(n);
  if (maType === "VIDYA") {
    const alpha = 2 / (maLength + 1);
    ma[0] = src[0];
    for (let i = 1; i < n; i++) {
      let sumUp = 0, sumDown = 0;
      const start = Math.max(1, i - cmoLength + 1);
      for (let j = start; j <= i; j++) {
        const diff = src[j] - src[j - 1];
        if (diff > 0) sumUp += diff;
        else if (diff < 0) sumDown -= diff;
      }
      const total = sumUp + sumDown;
      const cmo = total === 0 ? 0 : Math.abs((sumUp - sumDown) / total);
      ma[i] = alpha * cmo * src[i] + (1 - alpha * cmo) * ma[i - 1];
    }
  } else if (maType === "EMA") {
    const alpha = 2 / (maLength + 1);
    ma[0] = src[0];
    for (let i = 1; i < n; i++) {
      ma[i] = alpha * src[i] + (1 - alpha) * ma[i - 1];
    }
  } else {
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      const start = Math.max(0, i - maLength + 1);
      for (let j = start; j <= i; j++) {
        sum += src[j];
        count++;
      }
      ma[i] = sum / count;
    }
  }
  const tr = new Float64Array(n);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    const h = high[i], l = low[i], prevC = close[i - 1];
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }
  const atr = new Float64Array(n);
  let initSum = 0;
  const countInit = Math.min(n, atrLength);
  for (let i = 0; i < countInit; i++) initSum += tr[i];
  atr[countInit - 1] = initSum / countInit;
  for (let i = 0; i < countInit - 1; i++) atr[i] = tr[i];
  for (let i = countInit; i < n; i++) {
    atr[i] = (atr[i - 1] * (atrLength - 1) + tr[i]) / atrLength;
  }
  const result = new Array(n);
  let trend = 1;
  let stop = close[0] - atr[0] * atrMult;
  for (let i = 0; i < n; i++) {
    const c = close[i];
    const dev = atr[i] * atrMult;
    let isBuy = false;
    let isSell = false;
    if (i === 0) {
      stop = c - dev;
      trend = 1;
    } else {
      if (trend === 1) {
        const candidate = c - dev;
        stop = Math.max(stop, candidate);
        if (c < stop) {
          trend = -1;
          stop = c + dev;
          isSell = true;
        }
      } else {
        const candidate = c + dev;
        stop = Math.min(stop, candidate);
        if (c > stop) {
          trend = 1;
          stop = c - dev;
          isBuy = true;
        }
      }
    }
    result[i] = {
      trail1: ma[i],
      trail2: stop,
      trend,
      isBuy,
      isSell,
      atr: atr[i]
    };
  }
  return result;
}

// src/index.js
var SMC = {
  swingHighsLows,
  bosChoch,
  fvg,
  orderBlocks,
  liquidity,
  previousHighLow,
  sessions,
  retracements,
  atrBot,
  // Pythonic aliases for interoperability
  swing_highs_lows: (candles, opts) => swingHighsLows(candles, { swingLength: opts?.swing_length ?? opts?.swingLength }),
  bos_choch: (candles, opts) => {
    const swingHL = Array.isArray(opts) ? opts : opts?.swing_highs_lows ?? opts?.swingHL;
    return bosChoch(candles, swingHL, opts);
  }
};
var index_default = SMC;
export {
  DEFAULT_SESSIONS,
  atrBot,
  bosChoch,
  index_default as default,
  fvg,
  liquidity,
  orderBlocks,
  previousHighLow,
  retracements,
  sessions,
  swingHighsLows
};
