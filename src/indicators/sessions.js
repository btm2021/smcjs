import { toColumns, toMs } from "../utils.js";

const DEFAULT_SESSIONS = {
  Sydney: { start: "21:00", end: "06:00" },
  Tokyo: { start: "00:00", end: "09:00" },
  London: { start: "07:00", end: "16:00" },
  "New York": { start: "13:00", end: "22:00" },
  "Asian kill zone": { start: "00:00", end: "04:00" },
  "London open kill zone": { start: "06:00", end: "09:00" },
  "New York kill zone": { start: "11:00", end: "14:00" },
  "london close kill zone": { start: "14:00", end: "16:00" },
};

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Parses a "UTC+5" / "GMT-3" style offset the same way the source library
 * does internally (it rewrites the zone to an IANA "Etc/GMT" name, whose
 * sign convention is inverted relative to common usage). We reproduce that
 * exact inversion for output parity rather than "fixing" it.
 */
function offsetMsForParity(timeZone) {
  if (timeZone === "UTC") return 0;
  const m = /^(?:UTC|GMT)\s*([+-]?\d+(?:\.\d+)?)$/.exec(timeZone.trim());
  if (!m) throw new Error(`Unsupported time_zone "${timeZone}". Use "UTC" or e.g. "UTC+5" / "GMT-3".`);
  const hours = parseFloat(m[1]);
  return hours * 60 * 60 * 1000;
}

/**
 * Sessions.
 * Flags which candles fall within a named trading session (or a custom
 * HH:MM window) and accumulates the running high/low for each contiguous
 * active block.
 *
 * @param {Array} candles
 * @param {{session: string, startTime?: string, endTime?: string, timeZone?: string}} options
 */
export function sessions(
  candles,
  { session, startTime = "", endTime = "", timeZone = "UTC" } = {}
) {
  if (session === "Custom" && (startTime === "" || endTime === "")) {
    throw new Error("Custom session requires a start and end time");
  }

  const def = session === "Custom" ? { start: startTime, end: endTime } : DEFAULT_SESSIONS[session];
  if (!def) throw new Error(`Unknown session "${session}"`);

  const start = minutesOfDay(def.start);
  const end = minutesOfDay(def.end);
  const deltaMs = offsetMsForParity(timeZone);

  const { n, high, low } = toColumns(candles);
  const active = new Array(n).fill(0);
  const outHigh = new Array(n).fill(0);
  const outLow = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const utcMs = toMs(candles[i].time) + deltaMs;
    const d = new Date(utcMs);
    const cur = d.getUTCHours() * 60 + d.getUTCMinutes();

    const isActive = (start <= end && start <= cur && cur <= end) || (start >= end && (cur >= start || cur <= end));

    if (isActive) {
      active[i] = 1;
      outHigh[i] = Math.max(high[i], i > 0 ? outHigh[i - 1] : 0);
      outLow[i] = Math.min(low[i], i > 0 && outLow[i - 1] !== 0 ? outLow[i - 1] : Infinity);
    }
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { active: active[i], high: outHigh[i], low: outLow[i] };
  }
  return result;
}

export { DEFAULT_SESSIONS };
