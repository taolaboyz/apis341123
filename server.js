const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

const HISTORY_API_URL = 'https://apiluck8-hknam.onrender.com/api/taixiu-md5';

/* ========= BIẾN TOÀN CỤC ========= */
let lastSession = null;
let lastPrediction = null;
let lastConfidence = 0;
let history = [];
let diceHistory = [];

// Bộ đếm đúng / sai
let tongDung = 0;
let tongSai = 0;

/* ========= HÀM PHÂN TÍCH ========= */
function analyze(history, diceHistory) {
  if (history.length < 3) {
    return { prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', confidence: 50 };
  }

  const last = history.at(-1);
  const last2 = history.at(-2);
  const last3 = history.at(-3);

  // 1. Bệt cầu (>=4 lần liên tiếp)
  if (history.slice(-4).every(r => r === 'Tài')) {
    return { prediction: 'Xỉu', confidence: 75 };
  }
  if (history.slice(-4).every(r => r === 'Xỉu')) {
    return { prediction: 'Tài', confidence: 75 };
  }

  // 2. Cầu 1-1
  if (last !== last2 && last2 !== last3) {
    return { prediction: last, confidence: 70 };
  }

  // 3. Cầu 2-2
  if (last === last2 && last2 !== last3) {
    return { prediction: last, confidence: 65 };
  }

  // 4. Phân tích hồi cầu (dựa trên điểm số)
  const lastDice = diceHistory.at(-1);
  const prevDice = diceHistory.at(-2);

  if (last === 'Tài' && lastDice >= 16 && prevDice <= 7) {
    return { prediction: 'Xỉu', confidence: 80 };
  }
  if (last === 'Xỉu' && lastDice <= 6 && prevDice >= 15) {
    return { prediction: 'Tài', confidence: 80 };
  }

  // 5. Thống kê tổng quan (10 phiên gần nhất)
  const recent = history.slice(-10);
  const countTai = recent.filter(r => r === 'Tài').length;
  const countXiu = recent.length - countTai;

  let prediction;
  let confidence;

  if (countTai > countXiu) {
    prediction = 'Xỉu';
    confidence = 60;
  } else if (countXiu > countTai) {
    prediction = 'Tài';
    confidence = 60;
  } else {
    prediction = last;
    confidence = 55;
  }

  // ✅ Nếu xác suất < 70 → đảo dự đoán
  if (confidence < 70) {
    prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
    confidence = 100 - confidence;
  }

  return { prediction, confidence };
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
      if (lastPrediction !== null) {
        if (lastPrediction === ketQua) tongDung++;
        else tongSai++;
      }

      lastSession = data.phien;

      history.push(ketQua);
      diceHistory.push(tong);
      if (history.length > 30) history.shift();
      if (diceHistory.length > 30) diceHistory.shift();

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

// Lịch sử kèm đánh giá
app.get('/history/luckywin', async (req, res) => {
  try {
    const response = await axios.get(`${HISTORY_API_URL}/history`);
    const data = response.data;

    data.sort((a, b) => parseInt(a.phien) - parseInt(b.phien));

    let result = [];
    for (let i = 0; i < data.length - 1; i++) {
      const current = data[i];
      const next = data[i + 1];
      const danh_gia = current.du_doan === next.ket_qua ? 'ĐÚNG' : 'SAI';
      result.push({
        phien: current.phien,
        du_doan: current.du_doan,
        ket_qua: next.ket_qua,
        danh_gia
      });
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Lỗi fetch API:', error.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
