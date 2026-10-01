// Opt-in only. Removing the setting restores the normal membership policy.
export function isTemporaryPublicAccessEnabled() {
    return process.env.TEMPORARY_PUBLIC_ACCESS === 'true';
}

export function isSnuGoogleAccount(payload) {
    return payload.hd === 'snu.ac.kr' && typeof payload.email === 'string'
        && /^[^@\s]+@snu\.ac\.kr$/i.test(payload.email);
}

export function effectiveMemberStatus(member) {
    return member.status === 'pending' && isTemporaryPublicAccessEnabled() ? 'approved' : member.status;
}
