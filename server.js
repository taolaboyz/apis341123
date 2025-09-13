const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// URL API gốc
const HISTORY_API_URL = 'https://apiluck8-hknam.onrender.com/api/taixiu-md5';

/* ========= BIẾN TOÀN CỤC ========= */
let lastSession = null;
let lastPrediction = null;
let lastConfidence = 0;
let history = [];
let diceHistory = [];
let predictHistoryMap = {}; // lưu lịch sử dự đoán theo game

// Bộ đếm đúng / sai
let tongDung = 0;
let tongSai = 0;

/* ========= HÀM PHÂN TÍCH ========= */
function analyze(history, diceHistory) {
  if (history.length < 5) {
    return {
      prediction: Math.random() > 0.5 ? "Tài" : "Xỉu",
      confidence: 55,
      reason: "Chưa đủ dữ liệu (history < 5)"
    };
  }

  let signals = { Tai: 0, Xiu: 0 };
  let reasons = [];
  const last = history.at(-1);

  /* ===== 1. CẦU BỆT ===== */
  let streak = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === last) streak++;
    else break;
  }
  if (streak >= 4) {
    signals[last === "Tài" ? "Xiu" : "Tai"] += 1; // giảm trọng số
    reasons.push(`Cầu bệt ${last} ${streak} lần → dễ bẻ`);
  }

  /* ===== 2. 3 PHIÊN GẦN NHẤT ===== */
  const last3 = history.slice(-3);
  if (last3.every(r => r === "Tài")) {
    signals.Tai += 3;
    reasons.push("3 phiên gần nhất đều Tài");
  }
  if (last3.every(r => r === "Xỉu")) {
    signals.Xiu += 3;
    reasons.push("3 phiên gần nhất đều Xỉu");
  }

  /* ===== 3. CẦU 1-1 ===== */
  if (last3[0] !== last3[1] && last3[1] !== last3[2]) {
    signals[last] += 2;
    reasons.push("Cầu 1-1 xuất hiện");
  }

  /* ===== 4. CẦU 2-2 ===== */
  if (
    history.slice(-4).join(",") === "Tài,Xỉu,Tài,Xỉu" ||
    history.slice(-4).join(",") === "Xỉu,Tài,Xỉu,Tài"
  ) {
    signals[last === "Tài" ? "Tai" : "Xiu"] += 2;
    reasons.push("Cầu 2-2 xuất hiện");
  }

  /* ===== 5. PHÂN TÍCH ĐIỂM ===== */
  const lastDice = diceHistory.at(-1);
  const prevDice = diceHistory.at(-2);
  const avg3 = diceHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;

  if (Math.abs(lastDice - prevDice) >= 8) {
    signals[last === "Tài" ? "Xiu" : "Tai"] += 2;
    reasons.push(`Điểm biến động mạnh (${prevDice} → ${lastDice})`);
  }

  if (avg3 >= 11) {
    signals.Tai += 2;
    reasons.push("Điểm TB 3 phiên cao (≥11)");
  }
  if (avg3 <= 10) {
    signals.Xiu += 2;
    reasons.push("Điểm TB 3 phiên thấp (≤10)");
  }

  /* ===== 6. QUYẾT ĐỊNH ===== */
  const total = signals.Tai + signals.Xiu;
  if (total === 0) {
    return { prediction: last, confidence: 55, reason: "Không có tín hiệu rõ ràng" };
  }

  let prediction, confidence;
  if (signals.Tai > signals.Xiu) {
    prediction = "Tài";
    confidence = Math.round((signals.Tai / total) * 100);
  } else {
    prediction = "Xỉu";
    confidence = Math.round((signals.Xiu / total) * 100);
  }

  // Nếu độ tin cậy thấp → giữ theo kết quả gần nhất
  if (confidence < 60) {
    prediction = last;
    confidence = 60;
    reasons.push("Confidence thấp → giữ theo kết quả gần nhất");
  }

  return { prediction, confidence, reason: reasons.join(" + ") };
}


/* ========= API ========= */

// Dự đoán hiện tại
app.get('/luckywin/kiv666', async (req, res) => {
  try {
    const response = await axios.get(HISTORY_API_URL);
    const data = response.data;

    const tong = data.xuc_xac_1 + data.xuc_xac_2 + data.xuc_xac_3;
    const ketQua = data.ket_qua;

    if (data.phien !== lastSession) {
      // 👉 Nếu đã có dự đoán trước đó thì lưu lại kèm kết quả thực tế
      if (lastPrediction !== null) {
        if (!predictHistoryMap['luckywin']) predictHistoryMap['luckywin'] = [];

        predictHistoryMap['luckywin'].push({
          phien: data.phien,                   // phiên hiện tại
          du_doan: lastPrediction,             // dự đoán của phiên trước
          ket_qua: ketQua,                     // kết quả thực tế
          danh_gia: lastPrediction === ketQua ? 'ĐÚNG' : 'SAI'
        });

        if (lastPrediction === ketQua) tongDung++;
        else tongSai++;

        if (predictHistoryMap['luckywin'].length > 50) {
          predictHistoryMap['luckywin'].shift();
        }
      }

      lastSession = data.phien;

      // Cập nhật lịch sử cầu
      history.push(ketQua);
      diceHistory.push(tong);
      if (history.length > 30) history.shift();
      if (diceHistory.length > 30) diceHistory.shift();

      // Tạo dự đoán mới cho phiên TIẾP THEO
      let { prediction, confidence } = analyze(history, diceHistory);
      if (confidence < 70) {
        prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
        confidence = 100 - confidence;
      }
      lastPrediction = prediction;
      lastConfidence = confidence;
    }

    res.json({
      ...data,
      tong,
      du_doan: lastPrediction,
      xac_xuat: lastConfidence,
      tong_dung: tongDung,
      tong_sai: tongSai
    });

  } catch (error) {
    console.error('❌ Lỗi fetch API:', error.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});


// Lịch sử kèm đánh giá (phiên mới nhất ở trên cùng)
app.get('/history/:game', (req, res) => {
  const game = req.params.game;
  const arr = predictHistoryMap[game] || [];
  const out = arr.slice().reverse().map(it => ({
    phien: it.phien || '',
    du_doan: it.du_doan || '',
    ket_qua: it.ket_qua || '',
    danh_gia: it.danh_gia || ''
  }));
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
