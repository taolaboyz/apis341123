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
  if (history.length < 3) {
    return { prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', confidence: 50 };
  }

  const last = history.at(-1);
  const last2 = history.at(-2);
  const last3 = history.at(-3);

  // 1. Bệt cầu (>=4 lần liên tiếp) → tiếp tục theo chuỗi, KHÔNG đảo
  if (history.slice(-4).every(r => r === 'Tài')) {
    return { prediction: 'Tài', confidence: 85 };
  }
  if (history.slice(-4).every(r => r === 'Xỉu')) {
    return { prediction: 'Xỉu', confidence: 85 };
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

  // 5. Xu hướng dao động điểm
  if (diceHistory.length >= 3) {
    const d1 = diceHistory.at(-3);
    const d2 = diceHistory.at(-2);
    const d3 = diceHistory.at(-1);

    if (d1 > d2 && d2 > d3) {
      return { prediction: 'Tài', confidence: 70 };
    }
    if (d1 < d2 && d2 < d3) {
      return { prediction: 'Xỉu', confidence: 70 };
    }
    if ((d1 > d2 && d2 < d3) || (d1 < d2 && d2 > d3)) {
      const prediction = last === 'Tài' ? 'Xỉu' : 'Tài';
      return { prediction, confidence: 68 };
    }
  }

  // 6. Thống kê tổng quan (10 phiên gần nhất)
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

  // ✅ KHÔNG đảo nếu đã có chuỗi ≥4
  const streak = history.slice().reverse().reduce((count, r, i, arr) => {
    return i === 0 || r === arr[i - 1] ? count + 1 : count;
  }, 0);

  if (confidence < 70 && streak < 4) {
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
