// Backtest so sánh nhiều "mô hình entry" kết hợp ATRBot (trend/regime) + SMC
// (swing / BOS-CHOCH / Order Block / FVG / Liquidity / Retracement).
//
// QUY TẮC THẮNG/THUA (theo đúng yêu cầu, KHÔNG phải backtest PnL đầy đủ):
//   - Không tính phí (fee = 0).
//   - Lệnh LIMIT được coi là khớp ngay khi có RÂU (wick) chạm mức giá limit,
//     không cần nến đóng cửa qua mức đó, không mô phỏng slippage.
//   - Lệnh MARKET khớp tại giá open của nến kế tiếp sau tín hiệu (causal,
//     không lookahead).
//   - Sau khi khớp, đo "Maximum Favorable Excursion" (MFE) — mức đi xa nhất
//     THEO ĐÚNG HƯỚNG lệnh, tính bằng % so với giá vào — trong suốt "vòng đời"
//     của lệnh. Nếu MFE >= 2% tại bất kỳ thời điểm nào -> WIN, ngược lại LOSE.
//   - "Vòng đời" (cycle) mặc định = tới khi có tín hiệu ATRBot NGƯỢC HƯỚNG kế
//     tiếp (đổi regime), giống hệt quy ước "MFE>2%/cycle" đã dùng trong nghiên
//     cứu ATRBot M1 (xem indicator_atrbot_m1.js). Với các mô hình không gắn
//     trực tiếp vào regime ATRBot (vd Liquidity Sweep), dùng một deadline cố
//     định theo số nến.
//   - Lệnh limit không khớp trước deadline -> "NO FILL", không tính vào
//     win/lose (được báo cáo riêng thành % lấp đầy).
//
// Dữ liệu: dùng test/fixtures/EURUSD_15M.csv (đã có sẵn, offline, cùng bộ dữ
// liệu parity dùng xuyên suốt dự án) — CHỈ nhằm so sánh tương đối các mô hình
// trên cùng 1 tập dữ liệu, không nhằm tái lập đúng con số IMXUSDT trong
// docstring ATRBot M1 (khác tài sản, khác thị trường).
//
// Chạy: node research/backtest_entry_models.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import SMC from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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

function loadEurUsd() {
  const text = readFileSync(path.join(ROOT, "test/fixtures/EURUSD_15M.csv"), "utf8").trim();
  const rows = text.split("\n").slice(1).map((l) => l.split(","));
  return rows.map((r) => {
    const [dateStr, open, high, low, close, , volume] = r;
    const [d, t] = dateStr.split(" ");
    const [y, mo, da] = d.split(".").map(Number);
    const [h, mi, s] = t.split(":").map(Number);
    const time = Date.UTC(y, mo - 1, da, h, mi, s);
    return { time, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) };
  });
}

function loadImxUsdt() {
  return JSON.parse(readFileSync(path.join(__dirname, "data_imxusdt_15m.json"), "utf8"));
}

const DATASET = process.argv[2] === "imx" ? "imx" : "eurusd";
const candles = DATASET === "imx" ? loadImxUsdt() : loadEurUsd();
const N = candles.length;
console.log(`Loaded ${N} candles (${DATASET === "imx" ? "IMXUSDT Futures 15m, Binance" : "EURUSD 15M fixture"})\n`);

const SWING_LEN = 20;
const swingHL = SMC.swingHighsLows(candles, { swingLength: SWING_LEN });
const bosChochArr = SMC.bosChoch(candles, swingHL, { closeBreak: true });
const statefulBos = StatefulBosChoch.calculate(candles, swingHL, { closeBreak: true });
const ob = SMC.orderBlocks(candles, swingHL, { closeMitigation: false });
const fvgArr = SMC.fvg(candles, { joinConsecutive: false });
const liq = SMC.liquidity(candles, swingHL, { rangePercent: 0.01 });

function runAtrBot(adaptiveK) {
  return ATRBotM1.calculate(candles, {
    maType: "VIDYA", cmoLength: 14, maLength: 21, atrLength: 14,
    baseAtrMult: 2.0, percentileWindow: 5000, minPeriods: 200,
    adaptiveK, liqSweepFilterPct: 0,
  });
}
const atrFixed = runAtrBot(0);      // ATRBot gốc (atrMult cố định)
const atrM1 = runAtrBot(1.5);       // ATRBot M1 (adaptive mặc định)

// ---- Tiện ích chung ----

function nextOppositeAtrSignal(atrArr, fromIndex, direction) {
  for (let k = fromIndex + 1; k < N; k++) {
    if (direction === 1 && atrArr[k].isSell) return k;
    if (direction === -1 && atrArr[k].isBuy) return k;
  }
  return N - 1;
}

// MFE window (entryIndexExclusive, deadlineInclusive]; direction 1=long,-1=short.
function mfeHitsTarget(entryPrice, direction, entryIndexExclusive, deadlineInclusive, targetPct) {
  for (let k = entryIndexExclusive + 1; k <= deadlineInclusive && k < N; k++) {
    const favorable = direction === 1
      ? (candles[k].high - entryPrice) / entryPrice * 100
      : (entryPrice - candles[k].low) / entryPrice * 100;
    if (favorable >= targetPct) return k;
  }
  return -1;
}

function evalOrder({ signalIndex, direction, kind, limitPrice, deadlineIndex }) {
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
  const hit2 = mfeHitsTarget(fillPrice, direction, fillIndex, deadlineIndex, 2);
  const hit4 = mfeHitsTarget(fillPrice, direction, fillIndex, deadlineIndex, 4);
  const hit6 = mfeHitsTarget(fillPrice, direction, fillIndex, deadlineIndex, 6);
  return { filled: true, win: hit2 !== -1, hit4: hit4 !== -1, hit6: hit6 !== -1, barsToWin: hit2 !== -1 ? hit2 - fillIndex : null };
}

function report(name, orders) {
  const filled = orders.filter((o) => o && o.filled);
  const noFill = orders.filter((o) => o && !o.filled).length;
  const wins = filled.filter((o) => o.win).length;
  const winRate = filled.length ? (wins / filled.length * 100).toFixed(2) : "n/a";
  const fillRate = orders.length ? (filled.length / orders.length * 100).toFixed(1) : "n/a";
  const hit4 = filled.length ? (filled.filter((o) => o.hit4).length / filled.length * 100).toFixed(1) : "n/a";
  const hit6 = filled.length ? (filled.filter((o) => o.hit6).length / filled.length * 100).toFixed(1) : "n/a";
  const avgBars = filled.filter((o) => o.barsToWin !== null);
  const avgBarsToWin = avgBars.length ? (avgBars.reduce((a, o) => a + o.barsToWin, 0) / avgBars.length).toFixed(1) : "n/a";
  console.log(
    `${name.padEnd(42)} tín hiệu=${String(orders.length).padStart(4)}  khớp=${String(filled.length).padStart(4)} (${fillRate}%)  ` +
    `win-rate(>2%)=${String(winRate).padStart(6)}%  (>4%)=${hit4}%  (>6%)=${hit6}%  avgBars->2%=${avgBarsToWin}`
  );
  return { name, signals: orders.length, filled: filled.length, wins, winRate };
}

const results = [];

// ---------------------------------------------------------------------------
// M1. ATRBot gốc (atrMult cố định 2.0) — market, deadline=flip ngược tiếp theo
// ---------------------------------------------------------------------------
{
  const orders = [];
  for (let i = 0; i < N; i++) {
    if (atrFixed[i].isBuy) orders.push(evalOrder({ signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrFixed, i, 1) }));
    else if (atrFixed[i].isSell) orders.push(evalOrder({ signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrFixed, i, -1) }));
  }
  results.push(report("M1  ATRBot gốc (mult cố định, market)", orders));
}

// ---------------------------------------------------------------------------
// M2. ATRBot M1 adaptive — market, deadline=flip ngược tiếp theo
// ---------------------------------------------------------------------------
{
  const orders = [];
  for (let i = 0; i < N; i++) {
    if (atrM1[i].isBuy) orders.push(evalOrder({ signalIndex: i, direction: 1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, i, 1) }));
    else if (atrM1[i].isSell) orders.push(evalOrder({ signalIndex: i, direction: -1, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, i, -1) }));
  }
  results.push(report("M2  ATRBot M1 adaptive (market)", orders));
}

// ---------------------------------------------------------------------------
// M3. ATRBot M1 + xác nhận cấu trúc (BOS/CHOCH cùng hướng trong 30 nến trước)
// ---------------------------------------------------------------------------
{
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
    orders.push(evalOrder({ signalIndex: i, direction, kind: "market", deadlineIndex: nextOppositeAtrSignal(atrM1, i, direction) }));
  }
  results.push(report("M3  ATRBot M1 + xác nhận BOS/CHOCH (market)", orders));
}

// ---------------------------------------------------------------------------
// M4. ATRBot trend + limit retest Order Block cùng hướng
// ---------------------------------------------------------------------------
{
  const orders = [];
  for (let i = 0; i < N; i++) {
    if (ob[i].ob === 1 && atrM1[i].trend === 1) {
      const invalidAt = (() => { for (let k = i + 1; k < N; k++) if (candles[k].low < ob[i].bottom) return k; return N - 1; })();
      const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, i, 1));
      orders.push(evalOrder({ signalIndex: i, direction: 1, kind: "limit", limitPrice: ob[i].top, deadlineIndex: deadline }));
    } else if (ob[i].ob === -1 && atrM1[i].trend === -1) {
      const invalidAt = (() => { for (let k = i + 1; k < N; k++) if (candles[k].high > ob[i].top) return k; return N - 1; })();
      const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, i, -1));
      orders.push(evalOrder({ signalIndex: i, direction: -1, kind: "limit", limitPrice: ob[i].bottom, deadlineIndex: deadline }));
    }
  }
  results.push(report("M4  ATRBot trend + retest Order Block (limit)", orders));
}

// ---------------------------------------------------------------------------
// M5. ATRBot trend + limit retest FVG cùng hướng
// ---------------------------------------------------------------------------
{
  const orders = [];
  for (let i = 0; i < N; i++) {
    if (fvgArr[i].fvg === 1 && atrM1[i].trend === 1) {
      const deadline = Math.min(fvgArr[i].mitigatedIndex || N - 1, nextOppositeAtrSignal(atrM1, i, 1));
      orders.push(evalOrder({ signalIndex: i, direction: 1, kind: "limit", limitPrice: fvgArr[i].top, deadlineIndex: deadline || N - 1 }));
    } else if (fvgArr[i].fvg === -1 && atrM1[i].trend === -1) {
      const deadline = Math.min(fvgArr[i].mitigatedIndex || N - 1, nextOppositeAtrSignal(atrM1, i, -1));
      orders.push(evalOrder({ signalIndex: i, direction: -1, kind: "limit", limitPrice: fvgArr[i].bottom, deadlineIndex: deadline || N - 1 }));
    }
  }
  results.push(report("M5  ATRBot trend + retest FVG (limit)", orders));
}

// ---------------------------------------------------------------------------
// M6. Liquidity Sweep Reversal (độc lập ATRBot) — market, deadline cố định 96 nến (~1 ngày)
// ---------------------------------------------------------------------------
{
  const DEADLINE_BARS = 96;
  const orders = [];
  for (let i = 0; i < N; i++) {
    if (liq[i].liquidity === -1 && liq[i].swept) {
      const k = liq[i].swept;
      if (k > 0 && k < N - 1 && candles[k].close > liq[i].level) {
        orders.push(evalOrder({ signalIndex: k, direction: 1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
      }
    } else if (liq[i].liquidity === 1 && liq[i].swept) {
      const k = liq[i].swept;
      if (k > 0 && k < N - 1 && candles[k].close < liq[i].level) {
        orders.push(evalOrder({ signalIndex: k, direction: -1, kind: "market", deadlineIndex: Math.min(k + DEADLINE_BARS, N - 1) }));
      }
    }
  }
  results.push(report("M6  Liquidity Sweep + Reject (market, ngược regime)", orders));
}

// ---------------------------------------------------------------------------
// M7. BOS/CHOCH breakout -> limit chờ retest đúng mức bị phá (dùng bosChoch gốc)
// ---------------------------------------------------------------------------
{
  const DEADLINE_BARS = 50;
  const orders = [];
  for (let i = 0; i < N; i++) {
    const b = bosChochArr[i];
    if (b.brokenIndex === null || b.brokenIndex === undefined) continue;
    const j = b.brokenIndex;
    if (j < i || j >= N) continue;
    if (b.bos === 1 || b.choch === 1) {
      orders.push(evalOrder({ signalIndex: j, direction: 1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
    } else if (b.bos === -1 || b.choch === -1) {
      orders.push(evalOrder({ signalIndex: j, direction: -1, kind: "limit", limitPrice: b.level, deadlineIndex: Math.min(j + DEADLINE_BARS, N - 1) }));
    }
  }
  results.push(report("M7  BOS/CHOCH breakout + chờ retest mức phá (limit)", orders));
}

// ---------------------------------------------------------------------------
// M8. Multi-entry: DCA 2 lệnh limit vào vùng hợp lưu OB+FVG cùng hướng trend
// ---------------------------------------------------------------------------
{
  const orders = [];
  // Với mỗi OB mới hình thành cùng trend, tìm FVG cùng hướng gần nhất trong 20
  // nến trước/sau có overlap khoảng giá -> đặt 2 lệnh limit (FVG nông hơn 50%,
  // OB sâu hơn 50%), entry hiệu dụng = trung bình trọng số các chân đã khớp.
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
      const invalidAt = (() => { for (let k = i + 1; k < N; k++) if (candles[k].low < ob[i].bottom) return k; return N - 1; })();
      const deadline = Math.min(invalidAt, nextOppositeAtrSignal(atrM1, i, 1));
      const legs = [{ price: f.top, weight: 0.5 }, { price: ob[i].top, weight: 0.5 }].sort((a, b) => b.price - a.price);
      let fillIdx = -1, weightedSum = 0, weightFilled = 0;
      for (const leg of legs) {
        for (let k = i + 1; k <= deadline && k < N; k++) {
          if (candles[k].low <= leg.price) { fillIdx = Math.max(fillIdx, k); weightedSum += leg.price * leg.weight; weightFilled += leg.weight; break; }
        }
      }
      if (weightFilled === 0) { orders.push({ filled: false }); continue; }
      const avgEntry = weightedSum / weightFilled;
      const hit2 = mfeHitsTarget(avgEntry, 1, fillIdx, deadline, 2);
      const hit4 = mfeHitsTarget(avgEntry, 1, fillIdx, deadline, 4);
      const hit6 = mfeHitsTarget(avgEntry, 1, fillIdx, deadline, 6);
      orders.push({ filled: true, win: hit2 !== -1, hit4: hit4 !== -1, hit6: hit6 !== -1, barsToWin: hit2 !== -1 ? hit2 - fillIdx : null });
    }
  }
  results.push(report("M8  Multi-entry DCA: OB+FVG hợp lưu, 2 lệnh (limit)", orders));
}

console.log("\nGhi chú: win-rate không thể so sánh trực tiếp giữa các mô hình có\n" +
  "deadline/độ dài cycle khác nhau (cycle càng dài, xác suất chạm 2% càng cao).\n" +
  `Đây là benchmark tương đối trên CÙNG 1 bộ dữ liệu (${DATASET === "imx" ? "IMXUSDT 15m" : "EURUSD 15M"}), không phải\n` +
  "khuyến nghị giao dịch thực tế (chưa tính spread/slippage/SL thực). Các mô hình\n" +
  "có mẫu (tín hiệu) quá nhỏ (<20) chỉ mang tính tham khảo, KHÔNG đủ ý nghĩa thống kê.");
