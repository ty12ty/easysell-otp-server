require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Redis = require('ioredis');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Redis 配置
const redis = new Redis(process.env.REDIS_URL);

// === 配置 ===
const apiKey = process.env.SEMAPHORE_API_KEY;
const useSender = process.env.SEMAPHORE_USE_SENDER === 'true';
const senderName = process.env.SEMAPHORE_SENDER_NAME;
const senderStatus = process.env.SEMAPHORE_SENDER_STATUS || 'Pending'; // 👈 新增，环境变量配置

// === 📤 发送 OTP ===
app.post('/send-otp', async (req, res) => {
  let { number } = req.body;

  // 📞 自动修正菲律宾号
  if (number.startsWith('09')) {
    number = '63' + number.slice(1);
  } else if (number.startsWith('6309')) {
    number = '639' + number.slice(3);
  }

  // 📋 OTP 消息模板
  const message = "Your OTP code is {otp}. Please use it within 5 minutes.";

  try {
    // === 动态选择 API URL ===
    // ✅ 如果 Sender Name 已过审，走 /otp 专用通道，否则走 /messages
    const apiUrl = senderStatus === 'Active'
      ? 'https://semaphore.co/api/v4/otp'
      : 'https://semaphore.co/api/v4/messages';

    const params = {
      apikey: apiKey,
      number,
      message,
    };

    if (useSender) {
      params.sendername = senderName;
    }

    const response = await axios.post(apiUrl, null, { params });

    // === 成功处理 ===
    if (apiUrl.includes('/otp')) {
      // 如果走的是 OTP 专线，Semaphore 会返回 { code }
      if (response.data && response.data.length > 0 && response.data[0].code) {
        const otp = response.data[0].code;
        await redis.setex(number, 300, otp);
        return res.json({ success: true, otp, response: response.data[0] });
      } else {
        return res.status(500).json({ success: false, error: "Invalid OTP response", response: response.data });
      }
    } else {
      // 如果走的是 /messages，自行生成 OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      // 替换模板
      const customMessage = message.replace('{otp}', otp);
      // 重新发（因为刚才发的 message 里是 {otp} 占位符）
      await axios.post('https://semaphore.co/api/v4/messages', null, {
        params: {
          apikey: apiKey,
          number,
          message: customMessage,
          ...(useSender && { sendername: senderName })
        }
      });
      await redis.setex(number, 300, otp);
      return res.json({ success: true, otp, response: 'Sent via /messages with generated OTP' });
    }

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
