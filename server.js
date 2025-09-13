const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4000;

// ===== BIẾN TOÀN CỤC =====
let lastData = null;
let history = []; // lưu {phien, du_doan, ket_qua, danh_gia, dudoan_vi}

// ===== GỌI API GỐC =====
async function fetchSicboSunWin() {
  try {
    const res = await fetch("https://sicokk.onrender.com/predict");
    const data = await res.json();

    // Chuẩn hóa dữ liệu
    const current = {
      Phien: data.Phien,
      Xuc_xac_1: data.Xuc_xac_1,
      Xuc_xac_2: data.Xuc_xac_2,
      Xuc_xac_3: data.Xuc_xac_3,
      Tong: data.Tong,
      Ket_qua: data.Ket_qua,
      du_doan: data.du_doan,
      do_tin_cay: data.do_tin_cay,
      dudoan_vi: data.dudoan_vi,   // 🔥 thêm field này
      phien_hien_tai: data.phien_hien_tai,
      Ghi_chu: data.Ghi_chu,
      id: "@LostmyS4lf"
    };

    // Nếu có phiên mới
    if (!lastData || current.Phien !== lastData.Phien) {
      if (lastData) {
        // Đánh giá đúng/sai dự đoán của phiên trước
        const danh_gia =
          lastData.du_doan === current.Ket_qua ? "ĐÚNG" : "SAI";

        history.unshift({
          phien: lastData.Phien,
          du_doan: lastData.du_doan,
          ket_qua: current.Ket_qua,
          danh_gia,
          dudoan_vi: lastData.dudoan_vi || []
        });

        if (history.length > 50) history.pop();
      }
      lastData = current;
    }
  } catch (err) {
    console.error("❌ Lỗi fetch API SicboSunWin:", err);
  }
}

// Gọi API liên tục 5s/lần
setInterval(fetchSicboSunWin, 5000);
fetchSicboSunWin();

// ===== ROUTES =====
app.get("/sicbosunwin/current", (req, res) => {
  if (!lastData) return res.json({ error: "Chưa có dữ liệu" });
  res.json(lastData);
});

app.get("/sicbosunwin/history", (req, res) => {
  res.json(history);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server SicboSunWin chạy tại http://localhost:${PORT}`);
});
