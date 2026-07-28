import test from 'node:test';
import assert from 'node:assert/strict';
import { getGeminiRetryAfterSeconds } from '../server/services/gemini-rate-limit.js';

test('Gemini retry delay prefers the Retry-After header', () => {
    assert.equal(getGeminiRetryAfterSeconds('12.2', {
        error: { message: 'Please retry in 30s.' }
    }), 13);
});

test('Gemini retry delay is extracted from quota messages and rounded up', () => {
    assert.equal(getGeminiRetryAfterSeconds('', {
        error: { message: 'Please retry in 19.653888224s.' }
    }), 20);
});

test('Gemini retry delay falls back to one minute', () => {
    assert.equal(getGeminiRetryAfterSeconds('', {
        error: { message: 'Quota exceeded.' }
    }), 60);
});
