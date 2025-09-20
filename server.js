const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// URL API mới
const HISTORY_API_URL = 'https://66.bot/GetNewLottery/TaixiuMD5';

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

/* ========= HÀM KIỂM TRA CẦU ========= */
// Kiểm tra cầu bệt (≥4 lần liên tiếp)
function isBiet(history) {
  if (history.length < 4) return false;
  let count = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === history[i + 1]) count++;
    else break;
  }
  return count >= 4;
}

// Kiểm tra cầu 1-1 (xen kẽ Tài/Xỉu ≥4 lần)
function isCau11(history) {
  if (history.length < 4) return false;
  let count = 1;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i] !== history[i - 1]) count++;
    else break;
  }
  return count >= 4;
}

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

  // 2. Cầu 1-1 (xen kẽ Tài/Xỉu)
  if (last !== last2 && last2 !== last3) {
    const prediction = last === 'Tài' ? 'Xỉu' : 'Tài';
    return { prediction, confidence: 70 };
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
    if ((d1 > d2 && d2 < d3)  (d1 < d2 && d2 > d3)) {
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
    return i === 0;  r === arr[i - 1] ? count + 1 : count;
  }, 0);

  if (confidence < 70 && streak < 4) {
    prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
    confidence = 100 - confidence;
  }

  return { prediction, confidence };
}

/* ========= API ========= */
app.get('/luckywin/kiv666', async (req, res) => {
  try {
    const response = await axios.get(HISTORY_API_URL);
    const apiData = response.data;

    if (!apiData || apiData.state !== 1 || !apiData.data) {
      return res.status(500).json({ error: 'Dữ liệu API không hợp lệ' });
    }

    const gameData = apiData.data;
    const phien = gameData.Expect;

    // Tách 3 xúc xắc từ OpenCode
    const dice = gameData.OpenCode.split(',').map(num => parseInt(num.trim()));
    const tong = dice.reduce((a, b) => a + b, 0);

    // Xác định kết quả
    const ketQua = tong <= 10 ? 'Xỉu' : 'Tài';

    if (phien !== lastSession) {
      // Lưu kết quả dự đoán trước
      if (lastPrediction !== null) {
        if (!predictHistoryMap['luckywin']) predictHistoryMap['luckywin'] = [];

        predictHistoryMap['luckywin'].push({
          phien: phien,
          du_doan: lastPrediction,
          ket_qua: ketQua,
          danh_gia: lastPrediction === ketQua ? 'ĐÚNG' : 'SAI'
        });

        if (lastPrediction === ketQua) tongDung++;
        else tongSai++;

        if (predictHistoryMap['luckywin'].length > 50) {
          predictHistoryMap['luckywin'].shift();
        }
      }

      lastSession = phien;

      // Cập nhật lịch sử
      history.push(ketQua);
      diceHistory.push(tong);
      if (history.length > 30) history.shift();
      if (diceHistory.length > 30) diceHistory.shift();

      // Tạo dự đoán mới
      let { prediction, confidence } = analyze(history, diceHistory);

      lastPrediction = prediction;
      lastConfidence = confidence;
    }

    res.json({
      phien,
      xuc_xac_1: dice[0],
      xuc_xac_2: dice[1],
      xuc_xac_3: dice[2],
      tong,
      ket_qua: ketQua,
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

// API lấy lịch sử
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
