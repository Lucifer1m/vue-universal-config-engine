import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveImportedComponents } from './index.js';

describe('component resolver', () => {
  it('resolves a local relative Vue component', () => {
    const root = path.resolve('fixtures/local');
    const sourceFile = path.join(root, 'Parent.vue');
    const result = resolveImportedComponents([
      {
        local: 'UserSelector',
        imported: 'UserSelector',
        source: './UserSelector.vue',
        sourceRef: {} as never,
      },
    ], { projectRoot: root, sourceFile });
    const item = result.get('UserSelector')!;
    expect(item.kind).toBe('local-vue');
    expect(item.resolvedFile).toBe(path.join(root, 'UserSelector.vue'));
    expect(fs.existsSync(item.resolvedFile!)).toBe(true);
  });
});
