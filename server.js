require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Redis = require('ioredis');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const redis = new Redis(process.env.REDIS_URL);

const apiKey = process.env.SEMAPHORE_API_KEY;
const useSender = process.env.SEMAPHORE_USE_SENDER === 'true';
const senderName = process.env.SEMAPHORE_SENDER_NAME;

// === 📞 统一格式化菲律宾手机号 ===
function normalizePhilippineNumber(input) {
  let number = String(input).replace(/\D/g, '');

  if (number.startsWith('6309')) {
    number = '639' + number.slice(4);
  } else if (number.startsWith('09')) {
    number = '63' + number.slice(1);
  } else if (number.startsWith('639')) {
    // OK
  } else if (number.startsWith('63') && number.length === 12) {
    // OK
  } else if (number.startsWith('9') && number.length === 10) {
    number = '63' + number;
  } else {
    throw new Error('Invalid Philippine mobile number format.');
  }

  return number;
}

// === 📤 发送 OTP ===
app.post('/send-otp', async (req, res) => {
  let number;
  try {
    number = normalizePhilippineNumber(req.body.number);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  try {
    // 自行生成 6 位 OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const message = `Your OTP code is ${otp}. Please use it within 5 minutes.`;

    const params = {
      apikey: apiKey,
      number,
      message,
    };

    if (useSender) {
      params.sendername = senderName;
    }

    // 发送到 Semaphore /messages
    await axios.post('https://semaphore.co/api/v4/messages', null, { params });

    // 缓存 OTP
    await redis.setex(number, 300, otp);

    res.json({ success: true, otp, response: 'Sent via /messages with custom OTP' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

// === ✅ 验证 OTP ===
app.post('/verify-otp', async (req, res) => {
  let number;
  try {
    number = normalizePhilippineNumber(req.body.number);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  const otp = req.body.otp;

  const storedOtp = await redis.get(number);

  if (storedOtp === otp) {
    await redis.del(number);
    res.json({ success: true, message: "OTP verified successfully!" });
  } else {
    res.status(400).json({ success: false, message: "Invalid OTP." });
  }
});

// === 🚀 启动服务器 ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
