const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseImageDataUrl(value) {
    const match = String(value || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1])) {
        throw new TypeError('OCR 이미지는 JPG, PNG, WEBP 형식이어야 합니다.');
    }
    if (match[2].length > 8_000_000) {
        throw new TypeError('OCR 이미지가 너무 큽니다.');
    }
    return { mimeType: match[1], data: match[2] };
}

export function createOcrService({
    apiKey,
    model = 'gemini-flash-latest',
    fetchImpl = globalThis.fetch
}) {
    if (!apiKey) throw new Error('OCR service requires an API key');
    if (typeof fetchImpl !== 'function') throw new Error('OCR service requires fetch');

    return {
        async extractText(images) {
            const normalized = (Array.isArray(images) ? images : [])
                .slice(0, 5)
                .map(parseImageDataUrl);
            if (normalized.length === 0) {
                throw new TypeError('OCR할 이미지를 선택해주세요.');
            }

            const response = await fetchImpl(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [
                                {
                                    text: [
                                        '이미지 안의 한국어와 영어 텍스트를 OCR로 추출하세요.',
                                        '보이는 순서를 유지한 일반 텍스트만 반환하세요.',
                                        '내용을 요약하거나 추측하거나 날짜를 보정하지 마세요.',
                                        '판독할 수 없는 부분은 생략하세요.'
                                    ].join('\n')
                                },
                                ...normalized.map(image => ({ inlineData: image }))
                            ]
                        }],
                        generationConfig: {
                            temperature: 0,
                            maxOutputTokens: 4096
                        }
                    })
                }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data?.error?.message || `OCR 요청 실패 (${response.status})`);
                error.status = response.status;
                throw error;
            }
            const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (!text) throw new Error('이미지에서 검색 가능한 글자를 찾지 못했습니다.');
            return text.slice(0, 20_000);
        }
    };
}

export const ocrInternals = { parseImageDataUrl };
