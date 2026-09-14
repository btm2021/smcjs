/**
 * Dynamic Swing Highs/Lows (thử nghiệm — KHÔNG thuộc thư viện lõi SMC.js)
 *
 * SMC.swingHighsLows() gốc dùng một `swingLength` (leftBar = rightBar) CỐ ĐỊNH
 * cho toàn bộ chuỗi nến — số nến này khá chủ quan, không thay đổi theo chế độ
 * biến động (volatility regime) của thị trường.
 *
 * File này cung cấp một biến thể: cửa sổ swing (leftBar/rightBar, đối xứng
 * giống bản gốc) co giãn theo percentile-rank của ATR% trong một cửa sổ quá
 * khứ dài — CÙNG công thức "M1" mà indicator_atrbot_m1.js dùng để co giãn
 * atrMult, chỉ khác là áp dụng cho SỐ NẾN thay vì hệ số ATR:
 *
 *   window(i) = baseWindow * (1 + K * (1 - percentileRank(ATR%, i)))
 *               [làm tròn, giới hạn trong [minBars, maxBars]]
 *
 * Khi ATR% đang ở percentile THẤP so với lịch sử của chính nó (thị trường
 * choppy/sideway) -> cửa sổ MỞ RỘNG (yêu cầu nhiều nến xác nhận hơn, lọc bớt
 * các đỉnh/đáy nhiễu). Khi ATR% ở percentile CAO (breakout/trend thật) -> cửa
 * sổ co lại gần baseWindow (phản ứng nhanh hơn, bắt swing sớm hơn).
 *
 * percentile-rank được tính CAUSAL (chỉ dùng dữ liệu quá khứ tại mỗi nến),
 * nhưng bản thân việc "biết một nến có phải swing hay không" vẫn cần nhìn
 * `window(i)` nến ở CẢ HAI PHÍA (giống hệt swingLength gốc) — nghĩa là độ trễ
 * xác nhận cũng THAY ĐỔI theo window(i), không cố định như bản gốc.
 *
 * Output cùng shape với SMC.swingHighsLows(): Array<{highLow: 1|-1|null, level:number|null}>
 * cùng độ dài với candles, nên dùng thay thế trực tiếp làm `swingHL` cho
 * SMC.bosChoch / orderBlocks / liquidity / retracements.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.DynamicSwingHL = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

  // Causal rolling percentile-rank — giống hệt indicator_atrbot_m1.js, tách
  // riêng ra đây để file này không phụ thuộc ngược vào ATRBot.
  function rollingPercentileRank(values, window, minPeriods) {
    const n = values.length;
    const out = new Array(n).fill(1.0);
    const buf = [];
    function bisectLeft(arr, x) {
      let lo = 0, hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < x) lo = mid + 1; else hi = mid;
      }
      return lo;
    }
    for (let i = 0; i < n; i++) {
      const v = values[i];
      const insPos = bisectLeft(buf, v);
      buf.splice(insPos, 0, v);
      const windowStart = i - window + 1;
      if (windowStart > 0) {
        const evictVal = values[windowStart - 1];
        const evPos = bisectLeft(buf, evictVal);
        if (buf[evPos] === evictVal) buf.splice(evPos, 1);
      }
      const count = i + 1 >= minPeriods ? buf.length : -1;
      if (count > 0) {
        const lessPos = bisectLeft(buf, v);
        out[i] = lessPos / buf.length;
      }
    }
    return out;
  }

  function computeAdaptiveWindow(candles, opts) {
    opts = opts || {};
    const n = candles.length;
    const atrLength = opts.atrLength || 14;
    const percentileWindow = opts.percentileWindow || 5000;
    const minPeriods = opts.minPeriods || 200;
    const baseWindow = opts.baseWindow || 50;
    const K = opts.adaptiveK != null ? opts.adaptiveK : 1.5;
    const minBars = Math.max(1, opts.minBars || 5);
    const maxBars = Math.max(minBars, opts.maxBars || 200);

    const high = new Array(n), low = new Array(n), close = new Array(n);
    for (let i = 0; i < n; i++) {
      high[i] = candles[i].high;
      low[i] = candles[i].low;
      close[i] = candles[i].close;
    }

    // True Range + Wilder ATR (causal) — công thức y hệt ATRBot M1.
    const tr = new Array(n);
    tr[0] = n > 0 ? high[0] - low[0] : 0;
    for (let i = 1; i < n; i++) {
      tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    }
    const atr = new Array(n);
    if (n > 0) atr[0] = tr[0];
    for (let i = 1; i < n; i++) {
      atr[i] = (atr[i - 1] * (atrLength - 1) + tr[i]) / atrLength;
    }
    const atrPct = new Array(n);
    for (let i = 0; i < n; i++) atrPct[i] = close[i] > 0 ? (atr[i] / close[i] * 100.0) : 0;

    const pctRank = rollingPercentileRank(atrPct, percentileWindow, minPeriods);

    const windowArr = new Array(n);
    for (let i = 0; i < n; i++) {
      let w = Math.round(baseWindow * (1 + K * (1 - pctRank[i])));
      if (w < minBars) w = minBars;
      if (w > maxBars) w = maxBars;
      windowArr[i] = w;
    }
    return { windowArr: windowArr, atrPct: atrPct, pctRank: pctRank };
  }

  function calculate(candles, opts) {
    const n = candles.length;
    if (n === 0) return { swingHL: [], windowArr: [], atrPct: [], pctRank: [] };

    const adaptive = computeAdaptiveWindow(candles, opts);
    const windowArr = adaptive.windowArr;

    const high = new Array(n), low = new Array(n);
    for (let i = 0; i < n; i++) {
      high[i] = candles[i].high;
      low[i] = candles[i].low;
    }

    // Phát hiện swing với cửa sổ RIÊNG cho từng nến (thay vì 1 SL cố định cho
    // toàn chuỗi) — cùng tiêu chí "high[i]/low[i] là cực trị trong cửa sổ đối
    // xứng quanh i" như bản gốc, chỉ khác độ rộng cửa sổ đổi theo từng i.
    const highLow = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const SL = windowArr[i];
      const loStart = i - SL + 1;
      const hiEnd = i + SL;
      if (loStart < 0 || hiEnd > n - 1) continue;
      let windowHighMax = -Infinity, windowLowMin = Infinity;
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

    // Fixed-point reduction — giống hệt src/indicators/swingHighsLows.js: giữa
    // 2 swing liên tiếp CÙNG loại, chỉ giữ điểm cực trị hơn, lặp tới khi chuỗi
    // so le hoàn toàn. Giữ nguyên bước này để BOS/CHOCH/OB/Liquidity/Retracements
    // (vốn giả định swingHL đã so le) hoạt động đúng như với swingLength cố định.
    for (;;) {
      const positions = [];
      for (let i = 0; i < n; i++) if (highLow[i] !== null) positions.push(i);
      if (positions.length < 2) break;

      const toRemove = new Array(positions.length).fill(false);
      for (let k = 0; k < positions.length - 1; k++) {
        const pA = positions[k], pB = positions[k + 1];
        const typeA = highLow[pA], typeB = highLow[pB];
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

    // Buộc chuỗi bắt đầu/kết thúc so le — giống hệt bản gốc.
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

    const swingHL = new Array(n);
    for (let i = 0; i < n; i++) {
      const hl = highLow[i];
      swingHL[i] = {
        highLow: hl,
        level: hl === 1 ? high[i] : hl === -1 ? low[i] : null,
      };
    }

    return { swingHL: swingHL, windowArr: windowArr, atrPct: adaptive.atrPct, pctRank: adaptive.pctRank };
  }

  return { calculate: calculate, computeAdaptiveWindow: computeAdaptiveWindow };
}));
