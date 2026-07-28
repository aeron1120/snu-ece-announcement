import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrService, ocrInternals } from '../server/services/ocr-service.js';

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('OCR service sends image bytes and returns plain searchable text', async () => {
    let requestBody;
    const service = createOcrService({
        apiKey: 'test-key',
        fetchImpl: async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return {
                ok: true,
                async json() {
                    return {
                        candidates: [{
                            content: { parts: [{ text: '  반도체 인턴십 지원 안내  ' }] }
                        }]
                    };
                }
            };
        }
    });

    const text = await service.extractText([TINY_JPEG]);
    assert.equal(text, '반도체 인턴십 지원 안내');
    assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
    assert.equal(requestBody.contents[0].parts[1].inlineData.data, '/9j/4AAQSkZJRg==');
});

test('OCR rejects unsupported or missing images before calling the model', async () => {
    assert.throws(
        () => ocrInternals.parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='),
        /JPG, PNG, WEBP/
    );
    const service = createOcrService({
        apiKey: 'test-key',
        fetchImpl: async () => assert.fail('fetch should not run')
    });
    await assert.rejects(() => service.extractText([]), /이미지를 선택/);
});
