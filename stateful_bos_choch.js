/**
 * BOS/CHOCH có "bộ nhớ" trạng thái xu hướng (thử nghiệm — KHÔNG thuộc thư viện
 * lõi SMC.js, không cần giữ parity với bản Python gốc).
 *
 * SMC.bosChoch() (thuật toán gốc) xếp loại BOS/CHOCH ĐỘC LẬP cho từng cụm 4
 * swing liên tiếp, chỉ dựa vào thứ tự giá trị của chúng — thuật toán không hề
 * lưu "xu hướng hiện tại đang là gì". Hệ quả: một chuỗi kiểu "đỉnh thoái lui
 * dần trước khi phá cấu trúc" (rounding top — Higher High rồi Lower High,
 * CHƯA phá đáy) không khớp cả 2 công thức BOS lẫn CHOCH, nên không được gắn
 * nhãn gì — khiến BOS có thể "đổi phe" (xanh -> đỏ) mà không có CHOCH ở giữa
 * (xem giải thích chi tiết kèm ví dụ thật trong lịch sử hội thoại/README).
 *
 * File này thay bằng một máy trạng thái (state machine) đúng theo cách hiểu
 * SMC kinh điển — LUÔN nhớ điều kiện/xu hướng trước đó:
 *
 *   - Luôn theo dõi đỉnh (swing high) và đáy (swing low) CHƯA BỊ PHÁ gần nhất
 *     làm 2 "mốc cấu trúc" hiện hành (mỗi khi có swing mới cùng loại xuất
 *     hiện, mốc được cập nhật sang swing mới nhất).
 *   - Khi giá phá 1 trong 2 mốc:
 *       + Phá CÙNG chiều với xu hướng đang nhớ (hoặc chưa có xu hướng, tức
 *         lần phá đầu tiên) -> BOS (tiếp diễn). Xu hướng giữ nguyên/khởi tạo.
 *       + Phá NGƯỢC chiều xu hướng đang nhớ -> CHOCH (đảo chiều), và xu
 *         hướng đang nhớ ĐƯỢC CẬP NHẬT sang chiều mới ngay lập tức.
 *   - Mốc vừa bị phá được "tiêu thụ" (đặt về null) — chờ swing cùng loại kế
 *     tiếp xuất hiện mới có mốc mới để theo dõi.
 *
 * Nhờ có bộ nhớ, mọi cú phá cùng chiều xu hướng LUÔN là BOS, và bắt buộc phải
 * có đúng 1 CHOCH mỗi khi đổi phe — không còn khoảng "im lặng" như bản gốc.
 *
 * Output CÙNG SHAPE với SMC.bosChoch(): Array<{bos, choch, level, brokenIndex}>
 * cùng độ dài với candles, dùng thay thế trực tiếp cho code vẽ BOS/CHOCH hiện
 * có trong demo. Nhận `swingHL` bất kỳ (cố định hay Cửa sổ Động) làm input,
 * không quan tâm nó được tính bằng cách nào.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.StatefulBosChoch = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

  function calculate(candles, swingHL, opts) {
    opts = opts || {};
    const closeBreak = opts.closeBreak !== false;
    const n = candles.length;
    if (n === 0) return [];

    const close = new Array(n), high = new Array(n), low = new Array(n);
    for (let i = 0; i < n; i++) {
      close[i] = candles[i].close;
      high[i] = candles[i].high;
      low[i] = candles[i].low;
    }

    const bos = new Array(n).fill(0);
    const choch = new Array(n).fill(0);
    const level = new Array(n).fill(0);
    const broken = new Array(n).fill(0);

    let trend = 0; // 0 = chưa xác định, 1 = bullish, -1 = bearish
    let pendingHigh = null; // { index, level } — đỉnh chưa bị phá gần nhất
    let pendingLow = null; // { index, level } — đáy chưa bị phá gần nhất

    for (let i = 0; i < n; i++) {
      // 1. Kiểm tra phá vỡ mốc hiện hành TẠI nến i — bỏ qua chính nến hình
      //    thành mốc và nến liền sau (đệm +2, giống khoảng đệm i+2 của bản
      //    gốc trong src/indicators/bosChoch.js) để tránh khớp giả do wick
      //    của chính nến tạo swing.
      if (pendingHigh !== null && i >= pendingHigh.index + 2) {
        const brokeUp = closeBreak ? close[i] > pendingHigh.level : high[i] > pendingHigh.level;
        if (brokeUp) {
          const anchor = pendingHigh.index;
          const isBos = trend !== -1; // chưa có xu hướng hoặc đang bullish -> tiếp diễn
          if (isBos) bos[anchor] = 1; else choch[anchor] = 1;
          level[anchor] = pendingHigh.level;
          broken[anchor] = i;
          trend = 1;
          pendingHigh = null;
        }
      }
      if (pendingLow !== null && i >= pendingLow.index + 2) {
        const brokeDown = closeBreak ? close[i] < pendingLow.level : low[i] < pendingLow.level;
        if (brokeDown) {
          const anchor = pendingLow.index;
          const isBos = trend !== 1;
          if (isBos) bos[anchor] = -1; else choch[anchor] = -1;
          level[anchor] = pendingLow.level;
          broken[anchor] = i;
          trend = -1;
          pendingLow = null;
        }
      }

      // 2. Cập nhật mốc cấu trúc khi có swing MỚI xuất hiện tại nến i (luôn
      //    lấy swing mới nhất cùng loại làm mốc theo dõi tiếp theo).
      const hl = swingHL[i] ? swingHL[i].highLow : null;
      if (hl === 1) pendingHigh = { index: i, level: swingHL[i].level };
      else if (hl === -1) pendingLow = { index: i, level: swingHL[i].level };
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        bos: bos[i] !== 0 ? bos[i] : null,
        choch: choch[i] !== 0 ? choch[i] : null,
        level: level[i] !== 0 ? level[i] : null,
        brokenIndex: broken[i] !== 0 ? broken[i] : null,
      };
    }
    return result;
  }

  return { calculate: calculate };
}));
