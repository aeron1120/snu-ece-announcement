export default {
    scheduled(_controller, env, ctx) {
        const apiBaseUrl = String(env.API_BASE_URL || '').replace(/\/$/, '');
        const request = fetch(`${apiBaseUrl}/api/internal/crawl/ece-academics`, {
            method: 'POST',
            headers: {
                'x-crawl-secret': env.CRAWL_TRIGGER_SECRET
            }
        }).then(response => {
            if (!response.ok) {
                throw new Error(`crawl trigger failed: ${response.status}`);
            }
        });
        ctx.waitUntil(request);
    }
};
