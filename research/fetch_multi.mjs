// Kéo ~100,000 nến 15m cho nhiều symbol từ Binance Futures, lưu từng symbol ra
// research/data/<SYMBOL>_15m.json. Idempotent: symbol đã đủ dữ liệu thì bỏ qua
// (chạy lại an toàn nếu bị ngắt giữa chừng).
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "IMXUSDT",
];
const TOTAL = 100000;
const LIMIT = 1500;

async function fetchSymbol(symbol) {
  const outFile = path.join(DATA_DIR, `${symbol}_15m.json`);
  if (existsSync(outFile)) {
    const existing = JSON.parse(readFileSync(outFile, "utf8"));
    if (existing.length >= TOTAL) {
      console.log(`[${symbol}] already has ${existing.length} candles, skip.`);
      return;
    }
  }

  let endTime = Date.now();
  let all = [];
  let attempts = 0;
  while (all.length < TOTAL) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=${LIMIT}&endTime=${endTime}`;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      attempts++;
      if (attempts > 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempts));
      continue;
    }
    if (!res.ok) {
      if (res.status === 429 || res.status === 418) {
        console.log(`[${symbol}] rate limited, backing off 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw new Error(`[${symbol}] HTTP ${res.status}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = rows.concat(all);
    endTime = rows[0][0] - 1;
    process.stdout.write(`\r[${symbol}] fetched ${all.length}/${TOTAL}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log("");

  const candles = all.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
    volume: Number(k[5]),
  }));
  writeFileSync(outFile, JSON.stringify(candles));
  console.log(`[${symbol}] saved ${candles.length} candles -> ${outFile}`);
}

for (const symbol of SYMBOLS) {
  await fetchSymbol(symbol);
}
console.log("\nDONE fetching all symbols.");
