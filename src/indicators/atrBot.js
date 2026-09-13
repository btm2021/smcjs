import { toColumns } from "../utils.js";

/**
 * ATRBot Trailing Stop & Moving Average (VIDYA / EMA / SMA).
 *
 * @param {Array} candles
 * @param {{
 *   maType?: 'VIDYA'|'EMA'|'SMA',
 *   source?: 'close'|'hl2'|'hlc3',
 *   cmoLength?: number,
 *   maLength?: number,
 *   atrLength?: number,
 *   atrMult?: number
 * }} options
 * @returns {Array<{trail1: number, trail2: number, trend: 1|-1, isBuy: boolean, isSell: boolean, atr: number}>}
 */
export function atrBot(candles, {
  maType = "VIDYA",
  source = "close",
  cmoLength = 14,
  maLength = 21,
  atrLength = 14,
  atrMult = 2.0,
} = {}) {
  const { n, high, low, close } = toColumns(candles);
  if (n === 0) return [];

  // 1. Source series
  const src = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (source === "hl2") src[i] = (high[i] + low[i]) / 2;
    else if (source === "hlc3") src[i] = (high[i] + low[i] + close[i]) / 3;
    else src[i] = close[i];
  }

  // 2. Moving average (VIDYA, EMA, or SMA)
  const ma = new Float64Array(n);
  if (maType === "VIDYA") {
    // Chande Momentum Oscillator (CMO)
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
      ma[i] = (alpha * cmo * src[i]) + (1 - alpha * cmo) * ma[i - 1];
    }
  } else if (maType === "EMA") {
    const alpha = 2 / (maLength + 1);
    ma[0] = src[0];
    for (let i = 1; i < n; i++) {
      ma[i] = alpha * src[i] + (1 - alpha) * ma[i - 1];
    }
  } else {
    // SMA
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      const start = Math.max(0, i - maLength + 1);
      for (let j = start; j <= i; j++) { sum += src[j]; count++; }
      ma[i] = sum / count;
    }
  }

  // 3. Average True Range (ATR)
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

  // 4. Trailing Stop & Reversal Signals
  const result = new Array(n);
  let trend = 1; // 1 = bull, -1 = bear
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
        // Bullish: Stop only ratchets UP
        const candidate = c - dev;
        stop = Math.max(stop, candidate);
        if (c < stop) {
          trend = -1;
          stop = c + dev;
          isSell = true;
        }
      } else {
        // Bearish: Stop only ratchets DOWN
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
      atr: atr[i],
    };
  }

  return result;
}
