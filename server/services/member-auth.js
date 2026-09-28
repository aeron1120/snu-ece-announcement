import crypto from 'node:crypto';
import { Router } from 'express';
import { readCookie, getGoogleAuthConfig, isAdminEmail } from './google-admin-auth.js';
import { parseSnuProfile } from './snu-profile.js';
import { ECE_STAFF } from '../config/ece-staff.js';

const COOKIE = 'ece_member_session';
const TTL = 8 * 60 * 60 * 1000;
export function createMemberAuth({ store, resolveAdminSession }) {
    const sessions = new Map();
    const router = Router();
    function cookie(res, value, maxAge = TTL / 1000) {
        const policy = process.env.NODE_ENV === 'production' ? 'SameSite=None; Secure' : 'SameSite=Lax';
        res.append('Set-Cookie', `${COOKIE}=${value}; HttpOnly; ${policy}; Path=/; Max-Age=${maxAge}`);
    }
    const cleanup = setInterval(() => {
        for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(id);
    }, TTL);
    cleanup.unref();
    async function resolve(req) {
        const admin = await resolveAdminSession(req);
        if (admin) return { email: admin.email, status: 'approved', admin: true, profile: admin.profile || {} };
        const id = readCookie(req, COOKIE);
        const session = sessions.get(id);
        if (!session || session.expiresAt <= Date.now()) { sessions.delete(id); return null; }
        const member = await store.get(session.email);
        if (!member || member.subject !== session.subject) return null;
        return { email: member.email, status: member.status, profile: member.profile, admin: false };
    }
    async function onLogin(req, res, identity) {
        const member = await store.register({ email: identity.email, subject: identity.subject,
            profile: parseSnuProfile(identity.name) },
        ECE_STAFF.some(row => row.email === identity.email) || isAdminEmail(identity.email) ? 'approved' : 'pending');
        sessions.delete(readCookie(req, COOKIE));
        const id = crypto.randomBytes(32).toString('base64url');
        sessions.set(id, { email: identity.email, subject: identity.subject, expiresAt: Date.now() + TTL });
        cookie(res, id);
        return member.status;
    }
    router.use(['/api/member', '/api/admin/members'], (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use('/api', (req, res, next) => {
        if (readCookie(req, COOKIE) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin')) {
            const config = getGoogleAuthConfig();
            const allowed = config ? [config.frontendOrigin, new URL(config.redirectUri).origin] : [];
            if (!allowed.includes(req.get('Origin'))) return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
        }
        next();
    });
    router.get('/api/member/session', async (req, res) => {
        try {
            const member = await resolve(req);
            if (!member) return res.status(401).json({ authenticated: false });
            res.json({ authenticated: true, ...member });
        } catch { res.status(503).json({ error: '소속 확인 서비스를 사용할 수 없습니다.' }); }
    });
    function clearSession(req, res) {
        sessions.delete(readCookie(req, COOKIE));
        cookie(res, '', 0);
    }
    router.delete('/api/member/session', (req, res) => {
        clearSession(req, res);
        res.sendStatus(204);
    });
    router.use('/api/admin/members', async (req, res, next) => {
        if (!await resolveAdminSession(req)) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
        next();
    });
    router.get('/api/admin/members', async (req, res) => {
        try { res.json({ members: await store.list() }); }
        catch { res.status(503).json({ error: '구성원 목록을 불러오지 못했습니다.' }); }
    });
    router.patch('/api/admin/members/:email', async (req, res) => {
        if (!['approved', 'denied', 'pending'].includes(req.body?.status)) return res.status(400).json({ error: '잘못된 승인 상태입니다.' });
        if (isAdminEmail(req.params.email)) return res.status(400).json({ error: '관리자 권한은 지정된 계정 목록에서 관리합니다.' });
        try {
            const admin = await resolveAdminSession(req);
            const member = await store.review(req.params.email, req.body.status, admin.email);
            if (!member) return res.sendStatus(404);
            res.json({ member });
        } catch { res.status(503).json({ error: '승인 상태를 저장하지 못했습니다.' }); }
    });
    async function requireMember(req, res, next) {
        res.set('Cache-Control', 'no-store');
        try {
            const member = await resolve(req);
            if (!member) return res.status(401).json({ code: 'MEMBER_LOGIN_REQUIRED', error: '서울대학교 계정으로 로그인해주세요.' });
            if (member.status !== 'approved') return res.status(403).json({ code: 'MEMBER_APPROVAL_REQUIRED', error: '전기정보공학부 소속 확인이 필요합니다.' });
            req.member = member;
            next();
        } catch { res.status(503).json({ error: '소속을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
    }
    return { router, onLogin, requireMember, clearSession };
}
