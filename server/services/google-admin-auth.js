import crypto from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { isTemporaryPublicAccessEnabled, isSnuGoogleAccount } from './member-access-policy.js';

export function isAdminEmail(email, env = process.env) {
    if (typeof email !== 'string' || !/^[^@\s,*]+@snu\.ac\.kr$/i.test(email)) return false;
    // No built-in accounts: an unset or empty list never grants administrator access.
    const admins = String(env.ADMIN_EMAILS || '').split(/[,\r\n]+/)
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[^@\s,*]+@snu\.ac\.kr$/.test(value));
    return admins.includes(email.toLowerCase());
}

export function readCookie(req, name) {
    for (const pair of String(req.headers.cookie || '').split(';')) {
        const [key, ...value] = pair.trim().split('=');
        if (key === name) {
            try { return decodeURIComponent(value.join('=')); } catch { return ''; }
        }
    }
    return '';
}

export function getGoogleAuthConfig(env = process.env) {
    const redirectUri = env.GOOGLE_REDIRECT_URI || '';
    const frontendUrl = env.FRONTEND_ORIGIN || 'http://localhost:3000';
    try {
        const callback = new URL(redirectUri);
        const frontend = new URL(frontendUrl);
        const safeUrl = url => !url.username && !url.password && !url.search && !url.hash
            && (url.protocol === 'https:' || (url.protocol === 'http:'
                && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
        if (!safeUrl(callback) || !safeUrl(frontend) || frontend.pathname !== '/'
            || callback.pathname !== '/api/auth/google/callback') return null;
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
        return {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: callback.href,
            frontendOrigin: frontend.origin,
            secure: callback.protocol === 'https:'
        };
    } catch { return null; }
}

// Authorization codes, PKCE verifiers and Google tokens stay on the API server.
export function createGoogleAdminAuthRouter({ onLogin, onMemberLogin, limiter }) {
    const router = Router();
    const attempts = new Map();
    const ttl = 10 * 60 * 1000;
    const cookieName = 'ece_google_oauth';
    const cookie = (res, value, config, maxAge = ttl / 1000) => res.append('Set-Cookie',
        `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`);
    const prune = () => {
        for (const [state, attempt] of attempts) {
            if (attempt.expiresAt <= Date.now()) attempts.delete(state);
        }
    };
    const cleanup = setInterval(prune, ttl);
    cleanup.unref();
    router.use('/api/auth/google', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        next();
    });
    router.get('/api/auth/google', limiter, (req, res) => {
        const config = getGoogleAuthConfig();
        if (!config) return res.status(503).send('Google 로그인 환경 변수가 설정되지 않았습니다.');
        prune();
        if (attempts.size >= 1000) return res.status(503).send('잠시 후 다시 시도해주세요.');
        const state = crypto.randomBytes(32).toString('base64url');
        const binding = crypto.randomBytes(32).toString('base64url');
        const nonce = crypto.randomBytes(32).toString('base64url');
        const verifier = crypto.randomBytes(32).toString('base64url');
        const previous = readCookie(req, cookieName);
        for (const [key, attempt] of attempts) {
            if (attempt.binding === previous) attempts.delete(key);
        }
        attempts.set(state, {
            binding, nonce, verifier, config,
            purpose: req.query.purpose === 'member' ? 'member' : 'admin',
            next: typeof req.query.next === 'string' && /^\/(?:index\.html|banner-inquiry(?:\.html)?)?(?:[?#]|$)/.test(req.query.next)
                ? req.query.next.slice(0, 2000) : '/',
            edit: typeof req.query.edit === 'string' ? req.query.edit.slice(0, 100) : '',
            expiresAt: Date.now() + ttl
        });
        cookie(res, binding, config);
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
            client_id: config.clientId, redirect_uri: config.redirectUri,
            response_type: 'code', scope: 'openid email profile', prompt: 'select_account', hd: 'snu.ac.kr',
            state, nonce, code_challenge_method: 'S256',
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
        }).toString();
        if (req.query.purpose === 'member' && isTemporaryPublicAccessEnabled()) url.searchParams.delete('hd');
        res.redirect(302, url.href);
    });
    // The start route limits admission. A single-use, browser-bound callback must
    // still finish when other users on the same IP exhaust that admission budget.
    router.get('/api/auth/google/callback', async (req, res) => {
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const attempt = attempts.get(state);
        if (!attempt || attempt.expiresAt <= Date.now()
            || attempt.binding !== readCookie(req, cookieName)) {
            return res.status(400).send('로그인 요청이 만료되었거나 유효하지 않습니다. 로그인 화면에서 다시 시작해주세요.');
        }
        attempts.delete(state); // One use, including denied or failed requests.
        const { config } = attempt;
        cookie(res, '', config, 0);
        const failure = reason => {
            const url = new URL(attempt.purpose === 'member' ? '/login.html' : '/admin-login.html', config.frontendOrigin);
            url.searchParams.set('error', reason);
            if (attempt.purpose === 'member') url.searchParams.set('next', attempt.next);
            if (attempt.edit) url.searchParams.set('edit', attempt.edit);
            return res.redirect(302, url.href);
        };
        if (req.query.error) return failure('cancelled');
        if (typeof req.query.code !== 'string' || !req.query.code) return failure('failed');
        try {
            const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
            const { tokens } = await client.getToken({
                code: req.query.code, codeVerifier: attempt.verifier,
                redirect_uri: config.redirectUri
            });
            if (!tokens.id_token) return failure('failed');
            // Library checks Google's signature, issuer, audience and expiry.
            const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
            const payload = ticket.getPayload();
            if (!payload?.sub || payload.nonce !== attempt.nonce
                || payload.email_verified !== true
                || typeof payload.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(payload.email)
                || ((!isTemporaryPublicAccessEnabled() || attempt.purpose === 'admin') && !isSnuGoogleAccount(payload))
                || (attempt.purpose === 'admin' && !isAdminEmail(payload.email))) return failure('not_allowed');
            const identity = { email: payload.email.toLowerCase(), subject: payload.sub, name: payload.name || '',
                snuAccount: isSnuGoogleAccount(payload) };
            const admin = identity.snuAccount && isAdminEmail(identity.email);
            if (admin) await onLogin(req, res, identity);
            if (attempt.purpose === 'member') {
                const status = admin ? 'approved' : await onMemberLogin(req, res, identity);
                const destination = new URL(status === 'approved' ? attempt.next : '/login.html', config.frontendOrigin);
                if (status !== 'approved') destination.searchParams.set('next', attempt.next);
                return res.redirect(302, destination.href);
            }
            const workspace = new URL('/admin.html', config.frontendOrigin);
            if (attempt.edit) workspace.searchParams.set('edit', attempt.edit);
            return res.redirect(302, workspace.href);
        } catch {
            // Never return provider tokens, authorization codes or client secrets in errors.
            return failure('failed');
        }
    });
    return router;
}
