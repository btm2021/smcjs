# API Reference

Full parameter and return-shape reference for every function exported from
[`src/index.js`](../src/index.js). For a quick start and install instructions
see [`README.md`](../README.md); for repo-wide conventions and known quirks
see [`CLAUDE.md`](../CLAUDE.md).

## Conventions used throughout this document

- **`candles`**: `Array<{ time, open, high, low, close, volume? }>`. `time`
  may be a unix timestamp in seconds or milliseconds, an ISO 8601 string, or
  a `Date`. `volume` is only required by `orderBlocks()` — if any candle is
  missing it, `orderBlocks()` throws.
- Every function returns an array **the same length as `candles`**, index `i`
  of the result always describing candle `i`. There is no re-indexing,
  filtering, or truncation.
- `null` in a result field means "no signal for this candle." Some fields use
  a literal `0` for a *different* meaning ("a signal exists but hasn't
  resolved yet") — those are called out explicitly below per function.
- Functions that take a `swingHL` argument expect the exact array returned by
  `swingHighsLows()` — don't hand-construct it, and don't filter/slice it
  before passing it on (several functions rely on it being index-aligned with
  `candles`).
- All functions are pure: no shared mutable state, no caching. Calling the
  same function twice with equal inputs returns equal (deep) output.

Import once and reuse across your app:

```js
import {
  swingHighsLows,
  bosChoch,
  fvg,
  orderBlocks,
  liquidity,
  previousHighLow,
  sessions,
  retracements,
} from "smcjs"; // or a relative path to src/index.js, or the global `SMC` in the browser build
```

---

## `swingHighsLows(candles, options?)`

Pivot (swing) high/low detection. This is the only function that doesn't
consume another indicator's output — `bosChoch`, `orderBlocks`, `liquidity`,
and `retracements` all take *its* output as their required second argument.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `swingLength` | `number` | `50` | A candle is a swing high/low if its high/low is the most extreme value in a window spanning `swingLength` candles before it through `swingLength` candles after it. Smaller values → more, tighter swing points; larger values → fewer, more significant ones. |

**Returns** `Array<{ highLow: 1 | -1 | null, level: number | null }>`

- `highLow`: `1` = swing high, `-1` = swing low, `null` = not a swing point.
- `level`: the price of the swing (`high[i]` if `highLow === 1`, `low[i]` if
  `highLow === -1`), `null` otherwise.
- The confirmed sequence of non-null points always **strictly alternates**
  high/low/high/low — two swing highs (or two swing lows) never appear
  back-to-back in the output.
- The first `swingLength * 2 - 1` candles and the last `swingLength` candles
  can never be confirmed swing points (not enough lookback/lookahead), except
  that the very first and last candle of the whole series are sometimes
  forced to a value to guarantee the alternation invariant above holds
  end-to-end (this mirrors the original library exactly; see `CLAUDE.md`
  if you need the byte-for-byte edge-case behavior).

```js
const swingHL = swingHighsLows(candles, { swingLength: 50 });
```

---

## `bosChoch(candles, swingHL, options?)`

BOS (Break of Structure) / CHOCH (Change of Character) — market-structure
shifts, each anchored to a specific swing level that price must *later
actually break* for the signal to be reported at all (a structure point that
never gets broken by the end of your candle series never appears in the
output).

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `closeBreak` | `boolean` | `true` | If `true`, a level counts as "broken" when a candle's `close` crosses it. If `false`, the candle's `high`/`low` is used instead (more sensitive, triggers on wicks). |

**Returns** `Array<{ bos: 1 | -1 | null, choch: 1 | -1 | null, level: number | null, brokenIndex: number | null }>`

- `bos` / `choch`: `1` = bullish, `-1` = bearish. Exactly one of `bos`/`choch`
  is non-null on any given row that has a signal at all (they're mutually
  exclusive per 4-swing-point pattern).
- `level`: the swing price level that had to be broken for this signal to be
  confirmed.
- `brokenIndex`: the candle index where that break actually happened.
- **Quirk to know about**: `brokenIndex` can occasionally be non-null on a
  row where `bos`/`choch` are both `null`. This happens when an older signal
  gets invalidated (superseded) by a newer, tighter one *after* it already
  recorded its own break index — the break index is never cleared, only
  `bos`/`choch`/`level` are. Treat `bos !== null || choch !== null` as "is
  there a signal on this row," not `brokenIndex !== null`.

```js
const swingHL = swingHighsLows(candles, { swingLength: 50 });
const structure = bosChoch(candles, swingHL, { closeBreak: true });
```

---

## `fvg(candles, options?)`

FVG (Fair Value Gap) — a 3-candle imbalance where the wick of the candle
before and the wick of the candle after a strong-bodied middle candle don't
overlap.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `joinConsecutive` | `boolean` | `false` | When `true`, immediately adjacent same-direction gaps are merged into a single zone (using the widest top/bottom of the run), attributed to the *last* candle in the run. |

**Returns** `Array<{ fvg: 1 | -1 | null, top: number | null, bottom: number | null, mitigatedIndex: number | null }>`

- `fvg`: `1` = bullish gap, `-1` = bearish gap.
- `top` / `bottom`: the price boundaries of the gap (`top > bottom` always).
- `mitigatedIndex`: the candle index where price first traded back into the
  gap (filling it). **`0` means "still open/unmitigated"** — it is *not* the
  same as `null` (`null` means there's no gap on this row at all).

```js
const gaps = fvg(candles, { joinConsecutive: true });
const openGaps = gaps.filter((g) => g.fvg !== null && g.mitigatedIndex === 0);
```

---

## `orderBlocks(candles, swingHL, options?)`

OB (Order Block) — the last opposing candle before an impulsive break of a
swing point, tracked through mitigation ("breaker") and, if price later
reclaims fully through it, invalidation (at which point it disappears from
the output entirely — there's no separate "invalidated" flag).

**Requires** every candle to have a numeric `volume`; throws otherwise.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `closeMitigation` | `boolean` | `false` | If `true`, mitigation/breaker/invalidation checks use candle body (`open`/`close`) instead of the full wick (`high`/`low`) — less sensitive to wicks. |

**Returns** `Array<{ ob: 1 | -1 | null, top: number | null, bottom: number | null, obVolume: number | null, mitigatedIndex: number | null, percentage: number | null }>`

- `ob`: `1` = bullish order block, `-1` = bearish.
- `top` / `bottom`: the order block candle's high/low.
- `obVolume`: the breakout candle's volume plus its two preceding candles'.
- `mitigatedIndex`: candle index where the block was first mitigated
  ("armed" as a breaker). `0` means "not yet mitigated" — distinct from
  `null` ("no order block on this row").
- `percentage`: `0`–`100`, a rough strength/imbalance score
  (`min(highVolume, lowVolume) / max(highVolume, lowVolume) * 100`, where
  `highVolume`/`lowVolume` are volume-weighted halves of the 3-candle window
  around the breakout — `100` means perfectly balanced, closer to `0` means
  one side dominated).
- An order block can silently vanish from later rows' output if price fully
  reclaims through a block that was already mitigated — there's no
  "invalidated" marker, it just stops appearing.

```js
const swingHL = swingHighsLows(candles, { swingLength: 50 });
const blocks = orderBlocks(candles, swingHL, { closeMitigation: false });
```

---

## `liquidity(candles, swingHL, options?)`

Clusters swing highs (or swing lows) that sit within `rangePercent` of each
other into a single liquidity zone, then reports when price later sweeps
through the whole cluster.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `rangePercent` | `number` | `0.01` (i.e. 1%) | Fraction of the *entire dataset's* high-low range used as the clustering tolerance around each candidate level. This is a fixed absolute price band computed once from the whole series, not a rolling/local value. |

**Returns** `Array<{ liquidity: 1 | -1 | null, level: number | null, end: number | null, swept: number | null }>`

- `liquidity`: `1` = a cluster of swing highs (bullish-side liquidity), `-1` =
  a cluster of swing lows.
- `level`: the average price across all swing points absorbed into the
  cluster.
- `end`: candle index of the last swing point absorbed into the cluster.
- `swept`: candle index where price finally broke through the whole zone.
  **`0` means "not yet swept"** — distinct from `null` ("no liquidity zone
  anchored at this row").
- A cluster is only reported when 2+ swing points get grouped together; a
  lone, unclustered swing point produces no signal. Each swing point can
  belong to at most one cluster.

```js
const swingHL = swingHighsLows(candles, { swingLength: 50 });
const pools = liquidity(candles, swingHL, { rangePercent: 0.005 });
```

---

## `previousHighLow(candles, options?)`

Reports the previous completed period's high/low relative to each candle
(e.g. "yesterday's high," "last week's low"), and latches a broken flag once
price trades through it during the *current* period.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `timeFrame` | `string` | `"1D"` | The reference period. Supports `"<n>m"` (minutes), `"<n>H"`/`"<n>h"` (hours), `"<n>D"`/`"<n>d"` (days), `"<n>W"`/`"<n>w"` (weeks), `"<n>M"` (months — capital `M`; lowercase `m` means minutes). Examples: `"15m"`, `"1H"`, `"4H"`, `"1D"`, `"1W"`, `"1M"`. |

**Returns** `Array<{ previousHigh: number | null, previousLow: number | null, brokenHigh: 0 | 1, brokenLow: 0 | 1 }>`

- `previousHigh` / `previousLow`: the high/low of the previous completed
  `timeFrame` bucket. `null` until enough history has accumulated (at least
  2 completed buckets).
- `brokenHigh` / `brokenLow`: `1` once price has traded above
  `previousHigh` / below `previousLow` *during the current bucket*, and stays
  `1` for the remainder of that bucket; always `0`/`1`, never `null`.
- Week buckets are Sunday-anchored (`'W-SUN'` convention) and month buckets
  are anchored to each calendar month's own boundaries — both chosen to
  match how the reference implementation's underlying data-resampling
  library buckets time, not an arbitrary choice; see `CLAUDE.md` before
  changing bucket-alignment logic.

```js
const dailyLevels = previousHighLow(candles, { timeFrame: "1D" });
const weeklyLevels = previousHighLow(candles, { timeFrame: "1W" });
```

---

## `sessions(candles, options)`

Flags which candles fall within a named trading session (or a custom
time-of-day window), and accumulates the running high/low reached so far
within each contiguous active block.

**Options**

| Option | Type | Default | Meaning |
|---|---|---|---|
| `session` | `string` | *(required)* | One of: `"Sydney"`, `"Tokyo"`, `"London"`, `"New York"`, `"Asian kill zone"`, `"London open kill zone"`, `"New York kill zone"`, `"london close kill zone"` (lowercase `l`, matches the original spelling), or `"Custom"`. |
| `startTime` | `string` | `""` | `"HH:MM"`, 24h. Required (and only used) when `session === "Custom"`. |
| `endTime` | `string` | `""` | `"HH:MM"`, 24h. Required (and only used) when `session === "Custom"`. |
| `timeZone` | `string` | `"UTC"` | `"UTC"`, or `"UTC±N"` / `"GMT±N"`. **Note:** non-`"UTC"` values reproduce a real sign-inversion quirk from the reference implementation (it maps onto IANA `Etc/GMT` zones, whose sign convention is inverted from common usage) — this is intentional for parity, not a bug. Prefer `"UTC"` and shift your own candle timestamps if you need a specific, unambiguous offset. |

Default session windows (all as UTC-equivalent `HH:MM`, before any
`timeZone` shift is applied): Sydney `21:00–06:00`, Tokyo `00:00–09:00`,
London `07:00–16:00`, New York `13:00–22:00`, Asian kill zone `00:00–04:00`,
London open kill zone `06:00–09:00`, New York kill zone `11:00–14:00`,
london close kill zone `14:00–16:00`. These are also exported as
`DEFAULT_SESSIONS` from `src/index.js` if you need to read them
programmatically.

**Returns** `Array<{ active: 0 | 1, high: number, low: number }>`

- `active`: `1` if the candle's time-of-day falls in the session window.
- `high` / `low`: the running high/low **within the current contiguous
  active block only** — resets to `0` on every inactive candle (`0`, not
  `null`, is the "inactive" sentinel here).

```js
const london = sessions(candles, { session: "London" });
const custom = sessions(candles, { session: "Custom", startTime: "08:00", endTime: "12:00" });
```

---

## `retracements(candles, swingHL)`

Percentage pullback of price from the most recent swing extreme, as a
fraction of the current swing leg's range, plus the deepest pullback reached
so far during that leg.

**No options.**

**Returns** `Array<{ direction: 1 | -1 | 0, currentRetracementPct: number, deepestRetracementPct: number }>`

- `direction`: `1` while the active leg is bullish (tracking a pullback down
  from the last swing high), `-1` while bearish, `0` before there's enough
  swing history to determine a leg yet.
- `currentRetracementPct` / `deepestRetracementPct`: `0`–`100`-ish
  percentages (not clamped — can exceed 100 if price pulls back past the
  opposing swing level), rounded to 1 decimal place. `0` is the "no value"
  sentinel here (this function never produces `null`).
- The first few rows of the series are always zeroed out regardless of
  `swingHL` (not enough history for a meaningful leg yet) — don't be
  surprised that `direction`/`currentRetracementPct`/`deepestRetracementPct`
  are `0` there even once real swing points exist elsewhere.

```js
const swingHL = swingHighsLows(candles, { swingLength: 50 });
const pullbacks = retracements(candles, swingHL);
```
