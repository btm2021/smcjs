/**
 * PnfLevels — Support/Resistance + Trading Range trên biểu đồ Point & Figure,
 * theo đúng 3 bước trong đặc tả thuật toán (histogram đỉnh/đáy theo hàng ô
 * giá + cửa sổ trượt phát hiện vùng tích lũy). Thử nghiệm, không thuộc lõi
 * SMC.js.
 *
 * Bước 1 (dựng cột P&F) KHÔNG viết lại ở đây — dùng thẳng PointAndFigure.calculate()
 * (pnf.js), vốn đã trả về đúng {open,high,low,close,direction} theo bội số box.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.PnfLevels = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

  /** Bước 1: cột P&F -> {time, type:'X'|'O', high, low} (đã lượng tử hoá theo box). */
  function buildColumns(pnfResult) {
    return pnfResult.columns.map((c) => ({
      time: c.time,
      type: c.direction === 1 ? 'X' : 'O',
      high: Math.max(c.open, c.close),
      low: Math.min(c.open, c.close),
    }));
  }

  /**
   * Bước 2: Histogram đỉnh (cột X) / đáy (cột O) theo đúng hàng giá -> mức
   * Kháng cự / Hỗ trợ tĩnh. touches=2 -> Double Top/Bottom, >=3 -> Triple+.
   */
  function findSupportResistance(columns, opts) {
    const minTouches = (opts && opts.minTouches) || 2;
    const highs = new Map(), lows = new Map();
    columns.forEach((c, i) => {
      const m = c.type === 'X' ? highs : lows;
      const key = c.type === 'X' ? c.high : c.low;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(i);
    });

    function toLevels(m) {
      const out = [];
      for (const [price, columnIndices] of m) {
        if (columnIndices.length < minTouches) continue;
        const touches = columnIndices.length;
        out.push({ price, touches, columnIndices, label: touches === 2 ? 'double' : touches === 3 ? 'triple' : 'multiple' });
      }
      return out.sort((a, b) => b.price - a.price);
    }

    return { resistance: toLevels(highs), support: toLevels(lows) };
  }

  /**
   * Bước 3: cửa sổ trượt tìm Trading Range — với mỗi điểm bắt đầu, mở rộng
   * cửa sổ tới khi biên độ (top-bottom) vượt `maxHeight` hoặc hết dữ liệu,
   * giữ lại lần mở rộng CUỐI CÙNG còn thoả cả 3 điều kiện (>=minColumns cột,
   * trong biên maxHeight, đỉnh/đáy mỗi bên chạm >=minTouches lần) — tức
   * vùng tích luỹ DÀI NHẤT bắt đầu tại đó. Sau đó loại các range bị range
   * khác bao trọn.
   *
   * ponytail: O(n²) qua toàn bộ cặp (start,end) — ổn với vài trăm-nghìn cột
   * P&F thực tế; nếu dữ liệu lên hàng chục nghìn cột, đổi sang deque trượt
   * O(n) cho max/min (kiểu monotonic queue) thay vì quét lại mỗi start.
   */
  function findRanges(columns, opts) {
    opts = opts || {};
    const minColumns = opts.minColumns || 4;
    const minTouches = opts.minTouches || 2;
    const maxHeight = opts.maxHeight; // null/undefined = không giới hạn thêm ngoài điều kiện chạm

    const candidates = [];
    for (let start = 0; start <= columns.length - minColumns; start++) {
      let top = -Infinity, bottom = Infinity;
      const highTouch = new Map(), lowTouch = new Map();
      let lastValid = null;

      for (let end = start; end < columns.length; end++) {
        const c = columns[end];
        if (c.type === 'X') {
          top = Math.max(top, c.high);
          highTouch.set(c.high, (highTouch.get(c.high) || 0) + 1);
        } else {
          bottom = Math.min(bottom, c.low);
          lowTouch.set(c.low, (lowTouch.get(c.low) || 0) + 1);
        }

        const count = end - start + 1;
        if (count < minColumns) continue;
        const height = top - bottom;
        if (maxHeight != null && height > maxHeight) break;

        const topTouches = highTouch.get(top) || 0;
        const bottomTouches = lowTouch.get(bottom) || 0;
        if (topTouches >= minTouches && bottomTouches >= minTouches) {
          lastValid = { startIndex: start, endIndex: end, columnCount: count, top, bottom, height, topTouches, bottomTouches };
        }
      }
      if (lastValid) candidates.push(lastValid);
    }

    // Bỏ range bị 1 range khác (dài hơn hoặc bằng) bao trọn hoàn toàn.
    return candidates.filter((a) => !candidates.some((b) =>
      b !== a && b.startIndex <= a.startIndex && b.endIndex >= a.endIndex &&
      (b.endIndex - b.startIndex > a.endIndex - a.startIndex)
    ));
  }

  /**
   * Gộp kháng cự + hỗ trợ thành MỘT danh sách "mức chính" (key level), kèm
   * danh sách thời điểm chạm (tăng dần). Một giá vừa là đỉnh cột X vừa là đáy
   * cột O -> gộp làm 1 mức và CỘNG số lần chạm (mức đó mạnh hơn hẳn, đúng
   * nguyên tắc đảo vai kháng cự <-> hỗ trợ).
   */
  function keyLevels(columns, sr) {
    const byPrice = new Map();
    for (const lv of sr.resistance.concat(sr.support)) {
      const times = lv.columnIndices.map((i) => columns[i].time);
      const cur = byPrice.get(lv.price);
      if (cur) { cur.touches += lv.touches; cur.times = cur.times.concat(times); }
      else byPrice.set(lv.price, { price: lv.price, touches: lv.touches, times: times });
    }
    const out = Array.from(byPrice.values());
    for (const lv of out) lv.times.sort((a, b) => a - b);
    return out.sort((a, b) => a.price - b.price);
  }

  /**
   * Chấm điểm tín hiệu ATRBot bằng mức P&F — ghi cờ `pnfBlocked`/`pnfConfirm`
   * thẳng vào từng phần tử của `results` (mảng do ATRBotM1Indicator.calculate
   * trả về, cùng chỉ số với `candles`).
   *
   *   BUY : mức ngay TRÊN giá = vật cản (vào lệnh mà hết dư địa -> CHẶN),
   *         mức ngay DƯỚI giá = điểm tựa (mua sát hỗ trợ -> XÁC NHẬN).
   *   SELL: ngược lại.
   *
   * Vì mức chính không phân biệt kháng cự/hỗ trợ mà chỉ xét TƯƠNG QUAN với giá
   * tại thời điểm tín hiệu, trường hợp giá phá mức rồi mức đó đổi vai (kháng cự
   * cũ thành hỗ trợ mới) được xử lý tự nhiên, không cần nhánh riêng.
   *
   * CAUSAL: tại nến i chỉ dùng mức đã đủ `minTouches` lần chạm TÍNH ĐẾN nến đó
   * — một mức "3 lần chạm" mà lần chạm thứ 2 còn nằm ở tương lai thì tại nến i
   * nó chưa tồn tại. Không có điều này thì mọi thống kê thắng/thua đều là nhìn
   * trộm tương lai.
   *
   * ponytail: quét O(số tín hiệu × số mức) — vài trăm × vài chục nên không đáng
   * tối ưu; nếu số mức lên hàng nghìn thì sort theo giá + binary search 2 đầu.
   */
  function gradeSignals(candles, results, levels, opts) {
    opts = opts || {};
    const blockPct = opts.blockPct != null ? opts.blockPct : 1.0;
    const confirmPct = opts.confirmPct != null ? opts.confirmPct : blockPct;
    const minTouches = opts.minTouches || 2;
    let blocked = 0, confirmed = 0;

    const n = Math.min(results.length, candles.length);
    for (let i = 0; i < n; i++) {
      const r = results[i];
      if (!r.isBuy && !r.isSell) continue;
      const price = candles[i].close, t = candles[i].time;

      let above = null, below = null;
      for (const lv of levels) {
        let seen = 0;
        for (const lt of lv.times) { if (lt > t) break; seen++; }
        if (seen < minTouches) continue;
        if (lv.price > price) { if (above === null || lv.price < above) above = lv.price; }
        else if (lv.price < price) { if (below === null || lv.price > below) below = lv.price; }
      }

      const dAbove = above === null ? Infinity : (above - price) / price * 100;
      const dBelow = below === null ? Infinity : (price - below) / price * 100;
      const dBlock = r.isBuy ? dAbove : dBelow;
      const dSupport = r.isBuy ? dBelow : dAbove;

      if (dBlock <= blockPct) { r.pnfBlocked = true; blocked++; }
      else if (dSupport <= confirmPct) { r.pnfConfirm = true; confirmed++; }
    }
    return { blocked: blocked, confirmed: confirmed };
  }

  /** Đường hỗ trợ động 45° hướng lên, neo tại đáy cột `anchorIndex`. */
  function bullishSupportLine(columns, anchorIndex, boxSize) {
    const anchor = columns[anchorIndex].low;
    const line = [];
    for (let i = anchorIndex, k = 0; i < columns.length; i++, k++) {
      line.push({ time: columns[i].time, price: anchor + k * boxSize });
    }
    return line;
  }

  /** Đường kháng cự động 45° hướng xuống, neo tại đỉnh cột `anchorIndex`. */
  function bearishResistanceLine(columns, anchorIndex, boxSize) {
    const anchor = columns[anchorIndex].high;
    const line = [];
    for (let i = anchorIndex, k = 0; i < columns.length; i++, k++) {
      line.push({ time: columns[i].time, price: anchor - k * boxSize });
    }
    return line;
  }

  return {
    buildColumns: buildColumns,
    findSupportResistance: findSupportResistance,
    findRanges: findRanges,
    keyLevels: keyLevels,
    gradeSignals: gradeSignals,
    bullishSupportLine: bullishSupportLine,
    bearishResistanceLine: bearishResistanceLine,
  };
}));
