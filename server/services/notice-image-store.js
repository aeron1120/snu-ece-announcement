import crypto from 'node:crypto';

const BUCKET = 'notice-images';

// data URL에서 실제 바이트와 확장자를 꺼낸다. 그림이 아니면 null.
function decodeDataUrl(value) {
    const match = String(value || '').match(
        /^data:(image\/(avif|gif|jpe?g|png|webp));base64,([a-z0-9+/=\s]+)$/i
    );
    if (!match) return null;
    const body = Buffer.from(match[3], 'base64');
    if (body.length === 0) return null;
    const extension = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
    return { body, contentType: match[1].toLowerCase(), extension };
}

export function createNoticeImageStore({ supabase, supabaseUrl }) {
    const publicPrefix = supabaseUrl
        ? `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/`
        : '';

    // 이 버킷이 가진 주소인지. 아니면 가져오지도, 지우지도 않는다.
    function isOwnedUrl(value) {
        return Boolean(publicPrefix) && String(value || '').startsWith(publicPrefix);
    }

    function keyFromUrl(value) {
        return isOwnedUrl(value) ? String(value).slice(publicPrefix.length) : '';
    }

    return {
        isOwnedUrl,

        // data URL만 버킷으로 올리고 주소로 바꾼다. 나머지는 그대로 둔다.
        // Supabase가 없으면(로컬 파일 모드) 전부 그대로 둔다.
        async persistImages(images) {
            const list = Array.isArray(images) ? images : [];
            if (!supabase) return list;

            const persisted = [];
            for (const image of list) {
                const decoded = decodeDataUrl(image);
                if (!decoded) {
                    persisted.push(image);
                    continue;
                }
                // 공지 id는 저장 뒤에야 생기므로 임의 이름을 쓰고, 지울 땐 주소에서 되짚는다.
                const key = `${crypto.randomUUID()}.${decoded.extension}`;
                const { error } = await supabase.storage.from(BUCKET).upload(key, decoded.body, {
                    contentType: decoded.contentType,
                    upsert: false
                });
                // 사진이 빠진 채 저장된 공지보다 저장 실패가 낫다.
                if (error) throw error;
                persisted.push(supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl);
            }
            return persisted;
        },

        // 고아 파일이 남는 것보다 공지 삭제가 막히는 쪽이 나쁘다. 실패는 삼킨다.
        async removeImages(images) {
            if (!supabase) return;
            const keys = (Array.isArray(images) ? images : []).map(keyFromUrl).filter(Boolean);
            if (keys.length === 0) return;
            try {
                const { error } = await supabase.storage.from(BUCKET).remove(keys);
                if (error) console.warn('공지 이미지 삭제 실패:', error.message || error);
            } catch (error) {
                console.warn('공지 이미지 삭제 실패:', error.message || error);
            }
        }
    };
}
