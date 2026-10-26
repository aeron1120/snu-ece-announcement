import crypto from 'node:crypto';
import { categorySlugForKey, classifyNoticeCategory } from './notice-classifier.js';

const DAY_MS = 86_400_000;
const DATE_DIVIDER = /^-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+\S+요일)?\s*-+$/;
const MESSAGE_HEADER = /^\[([^\]]+)]\s+\[(오전|오후)\s+(\d{1,2}):(\d{2})]\s*([\s\S]*)$/;
const IMAGE_ONLY = /^사진(?:\s+\d+장)?$/;
const FILE_LINE = /^파일:\s*(.+)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const DEADLINE_PATTERNS = [
    /(?:신청|접수)\s*기간[^\n]{0,80}/gi,
    /(?:마감|까지)[^\n]{0,60}/gi,
    /\bD-\d+\b/gi
];

function normalizeKakaoTime(dateContext, meridiem, hourText, minuteText) {
    if (!dateContext) return null;
    let hour = Number(hourText);
    if (meridiem === '오후' && hour < 12) hour += 12;
    if (meridiem === '오전' && hour === 12) hour = 0;
    const utc = Date.UTC(
        dateContext.year,
        dateContext.month - 1,
        dateContext.day,
        hour - 9,
        Number(minuteText)
    );
    return new Date(utc).toISOString();
}

function extractTitle(body) {
    const firstLine = String(body || '').split('\n')[0].trim();
    return firstLine || '이미지 첨부 공지';
}

function normalizeThreadTitle(title) {
    return String(title || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\[(?:재공지|리마인드|remind(?:er)?)\]/gi, '')
        .replace(/(?:재공지|리마인드|remind(?:er)?)/gi, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function extractUrls(body) {
    return Array.from(new Set(String(body || '').match(URL_PATTERN) || []));
}

function extractDeadlineExpressions(body) {
    const matches = DEADLINE_PATTERNS.flatMap(pattern => String(body || '').match(pattern) || []);
    return Array.from(new Set(matches.map(value => value.trim()).filter(Boolean)));
}

function classifyDraft(title, body) {
    return categorySlugForKey(classifyNoticeCategory({ title, content: body }).key);
}

function classifySender(sender) {
    const value = String(sender || '');
    if (/전기|정보|ece|학생회.*전정/i.test(value)) return '전기정보';
    if (/공과|공대|engineering/i.test(value)) return '공과대학';
    if (/총학|총학생회|중앙|단과대.*연석/i.test(value)) return '총학·중앙';
    return '외부·기업';
}

function makeExternalId(message) {
    return crypto.createHash('sha256')
        .update([
            message.sender,
            message.sentAt,
            message.body,
            message.imageAttachmentCount,
            message.attachments.map(item => item.name).join('|')
        ].join('\u001f'))
        .digest('hex');
}

export function parseKakaoExport(rawInput) {
    const raw = Buffer.isBuffer(rawInput)
        ? rawInput.toString('utf8')
        : String(rawInput || '');
    if (!raw.includes('\r\n')) {
        throw new TypeError('카카오톡 원문의 CRLF 메시지 경계를 찾지 못했습니다. 개행을 변환하지 않은 원본 파일을 올려주세요.');
    }

    const records = raw.split('\r\n');
    const messages = [];
    let dateContext = null;
    let previousTextMessage = null;

    for (const record of records) {
        const trimmed = record.trim();
        if (!trimmed) continue;
        const divider = trimmed.match(DATE_DIVIDER);
        if (divider) {
            dateContext = {
                year: Number(divider[1]),
                month: Number(divider[2]),
                day: Number(divider[3])
            };
            previousTextMessage = null;
            continue;
        }

        const match = record.match(MESSAGE_HEADER);
        if (!match || !dateContext) continue;
        const sender = match[1].trim();
        const body = match[5].trim();
        const sentAt = normalizeKakaoTime(dateContext, match[2], match[3], match[4]);
        const fileMatch = body.match(FILE_LINE);
        const isAttachmentOnly = IMAGE_ONLY.test(body) || (!fileMatch && body.length < 15);

        if (fileMatch || isAttachmentOnly) {
            if (previousTextMessage) {
                if (fileMatch) {
                    previousTextMessage.attachments.push({ name: fileMatch[1].trim(), url: '' });
                } else {
                    const count = Number(body.match(/\d+/)?.[0]) || 1;
                    previousTextMessage.imageAttachmentCount += count;
                }
            } else {
                const orphan = {
                    sender,
                    sentAt,
                    body: '',
                    title: fileMatch ? fileMatch[1].trim() : '이미지 첨부 공지',
                    urls: [],
                    deadlineExpressions: [],
                    imageAttachmentCount: fileMatch ? 0 : (Number(body.match(/\d+/)?.[0]) || 1),
                    attachments: fileMatch ? [{ name: fileMatch[1].trim(), url: '' }] : []
                };
                messages.push(orphan);
                previousTextMessage = orphan;
            }
            continue;
        }

        const message = {
            sender,
            sentAt,
            body,
            title: extractTitle(body),
            urls: extractUrls(body),
            deadlineExpressions: extractDeadlineExpressions(body),
            imageAttachmentCount: 0,
            attachments: []
        };
        messages.push(message);
        previousTextMessage = message;
    }

    return messages;
}

export function buildKakaoBackfillDrafts(rawInput) {
    const messages = parseKakaoExport(rawInput);
    const drafts = [];
    const threadsByTitle = new Map();

    for (const message of messages) {
        const normalizedTitle = normalizeThreadTitle(message.title);
        const candidates = threadsByTitle.get(normalizedTitle) || [];
        const sentAtMs = Date.parse(message.sentAt);
        const thread = [...candidates].reverse().find(candidate =>
            Math.abs(sentAtMs - Date.parse(candidate.latestSentAt)) <= 30 * DAY_MS
        );

        if (thread) {
            thread.latestSentAt = message.sentAt;
            thread.reminderCount += 1;
            thread.threadMessages.push({
                sender: message.sender,
                sentAt: message.sentAt,
                body: message.body
            });
            thread.imageAttachmentCount += message.imageAttachmentCount;
            thread.attachments.push(...message.attachments);
            thread.urls = Array.from(new Set([...thread.urls, ...message.urls]));
            thread.deadlineExpressions = Array.from(new Set([
                ...thread.deadlineExpressions,
                ...message.deadlineExpressions
            ]));
            continue;
        }

        /* 규칙에 안 걸린 메시지도 빈손으로 두지 않는다. 공용 분류기가 다섯 중
           하나를 제안하고, 관리자는 가져오기 전에 드롭다운에서 바꿀 수 있다. */
        const classification = classifyNoticeCategory({ title: message.title, content: message.body });
        const categorySlug = categorySlugForKey(classification.key);
        const requiresAction = /신청|접수|지원|모집|등록|제출|설문|폼|참가/.test(
            `${message.title}\n${message.body}`
        );
        const sourceExternalId = makeExternalId(message);
        const draft = {
            sourceType: 'kakao-backfill',
            sourceExternalId,
            threadKey: sourceExternalId,
            sourcePublishedAt: message.sentAt,
            title: message.title,
            content: message.body,
            rawTitle: message.title,
            rawContent: message.body,
            target: '전체',
            targets: ['전체'],
            host: message.sender,
            sourceGroup: classifySender(message.sender),
            sender: message.sender,
            categorySlug,
            requiresAction,
            classificationStatus: classification.source === 'default' ? 'fallback' : 'draft',
            urls: message.urls,
            deadlineExpressions: message.deadlineExpressions,
            imageAttachmentCount: message.imageAttachmentCount,
            attachments: [...message.attachments],
            reminderCount: 0,
            latestSentAt: message.sentAt,
            threadMessages: [{
                sender: message.sender,
                sentAt: message.sentAt,
                body: message.body
            }]
        };
        drafts.push(draft);
        candidates.push(draft);
        threadsByTitle.set(normalizedTitle, candidates);
    }

    return {
        messages,
        drafts,
        stats: {
            messageCount: messages.length,
            draftCount: drafts.length,
            groupedDuplicateCount: messages.length - drafts.length,
            unclassifiedCount: drafts.filter(draft => !draft.categorySlug).length,
            unclassifiedRate: drafts.length
                ? drafts.filter(draft => !draft.categorySlug).length / drafts.length
                : 0
        }
    };
}

export const kakaoBackfillInternals = {
    classifyDraft,
    classifySender,
    extractDeadlineExpressions,
    extractUrls,
    normalizeThreadTitle
};
