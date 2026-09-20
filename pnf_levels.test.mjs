/**
 * Self-check cho phần mức chính P&F + chấm điểm tín hiệu ATRBot.
 * Chạy: node pnf_levels.test.mjs
 */
import assert from 'node:assert/strict';
import './pnf_levels.js';

const { findSupportResistance, keyLevels, gradeSignals } = globalThis.PnfLevels;

// --- keyLevels: giá vừa là đỉnh cột X vừa là đáy cột O -> 1 mức, cộng lần chạm
{
  const columns = [
    { time: 10, type: 'X', high: 100, low: 90 },
    { time: 20, type: 'O', high: 100, low: 80 },
    { time: 30, type: 'X', high: 100, low: 85 },
    { time: 40, type: 'O', high: 110, low: 100 },
    { time: 50, type: 'O', high: 115, low: 100 },
  ];
  const sr = findSupportResistance(columns, { minTouches: 2 });
  const merged = keyLevels(columns, sr);
  assert.equal(merged.length, 1, 'chỉ có duy nhất mức giá 100 đủ 2 lần chạm mỗi phía');
  assert.equal(merged[0].price, 100);
  assert.equal(merged[0].touches, 4, 'kháng cự 2 + hỗ trợ 2 = 4 lần chạm');
  assert.deepEqual(merged[0].times, [10, 30, 40, 50], 'thời điểm chạm phải tăng dần');
}

// --- gradeSignals: CAUSAL — mức chưa đủ lần chạm tại nến đó thì chưa tồn tại
{
  const levels = [{ price: 101, touches: 2, times: [10, 20] }];
  const candles = [5, 15, 25].map((time) => ({ time, close: 100 }));
  const results = candles.map(() => ({ isBuy: true, isSell: false }));
  const g = gradeSignals(candles, results, levels, { blockPct: 2 });

  assert.equal(results[0].pnfBlocked, undefined, 't=5: chưa có lần chạm nào -> chưa chặn');
  assert.equal(results[1].pnfBlocked, undefined, 't=15: mới 1/2 lần chạm -> vẫn chưa chặn');
  assert.equal(results[2].pnfBlocked, true, 't=25: đủ 2 lần chạm -> mức tồn tại và chặn BUY');
  assert.deepEqual(g, { blocked: 1, confirmed: 0 });
}

// --- gradeSignals: chiều của vật cản/điểm tựa ngược nhau giữa BUY và SELL
{
  const above = { price: 101, touches: 2, times: [10, 20] };
  const below = { price: 99, touches: 2, times: [10, 20] };
  const candles = [{ time: 30, close: 100 }];

  const buyBlocked = [{ isBuy: true, isSell: false }];
  gradeSignals(candles, buyBlocked, [above], { blockPct: 2 });
  assert.equal(buyBlocked[0].pnfBlocked, true, 'BUY bị kháng cự phía trên chặn');

  const buyConfirmed = [{ isBuy: true, isSell: false }];
  gradeSignals(candles, buyConfirmed, [below], { blockPct: 2 });
  assert.equal(buyConfirmed[0].pnfConfirm, true, 'BUY tựa lưng vào hỗ trợ phía dưới');

  const sellBlocked = [{ isBuy: false, isSell: true }];
  gradeSignals(candles, sellBlocked, [below], { blockPct: 2 });
  assert.equal(sellBlocked[0].pnfBlocked, true, 'SELL bị hỗ trợ phía dưới chặn');

  const sellConfirmed = [{ isBuy: false, isSell: true }];
  gradeSignals(candles, sellConfirmed, [above], { blockPct: 2 });
  assert.equal(sellConfirmed[0].pnfConfirm, true, 'SELL tựa lưng vào kháng cự phía trên');
}

// --- gradeSignals: mức ở xa hơn ngưỡng % thì không ảnh hưởng gì
{
  const levels = [{ price: 130, touches: 2, times: [10, 20] }, { price: 70, touches: 2, times: [10, 20] }];
  const candles = [{ time: 30, close: 100 }];
  const results = [{ isBuy: true, isSell: false }];
  const g = gradeSignals(candles, results, levels, { blockPct: 2 });
  assert.deepEqual(g, { blocked: 0, confirmed: 0 }, 'mức cách 30% -> tín hiệu giữ nguyên');
}

console.log('OK — pnf_levels: keyLevels + gradeSignals (causal)');
