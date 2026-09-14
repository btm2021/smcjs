// Kiểm chứng thực nghiệm: chạy strategies.js ở nhiều điểm cắt (checkpoint)
// tăng dần trên CÙNG 1 bộ dữ liệu, rồi so sánh — mọi tín hiệu neo tại index
// <= cutoff (T-1-bufferBars, đúng công thức isUnsettledAnchor() của demo)
// phải giữ NGUYÊN (không đổi hướng/giá, không biến mất) ở mọi checkpoint sau.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import SMC from "../src/index.js";

const base = "C:/Users/Admin/Desktop/smcjs/";
function loadUmd(file) {
  const sandbox = {}; sandbox.self = sandbox; sandbox.SMC = SMC;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(base + file, "utf8"), sandbox, { filename: file });
  return sandbox;
}
const ATRBotM1Indicator = loadUmd("indicator_atrbot_m1.js").ATRBotM1Indicator;
const DynamicSwingHL = loadUmd("dynamic_swing_hl.js").DynamicSwingHL;
const StatefulBosChoch = loadUmd("stateful_bos_choch.js").StatefulBosChoch;
const SmcStrategies = loadUmd("strategies.js").SmcStrategies;
const deps = { SMC, ATRBotM1Indicator, DynamicSwingHL, StatefulBosChoch };

const allCandles = JSON.parse(readFileSync(base + "research/data/BTCUSDT_15m.json", "utf8"));
const N = allCandles.length;
const BUFFER_BARS = 500; // mặc định của demo (state.antiRepaint.bufferBars)
const ids = SmcStrategies.list.map((s) => s.id);

const checkpoints = [];
for (let t = 3000; t < N; t += 4000) checkpoints.push(t);
checkpoints.push(N);

console.log(`Chạy ${checkpoints.length} checkpoint trên ${N} nến BTCUSDT, buffer=${BUFFER_BARS}...`);

const snapshots = checkpoints.map((T) => {
  const candles = allCandles.slice(0, T);
  const cutoff = Math.max(0, T - 1 - BUFFER_BARS);
  const raw = SmcStrategies.runMany(ids, candles, deps);
  const settled = {};
  for (const id of ids) {
    settled[id] = raw[id].filter((s) => s.index <= cutoff);
  }
  return { T, cutoff, settled };
});

function keyOf(s) {
  return `${s.index}|${s.direction}|${s.kind}|${s.price}`;
}

let totalViolations = 0;
for (const id of ids) {
  const seen = new Map();
  let violations = 0;
  const examples = [];
  for (const snap of snapshots) {
    for (const s of snap.settled[id]) {
      const k = keyOf(s);
      if (seen.has(k)) continue; // đã thấy y hệt trước đó -> ổn
      // Kiểm tra: có tín hiệu nào TRÙNG index+kind nhưng KHÁC direction/price không?
      const conflictKey = [...seen.keys()].find((ek) => ek.split("|")[0] === String(s.index));
      if (conflictKey) {
        violations++;
        if (examples.length < 3) examples.push({ atT: snap.T, index: s.index, before: conflictKey, after: k });
      }
      seen.set(k, true);
    }
  }
  // Kiểm tra biến mất: tín hiệu đã "settled" ở checkpoint sớm hơn nhưng KHÔNG còn ở checkpoint sau.
  for (let a = 0; a < snapshots.length - 1; a++) {
    const early = new Set(snapshots[a].settled[id].map(keyOf));
    for (let b = a + 1; b < snapshots.length; b++) {
      const later = new Set(snapshots[b].settled[id].map(keyOf));
      for (const k of early) {
        if (!later.has(k)) {
          violations++;
          if (examples.length < 5) examples.push({ disappearedAtT: snapshots[b].T, key: k, wasSettledAtT: snapshots[a].T });
        }
      }
    }
  }
  totalViolations += violations;
  console.log(`${id}: violations=${violations}` + (violations ? "  " + JSON.stringify(examples[0]) : ""));
}

console.log(`\nTỔNG VI PHẠM (đổi/biến mất sau khi đã "settled"): ${totalViolations}`);
console.log(totalViolations === 0 ? "\n✅ KHÔNG REPAINT (trong phạm vi đã kiểm tra)." : "\n❌ CÓ REPAINT — cần điều tra thêm.");
