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
// ✅ 电话号码清洗与校正函数
// ----------------------------
function sanitizePhoneNumber(phone) {
  // 1. 移除非数字字符
  let cleaned = phone.replace(/\D/g, '');
  
  // 2. 处理630开头的情况（菲律宾常见错误格式）
  if (cleaned.startsWith('630') && cleaned.length >= 12) {
    // 6309... -> 639...
    cleaned = '63' + cleaned.substring(3);
  }
  
  // 3. 处理63开头但长度超过12位的情况
  if (cleaned.startsWith('63') && cleaned.length > 12) {
    cleaned = cleaned.substring(0, 12);
  }
  
  // 4. 处理09开头（菲律宾本地格式）
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    cleaned = '63' + cleaned.substring(1);
  }
  
  // 5. 添加缺少的63前缀
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    cleaned = '63' + cleaned;
  }
  
  return cleaned;
}

// ----------------------------
// ✅ 6) 发送 OTP (优化版)
// ----------------------------
app.post("/send-otp", async (req, res) => {
  let { phone } = req.body;
  
  // 清洗电话号码
  phone = sanitizePhoneNumber(phone);
  
  // 菲律宾手机号验证 (639开头 + 9位数字 = 12位)
  const phRegex = /^639\d{9}$/;
  if (!phone || !phRegex.test(phone)) {
    return res.status(400).json({ 
      success: false,
      error: "Invalid Philippine number. Must be 639XXXXXXXXX format (12 digits).",
      corrected_phone: phone
    });
  }

  // 频率限制检查
  const rateKey = `rate:${phone}`;
  const attempts = await redisClient.get(rateKey) || 0;
  
  // 限制规则：60秒内最多1次，每天最多3次
  if (parseInt(attempts) >= 3) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please try again later."
    });
  }

  try {
    // 构造基础消息
    let message = "Pakigamit ang OTP {otp} to confirm your order.";
    
    // 动态添加Sender Name（如果已启用）
    if (process.env.SEMAPHORE_USE_SENDER === 'true' && process.env.SEMAPHORE_SENDER_NAME) {
      message = `${process.env.SEMAPHORE_SENDER_NAME}: ${message}`;
    }

    // 准备API请求参数
    const requestParams = {
      apikey: process.env.SEMAPHORE_API_KEY,
      number: phone,
      message: message
    };
    
    // 添加Sender Name参数（如果已启用）
    if (process.env.SEMAPHORE_USE_SENDER === 'true' && process.env.SEMAPHORE_SENDER_NAME) {
      requestParams.sendername = process.env.SEMAPHORE_SENDER_NAME;
    }

    // 调用Semaphore OTP API
    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp",
      new URLSearchParams(requestParams),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    // 检查API响应
    if (response.status !== 200 || !response.data?.[0]?.code) {
      throw new Error("Invalid response from Semaphore API");
    }

    // 从Semaphore响应中获取实际发送的OTP
    const semaphoreData = response.data[0];
    const otpCode = semaphoreData.code.toString();
    
    // 存储OTP到Redis
    const redisKey = `otp:${phone}`;
    await redisClient.setEx(redisKey, 300, otpCode); // 5分钟有效期
    
    // 更新频率计数器 (24小时过期)
    await redisClient.setEx(rateKey, 86400, parseInt(attempts) + 1);
    
    // 记录成功日志
    const senderMode = process.env.SEMAPHORE_USE_SENDER === 'true' ? 
      `with sender ${process.env.SEMAPHORE_SENDER_NAME}` : 
      "via official channel";
      
    console.log(`📤 OTP sent to ${phone} ${senderMode} (ID: ${semaphoreData.message_id})`);
    
    res.json({ 
      success: true, 
      message_id: semaphoreData.message_id,
      message: "OTP sent successfully",
      corrected_phone: phone  // 返回校正后的号码
    });
    
  } catch (error) {
    console.error("❌ Semaphore API error:", error.response?.data || error.message);
    
    // 构造错误信息
    let errorMsg = "Failed to send OTP";
    if (error.response?.data?.error) {
      errorMsg += `: ${error.response.data.error}`;
    } else if (error.message) {
      errorMsg += `: ${error.message}`;
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMsg,
      corrected_phone: phone
    });
  }
});

// ----------------------------
// ✅ 7) 验证 OTP (优化版)
// ----------------------------
app.post("/verify-otp", async (req, res) => {
  let { phone, otp } = req.body;
  
  // 清洗电话号码
  phone = sanitizePhoneNumber(phone);
  
  // 菲律宾号码格式验证
  const phRegex = /^639\d{9}$/;
  if (!phone || !otp || !phRegex.test(phone)) {
    return res.status(400).json({ 
      success: false,
      error: "Invalid phone or OTP format",
      corrected_phone: phone
    });
  }

  try {
    const redisKey = `otp:${phone}`;
    const savedOtp = await redisClient.get(redisKey);

    // 处理OTP不存在或过期
    if (!savedOtp) {
      return res.status(404).json({ 
        success: false, 
        error: "OTP expired or not requested. Please request a new OTP." 
      });
    }

    // 验证时忽略空格和前导零
    const cleanSavedOtp = savedOtp.trim();
    const cleanUserOtp = otp.trim().replace(/^0+/, '');
    
    if (cleanSavedOtp === cleanUserOtp) {
      // 验证成功后删除OTP和频率计数
      await redisClient.del(redisKey);
      await redisClient.del(`rate:${phone}`);
      
      console.log(`✅ OTP verified for ${phone}`);
      
      return res.json({ 
        success: true, 
        message: "OTP verified successfully!" 
      });
    }
    
    // 验证失败处理
    const attemptKey = `attempt:${phone}`;
    const attempts = await redisClient.incr(attemptKey);
    
    // 设置尝试次数过期时间（首次设置）
    if (attempts === 1) {
      await redisClient.expire(attemptKey, 300); // 5分钟窗口
    }
    
    // 超过最大尝试次数
    if (attempts >= 5) {
      // 使OTP失效并清除尝试计数
      await redisClient.del(redisKey);
      await redisClient.del(attemptKey);
      
      return res.status(403).json({
        success: false,
        error: "Maximum attempts exceeded. Please request a new OTP."
      });
    }
    
    res.status(400).json({
      success: false,
      error: "Invalid OTP",
      attempts_left: 5 - attempts
    });
    
  } catch (error) {
    console.error("❌ Verification error:", error.message);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// ----------------------------
// ✅ 8) Sender状态检查端点
// ----------------------------
app.get('/sender-status', (req, res) => {
  const usingCustomSender = process.env.SEMAPHORE_USE_SENDER === 'true';
  const senderName = process.env.SEMAPHORE_SENDER_NAME || '';
  
  res.json({
    success: true,
    using_custom_sender: usingCustomSender,
    sender_name: usingCustomSender ? senderName : 'Official',
    status: usingCustomSender ? 'Active' : 'Using default sender'
  });
});

// ----------------------------
// ✅ 9) 健康检查端点
// ----------------------------
app.get('/health', async (req, res) => {
  try {
    // 检查Redis连接
    await redisClient.ping();
    res.json({
      status: 'OK',
      redis: 'connected',
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      redis: 'disconnected',
      error: error.message
    });
  }
});

// ----------------------------
// ✅ 10) 启动服务器
// ----------------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📱 Sender Mode: ${
    process.env.SEMAPHORE_USE_SENDER === 'true' 
      ? `Custom (${process.env.SEMAPHORE_SENDER_NAME})` 
      : 'Official'
  }`);
});
