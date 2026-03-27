import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noticesFilePath = path.join(__dirname, 'data', 'notices.json');

const defaultNotices = [
    {
        id: 1,
        title: "2026 만우절 사전 이벤트 'ㄴr ㅅr실 할말 있oł...'",
        host: '문화소통국',
        target: '전체',
        deadline: '2026-03-28',
        content:
            '안녕하세요, 문화소통국입니다.\\n만우절 사전 이벤트를 진행합니다.\\n(참여 링크: https://forms.gle/test)\\n많관부!',
        aiSummary: ['만우절 맞이 익명 고백 이벤트 진행', '구글폼 링크를 통해 참여 가능', '추첨 통해 상품권 지급'],
        images: [],
        views: 124
    }
];

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    const allowedOrigin = process.env.FRONTEND_ORIGIN;
    if (allowedOrigin) {
        res.header('Access-Control-Allow-Origin', allowedOrigin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

async function ensureNoticesFile() {
    try {
        await fs.access(noticesFilePath);
    } catch {
        await fs.mkdir(path.dirname(noticesFilePath), { recursive: true });
        await fs.writeFile(noticesFilePath, JSON.stringify(defaultNotices, null, 2), 'utf-8');
    }
}

async function readNotices() {
    await ensureNoticesFile();
    const text = await fs.readFile(noticesFilePath, 'utf-8');

    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeNotices(notices) {
    await fs.mkdir(path.dirname(noticesFilePath), { recursive: true });
    await fs.writeFile(noticesFilePath, JSON.stringify(notices, null, 2), 'utf-8');
}

function normalizeNoticeInput(body = {}) {
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const target = String(body.target || '전체').trim() || '전체';
    const host = String(body.host || '기타').trim() || '기타';
    const deadline = String(body.deadline || '').trim();
    const aiSummary = Array.isArray(body.aiSummary)
        ? body.aiSummary.map(item => String(item || '').trim()).filter(Boolean).slice(0, 3)
        : [];
    const images = Array.isArray(body.images)
        ? body.images.map(item => String(item || '')).filter(Boolean).slice(0, 20)
        : [];

    return {
        title,
        content,
        target,
        host,
        deadline,
        aiSummary,
        images
    };
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

app.get('/api/notices', async (req, res) => {
    try {
        const notices = await readNotices();
        notices.sort((a, b) => Number(b.id) - Number(a.id));
        res.json({ notices });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 조회 실패' });
    }
});

app.post('/api/notices', async (req, res) => {
    try {
        const payload = normalizeNoticeInput(req.body || {});

        if (!payload.title || !payload.content) {
            return res.status(400).json({ error: 'title과 content는 필수입니다.' });
        }

        const notices = await readNotices();
        const newNotice = {
            id: Date.now(),
            ...payload,
            views: 0
        };
        notices.unshift(newNotice);
        await writeNotices(notices);
        res.status(201).json({ notice: newNotice });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 등록 실패' });
    }
});

app.put('/api/notices/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const payload = normalizeNoticeInput(req.body || {});
        if (!payload.title || !payload.content) {
            return res.status(400).json({ error: 'title과 content는 필수입니다.' });
        }

        const notices = await readNotices();
        const idx = notices.findIndex(n => Number(n.id) === id);
        if (idx === -1) {
            return res.status(404).json({ error: '공지 없음' });
        }

        const prev = notices[idx];
        const updated = {
            ...prev,
            ...payload,
            id: prev.id,
            views: Number(prev.views) || 0
        };
        notices[idx] = updated;
        await writeNotices(notices);
        res.json({ notice: updated });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 수정 실패' });
    }
});

app.delete('/api/notices/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const notices = await readNotices();
        const next = notices.filter(n => Number(n.id) !== id);

        if (next.length === notices.length) {
            return res.status(404).json({ error: '공지 없음' });
        }

        await writeNotices(next);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 삭제 실패' });
    }
});

app.post('/api/notices/:id/view', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const notices = await readNotices();
        const idx = notices.findIndex(n => Number(n.id) === id);
        if (idx === -1) {
            return res.status(404).json({ error: '공지 없음' });
        }

        notices[idx].views = (Number(notices[idx].views) || 0) + 1;
        await writeNotices(notices);
        res.json({ notice: notices[idx] });
    } catch (error) {
        res.status(500).json({ error: error.message || '조회수 반영 실패' });
    }
});

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
