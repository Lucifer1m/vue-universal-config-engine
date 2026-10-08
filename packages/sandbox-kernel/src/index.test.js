import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandboxSession, detectPackageManager, sha256 } from './index.js';
describe('sandbox-kernel', () => {
    it('detects pnpm from manifest', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-pm-'));
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.9.1' }));
        expect(detectPackageManager(root).name).toBe('pnpm');
    });
    it('applies stale-safe edit intents and reports diffs', async () => {
        const root = await makeProject();
        const session = createSandboxSession({ projectRoot: root, install: false });
        const current = await session.readFile('src/App.vue');
        const result = await session.applyEditIntent({
            actor: 'human',
            description: 'change button text',
            expectedHashes: { 'src/App.vue': current.hash },
            operations: [{ kind: 'replace-text', file: 'src/App.vue', oldText: 'Hello', newText: 'Bonjour' }],
        });
        expect(result.rejectedFiles).toHaveLength(0);
        expect(result.changedFiles).toEqual(['src/App.vue']);
        expect(result.diffs[0]).toContain('+<template>Bonjour</template>');
    });
    it('snapshots, detects changes, then restores source files', async () => {
        const root = await makeProject();
        const session = createSandboxSession({ projectRoot: root, install: false });
        const edited = await session.readFile('src/App.vue');
        const editedHash = edited.hash;
        const snapshot = await session.snapshot('before');
        await session.writeFile('src/App.vue', '<template>Changed</template>\n');
        const diff = await session.diff(snapshot.id);
        expect(diff.changed).toEqual(['src/App.vue']);
        await session.restore(snapshot.id);
        const restored = await session.readFile('src/App.vue');
        expect(restored.hash).toBe(editedHash);
    });
    it('clears a stale process error when a later start succeeds', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-sandbox-restart-'));
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'restart-fixture' }));
        await fs.writeFile(path.join(root, 'dev-fixture.mjs'), "import fs from 'node:fs';\nif (fs.existsSync('fail')) { console.error('bad'); process.exit(1); }\nconsole.log('http://127.0.0.1:5099/');\nsetTimeout(() => {}, 10000);\n");
        await fs.writeFile(path.join(root, 'fail'), '1');
        const session = createSandboxSession({ projectRoot: root, install: false, command: process.execPath, args: ['dev-fixture.mjs'], startupTimeoutMs: 1500 });
        await expect(session.start()).rejects.toThrow(/SANDBOX_START_FAILED|exit=1/);
        expect(session.status().state).toBe('stopped');
        expect(session.status().lastError).toContain('Preview process');
        await fs.rm(path.join(root, 'fail'));
        const started = await session.start();
        expect(started.state).toBe('running');
        expect(started.lastError).toBeNull();
        await session.stop();
    });
});
async function makeProject() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-sandbox-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.9.1', scripts: { dev: 'vite' } }, null, 2));
    await fs.writeFile(path.join(root, 'src/App.vue'), '<template>Hello</template>\n');
    return root;
}
//# sourceMappingURL=index.test.js.map