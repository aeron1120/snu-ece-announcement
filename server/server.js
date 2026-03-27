import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import cron from 'node-cron';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noticesFilePath = path.join(__dirname, 'data', 'notices.json');
const settingsFilePath = path.join(__dirname, 'data', 'settings.json');
const bannerFilePath = path.join(__dirname, 'data', 'banner-slides.json');
const SUPER_ADMIN_TOKEN = process.env.SUPER_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
const NOTICE_ADMIN_TOKEN = process.env.NOTICE_ADMIN_TOKEN || '0327';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_NOTICES_TABLE = process.env.SUPABASE_NOTICES_TABLE || 'notices';
const SUPABASE_SETTINGS_TABLE = process.env.SUPABASE_SETTINGS_TABLE || 'app_settings';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = useSupabase ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
let bannerStorageMode = useSupabase ? 'supabase' : 'file';
const initialNoticeAdminToken = NOTICE_ADMIN_TOKEN;

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

const defaultBannerSlides = [
    {
        name: '스타트업 부트캠프 모집',
        text: '📢 [광고] 교내 스타트업 부트캠프 참가자 모집 (~4/7)',
        bgStyle: 'background: linear-gradient(90deg, #eff6ff, #dbeafe);',
        textColor: '#1e40af',
        src: null,
        order: 0
    },
    {
        name: '글로벌 교환학생 설명회',
        text: '🎓 글로벌 교환학생 설명회 안내 D-5 (신청필수)',
        bgStyle: 'background: linear-gradient(90deg, #fdf4ff, #fae8ff);',
        textColor: '#86198f',
        src: null,
        order: 1
    },
    {
        name: 'AI 아이디어톤 모집',
        text: '💻 [홍보] 총학생회 주관 AI 아이디어톤 2026 모집중!',
        bgStyle: 'background: linear-gradient(90deg, #ecfdf5, #d1fae5);',
        textColor: '#065f46',
        src: null,
        order: 2
    }
];

const defaultAdminInfo = {
    name: 'ECE 학생회장 (이름 : 박지호)',
    phone: '010-1234-5678',
    kakao: 'snu_ece_pres'
};

const defaultBannerInfo = {
    name: '학생회 대외협력국 (국장 : 이배너)',
    phone: '010-8888-9999',
    kakao: 'snu_ece_ads'
};

const defaultSecuritySettings = {
    adminInfo: { ...defaultAdminInfo },
    bannerInfo: { ...defaultBannerInfo },
    bannerPassword: '1234',
    adminTokenHash: hashToken(initialNoticeAdminToken)
};

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    const allowedOrigin = process.env.FRONTEND_ORIGIN;
    if (allowedOrigin) {
        res.header('Access-Control-Allow-Origin', allowedOrigin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-super-admin-token, x-banner-token');
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

async function ensureSettingsFile() {
    try {
        await fs.access(settingsFilePath);
    } catch {
        await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
        await fs.writeFile(settingsFilePath, JSON.stringify(defaultSecuritySettings, null, 2), 'utf-8');
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

async function readSettingsFile() {
    await ensureSettingsFile();
    const text = await fs.readFile(settingsFilePath, 'utf-8');

    try {
        const parsed = JSON.parse(text);
        return {
            adminInfo: {
                name: String(parsed?.adminInfo?.name || defaultAdminInfo.name),
                phone: String(parsed?.adminInfo?.phone || defaultAdminInfo.phone),
                kakao: String(parsed?.adminInfo?.kakao || defaultAdminInfo.kakao)
            },
            bannerInfo: {
                name: String(parsed?.bannerInfo?.name || defaultBannerInfo.name),
                phone: String(parsed?.bannerInfo?.phone || defaultBannerInfo.phone),
                kakao: String(parsed?.bannerInfo?.kakao || defaultBannerInfo.kakao)
            },
            bannerPassword: String(parsed?.bannerPassword || defaultSecuritySettings.bannerPassword),
            adminTokenHash: String(parsed?.adminTokenHash || defaultSecuritySettings.adminTokenHash)
        };
    } catch {
        return { ...defaultSecuritySettings, adminInfo: { ...defaultAdminInfo } };
    }
}

async function writeSettingsFile(settings) {
    await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
    await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2), 'utf-8');
}

function isMissingBannerTableError(error) {
    if (!error) return false;
    const message = String(error?.message || '');
    return error.code === 'PGRST205' || message.includes('banner_slides');
}

function createDefaultBannerFileRows() {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return defaultBannerSlides.map((slide, index) => ({
        id: index + 1,
        name: slide.name,
        text: slide.text,
        bgStyle: slide.bgStyle,
        textColor: slide.textColor,
        src: slide.src,
        order: Number.isFinite(Number(slide.order)) ? Number(slide.order) : index,
        createdAt: new Date(now + index).toISOString(),
        expiresAt: new Date(now + sevenDaysMs).toISOString(),
        isDeleted: false
    }));
}

async function ensureBannerFile() {
    try {
        await fs.access(bannerFilePath);
    } catch {
        await fs.mkdir(path.dirname(bannerFilePath), { recursive: true });
        await fs.writeFile(bannerFilePath, JSON.stringify(createDefaultBannerFileRows(), null, 2), 'utf-8');
    }
}

async function readBannerFile() {
    await ensureBannerFile();
    const text = await fs.readFile(bannerFilePath, 'utf-8');

    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeBannerFile(slides) {
    await fs.mkdir(path.dirname(bannerFilePath), { recursive: true });
    await fs.writeFile(bannerFilePath, JSON.stringify(slides, null, 2), 'utf-8');
}

async function switchBannerStorageToFile(error) {
    if (bannerStorageMode === 'file') return;
    bannerStorageMode = 'file';
    await ensureBannerFile();
    console.warn('banner_slides 테이블을 찾지 못해 파일 저장소로 전환:', error?.message || error);
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

function normalizeAdminInfo(input = {}) {
    return {
        name: String(input.name || '').trim() || defaultAdminInfo.name,
        phone: String(input.phone || '').trim() || defaultAdminInfo.phone,
        kakao: String(input.kakao || '').trim() || defaultAdminInfo.kakao
    };
}

function normalizeBannerInfo(input = {}) {
    return {
        name: String(input.name || '').trim() || defaultBannerInfo.name,
        phone: String(input.phone || '').trim() || defaultBannerInfo.phone,
        kakao: String(input.kakao || '').trim() || defaultBannerInfo.kakao
    };
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
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

function getHeaderToken(req, headerName) {
    return String(req.headers[headerName] || '').trim();
}

function toClientSettings(settings) {
    return {
        adminInfo: normalizeAdminInfo(settings?.adminInfo || {}),
        bannerInfo: normalizeBannerInfo(settings?.bannerInfo || {})
    };
}

async function getSecuritySettings() {
    if (!useSupabase) {
        return readSettingsFile();
    }

    const { data, error } = await supabase
        .from(SUPABASE_SETTINGS_TABLE)
        .select('*')
        .eq('id', 1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            const seeded = {
                adminInfo: { ...defaultAdminInfo },
                bannerInfo: { ...defaultBannerInfo },
                bannerPassword: defaultSecuritySettings.bannerPassword,
                adminTokenHash: defaultSecuritySettings.adminTokenHash
            };
            await saveSecuritySettings(seeded);
            return seeded;
        }
        throw error;
    }

    return {
        adminInfo: {
            name: String(data.admin_name || defaultAdminInfo.name),
            phone: String(data.admin_phone || defaultAdminInfo.phone),
            kakao: String(data.admin_kakao || defaultAdminInfo.kakao)
        },
        bannerInfo: {
            name: String(data.banner_admin_name || defaultBannerInfo.name),
            phone: String(data.banner_admin_phone || defaultBannerInfo.phone),
            kakao: String(data.banner_admin_kakao || defaultBannerInfo.kakao)
        },
        bannerPassword: String(data.banner_password || defaultSecuritySettings.bannerPassword),
        adminTokenHash: String(data.admin_token_hash || defaultSecuritySettings.adminTokenHash)
    };
}

async function saveSecuritySettings(settings) {
    const normalized = {
        adminInfo: normalizeAdminInfo(settings?.adminInfo || {}),
        bannerInfo: normalizeBannerInfo(settings?.bannerInfo || {}),
        bannerPassword: String(settings?.bannerPassword || defaultSecuritySettings.bannerPassword),
        adminTokenHash: String(settings?.adminTokenHash || defaultSecuritySettings.adminTokenHash)
    };

    if (!useSupabase) {
        await writeSettingsFile(normalized);
        return normalized;
    }

    const { error } = await supabase.from(SUPABASE_SETTINGS_TABLE).upsert({
        id: 1,
        admin_name: normalized.adminInfo.name,
        admin_phone: normalized.adminInfo.phone,
        admin_kakao: normalized.adminInfo.kakao,
        banner_admin_name: normalized.bannerInfo.name,
        banner_admin_phone: normalized.bannerInfo.phone,
        banner_admin_kakao: normalized.bannerInfo.kakao,
        banner_password: normalized.bannerPassword,
        admin_token_hash: normalized.adminTokenHash,
        updated_at: new Date().toISOString()
    });

    if (error) {
        throw error;
    }

    return normalized;
}

async function requireNoticeAdmin(req, res, next) {
    try {
        const token = getHeaderToken(req, 'x-admin-token');
        if (!token) {
            return res.status(401).json({ error: '관리자 인증 실패' });
        }

        const settings = await getSecuritySettings();
        const expectedHash = settings?.adminTokenHash || defaultSecuritySettings.adminTokenHash;

        if (hashToken(token) !== expectedHash) {
            return res.status(401).json({ error: '관리자 인증 실패' });
        }

        next();
    } catch (error) {
        res.status(500).json({ error: error.message || '관리자 인증 처리 실패' });
    }
}

async function requireBannerAdmin(req, res, next) {
    try {
        const token = getHeaderToken(req, 'x-banner-token');
        if (!token) {
            return res.status(401).json({ error: '배너 관리자 인증 실패' });
        }

        const settings = await getSecuritySettings();
        const expected = String(settings?.bannerPassword || defaultSecuritySettings.bannerPassword);

        if (token !== expected) {
            return res.status(401).json({ error: '배너 관리자 인증 실패' });
        }

        next();
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 관리자 인증 처리 실패' });
    }
}

function requireSuperAdmin(req, res, next) {
    if (!SUPER_ADMIN_TOKEN) {
        return res.status(500).json({ error: 'SUPER_ADMIN_TOKEN이 설정되지 않았습니다.' });
    }

    const token = getHeaderToken(req, 'x-super-admin-token');
    if (!token || token !== SUPER_ADMIN_TOKEN) {
        return res.status(401).json({ error: '절대 관리자 인증 실패' });
    }

    next();
}

async function ensureDefaultData() {
    if (!useSupabase) {
        await ensureNoticesFile();
        await ensureSettingsFile();
        await ensureBannerFile();
        return;
    }

    const { count, error } = await supabase
        .from(SUPABASE_NOTICES_TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false);

    if (error) {
        throw error;
    }

    if ((count || 0) === 0) {
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

    const { count: bannerCount, error: bannerCountError } = await supabase
        .from('banner_slides')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gt('expires_at', new Date().toISOString());

    if (bannerCountError) {
        if (isMissingBannerTableError(bannerCountError)) {
            await switchBannerStorageToFile(bannerCountError);
        } else {
            console.warn('기본 배너 시딩 스킵:', bannerCountError.message || bannerCountError);
        }
    }

    if (!bannerCountError && (bannerCount || 0) === 0) {
        const sevenDaysLater = new Date();
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const bannerSeedRows = defaultBannerSlides.map(slide => ({
            name: slide.name,
            text: slide.text,
            bg_style: slide.bgStyle,
            text_color: slide.textColor,
            src: slide.src,
            order: slide.order,
            expires_at: sevenDaysLater.toISOString(),
            is_deleted: false
        }));

        const { error: bannerInsertError } = await supabase.from('banner_slides').insert(bannerSeedRows);
        if (bannerInsertError) {
            throw bannerInsertError;
        }
    }

    await getSecuritySettings();
}

function initializeBannerCleanupCron() {
    if (!useSupabase) {
        console.log('배너 자동 정리 크론: Supabase 미사용 (파일 모드), 스킵됨');
        return;
    }

    // 매일 자정에 만료된 배너 정리
    cron.schedule('0 0 * * *', async () => {
        console.log('[배너 크론 작업] 만료된 배너 정리 시작...');
        await cleanupExpiredBanners();
    });

    console.log('[배너 크론 작업] 활성화됨 (매일 자정)');
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

async function listBannerSlides() {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const nowIso = new Date().toISOString();
        return rows
            .filter(row => !row?.isDeleted && (!row?.expiresAt || row.expiresAt > nowIso))
            .sort((a, b) => {
                const orderDiff = (Number(a?.order) || 0) - (Number(b?.order) || 0);
                if (orderDiff !== 0) return orderDiff;
                return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
            })
            .map(toClientBannerSlide);
    }

    const { data, error } = await supabase
        .from('banner_slides')
        .select('*')
        .eq('is_deleted', false)
        .gt('expires_at', new Date().toISOString())
        .order('order', { ascending: true })
        .order('created_at', { ascending: false });

    if (error) {
        if (isMissingBannerTableError(error)) {
            await switchBannerStorageToFile(error);
            return listBannerSlides();
        }
        throw error;
    }

    return Array.isArray(data) ? data.map(toClientBannerSlide) : [];
}

async function createBannerSlide(payload) {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const nextId = rows.reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0) + 1;
        const sevenDaysLater = new Date();
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const row = {
            id: nextId,
            name: String(payload.name || '').trim(),
            text: String(payload.text || '').trim(),
            bgStyle: String(payload.bgStyle || '').trim(),
            textColor: String(payload.textColor || '').trim(),
            src: payload.src || null,
            order: Number(payload.order) || 0,
            createdAt: new Date().toISOString(),
            expiresAt: sevenDaysLater.toISOString(),
            isDeleted: false
        };

        rows.push(row);
        await writeBannerFile(rows);
        return toClientBannerSlide(row);
    }

    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const { data, error } = await supabase
        .from('banner_slides')
        .insert({
            name: String(payload.name || '').trim(),
            text: String(payload.text || '').trim(),
            bg_style: String(payload.bgStyle || '').trim(),
            text_color: String(payload.textColor || '').trim(),
            src: payload.src || null,
            order: Number(payload.order) || 0,
            expires_at: sevenDaysLater.toISOString(),
            is_deleted: false
        })
        .select('*')
        .single();

    if (error) {
        if (isMissingBannerTableError(error)) {
            await switchBannerStorageToFile(error);
            return createBannerSlide(payload);
        }
        throw error;
    }

    return toClientBannerSlide(data);
}

async function updateBannerSlide(id, payload) {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const idx = rows.findIndex(row => Number(row?.id) === id && !row?.isDeleted);
        if (idx === -1) return null;

        const sevenDaysLater = new Date();
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        rows[idx] = {
            ...rows[idx],
            name: String(payload.name || '').trim(),
            text: String(payload.text || '').trim(),
            bgStyle: String(payload.bgStyle || '').trim() || rows[idx].bgStyle || '',
            textColor: String(payload.textColor || '').trim(),
            src: payload.src || null,
            order: Number(payload.order) || 0,
            expiresAt: sevenDaysLater.toISOString()
        };

        await writeBannerFile(rows);
        return toClientBannerSlide(rows[idx]);
    }

    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const { data, error } = await supabase
        .from('banner_slides')
        .update({
            name: String(payload.name || '').trim(),
            text: String(payload.text || '').trim(),
            bg_style: String(payload.bgStyle || '').trim(),
            text_color: String(payload.textColor || '').trim(),
            src: payload.src || null,
            order: Number(payload.order) || 0,
            expires_at: sevenDaysLater.toISOString()
        })
        .eq('id', id)
        .eq('is_deleted', false)
        .select('*')
        .single();

    if (error && error.code !== 'PGRST116') {
        if (isMissingBannerTableError(error)) {
            await switchBannerStorageToFile(error);
            return updateBannerSlide(id, payload);
        }
        throw error;
    }

    return data ? toClientBannerSlide(data) : null;
}

async function reorderBannerSlides(items) {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const normalized = Array.isArray(items)
            ? items
                .map(item => ({ id: Number(item?.id), order: Number(item?.order) }))
                .filter(item => Number.isFinite(item.id) && Number.isFinite(item.order))
            : [];

        if (normalized.length === 0) {
            return listBannerSlides();
        }

        const orderMap = new Map(normalized.map(item => [item.id, item.order]));
        const nextRows = rows.map(row => {
            const id = Number(row?.id);
            if (!orderMap.has(id)) return row;
            return { ...row, order: orderMap.get(id) };
        });

        await writeBannerFile(nextRows);
        return listBannerSlides();
    }

    const normalized = Array.isArray(items)
        ? items
            .map(item => ({ id: Number(item?.id), order: Number(item?.order) }))
            .filter(item => Number.isFinite(item.id) && Number.isFinite(item.order))
        : [];

    if (normalized.length === 0) {
        return [];
    }

    for (const item of normalized) {
        const { error } = await supabase
            .from('banner_slides')
            .update({ order: item.order })
            .eq('id', item.id)
            .eq('is_deleted', false);

        if (error) {
            if (isMissingBannerTableError(error)) {
                await switchBannerStorageToFile(error);
                return reorderBannerSlides(items);
            }
            throw error;
        }
    }

    return listBannerSlides();
}

async function softDeleteBannerSlide(id) {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const idx = rows.findIndex(row => Number(row?.id) === id && !row?.isDeleted);
        if (idx === -1) return false;
        rows[idx] = { ...rows[idx], isDeleted: true };
        await writeBannerFile(rows);
        return true;
    }

    const { data, error } = await supabase
        .from('banner_slides')
        .update({ is_deleted: true })
        .eq('id', id)
        .eq('is_deleted', false)
        .select('id');

    if (error) {
        if (isMissingBannerTableError(error)) {
            await switchBannerStorageToFile(error);
            return softDeleteBannerSlide(id);
        }
        throw error;
    }

    return Array.isArray(data) && data.length > 0;
}

async function cleanupExpiredBanners() {
    if (!useSupabase || bannerStorageMode === 'file') {
        const rows = await readBannerFile();
        const nowIso = new Date().toISOString();
        const nextRows = rows.map(row => {
            if (row?.isDeleted) return row;
            if (!row?.expiresAt) return row;
            if (String(row.expiresAt) > nowIso) return row;
            return { ...row, isDeleted: true };
        });
        await writeBannerFile(nextRows);
        return;
    }

    try {
        const { error } = await supabase
            .from('banner_slides')
            .update({ is_deleted: true })
            .lt('expires_at', new Date().toISOString())
            .eq('is_deleted', false);

        if (error) {
            if (isMissingBannerTableError(error)) {
                await switchBannerStorageToFile(error);
                await cleanupExpiredBanners();
                return;
            }
            console.error('배너 자동 정리 오류:', error);
        } else {
            console.log('매료된 배너가 자동 정리되었습니다.');
        }
    } catch (error) {
        console.error('배너 자동 정리 중 오류 발생:', error);
    }
}

function toClientBannerSlide(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        name: row.name || '',
        text: row.text || '',
        bgStyle: row.bg_style || row.bgStyle || '',
        textColor: row.text_color || row.textColor || '',
        src: row.src || null,
        order: Number(row.order) || 0,
        expiresAt: row.expires_at || row.expiresAt || null
    };
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true, storage: useSupabase ? 'supabase' : 'file', bannerStorage: bannerStorageMode });
});

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await getSecuritySettings();
        res.json(toClientSettings(settings));
    } catch (error) {
        res.status(500).json({ error: error.message || '설정 조회 실패' });
    }
});

app.post('/api/admin/verify', requireNoticeAdmin, (req, res) => {
    res.json({ ok: true });
});

app.post('/api/super-admin/verify', requireSuperAdmin, (req, res) => {
    res.json({ ok: true });
});

app.post('/api/banner/verify', async (req, res) => {
    try {
        const inputPassword = String(req.body?.password || '').trim();
        const settings = await getSecuritySettings();
        const ok = inputPassword && inputPassword === settings.bannerPassword;
        if (!ok) {
            return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 인증 실패' });
    }
});

app.put('/api/settings', requireSuperAdmin, async (req, res) => {
    try {
        const current = await getSecuritySettings();
        const next = {
            ...current,
            adminInfo: normalizeAdminInfo(req.body?.adminInfo || current.adminInfo),
            bannerInfo: normalizeBannerInfo(req.body?.bannerInfo || current.bannerInfo)
        };

        const saved = await saveSecuritySettings(next);
        res.json(toClientSettings(saved));
    } catch (error) {
        res.status(500).json({ error: error.message || '관리자 정보 업데이트 실패' });
    }
});

app.put('/api/settings/passwords', requireSuperAdmin, async (req, res) => {
    try {
        const newNoticeAdminToken = String(req.body?.newNoticeAdminToken || req.body?.newAdminToken || '').trim();
        const newBannerPassword = String(req.body?.newBannerPassword || '').trim();

        if (!newNoticeAdminToken && !newBannerPassword) {
            return res.status(400).json({ error: '변경할 비밀번호가 없습니다.' });
        }

        const current = await getSecuritySettings();
        const next = {
            ...current,
            adminTokenHash: newNoticeAdminToken ? hashToken(newNoticeAdminToken) : current.adminTokenHash,
            bannerPassword: newBannerPassword || current.bannerPassword
        };

        await saveSecuritySettings(next);
        res.json({
            ok: true,
            noticeAdminTokenChanged: Boolean(newNoticeAdminToken),
            bannerPasswordChanged: Boolean(newBannerPassword)
        });
    } catch (error) {
        res.status(500).json({ error: error.message || '비밀번호 변경 실패' });
    }
});

app.get('/api/notices', async (req, res) => {
    try {
        const notices = await listNotices();
        res.json({ notices });
    } catch (error) {
        res.status(500).json({ error: error.message || '공지 조회 실패' });
    }
});

app.post('/api/notices', requireNoticeAdmin, async (req, res) => {
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

app.put('/api/notices/:id', requireNoticeAdmin, async (req, res) => {
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

app.delete('/api/notices/:id', requireNoticeAdmin, async (req, res) => {
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

app.get('/api/banner-slides', async (req, res) => {
    try {
        const slides = await listBannerSlides();
        res.json({ slides });
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 조회 실패' });
    }
});

app.post('/api/banner-slides', requireBannerAdmin, async (req, res) => {
    try {
        const payload = {
            name: String(req.body?.name || '').trim(),
            text: String(req.body?.text || '').trim(),
            bgStyle: String(req.body?.bgStyle || '').trim(),
            textColor: String(req.body?.textColor || '').trim(),
            src: req.body?.src || null,
            order: Number(req.body?.order) || 0
        };

        if (!payload.text && !payload.src) {
            return res.status(400).json({ error: '배너 텍스트 또는 이미지는 필수입니다.' });
        }

        const newSlide = await createBannerSlide(payload);
        res.status(201).json({ slide: newSlide });
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 등록 실패' });
    }
});

app.put('/api/banner-slides/reorder', requireBannerAdmin, async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (items.length === 0) {
            return res.status(400).json({ error: '순서 변경 항목이 없습니다.' });
        }

        const slides = await reorderBannerSlides(items);
        res.json({ slides });
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 순서 변경 실패' });
    }
});

app.put('/api/banner-slides/:id', requireBannerAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const payload = {
            name: String(req.body?.name || '').trim(),
            text: String(req.body?.text || '').trim(),
            bgStyle: String(req.body?.bgStyle || '').trim(),
            textColor: String(req.body?.textColor || '').trim(),
            src: req.body?.src || null,
            order: Number(req.body?.order) || 0
        };

        if (!payload.text && !payload.src) {
            return res.status(400).json({ error: '배너 텍스트 또는 이미지는 필수입니다.' });
        }

        const updated = await updateBannerSlide(id, payload);
        if (!updated) {
            return res.status(404).json({ error: '배너 없음' });
        }

        res.json({ slide: updated });
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 수정 실패' });
    }
});

app.delete('/api/banner-slides/:id', requireBannerAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        const deleted = await softDeleteBannerSlide(id);
        if (!deleted) {
            return res.status(404).json({ error: '배너 없음' });
        }

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message || '배너 삭제 실패' });
    }
});

ensureDefaultData()
    .then(() => {
        initializeBannerCleanupCron();
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT} (storage: ${useSupabase ? 'supabase' : 'file'})`);
        });
    })
    .catch(error => {
        console.error('초기화 실패:', error);
        process.exit(1);
    });
