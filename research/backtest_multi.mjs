// Backtest mở rộng: so sánh 17 "mô hình entry" (kết hợp ATRBot + SMC) trên 10
// symbol Binance Futures x 100,000 nến 15m mỗi symbol.
//
// Quy tắc thắng/thua GIỮ NGUYÊN như research/backtest_entry_models.mjs (đọc
// file đó để biết chi tiết): không phí, limit khớp khi râu chạm, market khớp
// ở open nến kế tiếp, WIN nếu MFE (Maximum Favorable Excursion) trong "vòng
// đời" lệnh đạt >= 2%, ngược lại LOSE. Limit không khớp trước deadline = NO
// FILL (loại khỏi win/lose, báo cáo riêng % khớp).
//
// Chạy: node research/backtest_multi.mjs
// Kết quả: in bảng tổng hợp ra console + ghi research/results_multi.json
// (dùng để viết báo cáo research/REPORT.md).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import SMC from "../src/index.js";
import { DEFAULT_SESSIONS } from "../src/indicators/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.SMC_BACKTEST_DATA_DIR || path.join(__dirname, "data");

function loadUmd(file) {
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.SMC = SMC;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
  return sandbox;
}
const ATRBotM1 = loadUmd("indicator_atrbot_m1.js").ATRBotM1Indicator;
const StatefulBosChoch = loadUmd("stateful_bos_choch.js").StatefulBosChoch;
const DynamicSwingHL = loadUmd("dynamic_swing_hl.js").DynamicSwingHL;

const SWING_LEN = 20;
const DYN_OPTS = { baseWindow: 20, atrLength: 14, adaptiveK: 1.5, percentileWindow: 3000, minPeriods: 100, minBars: 5, maxBars: 100 };

function runAtrBot(candles, adaptiveK, liqSweepFilterPct = 0) {
  return ATRBotM1.calculate(candles, {
    maType: "VIDYA", cmoLength: 14, maLength: 21, atrLength: 14,
    baseAtrMult: 2.0, percentileWindow: 5000, minPeriods: 200,
    adaptiveK, liqSweepFilterPct,
  });
}

function isSessionActive(sessionsArr, i) {
  return sessionsArr[i] && sessionsArr[i].active === 1;
}

// ---- Tiện ích backtest (giống hệt backtest_entry_models.mjs) ----

function nextOppositeAtrSignal(atrArr, N, fromIndex, direction) {
  for (let k = fromIndex + 1; k < N; k++) {
    if (direction === 1 && atrArr[k].isSell) return k;
    if (direction === -1 && atrArr[k].isBuy) return k;
  }
  return N - 1;
}

function mfeHitsTarget(candles, N, entryPrice, direction, entryIndexExclusive, deadlineInclusive, targetPct) {
  for (let k = entryIndexExclusive + 1; k <= deadlineInclusive && k < N; k++) {
    const favorable = direction === 1
      ? (candles[k].high - entryPrice) / entryPrice * 100
      : (entryPrice - candles[k].low) / entryPrice * 100;
    if (favorable >= targetPct) return k;
  }
  return -1;
}

function evalOrder(candles, N, { signalIndex, direction, kind, limitPrice, deadlineIndex }) {
  let fillIndex, fillPrice;
  if (kind === "market") {
    fillIndex = signalIndex + 1;
    if (fillIndex >= N) return null;
    fillPrice = candles[fillIndex].open;
  } else {
    fillIndex = -1;
    for (let k = signalIndex + 1; k <= deadlineIndex && k < N; k++) {
      const touched = direction === 1 ? candles[k].low <= limitPrice : candles[k].high >= limitPrice;
      if (touched) { fillIndex = k; break; }
    }
    if (fillIndex === -1) return { filled: false };
    fillPrice = limitPrice;
  }
  const hit2 = mfeHitsTarget(candles, N, fillPrice, direction, fillIndex, deadlineIndex, 2);
  const hit4 = mfeHitsTarget(candles, N, fillPrice, direction, fillIndex, deadlineIndex, 4);
  const hit6 = mfeHitsTarget(candles, N, fillPrice, direction, fillIndex, deadlineIndex, 6);
  return { filled: true, win: hit2 !== -1, hit4: hit4 !== -1, hit6: hit6 !== -1, barsToWin: hit2 !== -1 ? hit2 - fillIndex : null };
}

function invalidationIndex(candles, N, fromIndex, direction, level, isTop) {
  // direction 1 (bullish zone): invalidate khi low phá xuống dưới `level` (bottom).
  // direction -1 (bearish zone): invalidate khi high phá lên trên `level` (top).
  for (let k = fromIndex + 1; k < N; k++) {
    if (isTop ? candles[k].high > level : candles[k].low < level) return k;
  }
  return N - 1;
}

// ---------------------------------------------------------------------------
// Định nghĩa 17 mô hình. Mỗi hàm nhận `ctx` (mọi mảng chỉ báo đã tính trước
// cho 1 symbol) và trả về mảng orders (kết quả evalOrder / object tự chế cho
// M8 multi-entry).
// ---------------------------------------------------------------------------
const MODELS = [
  {
    id: "M1", name: "ATRBot gốc (mult cố định, market)",
    run(ctx) {
      const { candles, N, atrFixed } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (atrFixed[i].isBuy) orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrFixed, N, i, 1) }));
        else if (atrFixed[i].isSell) orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrFixed, N, i, -1) }));
      }
      return orders;
    },
  },
  {
    id: "M2", name: "ATRBot M1 adaptive (market)",
    run(ctx) {
      const { candles, N, atrM1 } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (atrM1[i].isBuy) orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, 1) }));
        else if (atrM1[i].isSell) orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, -1) }));
      }
      return orders;
    },
  },
  {
    id: "M3", name: "ATRBot M1 + xác nhận BOS/CHOCH gốc (market)",
    run(ctx) {
      const { candles, N, atrM1, bosChochArr } = ctx;
      const LOOKBACK = 30;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (!atrM1[i].isBuy && !atrM1[i].isSell) continue;
        const direction = atrM1[i].isBuy ? 1 : -1;
        let confirmed = false;
        for (let k = Math.max(0, i - LOOKBACK); k < i; k++) {
          const b = bosChochArr[k];
          if ((direction === 1 && (b.bos === 1 || b.choch === 1)) || (direction === -1 && (b.bos === -1 || b.choch === -1))) { confirmed = true; break; }
        }
        if (!confirmed) continue;
        orders.push(evalOrder(candles, N, { signalIndex: i, direction, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, direction) }));
      }
      return orders;
    },
  },
  {
    id: "M4", name: "ATRBot trend + retest Order Block (limit)",
    run(ctx) {
      const { candles, N, atrM1, ob } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (ob[i].ob === 1 && atrM1[i].trend === 1) {
          const invalidAt = invalidationIndex(candles, N, i, 1, ob[i].bottom, false);
          const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, N, i, 1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "limit", limitPrice: ob[i].top, deadlineIndex: deadline }));
        } else if (ob[i].ob === -1 && atrM1[i].trend === -1) {
          const invalidAt = invalidationIndex(candles, N, i, -1, ob[i].top, true);
          const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, N, i, -1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "limit", limitPrice: ob[i].bottom, deadlineIndex: deadline }));
        }
      }
      return orders;
    },
  },
  {
    id: "M5", name: "ATRBot trend + retest FVG (limit)",
    run(ctx) {
      const { candles, N, atrM1, fvgArr } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (fvgArr[i].fvg === 1 && atrM1[i].trend === 1) {
          const deadline = Math.min(fvgArr[i].mitigatedIndex || N - 1, nextOppositeAtrSignal(atrM1, N, i, 1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "limit", limitPrice: fvgArr[i].top, deadlineIndex: deadline || N - 1 }));
        } else if (fvgArr[i].fvg === -1 && atrM1[i].trend === -1) {
          const deadline = Math.min(fvgArr[i].mitigatedIndex || N - 1, nextOppositeAtrSignal(atrM1, N, i, -1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "limit", limitPrice: fvgArr[i].bottom, deadlineIndex: deadline || N - 1 }));
        }
      }
      return orders;
    },
  },
  {
    id: "M6", name: "Liquidity Sweep + Reject (market, độc lập ATRBot)",
    run(ctx) {
      const { candles, N, liq } = ctx;
      const DEADLINE_BARS = 96;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (liq[i].liquidity === -1 && liq[i].swept) {
          const k = liq[i].swept;
          if (k > 0 && k < N - 1 && candles[k].close > liq[i].level) {
            orders.push(evalOrder(candles, N, { signalIndex: k, direction: 1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
          }
        } else if (liq[i].liquidity === 1 && liq[i].swept) {
          const k = liq[i].swept;
          if (k > 0 && k < N - 1 && candles[k].close < liq[i].level) {
            orders.push(evalOrder(candles, N, { signalIndex: k, direction: -1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
          }
        }
      }
      return orders;
    },
  },
  {
    id: "M7", name: "BOS/CHOCH gốc breakout + chờ retest mức phá (limit)",
    run(ctx) {
      const { candles, N, bosChochArr } = ctx;
      const DEADLINE_BARS = 50;
      const orders = [];
      for (let i = 0; i < N; i++) {
        const b = bosChochArr[i];
        if (b.brokenIndex === null || b.brokenIndex === undefined) continue;
        const j = b.brokenIndex;
        if (j < i || j >= N) continue;
        if (b.bos === 1 || b.choch === 1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: 1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        } else if (b.bos === -1 || b.choch === -1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: -1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        }
      }
      return orders;
    },
  },
  {
    id: "M8", name: "Multi-entry DCA: OB+FVG hợp lưu, 2 lệnh (limit)",
    run(ctx) {
      const { candles, N, atrM1, ob, fvgArr } = ctx;
      const orders = [];
      function findConfluentFvg(i, dir, obTop, obBottom) {
        for (let k = Math.max(0, i - 20); k <= Math.min(N - 1, i + 20); k++) {
          const f = fvgArr[k];
          if (f.fvg !== dir) continue;
          const overlap = Math.min(f.top, obTop) - Math.max(f.bottom, obBottom);
          if (overlap > 0) return f;
        }
        return null;
      }
      for (let i = 0; i < N; i++) {
        if (ob[i].ob === 1 && atrM1[i].trend === 1) {
          const f = findConfluentFvg(i, 1, ob[i].top, ob[i].bottom);
          if (!f) continue;
          const invalidAt = invalidationIndex(candles, N, i, 1, ob[i].bottom, false);
          const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, N, i, 1));
          const legs = [{ price: f.top, weight: 0.5 }, { price: ob[i].top, weight: 0.5 }].sort((a, b) => b.price - a.price);
          let fillIdx = -1, weightedSum = 0, weightFilled = 0;
          for (const leg of legs) {
            for (let k = i + 1; k <= deadline && k < N; k++) {
              if (candles[k].low <= leg.price) { fillIdx = Math.max(fillIdx, k); weightedSum += leg.price * leg.weight; weightFilled += leg.weight; break; }
            }
          }
          if (weightFilled === 0) { orders.push({ filled: false }); continue; }
          const avgEntry = weightedSum / weightFilled;
          const hit2 = mfeHitsTarget(candles, N, avgEntry, 1, fillIdx, deadline, 2);
          const hit4 = mfeHitsTarget(candles, N, avgEntry, 1, fillIdx, deadline, 4);
          const hit6 = mfeHitsTarget(candles, N, avgEntry, 1, fillIdx, deadline, 6);
          orders.push({ filled: true, win: hit2 !== -1, hit4: hit4 !== -1, hit6: hit6 !== -1, barsToWin: hit2 !== -1 ? hit2 - fillIdx : null });
        }
      }
      return orders;
    },
  },
  {
    id: "M9", name: "Retracement 50% pullback theo trend ATRBot (market)",
    run(ctx) {
      const { candles, N, atrM1, retr } = ctx;
      const orders = [];
      for (let i = 1; i < N; i++) {
        const prev = retr[i - 1], cur = retr[i];
        // direction=1: vừa tạo đỉnh, đang thoái lui xuống (mua đáy hồi trong uptrend)
        if (cur.direction === 1 && atrM1[i].trend === 1 && prev.currentRetracementPct < 50 && cur.currentRetracementPct >= 50) {
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, 1) }));
        }
        // direction=-1: vừa tạo đáy, đang hồi lên (bán đỉnh hồi trong downtrend)
        if (cur.direction === -1 && atrM1[i].trend === -1 && prev.currentRetracementPct < 50 && cur.currentRetracementPct >= 50) {
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, -1) }));
        }
      }
      return orders;
    },
  },
  {
    id: "M10", name: "ATRBot M1 + xác nhận StatefulBosChoch (market)",
    run(ctx) {
      const { candles, N, atrM1, statefulBos } = ctx;
      const LOOKBACK = 30;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (!atrM1[i].isBuy && !atrM1[i].isSell) continue;
        const direction = atrM1[i].isBuy ? 1 : -1;
        let confirmed = false;
        for (let k = Math.max(0, i - LOOKBACK); k < i; k++) {
          const b = statefulBos[k];
          if ((direction === 1 && (b.bos === 1 || b.choch === 1)) || (direction === -1 && (b.bos === -1 || b.choch === -1))) { confirmed = true; break; }
        }
        if (!confirmed) continue;
        orders.push(evalOrder(candles, N, { signalIndex: i, direction, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, direction) }));
      }
      return orders;
    },
  },
  {
    id: "M11", name: "StatefulBosChoch breakout + chờ retest mức phá (limit)",
    run(ctx) {
      const { candles, N, statefulBos } = ctx;
      const DEADLINE_BARS = 50;
      const orders = [];
      for (let i = 0; i < N; i++) {
        const b = statefulBos[i];
        if (b.brokenIndex === null || b.brokenIndex === undefined) continue;
        const j = b.brokenIndex;
        if (j < i || j >= N) continue;
        if (b.bos === 1 || b.choch === 1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: 1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        } else if (b.bos === -1 || b.choch === -1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: -1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        }
      }
      return orders;
    },
  },
  {
    id: "M12", name: "ATRBot trend + retest Order Block (Dynamic Swing, limit)",
    run(ctx) {
      const { candles, N, atrM1, obDyn } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (obDyn[i].ob === 1 && atrM1[i].trend === 1) {
          const invalidAt = invalidationIndex(candles, N, i, 1, obDyn[i].bottom, false);
          const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, N, i, 1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "limit", limitPrice: obDyn[i].top, deadlineIndex: deadline }));
        } else if (obDyn[i].ob === -1 && atrM1[i].trend === -1) {
          const invalidAt = invalidationIndex(candles, N, i, -1, obDyn[i].top, true);
          const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, N, i, -1));
          orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "limit", limitPrice: obDyn[i].bottom, deadlineIndex: deadline }));
        }
      }
      return orders;
    },
  },
  {
    id: "M13", name: "BOS/CHOCH breakout + retest (Dynamic Swing, limit)",
    run(ctx) {
      const { candles, N, bosChochDyn } = ctx;
      const DEADLINE_BARS = 50;
      const orders = [];
      for (let i = 0; i < N; i++) {
        const b = bosChochDyn[i];
        if (b.brokenIndex === null || b.brokenIndex === undefined) continue;
        const j = b.brokenIndex;
        if (j < i || j >= N) continue;
        if (b.bos === 1 || b.choch === 1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: 1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        } else if (b.bos === -1 || b.choch === -1) {
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: -1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        }
      }
      return orders;
    },
  },
  {
    id: "M14", name: "Liquidity Sweep + Reject (Dynamic Swing, market)",
    run(ctx) {
      const { candles, N, liqDyn } = ctx;
      const DEADLINE_BARS = 96;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (liqDyn[i].liquidity === -1 && liqDyn[i].swept) {
          const k = liqDyn[i].swept;
          if (k > 0 && k < N - 1 && candles[k].close > liqDyn[i].level) {
            orders.push(evalOrder(candles, N, { signalIndex: k, direction: 1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
          }
        } else if (liqDyn[i].liquidity === 1 && liqDyn[i].swept) {
          const k = liqDyn[i].swept;
          if (k > 0 && k < N - 1 && candles[k].close < liqDyn[i].level) {
            orders.push(evalOrder(candles, N, { signalIndex: k, direction: -1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
          }
        }
      }
      return orders;
    },
  },
  {
    id: "M15", name: "Breaker Block retest (limit, độc lập ATRBot)",
    run(ctx) {
      const { candles, N, ob } = ctx;
      const DEADLINE_BARS = 100;
      const orders = [];
      for (let i = 0; i < N; i++) {
        // OB tăng bị hoà giải (mitigated) -> trở thành breaker GIẢM: chờ giá
        // hồi lên retest đúng đỉnh vùng (top) rồi bán.
        if (ob[i].ob === 1 && ob[i].mitigatedIndex) {
          const j = ob[i].mitigatedIndex;
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: -1, kind: "limit", limitPrice: ob[i].top, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        }
        // OB giảm bị hoà giải -> breaker TĂNG: chờ giá hồi xuống retest đáy vùng rồi mua.
        if (ob[i].ob === -1 && ob[i].mitigatedIndex) {
          const j = ob[i].mitigatedIndex;
          orders.push(evalOrder(candles, N, { signalIndex: j, direction: 1, kind: "limit", limitPrice: ob[i].bottom, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
        }
      }
      return orders;
    },
  },
  {
    id: "M16", name: "ATRBot M1 + lọc khoảng cách Liquidity built-in (market)",
    run(ctx) {
      const { candles, N, atrM1LiqFiltered } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (atrM1LiqFiltered[i].isBuy) orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1LiqFiltered, N, i, 1) }));
        else if (atrM1LiqFiltered[i].isSell) orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1LiqFiltered, N, i, -1) }));
      }
      return orders;
    },
  },
  {
    id: "M17", name: "ATRBot M1 chỉ trong phiên London+NY (market)",
    run(ctx) {
      const { candles, N, atrM1, sessionActive } = ctx;
      const orders = [];
      for (let i = 0; i < N; i++) {
        if (!sessionActive[i]) continue;
        if (atrM1[i].isBuy) orders.push(evalOrder(candles, N, { signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, 1) }));
        else if (atrM1[i].isSell) orders.push(evalOrder(candles, N, { signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, N, i, -1) }));
      }
      return orders;
    },
  },
];

function buildContext(candles) {
  const N = candles.length;
  const swingHL = SMC.swingHighsLows(candles, { swingLength: SWING_LEN });
  const bosChochArr = SMC.bosChoch(candles, swingHL, { closeBreak: true });
  const statefulBos = StatefulBosChoch.calculate(candles, swingHL, { closeBreak: true });
  const ob = SMC.orderBlocks(candles, swingHL, { closeMitigation: false });
  const fvgArr = SMC.fvg(candles, { joinConsecutive: false });
  const liq = SMC.liquidity(candles, swingHL, { rangePercent: 0.01 });
  const retr = SMC.retracements(candles, swingHL);

  const swingDyn = DynamicSwingHL.calculate(candles, DYN_OPTS).swingHL;
  const bosChochDyn = SMC.bosChoch(candles, swingDyn, { closeBreak: true });
  const obDyn = SMC.orderBlocks(candles, swingDyn, { closeMitigation: false });
  const liqDyn = SMC.liquidity(candles, swingDyn, { rangePercent: 0.01 });

  const atrFixed = runAtrBot(candles, 0);
  const atrM1 = runAtrBot(candles, 1.5);
  const atrM1LiqFiltered = runAtrBot(candles, 1.5, 3);

  const london = SMC.sessions(candles, { session: "London" });
  const ny = SMC.sessions(candles, { session: "New York" });
  const sessionActive = new Array(N);
  for (let i = 0; i < N; i++) sessionActive[i] = london[i].active === 1 || ny[i].active === 1;

  return { candles, N, swingHL, bosChochArr, statefulBos, ob, fvgArr, liq, retr, bosChochDyn, obDyn, liqDyn, atrFixed, atrM1, atrM1LiqFiltered, sessionActive };
}

function summarize(orders) {
  const filled = orders.filter((o) => o && o.filled);
  const wins = filled.filter((o) => o.win).length;
  const hit4 = filled.filter((o) => o.hit4).length;
  const hit6 = filled.filter((o) => o.hit6).length;
  const barsArr = filled.filter((o) => o.barsToWin !== null).map((o) => o.barsToWin);
  return {
    signals: orders.length,
    filled: filled.length,
    wins,
    hit4,
    hit6,
    barsSum: barsArr.reduce((a, b) => a + b, 0),
    barsCount: barsArr.length,
  };
}

function addInto(acc, s) {
  acc.signals += s.signals;
  acc.filled += s.filled;
  acc.wins += s.wins;
  acc.hit4 += s.hit4;
  acc.hit6 += s.hit6;
  acc.barsSum += s.barsSum;
  acc.barsCount += s.barsCount;
}

const dataFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith("_15m.json"));
if (dataFiles.length === 0) {
  console.error("Không tìm thấy dữ liệu trong research/data/. Chạy research/fetch_multi.mjs trước.");
  process.exit(1);
}

const perModel = {};
for (const m of MODELS) perModel[m.id] = { name: m.name, total: { signals: 0, filled: 0, wins: 0, hit4: 0, hit6: 0, barsSum: 0, barsCount: 0 }, bySymbol: {} };

for (const file of dataFiles) {
  const symbol = file.replace("_15m.json", "");
  const candles = JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8"));
  console.log(`\n=== ${symbol}: ${candles.length} nến ===`);
  const ctx = buildContext(candles);
  for (const m of MODELS) {
    const orders = m.run(ctx);
    const s = summarize(orders);
    perModel[m.id].bySymbol[symbol] = s;
    addInto(perModel[m.id].total, s);
    const winRate = s.filled ? (s.wins / s.filled * 100).toFixed(1) : "n/a";
    console.log(`  ${m.id.padEnd(4)} ${m.name.padEnd(52)} tín hiệu=${String(s.signals).padStart(5)} khớp=${String(s.filled).padStart(5)} win=${String(winRate).padStart(6)}%`);
  }
}

console.log("\n\n=========== TỔNG HỢP TOÀN BỘ 10 SYMBOL (POOLED) ===========\n");
const summaryRows = [];
for (const m of MODELS) {
  const t = perModel[m.id].total;
  const winRate = t.filled ? (t.wins / t.filled * 100) : null;
  const hit4Rate = t.filled ? (t.hit4 / t.filled * 100) : null;
  const hit6Rate = t.filled ? (t.hit6 / t.filled * 100) : null;
  const fillRate = t.signals ? (t.filled / t.signals * 100) : null;
  const avgBars = t.barsCount ? (t.barsSum / t.barsCount) : null;
  summaryRows.push({ id: m.id, name: m.name, signals: t.signals, filled: t.filled, fillRate, winRate, hit4Rate, hit6Rate, avgBars });
  console.log(
    `${m.id.padEnd(4)} ${m.name.padEnd(56)} tín hiệu=${String(t.signals).padStart(6)}  khớp=${t.filled} (${fillRate ? fillRate.toFixed(1) : "n/a"}%)  ` +
    `win(>2%)=${winRate !== null ? winRate.toFixed(2) + "%" : "n/a"}  (>4%)=${hit4Rate !== null ? hit4Rate.toFixed(1) + "%" : "n/a"}  (>6%)=${hit6Rate !== null ? hit6Rate.toFixed(1) + "%" : "n/a"}  avgBars->2%=${avgBars !== null ? avgBars.toFixed(1) : "n/a"}`
  );
}

writeFileSync(path.join(__dirname, "results_multi.json"), JSON.stringify({ perModel, summaryRows, symbols: dataFiles.map((f) => f.replace("_15m.json", "")) }, null, 2));
console.log("\nĐã ghi research/results_multi.json");
