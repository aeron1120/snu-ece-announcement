import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icon = await readFile(path.join(root, 'icons/app-icon.svg'));
const favicon = await readFile(path.join(root, 'icons/favicon.svg'));

// SVG lettering is outlined, so builds do not depend on installed fonts.
for (const [name, size] of [
    ['app-icon-192.png', 192], ['app-icon-512.png', 512],
    ['app-icon-1024.png', 1024], ['apple-touch-icon.png', 180]
]) {
    await sharp(icon, { density: 288 }).resize(size, size).png()
        .toFile(path.join(root, 'icons', name));
}
await sharp(favicon, { density: 288 }).resize(32, 32).png()
    .toFile(path.join(root, 'icons/favicon-32.png'));

// ICO directory with PNG frames for browser and Windows shortcut fallbacks.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size =>
    sharp(favicon, { density: 288 }).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (let i = 0; i < frames.length; i += 1) {
    const entry = 6 + i * 16;
    header[entry] = sizes[i];
    header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[i].length;
}
await writeFile(path.join(root, 'favicon.ico'), Buffer.concat([header, ...frames]));

// A large landscape brand card for KakaoTalk and other link previews.
const content = icon.toString().replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const sharing = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#24438d"/>
    <svg x="270" y="-15" width="660" height="660" viewBox="0 0 512 512">
        ${content.replace('<rect width="512" height="512" fill="url(#navy)"/>', '')}
    </svg>
</svg>`;
await sharp(Buffer.from(sharing)).png().toFile(path.join(root, 'icons/social-preview.png'));
