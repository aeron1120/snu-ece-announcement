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
