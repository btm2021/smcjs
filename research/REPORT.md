# Báo cáo: So sánh mô hình Entry kết hợp ATRBot + SMC.js

**Ngày:** 2026-09-14
**Dữ liệu:** Binance Futures, khung 15 phút, **10 symbol × 100.500 nến/symbol = 1.005.000 nến**, giai đoạn 2023-11-02 → 2026-09-14.
Symbol: `BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, IMXUSDT`.
**Code:** [research/backtest_multi.mjs](backtest_multi.mjs) (engine, 17 mô hình) · [research/fetch_multi.mjs](fetch_multi.mjs) (tải dữ liệu) · [research/results_multi.json](results_multi.json) (số liệu thô).

---

## 1. Quy tắc thắng/thua (giữ nguyên theo yêu cầu ban đầu)

- **Không phí, không mô phỏng slippage.**
- **Limit khớp khi râu (wick) chạm giá** — không cần nến đóng cửa qua mức, không cần "filled" theo nghĩa sổ lệnh thật.
- **Market khớp tại giá mở cửa (open) của nến kế tiếp** sau tín hiệu (đảm bảo không nhìn trước dữ liệu — causal).
- Sau khi khớp, đo **MFE (Maximum Favorable Excursion)** — mức đi xa nhất *đúng hướng lệnh*, tính theo % so với giá vào — trong suốt "vòng đời" lệnh.
  **MFE ≥ 2% → WIN, ngược lại → LOSE.** (Đây chính là quy ước `MFE>2%/cycle` đã dùng trong nghiên cứu gốc của `indicator_atrbot_m1.js`.)
- "Vòng đời" (deadline) mặc định = tới khi ATRBot phát tín hiệu **ngược hướng** kế tiếp (đổi regime). Với các mô hình không gắn trực tiếp vào ATRBot (Liquidity Sweep, Breaker Block, BOS/CHOCH retest), dùng deadline cố định theo số nến (ghi rõ trong mô tả từng mô hình).
- Limit không khớp trước deadline → **NO FILL**, loại khỏi thống kê win/lose (cột "Khớp %" cho biết tỷ lệ khớp).
- Ngoài ngưỡng 2% (yêu cầu gốc), báo cáo còn đo thêm **>4% và >6%** để mô phỏng ý nghĩa "nhiều TP" (một lệnh thắng có thể chạy tiếp đến TP2/TP3 hay không) mà không cần dựng cơ chế chốt lời rời rạc.

---

## 2. Danh sách 17 mô hình đã cài đặt

| ID | Tên | Loại lệnh | Cơ chế |
|---|---|---|---|
| M1 | ATRBot gốc (atrMult cố định 2.0) | Market | Baseline — tín hiệu đảo chiều regime (`isBuy`/`isSell`) của ATRBot, không dùng SMC |
| M2 | ATRBot M1 adaptive | Market | Như M1 nhưng atrMult co giãn theo percentile ATR% (tính năng đã có sẵn trong `indicator_atrbot_m1.js`) |
| M3 | ATRBot M1 + xác nhận BOS/CHOCH gốc | Market | Chỉ giữ tín hiệu ATRBot nếu có BOS/CHOCH (`SMC.bosChoch`) cùng hướng trong 30 nến trước đó |
| M4 | ATRBot trend + retest Order Block | Limit | Khi đang trong regime ATRBot + xuất hiện Order Block (`SMC.orderBlocks`) mới cùng hướng → đặt limit tại cạnh gần của OB, deadline = OB bị hoà giải hoặc regime đổi chiều |
| M5 | ATRBot trend + retest FVG | Limit | Như M4 nhưng dùng Fair Value Gap (`SMC.fvg`) thay Order Block |
| M6 | Liquidity Sweep + Reject | Market | Độc lập ATRBot — khi 1 pool thanh khoản (`SMC.liquidity`) bị quét rồi giá đóng cửa trở lại qua mức đó (từ chối), vào lệnh ngược hướng quét. Deadline cố định 96 nến (~1 ngày) |
| M7 | BOS/CHOCH gốc breakout + chờ retest | Limit | Sau khi BOS/CHOCH phá 1 mức, đặt limit chờ giá hồi lại đúng mức đó để vào tiếp diễn. Deadline cố định 50 nến |
| M8 | Multi-entry DCA: OB+FVG hợp lưu | Limit ×2 | Khi OB và FVG cùng hướng, cùng vùng giá chồng lấn xuất hiện gần nhau → đặt 2 lệnh limit (50/50) ở 2 cạnh, tính giá vào trung bình trọng số |
| M9 | Retracement 50% pullback | Market | Dùng `SMC.retracements`: vào lệnh thuận xu hướng ATRBot khi giá hồi đủ 50% của đợt sóng gần nhất |
| M10 | ATRBot M1 + xác nhận StatefulBosChoch | Market | Như M3 nhưng dùng bản BOS/CHOCH "có bộ nhớ trạng thái" (`stateful_bos_choch.js`) thay bản gốc |
| M11 | StatefulBosChoch breakout + chờ retest | Limit | Như M7 nhưng dùng StatefulBosChoch |
| M12 | ATRBot trend + retest OB (Dynamic Swing) | Limit | Như M4 nhưng Order Block được tính trên swing high/low **động** (`dynamic_swing_hl.js`, cửa sổ co giãn theo biến động) thay vì `swingLength` cố định |
| M13 | BOS/CHOCH breakout + retest (Dynamic Swing) | Limit | Như M7 nhưng dùng swing động |
| M14 | Liquidity Sweep + Reject (Dynamic Swing) | Market | Như M6 nhưng dùng swing động |
| M15 | Breaker Block retest | Limit | OB bị hoà giải (mitigated) → trở thành "breaker" ngược hướng; vào lệnh khi giá retest đúng cạnh breaker. ⚠️ **Xem mục 4 — mô hình này có sai lệch phương pháp, không dùng để xếp hạng** |
| M16 | ATRBot M1 + lọc khoảng cách Liquidity (built-in) | Market | Bật tham số có sẵn `liqSweepFilterPct=3` của `indicator_atrbot_m1.js`: bỏ qua tín hiệu nếu có pool thanh khoản chưa quét nằm quá gần (nguy cơ bẫy thanh khoản/whipsaw) |
| M17 | ATRBot M1 chỉ trong phiên London+NY | Market | Lọc tín hiệu ATRBot M1 theo `SMC.sessions` — chỉ giữ tín hiệu rơi vào phiên London hoặc New York |

**Các gợi ý đã được hiện thực hoá từ yêu cầu trước:** Retracement pullback (M9), StatefulBosChoch cho cả 2 biến thể M3/M7 (M10/M11), Dynamic Swing cho Order Block + BOS/CHOCH + Liquidity (M12/M13/M14 — FVG không nhận `swingHL` làm input nên không có biến thể "Dynamic Swing FVG"), Breaker Block (M15), lọc theo phiên (M17). Ý tưởng "Liquidity pool làm mục tiêu TP" được hiện thực khác đi thành **bộ lọc khoảng cách entry** (M16) vì cơ chế đo thắng/thua ở đây dựa trên MFE, không mô phỏng TP rời rạc nên không thể "nhắm tới" một mức giá cụ thể làm đích.

---

## 3. Kết quả tổng hợp (pooled toàn bộ 10 symbol)

| ID | Mô hình | Tín hiệu | Khớp | Khớp % | Win >2% | Win >4% | Win >6% | Bars TB→2% |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| M1 | ATRBot gốc (mult cố định, market) | 4,970 | 4,970 | 100.0% | 62.68% | 43.1% | 29.9% | 51.5 |
| M2 | ATRBot M1 adaptive (market) | 3,335 | 3,335 | 100.0% | 70.94% | 52.4% | 38.3% | 66.3 |
| M3 | ATRBot M1 + xác nhận BOS/CHOCH gốc | 479 | 479 | 100.0% | 83.72% | 63.3% | 47.4% | 65.8 |
| **M4** | **ATRBot trend + retest Order Block (limit)** | **330** | **330** | **100.0%** | **92.12%** | **82.4%** | **76.4%** | **27.7** |
| M5 | ATRBot trend + retest FVG (limit) | 100,246 | 100,246 | 100.0% | 19.09% | 9.9% | 6.8% | 8.4 |
| M6 | Liquidity Sweep + Reject (market) | 208 | 208 | 100.0% | 81.25% | 65.4% | 55.3% | 12.4 |
| M7 | BOS/CHOCH gốc breakout + retest (limit) | 11,938 | 10,629 | 89.0% | 40.10% | 15.9% | 6.8% | 17.9 |
| M8 | Multi-entry DCA OB+FVG (limit) | 77 | 77 | 100.0% | 85.71% | 76.6% | 63.6% | 38.7 |
| M9 | Retracement 50% pullback (market) | 21,699 | 21,699 | 100.0% | 50.80% | 36.0% | 26.4% | 67.9 |
| M10 | ATRBot M1 + xác nhận StatefulBosChoch | 470 | 470 | 100.0% | 83.40% | 63.0% | 47.2% | 64.3 |
| M11 | StatefulBosChoch breakout + retest (limit) | 11,614 | 10,310 | 88.8% | 40.81% | 16.4% | 7.0% | 17.8 |
| **M12** | **ATRBot trend + retest OB, Dynamic Swing (limit)** | **260** | **260** | **100.0%** | **91.15%** | **84.6%** | **78.1%** | **31.5** |
| M13 | BOS/CHOCH breakout + retest, Dynamic Swing | 6,989 | 6,162 | 88.2% | 42.47% | 17.9% | 8.0% | 17.2 |
| M14 | Liquidity Sweep + Reject, Dynamic Swing | 147 | 147 | 100.0% | 82.99% | 69.4% | 55.8% | 11.4 |
| M15 | Breaker Block retest ⚠️ | 176 | 50 | 28.4% | 100.00% | 92.0% | 72.0% | 5.3 |
| **M16** | **ATRBot M1 + lọc khoảng cách Liquidity (market)** | **1,881** | **1,881** | **100.0%** | **85.43%** | **72.5%** | **57.5%** | **88.0** |
| M17 | ATRBot M1 chỉ phiên London+NY (market) | 2,267 | 2,267 | 100.0% | 70.27% | 52.4% | 38.2% | 67.7 |

### Chi tiết theo từng symbol — các mô hình nổi bật (win-rate >2%, số trong ngoặc = n)

| ID | ADA | AVAX | BNB | BTC | DOGE | ETH | IMX | LINK | SOL | XRP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| M1 | 64%(491) | 68%(507) | 50%(513) | 50%(501) | 67%(500) | 59%(490) | 70%(531) | 68%(492) | 69%(474) | 63%(471) |
| M2 | 73%(329) | 79%(335) | 57%(343) | 59%(340) | 74%(326) | 67%(340) | 82%(338) | 75%(342) | 73%(334) | 71%(308) |
| M3 | 80%(44) | 85%(46) | 71%(58) | 69%(42) | 91%(46) | 92%(60) | 92%(50) | 88%(43) | 87%(46) | 82%(44) |
| **M4** | **97%(29)** | **97%(36)** | **79%(34)** | **82%(45)** | **97%(29)** | **92%(24)** | **96%(46)** | **93%(27)** | **97%(31)** | **97%(29)** |
| M6 | 85%(20) | 87%(23) | 81%(16) | 82%(11) | 86%(21) | 74%(34) | 91%(11) | 84%(31) | 68%(22) | 84%(19) |
| M8 | 100%(5) | 100%(4) | 73%(11) | 71%(17) | 75%(4) | 88%(8) | 100%(4) | 100%(6) | 100%(5) | 92%(13) |
| **M12** | **96%(23)** | **96%(28)** | **81%(27)** | **78%(41)** | **96%(23)** | **95%(19)** | **93%(30)** | **90%(20)** | **96%(24)** | **100%(25)** |
| **M16** | **84%(215)** | **87%(214)** | **82%(131)** | **81%(115)** | **86%(206)** | **85%(164)** | **88%(261)** | **88%(200)** | **86%(200)** | **84%(175)** |

**M4 và M12 nhất quán trên cả 10/10 symbol** (không có symbol nào tụt dưới ~78%) — đây là dấu hiệu quan trọng nhất cho thấy đây không phải kết quả trúng ngẫu nhiên của 1-2 symbol may mắn.

---

## 4. Bug phát hiện được trong lúc backtest (đã sửa)

Khi chạy M16 lần đầu, kết quả **giống hệt M2 tuyệt đối** (cùng 3,335 tín hiệu, cùng 70.94%) dù bật `liqSweepFilterPct=3`. Điều tra ra nguyên nhân: bộ lọc built-in trong [indicator_atrbot_m1.js](../indicator_atrbot_m1.js) (dòng ~217-228) đọc field `item.Liquidity`, `sw.Level`, `item.End`, `item.Swept` (viết hoa, kiểu Python/pandas) trong khi API JS hiện tại của `SMC.liquidity()`/`SMC.swingHighsLows()` trả về field viết thường (`liquidity`, `level`, `end`, `swept`). Vì object không có field viết hoa, `isNaN(undefined)` luôn `true` → điều kiện `continue` luôn đúng → mảng `zones` luôn rỗng → **bộ lọc này đã hoàn toàn vô hiệu (no-op) từ trước tới nay, bất kể `liqSweepFilterPct` đặt bao nhiêu.**

**Đã sửa** (đổi tên field về đúng chữ thường + sửa luôn cách gọi `swing_highs_lows`/`liquidity` cho đúng chữ ký object-option thay vì truyền số/số thực trần). Sau khi sửa, M16 mới thực sự lọc bớt tín hiệu (3,335 → 1,881, tức loại ~44%) và **win-rate tăng từ 70.94% → 85.43%**, khớp với tinh thần công bố ban đầu trong docstring ("skip nếu có pool thanh khoản gần, giảm bẫy stop-hunt"). File này không thuộc `src/` (không bị ràng buộc parity với bản Python gốc) nên sửa trực tiếp là an toàn.

---

## 5. Nhận xét theo từng nhóm

- **M5 (FVG retest) và M9 (Retracement 50%) win-rate thấp (19% và 51%)** dù mẫu cực lớn — đây là 2 điều kiện xảy ra **quá thường xuyên** (gần như mọi con sóng đều có FVG hoặc hồi 50%), nên tín hiệu không đủ chọn lọc để có edge riêng lẻ. Có thể dùng làm **bộ lọc phụ/điều kiện hợp lưu** (như M8 đã làm) thay vì mô hình entry độc lập.
- **M7/M11/M13 (BOS/CHOCH breakout + retest)** chỉ ~40-42% dù đúng theo lý thuyết SMC kinh điển — cho thấy riêng việc "chờ hồi về đúng mức breakout" không đủ, cần kết hợp thêm bộ lọc xu hướng (như M3/M10 đã làm và cải thiện rõ rệt lên 83-84%).
- **StatefulBosChoch (M10, M11, M13) cho kết quả gần như giống hệt bản gốc (M3, M7)** — chênh lệch trong khoảng ±1-2 điểm %. Máy trạng thái "nhớ xu hướng" đúng về mặt lý thuyết SMC hơn, nhưng ở cấp độ thống kê lớn, không tạo khác biệt đáng kể so với bản gốc cho các mô hình đã test.
- **Dynamic Swing (M12, M13, M14) cải thiện nhẹ so với bản swing cố định tương ứng** (M4→M12: 92.12%→91.15% gần như ngang nhau nhưng mẫu ít hơn ~21%; M7→M13: 40.10%→42.47%; M6→M14: 81.25%→82.99%) — hiệu ứng "lọc bớt swing nhiễu trong vùng biến động thấp" có tác dụng thật nhưng khiêm tốn, không đột phá.
- **Lọc theo phiên London+NY (M17) gần như không tạo khác biệt so với M2 không lọc** (70.27% vs 70.94%) — hợp lý vì thị trường crypto giao dịch 24/7, không lệ thuộc giờ phiên như FX.
- **M6/M14 (Liquidity Sweep độc lập ATRBot)** đáng chú ý vì **thời gian đạt mục tiêu rất nhanh** (trung bình ~12 nến ≈ 3 giờ) trong khi win-rate vẫn cao (81-83%) — phù hợp phong cách giao dịch nhanh/scalping, và tín hiệu **độc lập với ATRBot** nên có thể dùng làm nguồn tín hiệu bổ sung, đa dạng hoá.

---

## 6. ⚠️ Giới hạn & rủi ro cần đọc trước khi dùng số liệu này

1. **M15 (Breaker Block) bị sai lệch phương pháp (survivorship bias), không đáng tin.** `SMC.orderBlocks()` ghi đè dữ liệu tại đúng vị trí OB gốc mỗi khi breaker cuối cùng bị phá hoàn toàn (dọn về `null`). Vì mô hình đọc **trạng thái cuối cùng** của mảng kết quả (sau khi toàn bộ backtest chạy xong), nó chỉ "nhìn thấy" những breaker **chưa từng bị phá hoàn toàn tính đến cuối chuỗi dữ liệu** — tức là loại bỏ ngầm mọi ca thất bại thật sự đã có trong lịch sử. Đây là lý do M15 có win-rate 100% giả tạo. Muốn dùng model này cần viết lại bộ phát hiện breaker theo kiểu "causal" độc lập (giống cách `dynamic_swing_hl.js` đã tách riêng khỏi core), chưa nằm trong phạm vi lần này.
2. **M8 (Multi-entry DCA) mẫu quá nhỏ để tin cậy per-symbol** (4-17 tín hiệu/symbol, một số symbol chỉ có 4-5 lệnh) dù pooled trông đẹp (85.71%, n=77). Cần thêm dữ liệu (nhiều symbol/khung thời gian hơn) trước khi kết luận.
3. **Không tính phí giao dịch, spread, slippage, funding rate (hợp đồng vĩnh viễn)** — trên thực tế đây là chi phí đáng kể, đặc biệt với các mô hình `avgBars` nhỏ (M5, M6, M14, M15) vì tần suất giao dịch cao hơn đồng nghĩa tổng phí cao hơn.
4. **MFE ≥ 2% không phải là PnL thực của một lệnh có quản lý (không có stop-loss)** — chỉ đo "giá có từng đạt 2% thuận lợi hay chưa", không mô phỏng việc lệnh có thể đã bị quét stop trước khi đạt mục tiêu. Đây là thước đo **chất lượng tín hiệu**, không phải kết quả backtest PnL đầy đủ.
5. **Deadline/độ dài "vòng đời" khác nhau giữa các mô hình** khiến win-rate không hoàn toàn so sánh ngang hàng (cycle càng dài, xác suất ngẫu nhiên chạm 2% càng cao) — ví dụ M16 có avgBars→2% cao nhất (88 nến) một phần vì thừa hưởng deadline dài của ATRBot M1 gốc.
6. **Dữ liệu chỉ gồm 10 symbol lớn/thanh khoản tốt, đang niêm yết tới hiện tại** (không có symbol đã delist) — có thể tồn tại thiên lệch "survivorship" ở cấp độ chọn symbol, và giai đoạn 2023-2026 bao gồm cả uptrend mạnh lẫn sideway, nhưng chưa trải qua một chu kỳ gấu sâu như 2022.
7. Ngưỡng thắng/thua 2% **phù hợp với biến động crypto**, không dùng được cho tài sản ít biến động (đã kiểm chứng: chạy thử trên EURUSD 15M cho win-rate gần 0% vì 2% gần như không bao giờ đạt được trong khung 15 phút).

---

## 7. Kết luận — mô hình tốt nhất

Xét đồng thời **win-rate, cỡ mẫu đủ lớn, và tính nhất quán qua toàn bộ 10 symbol**, không tính M15 (sai lệch phương pháp):

### 🥇 Lựa chọn tốt nhất: **M4 — ATRBot trend + retest Order Block (limit)**
- Win-rate **92.12%** (>2%), vẫn còn **76.4%** đạt tới >6% — cho thấy khi đúng, lệnh thường chạy xa chứ không chỉ chạm 2% rồi quay đầu → **rất phù hợp chiến lược nhiều TP** (chốt 1 phần ở 2%, dời SL, để phần còn lại chạy tới 4-6%).
- **Nhất quán tuyệt đối trên 10/10 symbol** (thấp nhất 79% ở BNB, cao nhất 97% ở nhiều symbol).
- Thời gian trung bình tới mục tiêu ngắn (~28 nến ≈ 7 giờ ở khung 15m) — vốn không bị "giam" quá lâu.
- Cơ chế đơn giản, dễ triển khai thủ công: chờ ATRBot xác nhận xu hướng, chờ 1 Order Block mới hình thành cùng hướng, đặt limit ngay tại cạnh gần của OB.
- **M12** (bản Dynamic Swing của M4) cho kết quả gần như tương đương (91.15%, cũng nhất quán 10/10) — có thể coi là phương án thay thế/xác nhận chéo, không bắt buộc chọn 1 trong 2.

### 🥈 Lựa chọn "triển khai ngay, mẫu lớn nhất": **M16 — ATRBot M1 + lọc khoảng cách Liquidity**
- Chỉ cần bật 1 tham số có sẵn (`liqSweepFilterPct=3`, sau khi sửa bug) trên chính chỉ báo đang dùng — **không cần logic mới**.
- Cỡ mẫu lớn nhất trong nhóm hiệu suất cao (**n=1,881**) và **dải win-rate hẹp nhất qua các symbol** (81–88%, tất cả 10 symbol) → đáng tin cậy thống kê nhất.
- Đánh đổi: thời gian giữ lệnh trung bình dài hơn (~88 nến ≈ 22 giờ) và tín hiệu thưa hơn M2 gốc (giảm ~44% số lệnh).

### Gợi ý thử nghiệm tiếp theo (chưa làm trong lần này)
- Kết hợp M4 + M16: chỉ vào Order Block retest khi đồng thời không có pool thanh khoản đối nghịch quá gần — có thể đẩy win-rate cao hơn nữa dù giảm thêm số lệnh.
- Viết lại M15 (Breaker Block) theo kiểu causal đúng nghĩa để có số liệu tin cậy.
- Mở rộng M8 (multi-entry) sang khung thời gian dài hơn/nhiều symbol hơn để đủ mẫu kết luận.
- Thêm mô phỏng phí + slippage cố định (vd 0.05%/lệnh) để chuyển từ "chất lượng tín hiệu" sang ước lượng PnL thực tế gần hơn.

---

## 8. Cách chạy lại

```bash
# 1. Tải dữ liệu (idempotent, có thể chạy lại nếu bị ngắt giữa chừng)
node research/fetch_multi.mjs

# 2. Chạy backtest đầy đủ 17 mô hình x 10 symbol
node research/backtest_multi.mjs

# Kết quả in ra console + ghi research/results_multi.json
# Đổi thư mục dữ liệu tạm thời để test nhanh trên tập nhỏ hơn:
#   SMC_BACKTEST_DATA_DIR=/path/to/small_data node research/backtest_multi.mjs
```
