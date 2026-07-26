import { load } from 'cheerio';

export class EceParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EceParseError';
    }
}

export function isUndergraduateAudience(value) {
    return value === '학부' || value === '학부&대학원';
}

function toIsoDate(value) {
    const match = String(value || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function removeAudiencePrefix(value) {
    return String(value || '')
        .replace(/^\[(?:학부|학부&대학원)\]\s*/, '')
        .trim();
}

export function parseAcademicsList(html, baseUrl) {
    const $ = load(html);
    const boardRows = $('table.table-rows tbody tr');
    if (boardRows.length === 0) {
        throw new EceParseError('ECE board rows not found');
    }

    const rows = [];
    boardRows.each((_index, element) => {
        const cells = $(element).find('td');
        const audience = $(cells[1]).text().trim();
        if (!isUndergraduateAudience(audience)) return;

        const anchor = $(element).find('td.title a[href*="bbsidx="]').first();
        const href = anchor.attr('href');
        if (!href) return;

        const sourceUrl = new URL(href, baseUrl);
        const externalId = sourceUrl.searchParams.get('bbsidx');
        const title = removeAudiencePrefix(anchor.text());
        const publishedDate = toIsoDate($(cells[3]).text());
        if (!externalId || !title || !publishedDate) return;

        rows.push({
            externalId,
            audience,
            title,
            sourceUrl: sourceUrl.toString(),
            publishedDate
        });
    });

    return rows;
}

export function parseAcademicsDetail(html, sourceUrl) {
    const $ = load(html);
    const title = removeAudiencePrefix($('h1.bbstitle').first().text());
    const contentRoot = $('.bbs_contents').first().clone();
    contentRoot.find('br').replaceWith('\n');
    contentRoot.find('p, li, tr, div').each((_index, element) => {
        $(element).append('\n');
    });

    const content = contentRoot
        .text()
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const publishedDate = toIsoDate($('.infowrap .writer').first().text());
    const resolvedSource = new URL(sourceUrl);
    const externalId = resolvedSource.searchParams.get('bbsidx');
    const attachments = $('.board-filelist a')
        .map((_index, element) => ({
            name: $(element).text().trim(),
            url: new URL($(element).attr('href'), resolvedSource).toString()
        }))
        .get();

    if (!externalId || !title || !content || !publishedDate) {
        throw new EceParseError('ECE detail required fields not found');
    }

    return {
        externalId,
        title,
        content,
        publishedDate,
        attachments,
        sourceUrl: resolvedSource.toString()
    };
}
