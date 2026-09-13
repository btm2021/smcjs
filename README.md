# smcjs

A JavaScript port of [`smartmoneyconcepts`](https://github.com/joshyattridge/smart-money-concepts)
(the Python "Smart Money Concepts" indicator library), rewritten for
algorithmic parity and usable from Node.js, Bun, or a plain `<script>` tag in
the browser — no build step required to consume it.

Every function is verified against the original project's own golden-output
test fixtures (see [`test/parity.mjs`](test/parity.mjs)): **1,025,808 field
checks, 0 mismatches** across all 8 indicators and every documented option.

## Indicators

| Function | Description |
|---|---|
| `swingHighsLows(candles, { swingLength })` | Swing high/low pivot detection |
| `bosChoch(candles, swingHL, { closeBreak })` | Break of Structure / Change of Character |
| `fvg(candles, { joinConsecutive })` | Fair Value Gaps |
| `orderBlocks(candles, swingHL, { closeMitigation })` | Order Blocks (requires `volume`) |
| `liquidity(candles, swingHL, { rangePercent })` | Liquidity pools + sweeps |
| `previousHighLow(candles, { timeFrame })` | Previous period high/low + broken flags |
| `sessions(candles, { session, startTime, endTime, timeZone })` | Session high/low windows |
| `retracements(candles, swingHL)` | Retracement % from the active swing leg |

`candles` is an array of `{ time, open, high, low, close, volume? }` objects.
`time` may be a unix timestamp (seconds or ms), an ISO string, or a `Date`.
`swingHL` is the output of `swingHighsLows()` — every other indicator that
needs swing points takes it as an input, matching the original Python API, so
you only pay for that computation once.

Each function returns one plain-object result per input candle (same length,
same index alignment), with `null` standing in for the "no signal" sentinel.
See **[docs/API.md](docs/API.md)** for the full parameter/return-shape
reference (every option, every output field, every sentinel quirk), or
[`src/indicators/`](src/indicators/) directly for the source.

## Install / use

This package isn't published to npm; use it directly from the repo.

**Node.js / Bun (ESM):**
```js
import SMC, { swingHighsLows, bosChoch } from "./smcjs/src/index.js";

const swingHL = swingHighsLows(candles, { swingLength: 50 });
const structure = bosChoch(candles, swingHL);
// or: SMC.bosChoch(candles, swingHL)
```

**Browser (`<script>` tag, no bundler):**
```html
<script src="./smcjs/dist/smc.umd.js"></script>
<script>
  const swingHL = SMC.swingHighsLows(candles, { swingLength: 50 });
</script>
```

Run `npm run build` to (re)generate `dist/smc.umd.js` (global `SMC`) and
`dist/smc.esm.js` from `src/` via esbuild.

## Live Demo

🚀 **Interactive Web Demo on GitHub Pages**: [https://btm2021.github.io/smcjs/](https://btm2021.github.io/smcjs/)

`demo/index.html` is a self-contained chart viewer built on
[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
v5. It loads 15,000 15-minute candles from the **Binance Futures** public API
(with instant symbol search, IndexedDB caching, and real-time WebSocket ticker)
and provides full control over all SMC indicators plus **ATRBot M1** (Adaptive Volatility-Regime ATR Multiplier).

To run locally:

```bash
npm run demo
# open http://localhost:8080/demo/index.html
```

(Opening the file directly via `file://` also mostly works, except some
browsers block the `fetch()` to Binance under `file://` due to CORS — serving
it over `http://localhost` avoids that.)

## Verifying the port

```bash
npm test
```

This replays every function against `test/fixtures/EURUSD_15M.csv` (the exact
input file bundled with the original Python project's test suite) and diffs
the output field-by-field against that project's own recorded results for
each function/option combination it tests.

## Notes on faithfulness

The port intentionally reproduces several non-obvious behaviors of the
original implementation exactly, rather than "fixing" them, since the goal is
algorithmic parity:

- `bos_choch`'s `Level` (and a few other internal arrays) are rounded to
  float32 mid-computation in the original (numpy `dtype=np.float32`), which
  measurably affects later `>`/`<` break comparisons — replicated here via
  `Math.fround`.
- `previous_high_low` reproduces pandas' resample label semantics exactly,
  including the one-candle-lagged reference at the very start of each new
  bucket, and treats `'W'` weeks as Sunday-anchored (pandas' `W-SUN` default)
  and `'M'` months as anchored to each calendar month's last day, matching
  pandas' bin-edge convention.
- `sessions`' `time_zone` parsing reproduces a real sign-inversion quirk from
  the original mapping user-supplied `"UTC±N"` strings onto IANA `Etc/GMT`
  zones (whose sign convention is inverted from common usage).
- Several "is there a signal here" sentinels are NOT simply "null vs a value"
  — e.g. `fvg`'s and `orderBlocks`' `mitigatedIndex` uses `0` to mean "not yet
  mitigated" (distinct from `null` = "no gap/block here at all"), and
  `bosChoch`'s `brokenIndex` can occasionally be a stale non-null value on a
  row whose `bos`/`choch` were separately invalidated. These match the
  original's output exactly; see the JSDoc comments in `src/indicators/*.js`.

## License

MIT — see [LICENSE](LICENSE). This is an independent reimplementation; no
source code from the original Python project is included.
