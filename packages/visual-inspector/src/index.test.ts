import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectDomTarget } from './index.js';

describe('visual-inspector', () => {
  it('resolves a distinctive static element to its Vue source', async () => {
    const root = await makeProject();
    const result = await inspectDomTarget(root, {
      tag: 'button',
      id: 'save-user',
      classes: ['primary'],
      attributes: { type: 'button' },
      text: '保存用户',
    });
    expect(result.state).toBe('exact');
    expect(result.candidate?.file).toBe('src/UserForm.vue');
    expect(result.candidate?.sourceText).toContain('保存用户');
    expect(result.candidate?.range.start.line).toBeGreaterThan(1);
  });

  it('does not claim an exact match when repeated nodes are ambiguous', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-inspector-ambiguous-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'app' }));
    await fs.writeFile(path.join(root, 'src/List.vue'), `<template>\n  <button>编辑</button>\n  <button>编辑</button>\n</template>\n`);
    const result = await inspectDomTarget(root, { tag: 'button', text: '编辑' });
    expect(['ambiguous', 'relocated']).toContain(result.state);
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcbridge-inspector-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'app' }));
  await fs.writeFile(
    path.join(root, 'src/UserForm.vue'),
    `<template>\n  <section class="form">\n    <button id="save-user" class="primary" type="button">保存用户</button>\n  </section>\n</template>\n`,
  );
  return root;
}
