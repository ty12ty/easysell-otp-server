require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// Redis 配置
const redis = new Redis(process.env.REDIS_URL);

// Semaphore 配置
const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;
const SEMAPHORE_SENDER_NAME = process.env.SEMAPHORE_SENDER_NAME;
const SEMAPHORE_USE_SENDER = process.env.SEMAPHORE_USE_SENDER === 'true';

// 生成随机 6 位 OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000);
}

// 发送 OTP
app.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const otp = generateOTP();
    const message = `Your verification code is ${otp}`;

    const data = {
      apikey: SEMAPHORE_API_KEY,
      number: phone,
      message: message,
      type: 'otp'
    };

    if (SEMAPHORE_USE_SENDER) {
      data.sendername = SEMAPHORE_SENDER_NAME;
    }

    const response = await axios.post('https://api.semaphore.co/api/v4/messages', data);

    // 保存 OTP 到 Redis，过期时间 5 分钟
    await redis.setex(phone, 300, otp);

    res.json({
      success: true,
      otp: otp,
      response: response.data
    });
  } catch (error) {
    console.error('Error sending OTP:', error.response ? error.response.data : error.message);
    res.status(500).json({
      success: false,
      error: error.response ? error.response.data : error.message
    });
  }
});

// 验证 OTP
app.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

    const savedOtp = await redis.get(phone);
    if (!savedOtp) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found' });
    }

    if (savedOtp === otp) {
      await redis.del(phone); // 验证成功后删除
      return res.json({ success: true, message: 'OTP verified successfully' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
  } catch (error) {
    console.error('Error verifying OTP:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
