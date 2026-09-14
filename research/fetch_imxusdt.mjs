// Kéo ~15,000 nến IMXUSDT 15m từ Binance Futures (giống demo/index.html) và
// lưu ra research/data_imxusdt_15m.json để backtest offline, tái lập được.
import { writeFileSync } from "node:fs";

const LIMIT = 1500;
const TOTAL = 15000;
let endTime = Date.now();
let all = [];

while (all.length < TOTAL) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=IMXUSDT&interval=15m&limit=${LIMIT}&endTime=${endTime}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!rows.length) break;
  all = rows.concat(all);
  endTime = rows[0][0] - 1;
  process.stdout.write(`\rFetched ${all.length}/${TOTAL}`);
  await new Promise((r) => setTimeout(r, 150));
}
console.log("");

const candles = all.map((k) => ({
  time: Math.floor(k[0] / 1000),
  open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
  volume: Number(k[5]),
}));

writeFileSync(new URL("./data_imxusdt_15m.json", import.meta.url), JSON.stringify(candles));
console.log(`Saved ${candles.length} candles to research/data_imxusdt_15m.json`);
