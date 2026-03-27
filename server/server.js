import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..')));

app.post('/api/summary', async (req, res) => {
    const { prompt, model = 'gemini-2.5-flash' } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
    }

    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt가 비어 있습니다.' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data?.error?.message || 'Gemini API 호출 실패'
            });
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        res.json({ text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || '서버 오류' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
