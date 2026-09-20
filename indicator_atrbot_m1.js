/**
 * Indicator: ATRBot M1 (Adaptive Volatility-Regime ATR Multiplier)
 *
 * Kết quả nghiên cứu (research/atrbot_adaptive_mult_v2.py, IMXUSDT 15m, VIDYA 14-2-21):
 *   - ATRBot gốc (atrMult cố định = 2.0): baseline win rate ~70.55% (n=523, rule MFE>2%/cycle).
 *   - Nguyên nhân thua chính = whipsaw: khi ATR% (biến động thật) đang ở vùng THẤP so với lịch sử,
 *     băng trail2 = trail1 ± ATR×mult nằm rất gần trail1 -> chỉ 1 nến nhiễu nhỏ cũng đủ cắt qua
 *     band và sinh tín hiệu đảo chiều GIẢ (không phải trend thật đổi hướng).
 *   - Sửa: thay vì atrMult cố định, dùng công thức "M1" — co giãn atrMult theo percentile-rank
 *     của ATR% trong một cửa sổ quá khứ dài (mặc định 5000 nến ~52 ngày @ 15m):
 *         atrMult_adaptive(i) = baseMult * (1 + K * (1 - percentile_rank(ATR%, window)))
 *     Khi ATR% đang ở percentile thấp (thị trường choppy/sideway so với lịch sử) -> band tự
 *     RỘNG RA (giảm nhạy với nhiễu). Khi ATR% ở percentile cao (breakout/trend thật) -> band giữ
 *     gần baseMult (vẫn nhạy để bắt tín hiệu sớm).
 *   - Kết quả backtest tốt nhất: window=5000, K=1.5 -> win rate 80.83% (n=339, giữ 65% tín hiệu
 *     gốc) — vượt trội so với lọc hậu kỳ ATR%>=percentile-70 (76.69%, chỉ giữ 25% tín hiệu).
 *
 * Toàn bộ percentile-rank được tính CAUSAL (chỉ dùng dữ liệu quá khứ tại mỗi nến, rolling window),
 * không có lookahead.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(globalObj && globalObj.SMC, globalObj && globalObj.IndicatorRegistry);
  } else {
    const inst = factory(globalObj && globalObj.SMC, globalObj && globalObj.IndicatorRegistry);
    if (globalObj) {
      globalObj.ATRBotM1Indicator = inst;
      globalObj.ATRBotIndicator = inst;
    }
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function (SMC, IndicatorRegistry) {
  'use strict';

  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(168, 85, 247, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  /**
   * Causal rolling percentile-rank of the LAST value inside a trailing window.
   * Uses an efficient approach: maintain the window as a sorted insert would be O(n log n);
   * for typical chart sizes (<=100k bars) and window<=5000 this simple O(n*window/step) with a
   * sampled binary-search-free scan is fine, but we use a straightforward sliding technique
   * with a small sorted buffer (Array + binary insert) for O(n log window) performance.
   */
  function rollingPercentileRank(values, window, minPeriods) {
    const n = values.length;
    const out = new Array(n).fill(1.0); // before enough history: treat as "high percentile" (no widening)
    // sorted window buffer of {v} kept in ascending order, with insertion index tracked via bisect
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
      // insert current value
      const insPos = bisectLeft(buf, v);
      buf.splice(insPos, 0, v);
      // evict values that fell out of the window (window is on INDEX range [i-window+1, i])
      const windowStart = i - window + 1;
      if (windowStart > 0) {
        const evictVal = values[windowStart - 1];
        const evPos = bisectLeft(buf, evictVal);
        if (buf[evPos] === evictVal) buf.splice(evPos, 1);
      }
      const count = i + 1 >= minPeriods ? buf.length : -1;
      if (count > 0) {
        // percentile rank = fraction of window strictly less than v
        const lessPos = bisectLeft(buf, v);
        out[i] = lessPos / buf.length;
      }
    }
    return out;
  }

  const ATRBotM1Indicator = {
    id: 'atrbot_m1',
    name: 'ATRBot M1 (Adaptive Volatility-Regime Multiplier)',
    shortName: 'ATRBot M1',
    category: 'Trend & SMC Liquidity',
    tag: 'Adaptive ATR × VIDYA · Regime-Aware',
    desc: 'ATRBot với atrMult tự co giãn theo percentile-rank của ATR% (cửa sổ quá khứ dài) để giảm whipsaw trong vùng biến động thấp, thay vì lọc tín hiệu hậu kỳ.',
    color: '#a855f7',

    defaultInputs: {
      maType: { type: 'select', label: 'MA Calculation Method', value: 'VIDYA', options: ['VIDYA', 'EMA'] },
      cmoLength: { type: 'number', label: 'Chande Momentum (CMO) Length', value: 14, min: 1, max: 200, step: 1 },
      maLength: { type: 'number', label: 'MA Smoothing Period', value: 21, min: 1, max: 500, step: 1 },
      atrLength: { type: 'number', label: 'ATR Volatility Period', value: 14, min: 1, max: 200, step: 1 },
      baseAtrMult: { type: 'number', label: 'Base ATR Multiplier', value: 2.0, min: 0.1, max: 20.0, step: 0.1 },
      percentileWindow: { type: 'number', label: 'Percentile Window (bars, ~5000=52d@15m)', value: 5000, min: 100, max: 20000, step: 100 },
      minPeriods: { type: 'number', label: 'Min Bars Before Adaptive Kicks In', value: 200, min: 20, max: 2000, step: 10 },
      adaptiveK: { type: 'number', label: 'Adaptive Strength K (0=off, best≈1.5)', value: 1.5, min: 0, max: 5, step: 0.1 },
      liqSweepFilterPct: { type: 'number', label: 'Extra Filter: Skip if Liquidity Pool Within (%) [0=off]', value: 0, min: 0, max: 10, step: 0.1 }
    },

    defaultStyle: {
      showRibbon: { type: 'checkbox', label: 'Display Ribbon Cloud Fill', value: true },
      bullCloudColor: { type: 'color', label: 'Bullish Cloud Color', value: '#10b981' },
      bearCloudColor: { type: 'color', label: 'Bearish Cloud Color', value: '#f43f5e' },
      showVidyaLine: { type: 'checkbox', label: 'Display VIDYA Line', value: true },
      vidyaColor: { type: 'color', label: 'VIDYA Color', value: '#a855f7' },
      showStopLine: { type: 'checkbox', label: 'Display Adaptive Trailing Stop', value: true },
      stopColor: { type: 'color', label: 'Stop Color', value: '#f59e0b' },
      showSignals: { type: 'checkbox', label: 'Display Buy/Sell Signals', value: true },
      showMultPanel: { type: 'checkbox', label: 'Show Adaptive Mult Debug Label', value: false }
    },

    calculate: function (candles, inputs) {
      const n = candles.length;
      if (n === 0) return [];

      const maType = (inputs.maType || 'VIDYA').toUpperCase();
      const cmoLength = Number(inputs.cmoLength) || 14;
      const maLength = Number(inputs.maLength) || 21;
      const atrLength = Number(inputs.atrLength) || 14;
      const baseMult = Number(inputs.baseAtrMult) || 2.0;
      const pctWindow = Number(inputs.percentileWindow) || 5000;
      const minPeriods = Number(inputs.minPeriods) || 200;
      const K = Number(inputs.adaptiveK) || 0;
      const liqFilterPct = Number(inputs.liqSweepFilterPct) || 0;

      const close = new Array(n), high = new Array(n), low = new Array(n);
      for (let i = 0; i < n; i++) {
        close[i] = candles[i].close;
        high[i] = candles[i].high;
        low[i] = candles[i].low;
      }

      // 1. True Range + Wilder ATR (causal)
      const tr = new Array(n);
      tr[0] = high[0] - low[0];
      for (let i = 1; i < n; i++) {
        tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
      }
      const atr = new Array(n);
      atr[0] = tr[0];
      for (let i = 1; i < n; i++) {
        atr[i] = (atr[i - 1] * (atrLength - 1) + tr[i]) / atrLength;
      }
      const atrPct = new Array(n);
      for (let i = 0; i < n; i++) atrPct[i] = close[i] > 0 ? (atr[i] / close[i] * 100.0) : 0;

      // 2. Causal rolling percentile-rank of ATR% -> adaptive multiplier per bar
      const pctRank = rollingPercentileRank(atrPct, pctWindow, minPeriods);
      const multArr = new Array(n);
      for (let i = 0; i < n; i++) {
        multArr[i] = baseMult * (1 + K * (1 - pctRank[i]));
      }

      // 3. VIDYA (Trail1) + Adaptive ATR Trailing Stop (Trail2), same ratchet logic as atrBot()
      const trail1 = new Array(n), trail2 = new Array(n);
      const isBuy = new Array(n).fill(false), isSell = new Array(n).fill(false);
      const trendArr = new Array(n).fill(0);
      const emaAlpha = 2.0 / (maLength + 1);
      const gains = [], losses = [];
      let prevTrend = 0;

      for (let i = 0; i < n; i++) {
        const src = close[i];
        if (i === 0) {
          trail1[0] = src;
        } else if (maType === 'VIDYA') {
          const change = src - close[i - 1];
          gains.push(Math.max(change, 0));
          losses.push(Math.max(-change, 0));
          if (gains.length > cmoLength) { gains.shift(); losses.shift(); }
          let sg = 0, sl = 0;
          for (let k = 0; k < gains.length; k++) { sg += gains[k]; sl += losses[k]; }
          const tot = sg + sl;
          const cmo = tot > 0 ? ((sg - sl) / tot * 100.0) : 0.0;
          const alpha = emaAlpha * (Math.abs(cmo) / 100.0);
          trail1[i] = alpha * src + (1 - alpha) * trail1[i - 1];
        } else {
          trail1[i] = emaAlpha * src + (1 - emaAlpha) * trail1[i - 1];
        }

        const atrVal = atr[i] * multArr[i];
        if (i === 0) {
          trail2[0] = trail1[0];
        } else {
          const t2p = trail2[i - 1], t1p = trail1[i - 1], t1c = trail1[i];
          if (t1c > t2p) {
            trail2[i] = (t1p > t2p) ? Math.max(t2p, t1c - atrVal) : (t1c - atrVal);
          } else {
            trail2[i] = (t1c < t2p && t1p < t2p) ? Math.min(t2p, t1c + atrVal) : (t1c + atrVal);
          }
          const curTrend = trail1[i] > trail2[i] ? 1 : (trail1[i] < trail2[i] ? -1 : prevTrend);
          trendArr[i] = curTrend;
          isBuy[i] = curTrend === 1 && prevTrend === -1;
          isSell[i] = curTrend === -1 && prevTrend === 1;
          prevTrend = curTrend;
        }
      }

      // 4. Optional extra filter: skip signal if a same-direction unswept liquidity pool sits
      //    within liqFilterPct% (validated: +4pp lift on top of M1 alone at threshold=3%).
      if (liqFilterPct > 0) {
        const smcEngine = SMC || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null);
        if (smcEngine && typeof smcEngine.swing_highs_lows === 'function' && typeof smcEngine.liquidity === 'function') {
          try {
            const swingLen = 20;
            const swings = smcEngine.swing_highs_lows(candles, { swing_length: swingLen });
            const liqList = smcEngine.liquidity(candles, swings, { rangePercent: 0.01 }) || [];
            // strict-causal zones: use the swing's OWN level (no future-averaged group level)
            // NOTE: field names below (lowercase) must match the current JS port's output
            // shape ({liquidity, level, end, swept}) — a prior PascalCase mismatch here
            // (Liquidity/Level/End/Swept) silently made `zones` always empty, so this
            // filter was a complete no-op regardless of `liqSweepFilterPct`.
            const zones = [];
            for (let i = 0; i < liqList.length; i++) {
              const item = liqList[i];
              if (!item || item.liquidity === null || isNaN(item.liquidity)) continue;
              const sw = swings[i];
              if (!sw || sw.level === null || isNaN(sw.level)) continue;
              zones.push({
                start: i + swingLen,
                end: (item.end !== null && !isNaN(item.end)) ? item.end : 999999,
                swept: (item.swept !== null && !isNaN(item.swept) && item.swept > 0) ? item.swept : null,
                type: item.liquidity === 1 ? 'BSL' : 'SSL',
                level: sw.level
              });
            }
            for (let i = 0; i < n; i++) {
              if (!isBuy[i] && !isSell[i]) continue;
              const dir = isBuy[i] ? 1 : -1;
              const price = close[i];
              let nearest = Infinity;
              for (let zi = 0; zi < zones.length; zi++) {
                const z = zones[zi];
                if (!(z.start <= i && i <= z.end)) continue;
                if (z.swept !== null && z.swept <= i) continue;
                let d;
                if (dir === 1 && z.type === 'BSL' && z.level > price) d = (z.level - price) / price * 100.0;
                else if (dir === -1 && z.type === 'SSL' && z.level < price) d = (price - z.level) / price * 100.0;
                else continue;
                if (d < nearest) nearest = d;
              }
              if (isFinite(nearest) && nearest <= liqFilterPct) {
                // too close to a liquidity magnet -> likely a stop-hunt whipsaw, skip the signal
                isBuy[i] = false;
                isSell[i] = false;
              }
            }
          } catch (e) {
            console.warn('ATRBot M1: liquidity filter failed, skipping filter step.', e);
          }
        }
      }

      const results = new Array(n);
      for (let i = 0; i < n; i++) {
        results[i] = {
          time: candles[i].time,
          trail1: trail1[i],
          trail2: trail2[i],
          trend: trendArr[i],
          isBuy: isBuy[i],
          isSell: isSell[i],
          atr: atr[i],
          atrPct: atrPct[i],
          adaptiveMult: multArr[i],
          pctRank: pctRank[i]
        };
      }
      return results;
    },

    renderCanvas: function (ctx, data, style, helpers) {
      if (!data || data.length < 2) return;
      const { getX, getY, fromTime, toTime } = helpers;
      const n = data.length;

      ctx.save();

      // 1. Ribbon cloud between trail1/trail2
      if (style.showRibbon !== false) {
        for (let i = 1; i < n; i++) {
          const p1 = data[i - 1], p2 = data[i];
          if (p2.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (p1.time > toTime && i > 1 && data[i - 2].time > toTime) continue;
          const x1 = getX(p1.time), x2 = getX(p2.time);
          const y1a = getY(p1.trail1), y1b = getY(p1.trail2);
          const y2a = getY(p2.trail1), y2b = getY(p2.trail2);
          if (x1 === null || x2 === null || y1a === null || y1b === null || y2a === null || y2b === null) continue;
          const isBull = p2.trail1 >= p2.trail2;
          ctx.fillStyle = isBull
            ? hexToRgba(style.bullCloudColor || '#10b981', 0.16)
            : hexToRgba(style.bearCloudColor || '#f43f5e', 0.16);
          ctx.beginPath();
          ctx.moveTo(x1, y1a); ctx.lineTo(x2, y2a); ctx.lineTo(x2, y2b); ctx.lineTo(x1, y1b);
          ctx.closePath(); ctx.fill();
        }
      }

      // 2. VIDYA line
      if (style.showVidyaLine !== false) {
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = style.vidyaColor || '#a855f7';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (item.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (item.time > toTime && i > 0 && data[i - 1].time > toTime) continue;
          const x = getX(item.time), y = getY(item.trail1);
          if (x === null || y === null) continue;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      }

      // 3. Adaptive trailing stop line
      if (style.showStopLine !== false) {
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = style.stopColor || '#f59e0b';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (item.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (item.time > toTime && i > 0 && data[i - 1].time > toTime) continue;
          const x = getX(item.time), y = getY(item.trail2);
          if (x === null || y === null) continue;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      }

      // 4. Buy/Sell signal markers
      if (style.showSignals !== false) {
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (!item.isBuy && !item.isSell) continue;
          if (item.time < fromTime || item.time > toTime) continue;
          const x = getX(item.time), y = getY(item.trail2);
          if (x === null || y === null) continue;
          const isBuy = item.isBuy;
          const label = isBuy ? '▲ BUY' : '▼ SELL';
          const bgColor = isBuy ? '#10b981' : '#f43f5e';
          const pillY = isBuy ? y + 18 : y - 18;
          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          const textW = ctx.measureText(label).width;
          const badgeW = textW + 10, badgeH = 15;
          // Cờ do PnfLevels.gradeSignals() gắn (nếu trang có dùng mức P&F):
          // bị mức chắn ngay trước mặt -> làm mờ; tựa vào mức -> viền trắng.
          ctx.globalAlpha = item.pnfBlocked ? 0.3 : 1.0;
          ctx.fillStyle = bgColor;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH, 4);
            ctx.fill();
            if (item.pnfConfirm) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.stroke(); }
          } else {
            ctx.fillRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH);
            if (item.pnfConfirm) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.strokeRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH); }
          }
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, x, pillY);

          if (style.showMultPanel) {
            ctx.fillStyle = '#a855f7';
            ctx.font = '8px "JetBrains Mono", monospace';
            ctx.fillText(`x${item.adaptiveMult.toFixed(2)}`, x, pillY + (isBuy ? 12 : -12));
          }
          ctx.globalAlpha = 1.0;
        }
      }

      ctx.restore();
    }
  };

  if (IndicatorRegistry) {
    IndicatorRegistry.register(ATRBotM1Indicator);
  }

  return ATRBotM1Indicator;
}));
