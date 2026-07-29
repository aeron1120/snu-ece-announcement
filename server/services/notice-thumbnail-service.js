import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function cacheIdentity(id, updatedAt) {
    return crypto
        .createHash('sha256')
        .update(`${Number(id)}:${String(updatedAt || '')}`, 'utf8')
        .digest('hex');
}

function decodeImageDataUrl(image) {
    const match = String(image || '').match(
        /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,([a-z0-9+/=\s]+)$/i
    );
    if (!match) return null;
    const source = Buffer.from(match[1], 'base64');
    return source.length > 0 ? source : null;
}

export function createNoticeThumbnailService({ cacheDir, isOwnedUrl = null, fetchImage = null }) {
    if (!cacheDir) throw new TypeError('cacheDir is required');

    // data URL이면 해독하고, 우리 버킷 주소면 받아온다.
    // 남의 주소를 따라가면 이 엔드포인트가 요청 대행 통로가 된다.
    async function readSource(image) {
        const decoded = decodeImageDataUrl(image);
        if (decoded) return decoded;
        if (!isOwnedUrl || !fetchImage || !isOwnedUrl(image)) return null;
        try {
            const body = await fetchImage(image);
            return body && body.length > 0 ? body : null;
        } catch {
            return null;
        }
    }

    return {
        async getThumbnail({ id, updatedAt, image }) {
            const identity = cacheIdentity(id, updatedAt);
            const etag = `"${identity}"`;
            const cachePath = path.join(cacheDir, `${identity}.webp`);

            try {
                return {
                    kind: 'webp',
                    body: await readFile(cachePath),
                    etag
                };
            } catch (error) {
                if (error.code !== 'ENOENT') return { kind: 'default' };
            }

            const source = await readSource(image);
            if (!source) return { kind: 'default' };

            let temporaryPath = '';
            try {
                const body = await sharp(source)
                    .rotate()
                    .resize({ width: 640, withoutEnlargement: true })
                    .webp({ quality: 76 })
                    .toBuffer();
                await mkdir(cacheDir, { recursive: true });
                temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
                await writeFile(temporaryPath, body);
                await rename(temporaryPath, cachePath);
                return { kind: 'webp', body, etag };
            } catch {
                if (temporaryPath) {
                    await rm(temporaryPath, { force: true }).catch(() => {});
                }
                return { kind: 'default' };
            }
        }
    };
}
