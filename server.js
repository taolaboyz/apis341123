// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

/**
 * Cấu hình các API cho từng "game"
 * Nếu bạn có API khác, thêm vào object này
 */
const GAME_API = {
  luckywin: 'https://apiluck8-hknam.onrender.com/api/taixiu-md5',
  // ex: 'sicbo': 'https://example.com/api/sicbo'
};

/* ========= TRẠNG THÁI TRÊN SERVER ========= */
let lastSession = {};
let lastPrediction = {};
let lastConfidence = {};
let historyStore = {};      // historyStore[game] = ['Tài','Xỉu',...]
let predictHistory = {};    // predictHistory[game] = [{phien,du_doan,ket_qua,danh_gia},...]
let diceHistory = {};       // diceHistory[game] = [sum, ...]
let tongDung = {};          // tongDung[game] = n
let tongSai = {};           // tongSai[game] = n

/* Khởi tạo cấu trúc cho từng game trong GAME_API */
for (const g of Object.keys(GAME_API)) {
  lastSession[g] = null;
  lastPrediction[g] = null;
  lastConfidence[g] = 0;
  historyStore[g] = [];
  predictHistory[g] = [];
  diceHistory[g] = [];
  tongDung[g] = 0;
  tongSai[g] = 0;
}

/* ========= HÀM PHÂN TÍCH (giữ logic của bạn) ========= */
function analyze(history, diceHistory) {
  if (!Array.isArray(history)) history = [];
  if (!Array.isArray(diceHistory)) diceHistory = [];

  if (history.length < 3) return { prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', confidence: 50 };

  const last = history.at(-1), last2 = history.at(-2), last3 = history.at(-3);
  // 1. Bệt cầu
  if (history.slice(-4).every(r => r === 'Tài')) return { prediction: 'Xỉu', confidence: 75 };
  if (history.slice(-4).every(r => r === 'Xỉu')) return { prediction: 'Tài', confidence: 75 };
  // 2. 1-1
  if (last !== last2 && last2 !== last3) return { prediction: last, confidence: 70 };
  // 3. 2-2
  if (last === last2 && last2 !== last3) return { prediction: last, confidence: 65 };
  // 4. hồi cầu bằng dice
  const lastDice = diceHistory.at(-1), prevDice = diceHistory.at(-2);
  if (last === 'Tài' && lastDice >= 16 && prevDice <= 7) return { prediction: 'Xỉu', confidence: 80 };
  if (last === 'Xỉu' && lastDice <= 6 && prevDice >= 15) return { prediction: 'Tài', confidence: 80 };
  // 5. thống kê 10 phiên
  const recent = history.slice(-10);
  const countTai = recent.filter(r => r === 'Tài').length;
  const countXiu = recent.length - countTai;
  let prediction, confidence;
  if (countTai > countXiu) { prediction = 'Xỉu'; confidence = 60; }
  else if (countXiu > countTai) { prediction = 'Tài'; confidence = 60; }
  else { prediction = last; confidence = 55; }
  if (confidence < 70) { prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài'; confidence = 100 - confidence; }
  return { prediction, confidence };
}

/* ========= ROUTES ========= */

app.get('/:game/kiv666', async (req, res) => {
  const game = req.params.game;
  const apiUrl = GAME_API[game];
  if (!apiUrl) return res.status(404).json({ error: 'Game không được cấu hình' });

  try {
    const response = await axios.get(apiUrl, { timeout: 8000 });
    const data = response.data || {};

    // đánh giá cơ bản: bạn cần đảm bảo API gốc trả cấu trúc tương ứng
    const x1 = Number(data.xuc_xac_1 || 0);
    const x2 = Number(data.xuc_xac_2 || 0);
    const x3 = Number(data.xuc_xac_3 || 0);
    const tong = x1 + x2 + x3;
    const ketQua = data.ket_qua || data.result || null; // fallback

    // nếu chưa thấy ketQua, trả lỗi
    if (!ketQua) {
      return res.status(502).json({ error: 'API gốc không trả ket_qua' });
    }

    // init dữ liệu game nếu cần
    if (!historyStore[game]) {
      historyStore[game] = [];
      diceHistory[game] = [];
      predictHistory[game] = [];
      tongDung[game] = 0;
      tongSai[game] = 0;
      lastSession[game] = null;
      lastPrediction[game] = null;
      lastConfidence[game] = 0;
    }

    // mỗi phiên mới
    if (data.phien && data.phien !== lastSession[game]) {
      if (lastPrediction[game] !== null) {
        // đánh giá dự đoán trước -> so sánh với ketQua của phiên hiện tại
        if (lastPrediction[game] === ketQua) {
          tongDung[game] += 1;
          predictHistory[game].push({ phien: lastSession[game], du_doan: lastPrediction[game], ket_qua: ketQua, danh_gia: 'ĐÚNG' });
        } else {
          tongSai[game] += 1;
          predictHistory[game].push({ phien: lastSession[game], du_doan: lastPrediction[game], ket_qua: ketQua, danh_gia: 'SAI' });
        }
      }

      // lưu kết quả
      lastSession[game] = data.phien;
      historyStore[game].push(ketQua);
      diceHistory[game].push(tong);

      if (historyStore[game].length > 100) historyStore[game].shift();
      if (diceHistory[game].length > 100) diceHistory[game].shift();
      if (predictHistory[game].length > 200) predictHistory[game].shift();

      // phân tích
      let { prediction, confidence } = analyze(historyStore[game], diceHistory[game]);
      if (confidence < 70) {
        prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
        confidence = 100 - confidence;
      }
      lastPrediction[game] = prediction;
      lastConfidence[game] = confidence;
    }

    res.json({
      ...data,
      tong,
      du_doan: lastPrediction[game],
      xac_xuat: lastConfidence[game],
      tong_dung: tongDung[game],
      tong_sai: tongSai[game]
    });

  } catch (err) {
    console.error('❌ Lỗi fetch API:', err.message || err.toString());
    // nếu API gốc trả 404, 500 ... forward thông tin cơ bản
    if (err.response) {
      return res.status(err.response.status).json({ error: `Upstream error ${err.response.status}` });
    }
    return res.status(500).json({ error: 'Lỗi server khi gọi API gốc' });
  }
});

// Lịch sử dự đoán kèm đánh giá
app.get('/history/:game', (req, res) => {
  const game = req.params.game;
  if (!predictHistory[game]) return res.json([]);
  res.json(predictHistory[game]);
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
