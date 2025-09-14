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

/* ========= HÀM PHÂN TÍCH ========= */
function analyze(history, diceHistory) {
  if (history.length < 3) {
    return { prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', confidence: 50 };
  }

  const last = history.at(-1);
  const last2 = history.at(-2);
  const last3 = history.at(-3);

  // 1. Bệt cầu (>=4 lần liên tiếp)
  let streakBiet = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === history[i + 1]) streakBiet++;
    else break;
  }

  if (streakBiet >= 4) {
    const side = history.at(-1);
    const streakDice = diceHistory.slice(-streakBiet);

    const countMid = streakDice.filter(d => d === 11 || d === 12).length;

    if (countMid >= 2) {
      return { prediction: "Xỉu", confidence: 80 };
    }

    if (streakBiet >= 5) {
      const fifthDice = diceHistory.at(-streakBiet + 4);
      if (history.at(-streakBiet + 4) === "Tài" && fifthDice === 11) {
        return { prediction: "Xỉu", confidence: 85 };
      }
    }

    if (streakDice.includes(11) && side === "Tài") {
      return { prediction: "Xỉu", confidence: 80 };
    }

    // 👉 Nếu bệt Xỉu (≥4) mà ra 10 thì dự đoán Tài
    if (side === "Xỉu" && streakDice.includes(10)) {
      return { prediction: "Tài", confidence: 80 };
    }

    // 👉 NEW RULE: nếu 2 tay trước có Xỉu <= 6 thì dễ về Xỉu
    if (diceHistory.length >= 2) {
      const prev2 = diceHistory.at(-2);
      const prev1 = diceHistory.at(-1);

      if ((prev2 <= 6 && history.at(-2) === "Xỉu") ||
          (prev1 <= 6 && history.at(-1) === "Xỉu")) {
        return { prediction: "Xỉu", confidence: 78 };
      }
    }

    return { prediction: side, confidence: 85 };
  }

  // 👉 NEW RULE: bệt ≥4 mà xuất hiện Xỉu ≤6
  if (streakBiet >= 4) {
    const side = history.at(-1);
    const streakDice = diceHistory.slice(-streakBiet);

    // Nếu bệt đang là Xỉu
    if (side === "Xỉu") {
      const lastDice = diceHistory.at(-1);
      const prevDice = diceHistory.at(-2);

      // Nếu vừa ra Xỉu ≤6 → dự đoán Xỉu
      if (lastDice <= 6) {
        return { prediction: "Xỉu", confidence: 78 };
      }

      // Sau khi đã ra Xỉu thấp, nếu tiếp theo nhích lên → dự đoán Tài
      if (prevDice <= 6 && lastDice > prevDice) {
        return { prediction: "Tài", confidence: 82 };
      }
    }

    // Nếu bệt đang là Tài → áp dụng đối xứng
    if (side === "Tài") {
      const lastDice = diceHistory.at(-1);
      const prevDice = diceHistory.at(-2);

      // Nếu vừa ra Tài cao ≥17 → dự đoán Tài tiếp
      if (lastDice >= 17) {
        return { prediction: "Tài", confidence: 78 };
      }

      // Sau khi ra Tài cao, nếu tiếp theo tụt xuống → dự đoán Xỉu
      if (prevDice >= 17 && lastDice < prevDice) {
        return { prediction: "Xỉu", confidence: 82 };
      }
    }
  }

  // 2. Cầu 1-1 (xen kẽ Tài/Xỉu)
  if (last !== last2 && last2 !== last3) {
    // Đếm độ dài chuỗi 1-1 gần nhất
    let altCount = 1;
    for (let i = history.length - 1; i > 0; i--) {
      if (history[i] !== history[i - 1]) {
        altCount++;
      } else {
        break;
      }
    }

    if (altCount >= 6) {
      // 👉 Nếu cầu 1-1 kéo dài (>=6 ván xen kẽ) → dễ bẻ
      const prediction = last === "Tài" ? "Tài" : "Xỉu"; // giữ nguyên bên vừa ra
      return { prediction, confidence: 78 };
    } else {
      // 👉 Bình thường thì đảo
      const prediction = last === "Tài" ? "Xỉu" : "Tài";
      return { prediction, confidence: 70 };
    }
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

  // 7. Xu hướng giảm mạnh sau đỉnh
  if (diceHistory.length >= 5) {
    const d = diceHistory.slice(-5); // lấy 5 ván gần nhất

    // Kiểm tra có chuỗi giảm rõ rệt
    if (d[0] >= 13 && d[1] >= 13 && d[2] >= 11 && d[3] <= 11 && d[4] <= 9) {
      return { prediction: "Xỉu", confidence: 82 };
    }

    // Nếu xuất hiện >=2 lần số 11 liên tiếp trong chuỗi
    const hasTwo11 = d.filter(x => x === 11).length >= 2;
    if (hasTwo11 && d[d.length - 1] <= 9) {
      return { prediction: "Xỉu", confidence: 80 };
    }
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

  // 8. Cầu 2-1-2
  if (history.length >= 5) {
    const h = history.slice(-5); // lấy 5 ván gần nhất
    // pattern 2-1-2: AA B AA
    if (h[0] === h[1] && h[3] === h[4] && h[0] === h[3] && h[2] !== h[0]) {
      const lastDice = diceHistory.at(-1);

      if (lastDice >= 11 && lastDice <= 13) {
        // 👉 xúc xắc nằm vùng giữa → theo 2-1-2 (ngược)
        const prediction = h[0] === "Tài" ? "Xỉu" : "Tài";
        return { prediction, confidence: 75 };
      } else {
        // 👉 còn lại thì theo 2-2
        return { prediction: h[0], confidence: 70 };
      }
    }
  }

  // 8. 11 xen giữa chuỗi Xỉu
  if (diceHistory.length >= 3) {
    const d1 = diceHistory.at(-3);
    const d2 = diceHistory.at(-2);
    const d3 = diceHistory.at(-1);

    if (d1 <= 9 && d2 === 11 && d3 <= 10) {
      return { prediction: "Xỉu", confidence: 78 };
    }
  }

  // 9. Hai lần 11 liên tiếp rồi lên 13, sau đó xuống Xỉu
  if (diceHistory.length >= 5) {
    const d1 = diceHistory.at(-5);
    const d2 = diceHistory.at(-4);
    const d3 = diceHistory.at(-3);
    const d4 = diceHistory.at(-2);
    const d5 = diceHistory.at(-1);

    if (d1 === 11 && d2 === 11 && d3 >= 13 && d4 <= 10 && d5 <= 10) {
      return { prediction: "Xỉu", confidence: 82 };
    }
  }

/* ========= API ========= */

// Dự đoán hiện tại
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
      // 👉 Nếu đã có dự đoán trước đó thì lưu lại kèm kết quả thực tế
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
