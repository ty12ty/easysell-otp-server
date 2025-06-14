const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const { createClient } = require('redis');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Redis 客户端
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

// 生成随机 6 位 OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 发送 OTP
app.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const otp = generateOTP();

  // 缓存 OTP，有效期 5 分钟
  await redisClient.setEx(`otp:${phone}`, 300, otp);

  // 调用 Semaphore OTP API
  const params = new URLSearchParams();
  params.append('apikey', process.env.SEMAPHORE_API_KEY);
  params.append('number', phone);
  params.append('message', `DURANTGRACE: Pakigamit ang OTP {otp} to confirm your order. Expires in 5 minutes.`);

  try {
    const response = await axios.post('https://semaphore.co/api/v4/otp', params);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 验证 OTP
app.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const cachedOTP = await redisClient.get(`otp:${phone}`);

  if (cachedOTP === otp) {
    // 可在此写入 DB 或返回成功标记
    await redisClient.del(`otp:${phone}`);
    res.json({ success: true, message: 'OTP verified' });
  } else {
    res.status(400).json({ success: false, message: 'Invalid OTP' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
