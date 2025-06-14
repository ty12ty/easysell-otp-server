const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post("/send-otp", async (req, res) => {
  const { phoneNumber } = req.body;
  const apiKey = process.env.SEMAPHORE_API_KEY;
  const message = `DURANTGRACE: Pakigamit ang OTP {otp} to confirm your order. Expires in 5 minutes.`;

  try {
    const response = await axios.post(
      "https://api.semaphore.co/api/v4/otp",
      new URLSearchParams({
        apikey: apiKey,
        number: phoneNumber,
        message: message,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
