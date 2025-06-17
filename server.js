const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ SEND OTP 路由
app.post('/send-otp', async (req, res) => {
  try {
    const phone = req.body.phone;

    const requestParams = {
      apikey: process.env.SEMAPHORE_API_KEY,
      number: phone
    };

    // ✅ 如果环境变量启用 sendername 且有值就加上
    if (
      process.env.SEMAPHORE_USE_SENDER === 'true' &&
      process.env.SEMAPHORE_SENDER_NAME &&
      process.env.SEMAPHORE_SENDER_NAME.trim() !== ''
    ) {
      requestParams.sendername = process.env.SEMAPHORE_SENDER_NAME;
    }

    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp",
      new URLSearchParams(requestParams),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.response ? error.response.data : error.message });
  }
});

// ✅ VERIFY OTP 路由
app.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;

    const requestParams = {
      apikey: process.env.SEMAPHORE_API_KEY,
      number: phone,
      code: code
    };

    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp/verify",
      new URLSearchParams(requestParams),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.response ? error.response.data : error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
