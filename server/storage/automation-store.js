import { promises as fs } from 'node:fs';
import path from 'node:path';

function emptyDocument() {
    return {
        version: 1,
        notices: [],
        crawlRuns: [],
        crawlItems: [],
        categories: [],
        categoryAliases: [],
        categoryCandidates: [],
        categoryCandidateNotices: [],
        pushSubscriptions: [],
        notificationJobs: [],
        notificationDeliveries: [],
        auditLogs: []
    };
}

function nextId(rows) {
    return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}

function duplicateSourceError() {
    const error = new Error('duplicate source notice');
    error.code = 'DUPLICATE_SOURCE_NOTICE';
    return error;
}

function toSupabaseNotice(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        status: row.status,
        sourceType: row.source_type,
        sourceExternalId: row.source_external_id,
        sourceUrl: row.source_url,
        sourcePublishedAt: row.source_published_at,
        lastCrawledAt: row.last_crawled_at,
        title: row.title,
        content: row.content,
        rawTitle: row.raw_title,
        rawContent: row.raw_content,
        target: row.target,
        targets: Array.isArray(row.targets) ? row.targets : [],
        host: row.host,
        deadline: row.deadline,
        aiSummary: Array.isArray(row.ai_summary) ? row.ai_summary : [],
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        attachments: Array.isArray(row.attachments) ? row.attachments : [],
        analysisStatus: row.analysis_status,
        analysisConfidence: row.analysis_confidence,
        crawlMetadata: row.crawl_metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function toSupabaseNoticeInsert(notice) {
    const now = new Date().toISOString();
    return {
        status: 'pending_review',
        source_type: notice.sourceType,
        source_external_id: notice.sourceExternalId,
        source_url: notice.sourceUrl || null,
        source_published_at: notice.sourcePublishedAt || null,
        last_crawled_at: notice.lastCrawledAt || now,
        title: notice.title,
        content: notice.content,
        raw_title: notice.rawTitle || notice.title,
        raw_content: notice.rawContent || notice.content,
        target: notice.target || '전체',
        targets: notice.targets || ['전체'],
        host: notice.host || '전기정보공학부',
        deadline: notice.deadline || null,
        ai_summary: notice.aiSummary || [],
        keywords: notice.keywords || [],
        attachments: notice.attachments || [],
        analysis_status: notice.analysisStatus || 'pending',
        analysis_confidence: notice.analysisConfidence ?? null,
        crawl_metadata: notice.crawlMetadata || {},
        images: [],
        views: 0,
        is_deleted: false
    };
}

function createJsonStore(filePath) {
    let mutationQueue = Promise.resolve();

    async function readDocument() {
        await mutationQueue;
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
            return { ...emptyDocument(), ...parsed };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return emptyDocument();
        }
    }

    async function writeDocument(document) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(document, null, 2), 'utf8');
        await fs.rename(tempPath, filePath);
    }

    function mutate(mutator) {
        const operation = mutationQueue.then(async () => {
            let document;
            try {
                document = JSON.parse(await fs.readFile(filePath, 'utf8'));
                document = { ...emptyDocument(), ...document };
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                document = emptyDocument();
            }
            const result = await mutator(document);
            await writeDocument(document);
            return result;
        });
        mutationQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    return {
        async beginCrawlRun(sourceType) {
            return mutate(document => {
                const run = {
                    id: nextId(document.crawlRuns),
                    sourceType,
                    status: 'running',
                    discoveredCount: 0,
                    createdCount: 0,
                    failedCount: 0,
                    errorMessage: null,
                    startedAt: new Date().toISOString(),
                    finishedAt: null
                };
                document.crawlRuns.push(run);
                return { ...run };
            });
        },

        async finishCrawlRun(id, result) {
            return mutate(document => {
                const run = document.crawlRuns.find(item => Number(item.id) === Number(id));
                if (!run) throw new Error('crawl run not found');
                Object.assign(run, result, { finishedAt: new Date().toISOString() });
                return { ...run };
            });
        },

        async recordCrawlItem(crawlRunId, item) {
            return mutate(document => {
                const row = {
                    id: nextId(document.crawlItems),
                    crawlRunId: Number(crawlRunId),
                    sourceExternalId: String(item.sourceExternalId),
                    status: item.status,
                    errorMessage: item.errorMessage || null,
                    createdAt: new Date().toISOString()
                };
                document.crawlItems.push(row);
                return { ...row };
            });
        },

        async findNoticeBySource(sourceType, sourceExternalId) {
            const document = await readDocument();
            const notice = document.notices.find(item =>
                item.sourceType === sourceType
                && String(item.sourceExternalId) === String(sourceExternalId)
            );
            return notice ? { ...notice } : null;
        },

        async createPendingNotice(input) {
            return mutate(document => {
                const duplicate = document.notices.some(item =>
                    item.sourceType === input.sourceType
                    && String(item.sourceExternalId) === String(input.sourceExternalId)
                );
                if (duplicate) throw duplicateSourceError();
                const now = new Date().toISOString();
                const notice = {
                    id: nextId(document.notices),
                    ...input,
                    status: 'pending_review',
                    createdAt: now,
                    updatedAt: now
                };
                document.notices.push(notice);
                return { ...notice };
            });
        },

        async listReviewNotices() {
            const document = await readDocument();
            return document.notices
                .filter(notice => notice.status === 'pending_review')
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .map(notice => ({ ...notice }));
        },

        async getReviewNotice(id) {
            const document = await readDocument();
            const notice = document.notices.find(item =>
                Number(item.id) === Number(id) && item.status === 'pending_review'
            );
            return notice ? { ...notice } : null;
        }
    };
}

function createSupabaseStore(supabase) {
    return {
        async beginCrawlRun(sourceType) {
            const { data, error } = await supabase
                .from('crawl_runs')
                .insert({ source_type: sourceType, status: 'running' })
                .select('*')
                .single();
            if (error) throw error;
            return {
                id: Number(data.id),
                sourceType: data.source_type,
                status: data.status,
                startedAt: data.started_at
            };
        },

        async finishCrawlRun(id, result) {
            const payload = {
                status: result.status,
                discovered_count: result.discoveredCount,
                created_count: result.createdCount,
                failed_count: result.failedCount,
                error_message: result.errorMessage || null,
                finished_at: new Date().toISOString()
            };
            const { data, error } = await supabase
                .from('crawl_runs')
                .update(payload)
                .eq('id', id)
                .select('*')
                .single();
            if (error) throw error;
            return {
                id: Number(data.id),
                status: data.status,
                discoveredCount: data.discovered_count,
                createdCount: data.created_count,
                failedCount: data.failed_count,
                errorMessage: data.error_message,
                finishedAt: data.finished_at
            };
        },

        async recordCrawlItem(crawlRunId, item) {
            const { data, error } = await supabase
                .from('crawl_items')
                .insert({
                    crawl_run_id: crawlRunId,
                    source_external_id: item.sourceExternalId,
                    status: item.status,
                    error_message: item.errorMessage || null
                })
                .select('*')
                .single();
            if (error) throw error;
            return data;
        },

        async findNoticeBySource(sourceType, sourceExternalId) {
            const { data, error } = await supabase
                .from('notices')
                .select('*')
                .eq('source_type', sourceType)
                .eq('source_external_id', sourceExternalId)
                .maybeSingle();
            if (error) throw error;
            return toSupabaseNotice(data);
        },

        async createPendingNotice(input) {
            const { data, error } = await supabase
                .from('notices')
                .insert(toSupabaseNoticeInsert(input))
                .select('*')
                .single();
            if (error?.code === '23505') throw duplicateSourceError();
            if (error) throw error;
            return toSupabaseNotice(data);
        },

        async listReviewNotices() {
            const { data, error } = await supabase
                .from('notices')
                .select('*')
                .eq('status', 'pending_review')
                .eq('is_deleted', false)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []).map(toSupabaseNotice);
        },

        async getReviewNotice(id) {
            const { data, error } = await supabase
                .from('notices')
                .select('*')
                .eq('id', id)
                .eq('status', 'pending_review')
                .eq('is_deleted', false)
                .maybeSingle();
            if (error) throw error;
            return toSupabaseNotice(data);
        }
    };
}

export function createAutomationStore({ supabase = null, useSupabase, filePath }) {
    if (useSupabase) {
        if (!supabase) throw new Error('Supabase client is required');
        return createSupabaseStore(supabase);
    }
    if (!filePath) throw new Error('Automation JSON file path is required');
    return createJsonStore(filePath);
}
