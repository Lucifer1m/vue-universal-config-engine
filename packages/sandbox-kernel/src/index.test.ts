import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandboxSession, detectPackageManager, extractPreviewUrl, sha256 } from './index.js';

describe('sandbox-kernel', () => {
  it('inherits pnpm from a parent workspace manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-pm-workspace-'));
    const nested = path.join(root, 'examples', 'app');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.9.1' }));
    await fs.writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'app' }));
    expect(detectPackageManager(nested)).toMatchObject({ name: 'pnpm', reason: 'packageManager field' });
  });

  it('reads a Vite preview URL when the port is wrapped in color codes', () => {
    const output = '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n';
    expect(extractPreviewUrl(output)).toBe('http://localhost:5173/');
  });

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
});

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-sandbox-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.9.1', scripts: { dev: 'vite' } }, null, 2));
  await fs.writeFile(path.join(root, 'src/App.vue'), '<template>Hello</template>\n');
  return root;
}
