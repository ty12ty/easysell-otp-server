require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Redis = require('ioredis');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Redis 实例
const redis = new Redis(process.env.REDIS_URL);

// Send OTP
app.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

  try {
    // 生成 6 位 OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Semaphore 专用 OTP 路由参数
    const params = new URLSearchParams();
    params.append('apikey', process.env.SEMAPHORE_API_KEY);
    params.append('number', phone);
    params.append('message', `Your OTP code is {otp}.`);
    params.append('code', otp);

    // 是否使用自定义 Sender Name
    if (process.env.SEMAPHORE_USE_SENDER === 'true') {
      params.append('sendername', process.env.SEMAPHORE_SENDER_NAME);
    }

    // 请求 Semaphore OTP 路由
    const response = await axios.post('https://api.semaphore.co/api/v4/otp', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    // Redis 存储，5分钟
    await redis.setex(`otp:${phone}`, 300, otp);

    console.log('Semaphore OTP Response:', response.data);

    res.json({ success: true, otp, response: response.data });
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.response?.data || error.message });
  }
});

// Verify OTP
app.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP required' });

  try {
    const savedOtp = await redis.get(`otp:${phone}`);
    if (savedOtp === otp) {
      await redis.del(`otp:${phone}`);
      return res.json({ success: true, message: 'OTP verified' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Verification failed', error: error.message });
  }
});

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP server running on port ${PORT}`);
});
