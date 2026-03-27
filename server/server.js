import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

app.post("/api/summarize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    // 여기서 나중에 Gemini/OpenAI 호출
    return res.json({
      summary: `요약 결과 예시: ${text.slice(0, 100)}`
    });
  } catch (error) {
    return res.status(500).json({ error: "서버 오류" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});