import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createMemberStore({ supabase, filePath }) {
    let queue = Promise.resolve();
    async function read() {
        try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    function mutate(operation) {
        const task = queue.then(async () => {
            const rows = await read();
            const result = operation(rows);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(`${filePath}.tmp`, JSON.stringify(rows, null, 2));
            await fs.rename(`${filePath}.tmp`, filePath);
            return result;
        });
        queue = task.catch(() => {});
        return task;
    }
    async function query(request) {
        const { data, error } = await request;
        if (error) throw error;
        return data;
    }
    return {
        async get(email) {
            if (supabase) return query(supabase.from('ece_members').select('*').eq('email', email).maybeSingle());
            await queue;
            return (await read()).find(row => row.email === email) || null;
        },
        async list() {
            if (supabase) return query(supabase.from('ece_members').select('*').order('updated_at', { ascending: false }).limit(1000));
            await queue;
            return (await read()).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 1000);
        },
        async register(identity, initialStatus) {
            const now = new Date().toISOString();
            const row = { ...identity, status: initialStatus, created_at: now, updated_at: now,
                reviewed_by: null, reviewed_at: null };
            if (supabase) {
                // Never overwrite a concurrent administrator decision during login.
                await query(supabase.from('ece_members').upsert(row, { onConflict: 'email', ignoreDuplicates: true }));
                const existing = await this.get(identity.email);
                if (existing.subject !== identity.subject) throw new Error('Account identity changed');
                await query(supabase.from('ece_members').update({ profile: identity.profile, updated_at: now })
                    .eq('email', identity.email).eq('subject', identity.subject));
                return this.get(identity.email);
            }
            return mutate(rows => {
                const existing = rows.find(item => item.email === identity.email);
                if (existing) {
                    if (existing.subject !== identity.subject) throw new Error('Account identity changed');
                    existing.profile = identity.profile;
                    existing.updated_at = now;
                    return { ...existing };
                }
                rows.push(row);
                return row;
            });
        },
        async review(email, status, reviewer) {
            const update = { status, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            if (supabase) return query(supabase.from('ece_members').update(update).eq('email', email).select('*').maybeSingle());
            return mutate(rows => {
                const row = rows.find(item => item.email === email);
                return row ? Object.assign(row, update) : null;
            });
        }
    };
}
