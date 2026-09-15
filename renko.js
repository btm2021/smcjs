/**
 * Renko — chuyển đổi chuỗi nến OHLC thành "gạch" (brick) Renko cổ điển, dùng
 * giá đóng cửa (close-based Renko, kiểu phổ biến nhất) với quy tắc đảo chiều
 * cần đủ 2 brick (2× brickSize) — đúng chuẩn Renko truyền thống.
 *
 * (thử nghiệm — KHÔNG thuộc thư viện lõi SMC.js, không cần giữ parity với
 * bản Python gốc).
 *
 * THIẾT KẾ CHỐNG REPAINT: thuật toán chỉ đi tới (forward-only) qua `candles`
 * theo đúng thứ tự, dùng 1 state cục bộ (`base`, `trend`) không phụ thuộc bất
 * kỳ dữ liệu nào ở tương lai — 1 brick đã hình thành tại candle i chỉ phụ
 * thuộc vào candles[0..i], KHÔNG BAO GIỜ bị sửa lại khi có thêm nến mới phía
 * sau. Đây là tính chất causal mạnh hơn cả swingHighsLows() gốc (vốn có bước
 * "fixed-point reduction" có thể sửa lại 1 swing đã hình thành) — Renko ở
 * đây không có bước hậu xử lý nào tương tự.
 *
 * Lưu ý quan trọng về `brickSize` khi dùng chế độ 'atr': ATR được tính 1 LẦN
 * trên toàn bộ `candles` truyền vào (lấy giá trị ATR tại nến CUỐI CÙNG) rồi
 * dùng làm brick size CỐ ĐỊNH cho toàn bộ chuỗi — KHÔNG tính lại theo từng
 * nến. Điều này có chủ đích: 1 Renko chart có brick size thay đổi giữa chừng
 * sẽ khiến toàn bộ các brick trước đó bị vẽ lại khác đi mỗi khi có nến mới —
 * phá vỡ tính ổn định của biểu đồ. Muốn brick size mới, gọi lại calculate()
 * với candles mới (brickSize tự tính lại 1 lần cho lần gọi đó), không có
 * nghĩa là "recompute mỗi tick" như bên trong 1 lần gọi.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.Renko = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

  // Wilder ATR (causal, giống hệt công thức dùng trong indicator_atrbot_m1.js
  // và dynamic_swing_hl.js) — trả về mảng ATR cùng độ dài candles.
  function wilderAtr(candles, period) {
    const n = candles.length;
    const atr = new Array(n);
    if (n === 0) return atr;
    const tr = new Array(n);
    tr[0] = candles[0].high - candles[0].low;
    for (let i = 1; i < n; i++) {
      tr[i] = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    }
    atr[0] = tr[0];
    for (let i = 1; i < n; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
    return atr;
  }

  /**
   * Tính brick size theo chế độ đã chọn — 1 con số duy nhất, dùng cho toàn
   * bộ `candles` truyền vào lần gọi này.
   * @param {Array} candles
   * @param {{mode?: 'atr'|'fixed', atrPeriod?: number, atrMult?: number, fixedSize?: number}} opts
   */
  function computeBrickSize(candles, opts) {
    opts = opts || {};
    if (opts.mode === 'fixed') {
      return Math.max(0, Number(opts.fixedSize) || 0);
    }
    const period = opts.atrPeriod || 14;
    const mult = opts.atrMult != null ? opts.atrMult : 1.0;
    if (candles.length < period) return 0;
    const atr = wilderAtr(candles, period);
    return atr[atr.length - 1] * mult;
  }

  /**
   * @param {Array<{time,open,high,low,close,volume}>} candles
   * @param {{mode?:'atr'|'fixed', atrPeriod?:number, atrMult?:number, fixedSize?:number, brickSize?:number}} opts
   *   Truyền sẵn `opts.brickSize` (số) để BỎ QUA việc tự tính (dùng khi muốn
   *   "đóng băng" brick size đã tính từ trước, xem ghi chú đầu file).
   * @returns {{bricks: Array<{time,open,high,low,close,volume,direction:1|-1}>, brickSize: number}}
   */
  function calculate(candles, opts) {
    opts = opts || {};
    const n = candles.length;
    if (n === 0) return { bricks: [], brickSize: 0 };

    const brickSize = opts.brickSize != null ? opts.brickSize : computeBrickSize(candles, opts);
    const bricks = [];
    if (!brickSize || brickSize <= 0) return { bricks, brickSize: 0 };

    let base = candles[0].close;
    let trend = 0; // 0 = chưa xác định, 1 = tăng, -1 = giảm
    // Lightweight Charts yêu cầu `time` TĂNG NGHIÊM NGẶT giữa các điểm dữ
    // liệu liên tiếp — nhưng 1 nến nguồn CÓ THỂ sinh ra nhiều brick cùng lúc
    // (biến động trong 1 nến vượt quá vài lần brickSize), nếu gán nguyên
    // `candles[i].time` cho tất cả sẽ bị trùng thời gian, làm hỏng cấu trúc
    // dữ liệu nội bộ của thư viện chart (từng gây lỗi "Value is null" khi
    // brick size quá nhỏ so với biến động thực tế — đã kiểm chứng thực
    // nghiệm). Khắc phục: mỗi brick thêm sau, trong CÙNG 1 nến nguồn, được
    // cộng thêm 1 giây so với brick liền trước để đảm bảo tăng nghiêm ngặt.
    let lastTime = -Infinity;
    function nextTime(candidate) {
      const t = candidate > lastTime ? candidate : lastTime + 1;
      lastTime = t;
      return t;
    }

    for (let i = 1; i < n; i++) {
      const price = candles[i].close;
      const time = candles[i].time;

      for (;;) {
        if (trend >= 0 && price - base >= brickSize) {
          const open = base, close = base + brickSize;
          bricks.push({ time: nextTime(time), open, high: close, low: open, close, volume: candles[i].volume || 0, direction: 1 });
          base = close; trend = 1;
          continue;
        }
        if (trend <= 0 && base - price >= brickSize) {
          const open = base, close = base - brickSize;
          bricks.push({ time: nextTime(time), open, high: open, low: close, close, volume: candles[i].volume || 0, direction: -1 });
          base = close; trend = -1;
          continue;
        }
        // Đảo chiều: cần đủ 2x brickSize mới lật hướng (quy tắc Renko kinh
        // điển) — brick đầu tiên theo hướng mới "nhảy cóc" qua đúng 1
        // brickSize làm vùng đệm, giống mọi nền tảng Renko chuẩn khác.
        if (trend === 1 && base - price >= brickSize * 2) {
          const open = base - brickSize, close = base - brickSize * 2;
          bricks.push({ time: nextTime(time), open, high: open, low: close, close, volume: candles[i].volume || 0, direction: -1 });
          base = close; trend = -1;
          continue;
        }
        if (trend === -1 && price - base >= brickSize * 2) {
          const open = base + brickSize, close = base + brickSize * 2;
          bricks.push({ time: nextTime(time), open, high: close, low: open, close, volume: candles[i].volume || 0, direction: 1 });
          base = close; trend = 1;
          continue;
        }
        break;
      }
    }

    return { bricks, brickSize };
  }

  return { calculate: calculate, computeBrickSize: computeBrickSize, wilderAtr: wilderAtr };
}));
