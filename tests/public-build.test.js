import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preparePublic } from '../scripts/prepare-public.mjs';

test('preparePublic copies canonical frontend files', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'ece-public-'));
    await mkdir(path.join(rootDir, 'css'));
    await mkdir(path.join(rootDir, 'js'));
    await writeFile(path.join(rootDir, 'index.html'), '<main>ok</main>');
    await writeFile(path.join(rootDir, 'css/style.css'), 'body{}');
    await writeFile(path.join(rootDir, 'js/app.js'), 'window.ok=true');
    await writeFile(path.join(rootDir, 'js/config.js'), 'window.API_BASE_URL=""');

    await preparePublic({ rootDir });

    assert.equal(
        await readFile(path.join(rootDir, 'public/index.html'), 'utf8'),
        '<main>ok</main>'
    );
    assert.equal(
        await readFile(path.join(rootDir, 'public/js/app.js'), 'utf8'),
        'window.ok=true'
    );
});

test('canonical HTML includes the administrator review manager contract', async () => {
    const html = await readFile('index.html', 'utf8');

    for (const id of [
        'review-manager-modal',
        'review-notice-list',
        'review-editor',
        'review-pending-count'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-live="polite"/);
});

test('PWA manifest and service worker include install and push contracts', async () => {
    const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
    const worker = await readFile('service-worker.js', 'utf8');

    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.icons[0].src, /app-icon\.svg$/);
    assert.match(worker, /addEventListener\('push'/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /notificationclick/);
});

test('Cloudflare scheduled worker triggers the protected crawl endpoint', async () => {
    const worker = (await import('../cloudflare/crawl-worker.js')).default;
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
    };
    try {
        const pending = [];
        worker.scheduled({}, {
            API_BASE_URL: 'https://api.example.test/',
            CRAWL_TRIGGER_SECRET: 'secret'
        }, {
            waitUntil(promise) {
                pending.push(promise);
            }
        });
        await Promise.all(pending);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://api.example.test/api/internal/crawl/ece-academics'
    );
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['x-crawl-secret'], 'secret');
});
