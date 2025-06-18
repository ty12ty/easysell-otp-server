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

app.post('/send-otp', async (req, res) => {
    let { number } = req.body;

    // --- 📞 自动修正手机号 ---
    if (number.startsWith('09')) {
        number = '63' + number.slice(1);
    } else if (number.startsWith('6309')) {
        number = '639' + number.slice(3);
    }

    const apiKey = process.env.SEMAPHORE_API_KEY;
    const useSender = process.env.SEMAPHORE_USE_SENDER === 'true';
    const senderName = process.env.SEMAPHORE_SENDER_NAME;

    const message = "Your OTP code is {otp}. Please use it within 5 minutes.";

    try {
        const params = {
            apikey: apiKey,
            number: number,
            message: message
        };

        if (useSender) {
            params.sendername = senderName;
        }

        const response = await axios.post('https://semaphore.co/api/v4/otp', null, { params });

        if (response.data && response.data.length > 0 && response.data[0].code) {
            const otp = response.data[0].code;
            await redis.setex(number, 300, otp);
            res.json({ success: true, otp, response: response.data[0] });
        } else {
            res.status(500).json({ success: false, error: "Invalid response", response: response.data });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.toString() });
    }
});

app.post('/verify-otp', async (req, res) => {
    let { number, otp } = req.body;

    // --- 📞 自动修正手机号 ---
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
