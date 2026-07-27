import express from 'express';

export function createNoticeThumbnailRouter({
    loadSource,
    thumbnailService,
    defaultUrl
}) {
    if (typeof loadSource !== 'function') throw new TypeError('loadSource is required');
    if (!thumbnailService?.getThumbnail) {
        throw new TypeError('thumbnailService is required');
    }

    const router = express.Router();
    router.get('/api/notices/:id/thumbnail', async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: '유효하지 않은 id입니다.' });
        }

        try {
            const source = await loadSource(id);
            if (!source) return res.redirect(302, defaultUrl);

            const result = await thumbnailService.getThumbnail(source);
            if (result.kind !== 'webp') return res.redirect(302, defaultUrl);

            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                ETag: result.etag
            });
            if (req.get('if-none-match') === result.etag) {
                return res.status(304).end();
            }
            res.type('webp').send(result.body);
        } catch {
            res.redirect(302, defaultUrl);
        }
    });
    return router;
}
