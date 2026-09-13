// Compares the JS port against the golden reference CSVs shipped by the
// original Python project's own test suite, to verify algorithmic parity.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  swingHighsLows,
  bosChoch,
  fvg,
  orderBlocks,
  liquidity,
  previousHighLow,
  sessions,
  retracements,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures");

function parseCsv(file) {
  const text = readFileSync(path.join(FIX, file), "utf8").trim();
  const lines = text.split("\n");
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((line) => line.split(","));
  return { headers, rows };
}

function cell(v) {
  if (v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

function loadCandles() {
  const { rows } = parseCsv("EURUSD_15M.csv");
  return rows.map((r) => {
    const [dateStr, open, high, low, close, , volume] = r;
    const [d, t] = dateStr.split(" ");
    const [y, mo, da] = d.split(".").map(Number);
    const [h, mi, s] = t.split(":").map(Number);
    const time = Date.UTC(y, mo - 1, da, h, mi, s);
    return { time, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) };
  });
}

const candles = loadCandles();

let totalChecks = 0;
let totalFail = 0;
const EPS = 1e-3;

function approxEqual(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPS;
  return a === b;
}

function compare(name, actual, expectedFile, fieldMap, headers) {
  const { rows } = parseCsv(expectedFile);
  if (rows.length !== actual.length) {
    console.log(`[${name}] FAIL length mismatch: expected ${rows.length}, got ${actual.length}`);
    totalFail++;
    return;
  }
  let mismatches = 0;
  const examples = [];
  for (let i = 0; i < rows.length; i++) {
    for (const [csvCol, jsField] of Object.entries(fieldMap)) {
      totalChecks++;
      const csvIdx = headers.indexOf(csvCol);
      const expected = cell(rows[i][csvIdx]);
      const got = actual[i][jsField];
      if (!approxEqual(expected, got)) {
        mismatches++;
        if (examples.length < 8) examples.push(`row ${i} ${csvCol}: expected ${expected}, got ${got}`);
      }
    }
  }
  if (mismatches === 0) {
    console.log(`[${name}] OK (${rows.length} rows)`);
  } else {
    console.log(`[${name}] FAIL: ${mismatches} mismatches`);
    for (const e of examples) console.log("   " + e);
    totalFail++;
  }
}

// swing_highs_lows(swing_length=5)
{
  const { headers } = parseCsv("swing_highs_lows_result_data.csv");
  const actual = swingHighsLows(candles, { swingLength: 5 });
  compare(
    "swingHighsLows",
    actual,
    "swing_highs_lows_result_data.csv",
    { HighLow: "highLow", Level: "level" },
    headers
  );
}

const swingHL = swingHighsLows(candles, { swingLength: 5 });

// bos_choch
{
  const { headers } = parseCsv("bos_choch_result_data.csv");
  const actual = bosChoch(candles, swingHL);
  compare(
    "bosChoch",
    actual,
    "bos_choch_result_data.csv",
    { BOS: "bos", CHOCH: "choch", Level: "level", BrokenIndex: "brokenIndex" },
    headers
  );
}

// fvg
{
  const { headers } = parseCsv("fvg_result_data.csv");
  const actual = fvg(candles);
  compare(
    "fvg",
    actual,
    "fvg_result_data.csv",
    { FVG: "fvg", Top: "top", Bottom: "bottom", MitigatedIndex: "mitigatedIndex" },
    headers
  );
}

// fvg join_consecutive
{
  const { headers } = parseCsv("fvg_consecutive_result_data.csv");
  const actual = fvg(candles, { joinConsecutive: true });
  compare(
    "fvg(joinConsecutive)",
    actual,
    "fvg_consecutive_result_data.csv",
    { FVG: "fvg", Top: "top", Bottom: "bottom", MitigatedIndex: "mitigatedIndex" },
    headers
  );
}

// ob
{
  const { headers } = parseCsv("ob_result_data.csv");
  const actual = orderBlocks(candles, swingHL);
  compare(
    "orderBlocks",
    actual,
    "ob_result_data.csv",
    { OB: "ob", Top: "top", Bottom: "bottom", OBVolume: "obVolume", MitigatedIndex: "mitigatedIndex", Percentage: "percentage" },
    headers
  );
}

// liquidity
{
  const { headers } = parseCsv("liquidity_result_data.csv");
  const actual = liquidity(candles, swingHL);
  compare(
    "liquidity",
    actual,
    "liquidity_result_data.csv",
    { Liquidity: "liquidity", Level: "level", End: "end", Swept: "swept" },
    headers
  );
}

// previous_high_low
for (const [tf, file] of [
  ["4H", "previous_high_low_result_data_4h.csv"],
  ["1D", "previous_high_low_result_data_1D.csv"],
  ["1W", "previous_high_low_result_data_W.csv"],
]) {
  const { headers } = parseCsv(file);
  const actual = previousHighLow(candles, { timeFrame: tf });
  compare(
    `previousHighLow(${tf})`,
    actual,
    file,
    { PreviousHigh: "previousHigh", PreviousLow: "previousLow", BrokenHigh: "brokenHigh", BrokenLow: "brokenLow" },
    headers
  );
}

// sessions
{
  const { headers } = parseCsv("sessions_result_data.csv");
  const actual = sessions(candles, { session: "London" });
  compare(
    "sessions(London)",
    actual,
    "sessions_result_data.csv",
    { Active: "active", High: "high", Low: "low" },
    headers
  );
}

// retracements
{
  const { headers } = parseCsv("retracements_result_data.csv");
  const actual = retracements(candles, swingHL);
  compare(
    "retracements",
    actual,
    "retracements_result_data.csv",
    { Direction: "direction", "CurrentRetracement%": "currentRetracementPct", "DeepestRetracement%": "deepestRetracementPct" },
    headers
  );
}

console.log(`\n${totalChecks} field checks run, ${totalFail} indicator(s) with mismatches`);
process.exit(totalFail > 0 ? 1 : 0);
