require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const Redis = require('ioredis');

const app = express();
app.use(bodyParser.json());

// 初始化 Redis
const redis = new Redis(process.env.REDIS_URL);

// 生成 6 位随机 OTP
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

  // 保存到 Redis，设置过期时间 5 分钟
  await redis.set(`otp:${phone}`, otp, 'EX', 300);

  try {
    let message = `Your verification code is ${otp}`;
    let params = {
      apikey: process.env.SEMAPHORE_API_KEY,
      number: phone,
      message: message
    };

    if (process.env.SEMAPHORE_USE_SENDER === 'true') {
      params.sendername = process.env.SEMAPHORE_SENDER_NAME;
    }

    const response = await axios.post('https://api.semaphore.co/api/v4/messages', params, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('Semaphore API response:', response.data);

    res.json({ success: true, otp: otp, response: response.data });
  } catch (error) {
    console.error('Semaphore API error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 验证 OTP
app.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  const storedOtp = await redis.get(`otp:${phone}`);
  if (storedOtp === otp) {
    // 验证成功后删除 OTP
    await redis.del(`otp:${phone}`);
    return res.json({ success: true, message: 'OTP verified successfully' });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP server running on port ${PORT}`);
});
