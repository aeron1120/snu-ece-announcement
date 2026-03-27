import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noticesFilePath = path.join(__dirname, 'data', 'notices.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_NOTICES_TABLE = process.env.SUPABASE_NOTICES_TABLE || 'notices';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = useSupabase ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

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
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
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

function normalizeDeadline(deadline) {
    const value = String(deadline || '').trim();
    return value ? value : null;
}

function toClientNotice(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        title: row.title || '',
        content: row.content || '',
        target: row.target || '전체',
        host: row.host || '기타',
        deadline: row.deadline || '',
        aiSummary: Array.isArray(row.ai_summary) ? row.ai_summary : [],
        images: Array.isArray(row.images) ? row.images : [],
        views: Number(row.views) || 0,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function getAdminToken(req) {
    return String(req.headers['x-admin-token'] || '').trim();
}

function requireAdmin(req, res, next) {
    if (!ADMIN_TOKEN) {
        return res.status(500).json({ error: 'ADMIN_TOKEN이 설정되지 않았습니다.' });
    }

    const token = getAdminToken(req);
    if (!token || token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: '관리자 인증 실패' });
    }

    next();
}

async function ensureDefaultData() {
    if (!useSupabase) {
        await ensureNoticesFile();
        return;
    }

    const { count, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false);

    if (error) {
        throw error;
    }

    if ((count || 0) > 0) {
        return;
    }

    const seedRows = defaultNotices.map(notice => ({
        title: notice.title,
        content: notice.content,
        target: notice.target,
        host: notice.host,
        deadline: normalizeDeadline(notice.deadline),
        ai_summary: notice.aiSummary,
        images: notice.images,
        views: notice.views,
        is_deleted: false
    }));

    const { error: insertError } = await supabase.from(SUPABASE_NOTICES_TABLE).insert(seedRows);
    if (insertError) {
        throw insertError;
    }
}

async function listNotices() {
    if (!useSupabase) {
        const notices = await readNotices();
        return notices
            .filter(notice => !notice.isDeleted)
            .sort((a, b) => Number(b.id) - Number(a.id));
    }

    const { data, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map(toClientNotice);
}

async function createNotice(payload) {
    if (!useSupabase) {
        const notices = await readNotices();
        const newNotice = { id: Date.now(), ...payload, views: 0 };
        notices.unshift(newNotice);
        await writeNotices(notices);
        return newNotice;
    }

    const { data, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .insert({
            title: payload.title,
            content: payload.content,
            target: payload.target,
            host: payload.host,
            deadline: normalizeDeadline(payload.deadline),
            ai_summary: payload.aiSummary,
            images: payload.images,
            views: 0,
            is_deleted: false
        })
        .select('*')
        .single();

    if (error) {
        throw error;
    }

    return toClientNotice(data);
}

async function updateNotice(id, payload) {
    if (!useSupabase) {
        const notices = await readNotices();
        const idx = notices.findIndex(n => Number(n.id) === id);
        if (idx === -1) {
            return null;
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
        return updated;
    }

    const { data, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .update({
            title: payload.title,
            content: payload.content,
            target: payload.target,
            host: payload.host,
            deadline: normalizeDeadline(payload.deadline),
            ai_summary: payload.aiSummary,
            images: payload.images,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('is_deleted', false)
        .select('*')
        .single();

    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    return data ? toClientNotice(data) : null;
}

async function softDeleteNotice(id) {
    if (!useSupabase) {
        const notices = await readNotices();
        const idx = notices.findIndex(n => Number(n.id) === id);
        if (idx === -1) {
            return false;
        }

        notices[idx] = {
            ...notices[idx],
            isDeleted: true,
            deletedAt: new Date().toISOString()
        };
        await writeNotices(notices);
        return true;
    }

    const { data, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('is_deleted', false)
        .select('id');

    if (error) {
        throw error;
    }

    return Array.isArray(data) && data.length > 0;
}

async function incrementViewCount(id) {
    if (!useSupabase) {
        const notices = await readNotices();
        const idx = notices.findIndex(n => Number(n.id) === id && !n.isDeleted);
        if (idx === -1) {
            return null;
        }

        notices[idx].views = (Number(notices[idx].views) || 0) + 1;
        await writeNotices(notices);
        return notices[idx];
    }

    const { data, error } = await supabase.rpc('increment_notice_views', {
        target_notice_id: id
    });

    if (error) {
        throw error;
    }

    if (!Array.isArray(data) || data.length === 0) {
        return null;
    }

    return toClientNotice(data[0]);
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true, storage: useSupabase ? 'supabase' : 'file' });
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
    res.json({ ok: true });
});

app.get('/api/notices', async (req, res) => {
    try {
        const notices = await listNotices();
        res.json({ notices });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 조회 실패' });
    }
});

app.post('/api/notices', requireAdmin, async (req, res) => {
    try {
        const payload = normalizeNoticeInput(req.body || {});

        if (!payload.title || !payload.content) {
            return res.status(400).json({ error: 'title과 content는 필수입니다.' });
        }

        const newNotice = await createNotice(payload);
        res.status(201).json({ notice: newNotice });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 등록 실패' });
    }
});

app.put('/api/notices/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const payload = normalizeNoticeInput(req.body || {});
        if (!payload.title || !payload.content) {
            return res.status(400).json({ error: 'title과 content는 필수입니다.' });
        }

        const updated = await updateNotice(id, payload);
        if (!updated) {
            return res.status(404).json({ error: '공지 없음' });
        }

        res.json({ notice: updated });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 수정 실패' });
    }
});

app.delete('/api/notices/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const deleted = await softDeleteNotice(id);
        if (!deleted) {
            return res.status(404).json({ error: '공지 없음' });
        }

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

        const notice = await incrementViewCount(id);
        if (!notice) {
            return res.status(404).json({ error: '공지 없음' });
        }

        res.json({ notice });
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

ensureDefaultData()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT} (storage: ${useSupabase ? 'supabase' : 'file'})`);
        });
    })
    .catch(error => {
        console.error('초기화 실패:', error);
        process.exit(1);
    });
