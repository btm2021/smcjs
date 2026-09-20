/**
 * PointAndFigure — chuyển chuỗi nến OHLC thành cột X/O kiểu Point & Figure
 * cổ điển (dùng high/low, N-box reversal). Thử nghiệm, không thuộc lõi
 * SMC.js. Thuật toán tái dùng cấu trúc causal đã kiểm chứng của renko.js
 * (forward-only, time luôn tăng nghiêm ngặt) — chỉ khác cách hình thành cột:
 * P&F dùng high/low để mở rộng cột trong CÙNG 1 nến, và ngưỡng đảo chiều là
 * `reversal` box (mặc định 3, chuẩn P&F) thay vì cố định 2 như Renko.
 *
 * Mỗi cột được trả về dưới dạng "pseudo-candle" {time,open,high,low,close}
 * để tái dùng thẳng CandlestickSeries + mọi primitive SMC/ATRBot sẵn có,
 * giống hệt cách renko.js làm với brick.
 *
 * Cột cuối cùng (đang mở, chưa đảo chiều) vẫn được trả về để không mất dữ
 * liệu gần nhất — cột này còn có thể thay đổi khi có thêm nến mới (đúng bản
 * chất "đang hình thành"), mọi cột TRƯỚC đó là bất biến vĩnh viễn.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.PointAndFigure = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

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
    for (let i = 1; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    return atr;
  }

  function computeBoxSize(candles, opts) {
    opts = opts || {};
    if (opts.mode === 'fixed') return Math.max(0, Number(opts.fixedSize) || 0);
    const period = opts.atrPeriod || 14;
    const mult = opts.atrMult != null ? opts.atrMult : 1.0;
    if (candles.length < period) return 0;
    const atr = wilderAtr(candles, period);
    return atr[atr.length - 1] * mult;
  }

  /**
   * @param {Array<{time,open,high,low,close}>} candles
   * @param {{mode?:'atr'|'fixed', atrPeriod?:number, atrMult?:number, fixedSize?:number, boxSize?:number, reversal?:number}} opts
   *   Truyền sẵn `opts.boxSize` để dùng giá trị đã "đóng băng" thay vì tự tính lại.
   * @returns {{columns: Array<{time,open,high,low,close,volume,direction:1|-1}>, boxSize: number}}
   */
  function calculate(candles, opts) {
    opts = opts || {};
    const n = candles.length;
    if (n === 0) return { columns: [], boxSize: 0 };

    const boxSize = opts.boxSize != null ? opts.boxSize : computeBoxSize(candles, opts);
    const reversal = opts.reversal || 3;
    const columns = [];
    if (!boxSize || boxSize <= 0) return { columns, boxSize: 0 };

    let top = candles[0].close;
    let bottom = candles[0].close;
    let direction = 0; // 0 chưa xác định, 1 = cột X (tăng), -1 = cột O (giảm)
    let lastTime = -Infinity;
    function nextTime(t) {
      const r = t > lastTime ? t : lastTime + 1;
      lastTime = r;
      return r;
    }

    for (let i = 1; i < n; i++) {
      const { high, low, time } = candles[i];

      if (direction >= 0 && high - top >= boxSize) {
        direction = 1;
        while (high - top >= boxSize) top += boxSize;
      }
      if (direction <= 0 && bottom - low >= boxSize) {
        direction = -1;
        while (bottom - low >= boxSize) bottom -= boxSize;
      }

      if (direction === 1 && top - low >= boxSize * reversal) {
        columns.push({ time: nextTime(time), open: bottom, high: top, low: bottom, close: top, volume: 0, direction: 1 });
        const newTop = top - boxSize;
        direction = -1; top = newTop; bottom = newTop;
        while (bottom - low >= boxSize) bottom -= boxSize;
      } else if (direction === -1 && high - bottom >= boxSize * reversal) {
        columns.push({ time: nextTime(time), open: top, high: top, low: bottom, close: bottom, volume: 0, direction: -1 });
        const newBottom = bottom + boxSize;
        direction = 1; bottom = newBottom; top = newBottom;
        while (high - top >= boxSize) top += boxSize;
      }
    }

    if (direction !== 0) {
      columns.push({
        time: nextTime(candles[n - 1].time),
        open: direction === 1 ? bottom : top,
        high: top, low: bottom,
        close: direction === 1 ? top : bottom,
        volume: 0, direction,
      });
    }

    return { columns, boxSize };
  }

  return { calculate: calculate, computeBoxSize: computeBoxSize, wilderAtr: wilderAtr };
}));
