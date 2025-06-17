const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 你在 Render 的环境变量里设置 SE MAPHORE_API_KEY 和 SENDERNAME（可选）
const API_KEY = process.env.SEMAPHORE_API_KEY;
const SENDERNAME = process.env.SENDERNAME; // 可以没有

app.post("/send-otp", async (req, res) => {
  const { number } = req.body;

  try {
    const payload = {
      number: number,
      message: "Your OTP code is {otp}. Do not share this code with anyone."
    };

    // 如果 SENDERNAME 已经设置，包含 sendername，否则让 Semaphore 用默认 sender
    if (SENDERNAME) {
      payload.sendername = SENDERNAME;
    }

    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Send OTP failed:", error.response ? error.response.data : error.message);
    res.status(500).json({
      error: error.response ? error.response.data : error.message
    });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { number, otp } = req.body;

  try {
    const payload = {
      number: number,
      otp: otp
    };

    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp/verify",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Verify OTP failed:", error.response ? error.response.data : error.message);
    res.status(500).json({
      error: error.response ? error.response.data : error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
