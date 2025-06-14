import express from "express";
import axios from "axios";
import cors from "cors";
import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    keepAlive: 5000, // 防止空闲连接被关闭
    reconnectStrategy: retries => Math.min(retries * 50, 2000),
  },
});

redisClient.connect().catch(console.error);

app.post("/send-otp", async (req, res) => {
  const { phone } = req.body;

  if (!phone) return res.status(400).json({ error: "Phone is required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expireSeconds = 300;

  await redisClient.setEx(phone, expireSeconds, otp);

  const message = `DURANTGRACE: Pakigamit ang OTP ${otp} to confirm your order.`;

  try {
    const response = await axios.post("https://api.semaphore.co/api/v4/otp", null, {
      params: {
        apikey: process.env.SEMAPHORE_API_KEY,
        number: phone,
        message: message,
      },
    });
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) return res.status(400).json({ error: "Phone and OTP are required" });

  const savedOtp = await redisClient.get(phone);

  if (savedOtp === otp) {
    await redisClient.del(phone);
    res.json({ success: true, message: "OTP verified!" });
  } else {
    res.status(400).json({ success: false, error: "Invalid OTP" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
