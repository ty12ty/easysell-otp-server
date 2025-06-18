require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Redis = require('ioredis');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// === Redis 配置 ===
const redis = new Redis(process.env.REDIS_URL);

// === 配置 ===
const apiKey = process.env.SEMAPHORE_API_KEY;
const useSender = process.env.SEMAPHORE_USE_SENDER === 'true';
const senderName = process.env.SEMAPHORE_SENDER_NAME;

// === 📤 发送 OTP （只用 /messages）===
app.post('/send-otp', async (req, res) => {
  let { number } = req.body;

  // 自动修正菲律宾手机号
  if (number.startsWith('09')) {
    number = '63' + number.slice(1);
  } else if (number.startsWith('6309')) {
    number = '639' + number.slice(3);
  }

  try {
    // ✅ 自行生成 6 位 OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const message = `Your OTP code is ${otp}. Please use it within 5 minutes.`;

    // 发送到 /messages
    const params = {
      apikey: apiKey,
      number,
      message,
    };

    if (useSender) {
      params.sendername = senderName;
    }

    await axios.post('https://semaphore.co/api/v4/messages', null, { params });

    // Redis 保存 OTP，5分钟过期
    await redis.setex(number, 300, otp);

    res.json({ success: true, otp, response: 'Sent via /messages with custom OTP' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

// === ✅ 验证 OTP ===
app.post('/verify-otp', async (req, res) => {
  let { number, otp } = req.body;

  if (number.startsWith('09')) {
    number = '63' + number.slice(1);
  } else if (number.startsWith('6309')) {
    number = '639' + number.slice(3);
  }

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
