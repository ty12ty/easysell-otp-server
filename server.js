import express from "express";
import axios from "axios";
import cors from "cors";
import { createClient } from "redis";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

// 创建 Express 应用
const app = express();
const port = process.env.PORT || 10000;

// 中间件
app.use(cors());
app.use(express.json());

// Redis 客户端配置
const redisClient = createClient({
  url: process.env.REDIS_URL.replace(/^redis:\/\//, "rediss://"),
  socket: {
    keepAlive: 5000,
    reconnectStrategy: retries => Math.min(retries * 50, 2000),
  },
});

redisClient.on("error", (err) => console.error("❌ Redis error:", err));

// 带重试机制的 Redis 连接函数
async function connectRedis() {
  const maxRetries = 5;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      await redisClient.connect();
      console.log("✅ Connected to Redis");
      return;
    } catch (err) {
      console.error(`❌ Redis connection failed (attempt ${retryCount + 1}/${maxRetries}):`, err);
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.error("🔥 Critical: Failed to connect to Redis after multiple attempts");
  process.exit(1);
}

await connectRedis();

// 电话号码清洗函数
function sanitizePhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  
  // 处理630开头的情况（菲律宾常见错误格式）
  if (cleaned.startsWith('630') && cleaned.length >= 12) {
    cleaned = '63' + cleaned.substring(3);
  }
  
  // 处理63开头但长度超过12位的情况
  if (cleaned.startsWith('63') && cleaned.length > 12) {
    cleaned = cleaned.substring(0, 12);
  }
  
  // 处理09开头（菲律宾本地格式）
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    cleaned = '63' + cleaned.substring(1);
  }
  
  // 添加缺少的63前缀
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    cleaned = '63' + cleaned;
  }
  
  return cleaned;
}

// 根路由 - 用于Render健康检查
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OTP Verification Service</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
        h1 { color: #4f46e5; }
        .status { padding: 20px; margin: 20px auto; max-width: 500px; border-radius: 8px; }
        .operational { background-color: #d1fae5; color: #065f46; }
        .container { max-width: 800px; margin: 0 auto; }
        .endpoints { text-align: left; margin-top: 30px; }
        .endpoint { margin: 10px 0; padding: 10px; background: #f8fafc; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>OTP Verification Service</h1>
        <div class="status operational">
          <h2>Status: Operational</h2>
          <p>Service for Philippine market OTP verification</p>
        </div>
        
        <div class="endpoints">
          <h3>API Endpoints:</h3>
          <div class="endpoint">
            <strong>POST /send-otp</strong> - Send OTP to a phone number<br>
            Body: { "phone": "639XXXXXXXXX" }
          </div>
          <div class="endpoint">
            <strong>POST /verify-otp</strong> - Verify OTP code<br>
            Body: { "phone": "639XXXXXXXXX", "otp": "123456" }
          </div>
          <div class="endpoint">
            <strong>GET /health</strong> - Service health check
          </div>
          <div class="endpoint">
            <strong>GET /sender-status</strong> - SMS sender status
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 健康检查端点
app.get('/health', async (req, res) => {
  try {
    // 检查Redis连接
    await redisClient.ping();
    res.json({
      status: 'OK',
      redis: 'connected',
      server_time: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.2.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      redis: 'disconnected',
      error: error.message
    });
  }
});

// 发送者状态端点
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

// 发送OTP
app.post('/send-otp', async (req, res) => {
  let { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ 
      success: false,
      error: "Phone number is required" 
    });
  }
  
  // 清洗电话号码
  phone = sanitizePhoneNumber(phone);
  
  // 菲律宾手机号严格验证
  const phRegex = /^639\d{9}$/;
  if (!phRegex.test(phone)) {
    return res.status(400).json({ 
      success: false,
      error: "Invalid Philippine number. Must be 639XXXXXXXXX format (12 digits)",
      corrected_phone: phone
    });
  }
  
  // 客户端IP限制
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ipKey = `ip_limit:${clientIp}`;
  const ipAttempts = await redisClient.get(ipKey) || 0;
  
  if (parseInt(ipAttempts) > 50) {
    return res.status(429).json({
      success: false,
      error: "IP request limit exceeded. Please try again later."
    });
  }
  
  // 电话号码频率限制
  const rateKey = `rate:${phone}`;
  const attempts = await redisClient.get(rateKey) || 0;
  
  if (parseInt(attempts) >= 3) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please try again later."
    });
  }
  
  try {
    // 构造基础消息
    let message = "Your verification code is {otp}. Use it within 5 minutes.";
    
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
    
    // 更新频率计数器
    await redisClient.setEx(rateKey, 86400, parseInt(attempts) + 1); // 24小时过期
    await redisClient.setEx(ipKey, 3600, parseInt(ipAttempts) + 1); // 1小时过期
    
    // 记录成功日志
    const senderMode = process.env.SEMAPHORE_USE_SENDER === 'true' ? 
      `with sender ${process.env.SEMAPHORE_SENDER_NAME}` : 
      "via official channel";
      
    console.log(`📤 OTP sent to ${phone} ${senderMode} (ID: ${semaphoreData.message_id})`);
    
    res.json({ 
      success: true, 
      message_id: semaphoreData.message_id,
      message: "OTP sent successfully",
      corrected_phone: phone
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

// 验证OTP
app.post('/verify-otp', async (req, res) => {
  let { phone, otp } = req.body;
  
  if (!phone || !otp) {
    return res.status(400).json({ 
      success: false,
      error: "Phone and OTP are required" 
    });
  }
  
  // 清洗电话号码
  phone = sanitizePhoneNumber(phone);
  
  // 菲律宾号码格式验证
  const phRegex = /^639\d{9}$/;
  if (!phRegex.test(phone)) {
    return res.status(400).json({ 
      success: false,
      error: "Invalid phone format",
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
      
      // 创建验证标记（5分钟有效）
      await redisClient.setEx(`verified:${phone}`, 300, "true");
      
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
    if (parseInt(attempts) === 1) {
      await redisClient.expire(attemptKey, 300); // 5分钟窗口
    }
    
    // 超过最大尝试次数
    if (parseInt(attempts) >= 5) {
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
      attempts_left: 5 - parseInt(attempts)
    });
    
  } catch (error) {
    console.error("❌ Verification error:", error.message);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// 验证状态检查（供订单创建前使用）
app.post('/check-verification', async (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ 
      success: false,
      error: "Phone number is required" 
    });
  }
  
  // 清洗电话号码
  const cleanedPhone = sanitizePhoneNumber(phone);
  
  try {
    const isVerified = await redisClient.get(`verified:${cleanedPhone}`);
    
    if (isVerified) {
      return res.json({ 
        success: true, 
        verified: true,
        message: "Phone number is verified"
      });
    }
    
    res.json({
      success: true,
      verified: false,
      message: "Phone number not verified or verification expired"
    });
    
  } catch (error) {
    console.error("❌ Verification check error:", error.message);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📱 Sender Mode: ${
    process.env.SEMAPHORE_USE_SENDER === 'true' 
      ? `Custom (${process.env.SEMAPHORE_SENDER_NAME || 'None'})` 
      : 'Official'
  }`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
