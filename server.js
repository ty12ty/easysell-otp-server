// ----------------------------
// ✅ 1) 基本依赖
// ----------------------------
import express from "express";
import axios from "axios";
import cors from "cors";
import { createClient } from "redis";
import dotenv from "dotenv";

// ----------------------------
// ✅ 2) 加载环境变量
// ----------------------------
dotenv.config();

// ----------------------------
// ✅ 3) 创建 Express App
// ----------------------------
const app = express();
const port = process.env.PORT || 10000;

// ----------------------------
// ✅ 4) 中间件
// ----------------------------
app.use(cors());
app.use(express.json());

// ----------------------------
// ✅ 5) 连接 Redis（Upstash）
// ----------------------------
const redisClient = createClient({
  url: process.env.REDIS_URL.replace(/^redis:\/\//, "rediss://"), // 确保使用 TLS
  socket: {
    keepAlive: 5000,
    reconnectStrategy: retries => Math.min(retries * 50, 2000),
  },
});

redisClient.on("error", (err) => console.error("❌ Redis error:", err));

await redisClient.connect();
console.log("✅ Connected to Redis");

// ----------------------------
// ✅ 6) 发送 OTP
// ----------------------------
app.post("/send-otp", async (req, res) => {
  const { phone } = req.body;

  if (!phone) return res.status(400).json({ error: "Phone is required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expireSeconds = 300;

  try {
    // 1) 存 OTP 到 Redis
    await redisClient.setEx(phone, expireSeconds, otp);

    // 2) 组装短信内容 (推荐用 {otp}，Semaphore 会替换)
    const message = `DURANTGRACE: Pakigamit ang OTP {otp} to confirm your order.`;

    // 3) 调用 Semaphore /otp，带 code 确保使用自己生成的
    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp",
      null,
      {
        params: {
          apikey: process.env.SEMAPHORE_API_KEY,
          number: phone,
          message: message,
          code: otp, // ✅ 用自己生成的
        },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Failed to send OTP:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

// ----------------------------
// ✅ 7) 验证 OTP
// ----------------------------
app.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) return res.status(400).json({ error: "Phone and OTP are required" });

  try {
    const savedOtp = await redisClient.get(phone);

    if (savedOtp === otp) {
      await redisClient.del(phone); // 验证后删除
      res.json({ success: true, message: "OTP verified!" });
    } else {
      res.status(400).json({ success: false, error: "Invalid OTP" });
    }
  } catch (error) {
    console.error("❌ Failed to verify OTP:", error.message);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------
// ✅ 8) 启动服务器
// ----------------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
