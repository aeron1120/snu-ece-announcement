// Display names are a presentation hint, never proof of department membership.
export function parseSnuProfile(displayName) {
    const rawName = typeof displayName === 'string' ? displayName.trim().slice(0, 200) : '';
    const parts = rawName.split('/').map(part => part.trim());
    const [name, status = '', department = ''] = parts;
    return { rawName, name: name || '', status, department };
}
