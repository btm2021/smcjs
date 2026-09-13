export { swingHighsLows } from "./indicators/swingHighsLows.js";
export { bosChoch } from "./indicators/bosChoch.js";
export { fvg } from "./indicators/fvg.js";
export { orderBlocks } from "./indicators/orderBlocks.js";
export { liquidity } from "./indicators/liquidity.js";
export { previousHighLow } from "./indicators/previousHighLow.js";
export { sessions, DEFAULT_SESSIONS } from "./indicators/sessions.js";
export { retracements } from "./indicators/retracements.js";
export { atrBot } from "./indicators/atrBot.js";

import { swingHighsLows } from "./indicators/swingHighsLows.js";
import { bosChoch } from "./indicators/bosChoch.js";
import { fvg } from "./indicators/fvg.js";
import { orderBlocks } from "./indicators/orderBlocks.js";
import { liquidity } from "./indicators/liquidity.js";
import { previousHighLow } from "./indicators/previousHighLow.js";
import { sessions } from "./indicators/sessions.js";
import { retracements } from "./indicators/retracements.js";
import { atrBot } from "./indicators/atrBot.js";

/** Namespaced object mirroring the original Python `smc` class API surface. */
const SMC = {
  swingHighsLows,
  bosChoch,
  fvg,
  orderBlocks,
  liquidity,
  previousHighLow,
  sessions,
  retracements,
  atrBot,
  // Pythonic aliases for interoperability
  swing_highs_lows: (candles, opts) =>
    swingHighsLows(candles, { swingLength: opts?.swing_length ?? opts?.swingLength }),
  bos_choch: (candles, opts) => {
    const swingHL = Array.isArray(opts) ? opts : (opts?.swing_highs_lows ?? opts?.swingHL);
    return bosChoch(candles, swingHL, opts);
  },
};

export default SMC;
