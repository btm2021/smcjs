# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — only dev dependency is esbuild.
- `npm run build` — bundles `src/index.js` via `build.js`/esbuild into `dist/smc.umd.js` (global `SMC`, for `<script>` tags) and `dist/smc.esm.js`. Run this after any change under `src/` before expecting `demo/index.html` to reflect it — the demo loads the built bundle, not `src/` directly.
- `npm test` — runs `test/parity.mjs`, the only test suite. It is not split per-indicator/per-file; a single run checks all 8 indicators (11 checks counting multi-option variants) and prints `OK`/`FAIL` per indicator with up to 8 example mismatches. There's no built-in way to run a subset — to debug one function in isolation, write a throwaway script that imports it from `src/index.js` and reuses the CSV-parsing helpers already in `test/parity.mjs` against `test/fixtures/EURUSD_15M.csv`.
- `npm run demo` — starts `serve.js` (zero-dependency static file server) on `:8080`; open `http://localhost:8080/demo/index.html`.

No linter or CI is configured.

## Architecture

### What this is

A from-scratch JS reimplementation (not a wrapper) of the Python
[`smartmoneyconcepts`](https://github.com/joshyattridge/smart-money-concepts)
library, built for exact algorithmic parity — including several non-obvious
behaviors/quirks of the original that were deliberately reproduced rather than
"fixed." See the "Notes on faithfulness" section in `README.md` before
changing any indicator's logic; it documents which output sentinels are
intentional and why.

### Module layout

- `src/utils.js` — shared helpers used by every indicator: `toColumns()` turns
  an array of `{time, open, high, low, close, volume}` candle objects into
  parallel plain arrays; `toF32()` emulates numpy `float32` truncation via
  `Math.fround`; `firstIndexFrom()` is the "first index satisfying predicate"
  primitive that replaces the `np.argmax(boolean_mask)` idiom used repeatedly
  in the original.
- `src/indicators/*.js` — one file per indicator, each a pure function
  `(candles[, swingHL][, options]) -> Array` of per-candle result objects,
  same length and index alignment as `candles`, `null` marking "no signal."
- `src/index.js` — barrel: named exports plus a default `SMC` namespace object
  mirroring the original Python class's method surface (`SMC.swingHighsLows`,
  `SMC.bosChoch`, ...).

### The `swingHighsLows` dependency chain

`swingHighsLows()` is the only indicator that isn't derived from another
indicator's output. `bosChoch`, `orderBlocks`, `liquidity`, and `retracements`
all take its result (`swingHL`, an array of `{highLow, level}`) as a required
argument — mirroring the original Python API's `swing_highs_lows` parameter.
Compute it once per `swingLength` and reuse across all four dependents
(`demo/index.html`'s `fullRecomputeFromSwing()` shows the intended pattern)
rather than recomputing it inside each one.

### Output sentinel conventions are not uniform across functions

`null` generally means "no signal at this candle," but a plain `0` means
something different in several places — "a signal exists here but is still
open/unresolved," distinct from `null` ("no signal at all"):
`fvg().mitigatedIndex`, `orderBlocks().mitigatedIndex`, `liquidity().swept`.
Separately, `bosChoch().brokenIndex` can end up non-null on a row whose
`bos`/`choch` were zeroed out by a *later* signal's invalidation pass — this
is intentional (reproduced from the original), not a bug to clean up. Check
the relevant `src/indicators/*.js` file's docstring before changing any of
this.

### Float32 emulation has to happen mid-computation, not just at output

The original stores several intermediate arrays as `numpy.float32`
(`bosChoch`'s `level`, `orderBlocks`' `top`/`bottom`/volumes/`percentage`,
`liquidity`'s `level`, `previousHighLow`'s `previousHigh`/`previousLow`), and
critically, *later comparisons in the same function use the truncated value*,
not the original float64 one. The port applies `toF32()` at the exact point
the original casts to float32 — not just when formatting the final result —
because rounding only at output silently breaks parity whenever a later
branch compares against that value (this caused real, hard-to-spot parity
failures in `bosChoch`'s break-confirmation loop during development; the fix
is the `toF32()` call inside the main loop in `src/indicators/bosChoch.js`,
not the one in the final result-mapping step).

### Parity tests are golden-file diffs against the upstream project, not hand-written assertions

`test/fixtures/` holds files copied verbatim from the original Python
project's own test suite: `EURUSD_15M.csv` (input) plus one result CSV per
function/option combination, and `unit_tests.py` (upstream's own test file,
kept as the canonical reference for which parameters — e.g.
`swing_length=5` — each fixture was generated with). `test/parity.mjs` parses
both sides and diffs field-by-field with a `1e-3` tolerance. That tolerance
is already loose enough to absorb float32/float64 rounding noise, so a
mismatch almost always means a genuine behavioral divergence, not a false
positive — don't widen it to make a failure disappear.

### Demo (`demo/index.html`)

A single dependency-free HTML file — Lightweight Charts v5 and
`dist/smc.umd.js` both loaded via plain `<script>` tags, no bundler — kept
outside the `npm run build` pipeline. It fetches 15,000 IMXUSDT 15m candles
directly from the Binance Futures public REST API client-side, paginating
backward via the `endTime` query param (`fetchKlines()`). All indicator
visualization goes through exactly two small custom Lightweight Charts v5
primitives defined inline in the file, `BoxesPrimitive` and `LinesPrimitive`
(plus the stock series-markers plugin for swing/retracement point markers) —
there is no other drawing abstraction, so a new indicator's visualization
should reuse one of those two rather than introducing a third.
