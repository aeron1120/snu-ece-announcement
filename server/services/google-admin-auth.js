import crypto from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';

export const ADMIN_EMAILS = Object.freeze([
    'aeron1120@snu.ac.kr',
    'legojmon@snu.ac.kr',
    'minjunchoi@snu.ac.kr'
]);

export function isAdminEmail(email) {
    return typeof email === 'string' && ADMIN_EMAILS.includes(email.toLowerCase());
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
export function createGoogleAdminAuthRouter({ onLogin, limiter }) {
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
            edit: typeof req.query.edit === 'string' ? req.query.edit.slice(0, 100) : '',
            expiresAt: Date.now() + ttl
        });
        cookie(res, binding, config);
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
            client_id: config.clientId, redirect_uri: config.redirectUri,
            response_type: 'code', scope: 'openid email', prompt: 'select_account',
            state, nonce, code_challenge_method: 'S256',
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
        }).toString();
        res.redirect(302, url.href);
    });
    router.get('/api/auth/google/callback', limiter, async (req, res) => {
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
            const url = new URL('/admin-login.html', config.frontendOrigin);
            url.searchParams.set('error', reason);
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
                || payload.email_verified !== true || payload.hd !== 'snu.ac.kr'
                || !isAdminEmail(payload.email)) return failure('not_allowed');
            onLogin(req, res, { email: payload.email.toLowerCase(), subject: payload.sub });
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
