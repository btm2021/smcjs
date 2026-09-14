/**
 * SmcStrategies — thư viện phát hiện tín hiệu Entry (thử nghiệm — KHÔNG thuộc
 * thư viện lõi SMC.js, không cần giữ parity với bản Python gốc).
 *
 * Đây là bản port lại phần "phát hiện tín hiệu" (KHÔNG gồm phần mô phỏng khớp
 * lệnh / đo thắng-thua MFE) của 17 mô hình đã backtest trong
 * research/backtest_multi.mjs (xem research/REPORT.md để biết đầy đủ số liệu
 * win-rate trên 10 symbol x 100.500 nến). Dùng chung 1 file cho cả 2 nơi
 * (research backtest chạy bằng Node, demo/index.html chạy trên trình duyệt)
 * để đảm bảo logic phát hiện tín hiệu GIỐNG HỆT nhau — không viết lại 2 lần.
 *
 * THIẾT KẾ CHỐNG REPAINT (quan trọng — đọc trước khi thêm strategy mới):
 *   - Mọi strategy CHỈ nhận `candles` làm input (không có biến toàn cục nào
 *     khác chứa dữ liệu tương lai) — giống hệt nguyên tắc của mọi hàm SMC.*.
 *     Khi demo ở chế độ Replay, `candles` chỉ là 1 slice bị cắt tới đúng thời
 *     điểm hiện tại, nên strategy tự động không thể "nhìn thấy" tương lai.
 *   - File này KHÔNG tự áp dụng vùng đệm chống-repaint (anti-repaint buffer)
 *     — đó là chính sách của tầng UI (xem `isUnsettledAnchor()` trong
 *     demo/index.html), vì ngưỡng buffer là tuỳ chọn người dùng. `run()`/
 *     `runMany()` trả về tín hiệu THÔ (bao gồm cả các tín hiệu neo gần rìa
 *     mảng candles hiện tại — nơi swingHighsLows()'s "fixed-point reduction"
 *     có thể vẫn còn thay đổi trong tương lai). Bên gọi (demo) PHẢI tự lọc bỏ
 *     `sig.index > candles.length - 1 - bufferBars` trước khi hiển thị, đúng
 *     như đã làm với swing/BOS/OB/Liquidity.
 *   - Vì vậy 1 tín hiệu do file này trả ra là chuẩn "point-in-time": chạy lại
 *     `run()` với `candles` bị cắt ngắn hơn (kết thúc đúng tại hoặc sau
 *     `sig.index`) luôn cho lại đúng tín hiệu đó ở đúng vị trí — đây chính là
 *     tính chất bắt buộc để đảm bảo KHÔNG REPAINT khi kết hợp với vùng đệm ở
 *     tầng UI (đã kiểm chứng bằng research/verify scripts, xem cách kiểm tra
 *     ở cuối file này).
 *
 * Output signal shape: { index, time, direction: 1|-1, kind: 'market'|'limit',
 *   price: number|null, label: string }
 *   - `index` = vị trí trong mảng `candles` nơi tín hiệu HÌNH THÀNH (không
 *     phải nơi khớp lệnh — với lệnh limit, giá có thể khớp muộn hơn hoặc
 *     không bao giờ khớp; file này chỉ báo hiệu điểm hình thành để hiển thị).
 *   - `price` chỉ có ý nghĩa tham khảo (vùng/mức giá gợi ý) với các mô hình
 *     dạng limit; null với market.
 */
(function (root, factory) {
  const globalObj = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null)));
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (globalObj) {
    globalObj.SmcStrategies = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)), function () {
  'use strict';

  // Tham số cố định, GIỐNG HỆT research/backtest_multi.mjs — để số liệu
  // win-rate trong research/REPORT.md vẫn còn ý nghĩa tham chiếu cho các tín
  // hiệu hiển thị ở đây. Cố tình KHÔNG lấy từ state cài đặt SMC chung của demo
  // (vd swingLength người dùng có thể chỉnh ở card "Swing Highs/Lows") để
  // tránh làm lệch kết quả đã backtest.
  const SWING_LEN = 20;
  const DYN_OPTS = { baseWindow: 20, atrLength: 14, adaptiveK: 1.5, percentileWindow: 3000, minPeriods: 100, minBars: 5, maxBars: 100 };
  const ATR_BASE = { maType: 'VIDYA', cmoLength: 14, maLength: 21, atrLength: 14, baseAtrMult: 2.0, percentileWindow: 5000, minPeriods: 200 };
  const BOS_CONFIRM_LOOKBACK = 30;
  const RETEST_DEADLINE_BARS = 50;
  const LIQ_SWEEP_DEADLINE_BARS = 96;
  const BREAKER_DEADLINE_BARS = 100;
  // Vùng khởi động: bỏ qua mọi tín hiệu neo quá gần đầu mảng `candles`. Không
  // liên quan tới vùng đệm chống-repaint ở rìa PHẢI (tương lai) — đây là rìa
  // TRÁI (quá khứ xa của chính prefix đang xét). Lý do cần có: retracements()
  // có bước "xoá 3 legs đầu tiên vì chưa đủ lịch sử" mà việc "3 legs đầu tiên
  // là những leg nào" có thể xê dịch nhẹ tuỳ độ dài mảng đưa vào (đã kiểm
  // chứng thực nghiệm: 1 tín hiệu M9 tại index 118 xuất hiện/biến mất không
  // ổn định qua các checkpoint trước khi thêm hằng số này) — ngoài ra ATRBot
  // M1 cần tối thiểu `minPeriods` (200) nến mới đủ dữ liệu cho percentile-rank
  // và bản thân SMA/VIDYA cần thời gian "làm nóng". 1000 nến là dư an toàn.
  const WARMUP_BARS = 1000;

  function lazy(fn) {
    let done = false, value;
    return function () {
      if (!done) { value = fn(); done = true; }
      return value;
    };
  }

  function stripLastSwing(swingHL) {
    if (swingHL.length > 0) swingHL[swingHL.length - 1] = { highLow: null, level: null };
    return swingHL;
  }

  function resolveDeps(deps) {
    const g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    deps = deps || {};
    return {
      SMC: deps.SMC || g.SMC,
      ATRBotM1Indicator: deps.ATRBotM1Indicator || g.ATRBotM1Indicator,
      DynamicSwingHL: deps.DynamicSwingHL || g.DynamicSwingHL,
      StatefulBosChoch: deps.StatefulBosChoch || g.StatefulBosChoch,
    };
  }

  /**
   * Tạo 1 context tính-lười (lazy): mỗi chỉ báo nền chỉ được tính khi có ít
   * nhất 1 strategy thực sự cần tới nó (qua `ctx.xxx()`), và chỉ tính 1 lần
   * dù nhiều strategy cùng gọi trong 1 lượt `runMany()`.
   */
  function buildContext(candles, deps) {
    const N = candles.length;
    const ctx = { candles, N };

    ctx.swingFixed = lazy(() => stripLastSwing(deps.SMC.swingHighsLows(candles, { swingLength: SWING_LEN })));
    ctx.swingDynamic = lazy(() => {
      if (!deps.DynamicSwingHL) return ctx.swingFixed();
      return stripLastSwing(deps.DynamicSwingHL.calculate(candles, DYN_OPTS).swingHL);
    });

    ctx.bosFixed = lazy(() => deps.SMC.bosChoch(candles, ctx.swingFixed(), { closeBreak: true }));
    ctx.bosStateful = lazy(() => {
      if (!deps.StatefulBosChoch) return ctx.bosFixed();
      return deps.StatefulBosChoch.calculate(candles, ctx.swingFixed(), { closeBreak: true });
    });
    ctx.bosDynamic = lazy(() => deps.SMC.bosChoch(candles, ctx.swingDynamic(), { closeBreak: true }));

    ctx.ob = lazy(() => deps.SMC.orderBlocks(candles, ctx.swingFixed(), { closeMitigation: false }));
    ctx.obDynamic = lazy(() => deps.SMC.orderBlocks(candles, ctx.swingDynamic(), { closeMitigation: false }));
    ctx.fvg = lazy(() => deps.SMC.fvg(candles, { joinConsecutive: false }));
    ctx.liq = lazy(() => deps.SMC.liquidity(candles, ctx.swingFixed(), { rangePercent: 0.01 }));
    ctx.liqDynamic = lazy(() => deps.SMC.liquidity(candles, ctx.swingDynamic(), { rangePercent: 0.01 }));
    ctx.retr = lazy(() => deps.SMC.retracements(candles, ctx.swingFixed()));

    ctx.atrFixed = lazy(() => deps.ATRBotM1Indicator.calculate(candles, Object.assign({}, ATR_BASE, { adaptiveK: 0, liqSweepFilterPct: 0 })));
    ctx.atrAdaptive = lazy(() => deps.ATRBotM1Indicator.calculate(candles, Object.assign({}, ATR_BASE, { adaptiveK: 1.5, liqSweepFilterPct: 0 })));
    ctx.atrAdaptiveLiqFiltered = lazy(() => deps.ATRBotM1Indicator.calculate(candles, Object.assign({}, ATR_BASE, { adaptiveK: 1.5, liqSweepFilterPct: 3 })));

    ctx.sessionActive = lazy(() => {
      const london = deps.SMC.sessions(candles, { session: 'London' });
      const ny = deps.SMC.sessions(candles, { session: 'New York' });
      const out = new Array(N);
      for (let i = 0; i < N; i++) out[i] = london[i].active === 1 || ny[i].active === 1;
      return out;
    });

    return ctx;
  }

  function nextOppositeAtrSignal(atrArr, N, fromIndex, direction) {
    for (let k = fromIndex + 1; k < N; k++) {
      if (direction === 1 && atrArr[k].isSell) return true;
      if (direction === -1 && atrArr[k].isBuy) return true;
    }
    return false;
  }

  function sig(index, candles, direction, kind, price, label) {
    return { index, time: candles[index].time, direction, kind, price: price != null ? price : null, label };
  }

  // ---------------------------------------------------------------------
  // 17 mô hình — mỗi hàm CHỈ trả về điểm HÌNH THÀNH tín hiệu (không mô
  // phỏng khớp lệnh/MFE, xem research/backtest_multi.mjs nếu cần bản đầy đủ
  // có đo thắng-thua).
  // ---------------------------------------------------------------------
  const DETECTORS = {
    M1(ctx) {
      const { candles, N, atrFixed } = ctx;
      const a = atrFixed();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (a[i].isBuy) out.push(sig(i, candles, 1, 'market', null, 'M1'));
        else if (a[i].isSell) out.push(sig(i, candles, -1, 'market', null, 'M1'));
      }
      return out;
    },
    M2(ctx) {
      const { candles, N, atrAdaptive } = ctx;
      const a = atrAdaptive();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (a[i].isBuy) out.push(sig(i, candles, 1, 'market', null, 'M2'));
        else if (a[i].isSell) out.push(sig(i, candles, -1, 'market', null, 'M2'));
      }
      return out;
    },
    M3(ctx) {
      const { candles, N, atrAdaptive, bosFixed } = ctx;
      const a = atrAdaptive(), b = bosFixed();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (!a[i].isBuy && !a[i].isSell) continue;
        const direction = a[i].isBuy ? 1 : -1;
        let confirmed = false;
        for (let k = Math.max(0, i - BOS_CONFIRM_LOOKBACK); k < i; k++) {
          const r = b[k];
          if ((direction === 1 && (r.bos === 1 || r.choch === 1)) || (direction === -1 && (r.bos === -1 || r.choch === -1))) { confirmed = true; break; }
        }
        if (confirmed) out.push(sig(i, candles, direction, 'market', null, 'M3'));
      }
      return out;
    },
    M4(ctx) {
      const { candles, N, atrAdaptive, ob } = ctx;
      const a = atrAdaptive(), o = ob();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (o[i].ob === 1 && a[i].trend === 1) out.push(sig(i, candles, 1, 'limit', o[i].top, 'M4'));
        else if (o[i].ob === -1 && a[i].trend === -1) out.push(sig(i, candles, -1, 'limit', o[i].bottom, 'M4'));
      }
      return out;
    },
    M5(ctx) {
      const { candles, N, atrAdaptive, fvg } = ctx;
      const a = atrAdaptive(), f = fvg();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (f[i].fvg === 1 && a[i].trend === 1) out.push(sig(i, candles, 1, 'limit', f[i].top, 'M5'));
        else if (f[i].fvg === -1 && a[i].trend === -1) out.push(sig(i, candles, -1, 'limit', f[i].bottom, 'M5'));
      }
      return out;
    },
    M6(ctx) {
      const { candles, N, liq } = ctx;
      const l = liq();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (l[i].liquidity === -1 && l[i].swept) {
          const k = l[i].swept;
          if (k > 0 && k < N && candles[k].close > l[i].level) out.push(sig(k, candles, 1, 'market', null, 'M6'));
        } else if (l[i].liquidity === 1 && l[i].swept) {
          const k = l[i].swept;
          if (k > 0 && k < N && candles[k].close < l[i].level) out.push(sig(k, candles, -1, 'market', null, 'M6'));
        }
      }
      return out;
    },
    M7(ctx) {
      const { candles, N, bosFixed } = ctx;
      const b = bosFixed();
      const out = [];
      for (let i = 0; i < N; i++) {
        const r = b[i];
        if (r.brokenIndex === null || r.brokenIndex === undefined) continue;
        const j = r.brokenIndex;
        if (j < i || j >= N) continue;
        if (r.bos === 1 || r.choch === 1) out.push(sig(j, candles, 1, 'limit', r.level, 'M7'));
        else if (r.bos === -1 || r.choch === -1) out.push(sig(j, candles, -1, 'limit', r.level, 'M7'));
      }
      return out;
    },
    M8(ctx) {
      const { candles, N, atrAdaptive, ob, fvg } = ctx;
      const a = atrAdaptive(), o = ob(), f = fvg();
      const out = [];
      function findConfluentFvg(i, dir, obTop, obBottom) {
        for (let k = Math.max(0, i - 20); k <= Math.min(N - 1, i + 20); k++) {
          const item = f[k];
          if (item.fvg !== dir) continue;
          if (Math.min(item.top, obTop) - Math.max(item.bottom, obBottom) > 0) return item;
        }
        return null;
      }
      for (let i = 0; i < N; i++) {
        if (o[i].ob === 1 && a[i].trend === 1) {
          const fz = findConfluentFvg(i, 1, o[i].top, o[i].bottom);
          if (fz) out.push(sig(i, candles, 1, 'limit', (fz.top + o[i].top) / 2, 'M8'));
        } else if (o[i].ob === -1 && a[i].trend === -1) {
          const fz = findConfluentFvg(i, -1, o[i].top, o[i].bottom);
          if (fz) out.push(sig(i, candles, -1, 'limit', (fz.bottom + o[i].bottom) / 2, 'M8'));
        }
      }
      return out;
    },
    M9(ctx) {
      const { candles, N, atrAdaptive, retr } = ctx;
      const a = atrAdaptive(), r = retr();
      const out = [];
      for (let i = 1; i < N; i++) {
        const prev = r[i - 1], cur = r[i];
        if (cur.direction === 1 && a[i].trend === 1 && prev.currentRetracementPct < 50 && cur.currentRetracementPct >= 50) {
          out.push(sig(i, candles, 1, 'market', null, 'M9'));
        }
        if (cur.direction === -1 && a[i].trend === -1 && prev.currentRetracementPct < 50 && cur.currentRetracementPct >= 50) {
          out.push(sig(i, candles, -1, 'market', null, 'M9'));
        }
      }
      return out;
    },
    M10(ctx) {
      const { candles, N, atrAdaptive, bosStateful } = ctx;
      const a = atrAdaptive(), b = bosStateful();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (!a[i].isBuy && !a[i].isSell) continue;
        const direction = a[i].isBuy ? 1 : -1;
        let confirmed = false;
        for (let k = Math.max(0, i - BOS_CONFIRM_LOOKBACK); k < i; k++) {
          const r = b[k];
          if ((direction === 1 && (r.bos === 1 || r.choch === 1)) || (direction === -1 && (r.bos === -1 || r.choch === -1))) { confirmed = true; break; }
        }
        if (confirmed) out.push(sig(i, candles, direction, 'market', null, 'M10'));
      }
      return out;
    },
    M11(ctx) {
      const { candles, N, bosStateful } = ctx;
      const b = bosStateful();
      const out = [];
      for (let i = 0; i < N; i++) {
        const r = b[i];
        if (r.brokenIndex === null || r.brokenIndex === undefined) continue;
        const j = r.brokenIndex;
        if (j < i || j >= N) continue;
        if (r.bos === 1 || r.choch === 1) out.push(sig(j, candles, 1, 'limit', r.level, 'M11'));
        else if (r.bos === -1 || r.choch === -1) out.push(sig(j, candles, -1, 'limit', r.level, 'M11'));
      }
      return out;
    },
    M12(ctx) {
      const { candles, N, atrAdaptive, obDynamic } = ctx;
      const a = atrAdaptive(), o = obDynamic();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (o[i].ob === 1 && a[i].trend === 1) out.push(sig(i, candles, 1, 'limit', o[i].top, 'M12'));
        else if (o[i].ob === -1 && a[i].trend === -1) out.push(sig(i, candles, -1, 'limit', o[i].bottom, 'M12'));
      }
      return out;
    },
    M13(ctx) {
      const { candles, N, bosDynamic } = ctx;
      const b = bosDynamic();
      const out = [];
      for (let i = 0; i < N; i++) {
        const r = b[i];
        if (r.brokenIndex === null || r.brokenIndex === undefined) continue;
        const j = r.brokenIndex;
        if (j < i || j >= N) continue;
        if (r.bos === 1 || r.choch === 1) out.push(sig(j, candles, 1, 'limit', r.level, 'M13'));
        else if (r.bos === -1 || r.choch === -1) out.push(sig(j, candles, -1, 'limit', r.level, 'M13'));
      }
      return out;
    },
    M14(ctx) {
      const { candles, N, liqDynamic } = ctx;
      const l = liqDynamic();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (l[i].liquidity === -1 && l[i].swept) {
          const k = l[i].swept;
          if (k > 0 && k < N && candles[k].close > l[i].level) out.push(sig(k, candles, 1, 'market', null, 'M14'));
        } else if (l[i].liquidity === 1 && l[i].swept) {
          const k = l[i].swept;
          if (k > 0 && k < N && candles[k].close < l[i].level) out.push(sig(k, candles, -1, 'market', null, 'M14'));
        }
      }
      return out;
    },
    // ⚠ Xem cảnh báo "survivorship bias" ở research/REPORT.md mục 6.1 — do
    // SMC.orderBlocks() ghi đè (xoá) dữ liệu của 1 OB ngay tại vị trí hình
    // thành mỗi khi breaker của nó sau này bị phá hoàn toàn, danh sách trả về
    // ở đây chỉ gồm những breaker CHƯA từng bị phá tính đến cuối `candles`
    // hiện tại — không phản ánh đầy đủ những ca đã thất bại trong lịch sử.
    // Giữ lại để tham khảo trực quan, KHÔNG dùng số liệu win-rate của model
    // này để ra quyết định.
    M15(ctx) {
      const { candles, N, ob } = ctx;
      const o = ob();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (o[i].ob === 1 && o[i].mitigatedIndex) out.push(sig(o[i].mitigatedIndex, candles, -1, 'limit', o[i].top, 'M15⚠'));
        if (o[i].ob === -1 && o[i].mitigatedIndex) out.push(sig(o[i].mitigatedIndex, candles, 1, 'limit', o[i].bottom, 'M15⚠'));
      }
      return out;
    },
    M16(ctx) {
      const { candles, N, atrAdaptiveLiqFiltered } = ctx;
      const a = atrAdaptiveLiqFiltered();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (a[i].isBuy) out.push(sig(i, candles, 1, 'market', null, 'M16'));
        else if (a[i].isSell) out.push(sig(i, candles, -1, 'market', null, 'M16'));
      }
      return out;
    },
    M17(ctx) {
      const { candles, N, atrAdaptive, sessionActive } = ctx;
      const a = atrAdaptive(), s = sessionActive();
      const out = [];
      for (let i = 0; i < N; i++) {
        if (!s[i]) continue;
        if (a[i].isBuy) out.push(sig(i, candles, 1, 'market', null, 'M17'));
        else if (a[i].isSell) out.push(sig(i, candles, -1, 'market', null, 'M17'));
      }
      return out;
    },
  };

  // repaintRisk: 'none' = đã kiểm chứng thực nghiệm 0 vi phạm qua nhiều
  //   checkpoint tăng dần (xem research/verify_strategies_no_repaint.mjs) với
  //   MỌI mức bufferBars, kể cả 0 — vì detector chỉ dùng ATRBot/BOS-CHOCH/FVG
  //   (các hàm hoàn toàn causal, không có state toàn cục phụ thuộc độ dài mảng).
  //   'ob-liquidity' = PHỤ THUỘC SMC.orderBlocks()/SMC.liquidity() — 2 hàm này
  //   có nguồn repaint SÂU HƠN mức thời gian (vd liquidity() dùng high/low
  //   TOÀN CỤC của cả mảng candles để tính pipRange, nên thêm dữ liệu mới có
  //   thể đổi ngược cả những cụm đã hình thành rất lâu) — ĐÃ kiểm chứng THỰC
  //   NGHIỆM là KHÔNG triệt tiêu hết được dù tăng bufferBars lên 5000 (giảm
  //   dần nhưng không về 0, xem research/REPORT.md mục 6.1 và log kiểm chứng).
  //   Vùng đệm chống-repaint (`state.antiRepaint`) làm GIẢM tần suất nhưng
  //   KHÔNG đảm bảo tuyệt đối với nhóm này — hiển thị cảnh báo rõ trong UI.
  const LIST = [
    { id: 'M1', name: 'ATRBot gốc (mult cố định)', kind: 'market', group: 'ATRBot', winRate: 62.68, sampleSize: 4970, uses: ['atrbot'], repaintRisk: 'none', desc: 'Tín hiệu đảo chiều regime của ATRBot với atrMult cố định — baseline, không dùng SMC.' },
    { id: 'M2', name: 'ATRBot M1 Adaptive', kind: 'market', group: 'ATRBot', winRate: 70.94, sampleSize: 3335, uses: ['atrbot'], repaintRisk: 'none', desc: 'Như M1 nhưng atrMult co giãn theo percentile ATR% (giảm whipsaw ở vùng biến động thấp).' },
    { id: 'M3', name: 'ATRBot + xác nhận BOS/CHOCH', kind: 'market', group: 'Kết hợp', winRate: 83.72, sampleSize: 479, uses: ['atrbot', 'bos'], repaintRisk: 'none', desc: 'Chỉ giữ tín hiệu ATRBot nếu có BOS/CHOCH gốc cùng hướng trong 30 nến trước.' },
    { id: 'M4', name: 'Retest Order Block theo trend', kind: 'limit', group: 'Kết hợp', winRate: 92.12, sampleSize: 330, uses: ['atrbot', 'ob'], repaintRisk: 'ob-liquidity', desc: '★ Win-rate tốt nhất — chờ 1 Order Block mới cùng hướng regime ATRBot, vào limit tại cạnh gần OB.' },
    { id: 'M5', name: 'Retest FVG theo trend', kind: 'limit', group: 'Kết hợp', winRate: 19.09, sampleSize: 100246, uses: ['atrbot', 'fvg'], repaintRisk: 'none', desc: 'Như M4 nhưng dùng Fair Value Gap — quá thường xuyên nên win-rate thấp, không khuyến nghị đứng riêng.' },
    { id: 'M6', name: 'Liquidity Sweep + Reject', kind: 'market', group: 'Độc lập ATRBot', winRate: 81.25, sampleSize: 208, uses: ['liquidity'], repaintRisk: 'ob-liquidity', desc: 'Vào ngược hướng khi 1 pool thanh khoản bị quét rồi giá đóng cửa từ chối trở lại. Nhanh (~12 nến).' },
    { id: 'M7', name: 'BOS/CHOCH breakout + retest', kind: 'limit', group: 'Cấu trúc', winRate: 40.10, sampleSize: 11938, uses: ['bos'], repaintRisk: 'none', desc: 'Chờ giá hồi lại đúng mức vừa bị BOS/CHOCH phá vỡ.' },
    { id: 'M8', name: 'Multi-entry DCA OB+FVG', kind: 'limit', group: 'Kết hợp', winRate: 85.71, sampleSize: 77, uses: ['atrbot', 'ob', 'fvg'], repaintRisk: 'ob-liquidity', desc: 'OB và FVG cùng hướng chồng vùng giá → 2 lệnh limit DCA. Mẫu nhỏ, cần thêm dữ liệu để chắc chắn.' },
    { id: 'M9', name: 'Retracement 50% pullback', kind: 'market', group: 'Kết hợp', winRate: 50.80, sampleSize: 21699, uses: ['atrbot', 'retracements'], repaintRisk: 'none', desc: 'Mua/bán khi giá hồi đủ 50% sóng gần nhất, thuận hướng regime ATRBot.' },
    { id: 'M10', name: 'ATRBot + xác nhận StatefulBosChoch', kind: 'market', group: 'Kết hợp', winRate: 83.40, sampleSize: 470, uses: ['atrbot', 'bos'], repaintRisk: 'none', desc: 'Như M3 nhưng dùng BOS/CHOCH có bộ nhớ trạng thái — kết quả gần như tương đương M3.' },
    { id: 'M11', name: 'StatefulBosChoch breakout + retest', kind: 'limit', group: 'Cấu trúc', winRate: 40.81, sampleSize: 11614, uses: ['bos'], repaintRisk: 'none', desc: 'Như M7 nhưng dùng StatefulBosChoch.' },
    { id: 'M12', name: 'Retest OB (Dynamic Swing)', kind: 'limit', group: 'Thử nghiệm', winRate: 91.15, sampleSize: 260, uses: ['atrbot', 'ob'], repaintRisk: 'ob-liquidity', desc: 'Như M4 nhưng Order Block dựa trên swing động — chất lượng tương đương M4, ít tín hiệu hơn.' },
    { id: 'M13', name: 'BOS/CHOCH retest (Dynamic Swing)', kind: 'limit', group: 'Thử nghiệm', winRate: 42.47, sampleSize: 6989, uses: ['bos'], repaintRisk: 'none', desc: 'Như M7 nhưng dùng swing động — cải thiện nhẹ.' },
    { id: 'M14', name: 'Liquidity Sweep (Dynamic Swing)', kind: 'market', group: 'Thử nghiệm', winRate: 82.99, sampleSize: 147, uses: ['liquidity'], repaintRisk: 'ob-liquidity', desc: 'Như M6 nhưng dùng swing động — cải thiện nhẹ.' },
    { id: 'M15', name: 'Breaker Block retest ⚠', kind: 'limit', group: 'Độc lập ATRBot', winRate: null, sampleSize: null, uses: ['ob'], repaintRisk: 'ob-liquidity', desc: '⚠ Sai lệch phương pháp (survivorship bias) — chỉ mang tính tham khảo trực quan, KHÔNG dùng để ra quyết định. Xem research/REPORT.md mục 6.1.' },
    { id: 'M16', name: 'ATRBot + lọc khoảng cách Liquidity', kind: 'market', group: 'ATRBot', winRate: 85.43, sampleSize: 1881, uses: ['atrbot', 'liquidity'], repaintRisk: 'ob-liquidity', desc: '★ Mẫu lớn nhất trong nhóm hiệu suất cao, nhất quán nhất qua 10 symbol — bật liqSweepFilterPct=3 có sẵn của ATRBot M1.' },
    { id: 'M17', name: 'ATRBot chỉ trong phiên London+NY', kind: 'market', group: 'ATRBot', winRate: 70.27, sampleSize: 2267, uses: ['atrbot'], repaintRisk: 'none', desc: 'Lọc theo phiên gần như không tạo khác biệt trên crypto (thị trường 24/7) — tham khảo, không khuyến nghị.' },
  ];

  function applyWarmup(signals) {
    return signals.filter((s) => s.index >= WARMUP_BARS);
  }

  function run(id, candles, deps) {
    const fn = DETECTORS[id];
    if (!fn) throw new Error('Unknown strategy id: ' + id);
    const resolvedDeps = resolveDeps(deps);
    const ctx = buildContext(candles, resolvedDeps);
    return applyWarmup(fn(ctx));
  }

  function runMany(ids, candles, deps) {
    const resolvedDeps = resolveDeps(deps);
    const ctx = buildContext(candles, resolvedDeps);
    const out = {};
    for (const id of ids) {
      const fn = DETECTORS[id];
      if (!fn) continue;
      out[id] = applyWarmup(fn(ctx));
    }
    return out;
  }

  return { list: LIST, run: run, runMany: runMany, buildContext: buildContext, _detectors: DETECTORS };
}));
