function positiveSeconds(value) {
    const seconds = Math.ceil(Number.parseFloat(String(value || '')));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function getGeminiRetryAfterSeconds(retryAfterHeader, payload = {}) {
    const headerSeconds = positiveSeconds(retryAfterHeader);
    if (headerSeconds) return headerSeconds;

    const searchable = [
        payload?.error?.message,
        JSON.stringify(payload?.error?.details || [])
    ].filter(Boolean).join(' ');
    const patterns = [
        /retry\s+in\s+([\d.]+)\s*s/i,
        /retryDelay["']?\s*:\s*["']?([\d.]+)\s*s/i,
        /([\d.]+)\s*seconds?/i
    ];
    for (const pattern of patterns) {
        const match = searchable.match(pattern);
        const seconds = positiveSeconds(match?.[1]);
        if (seconds) return seconds;
    }
    return 60;
}
