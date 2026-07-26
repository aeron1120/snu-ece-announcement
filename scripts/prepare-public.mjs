import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function copyIfPresent(source, destination, options) {
    try {
        await cp(source, destination, options);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

export async function preparePublic({ rootDir }) {
    const outputDir = path.join(rootDir, 'public');
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(path.join(outputDir, 'css'), { recursive: true });
    await mkdir(path.join(outputDir, 'js'), { recursive: true });

    await cp(path.join(rootDir, 'index.html'), path.join(outputDir, 'index.html'));
    await cp(path.join(rootDir, 'css/style.css'), path.join(outputDir, 'css/style.css'));
    await cp(path.join(rootDir, 'js'), path.join(outputDir, 'js'), { recursive: true });

    for (const filename of ['manifest.webmanifest', 'service-worker.js', '_headers']) {
        await copyIfPresent(
            path.join(rootDir, filename),
            path.join(outputDir, filename)
        );
    }

    await copyIfPresent(
        path.join(rootDir, 'icons'),
        path.join(outputDir, 'icons'),
        { recursive: true }
    );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    await preparePublic({ rootDir: path.resolve(path.dirname(scriptPath), '..') });
}
