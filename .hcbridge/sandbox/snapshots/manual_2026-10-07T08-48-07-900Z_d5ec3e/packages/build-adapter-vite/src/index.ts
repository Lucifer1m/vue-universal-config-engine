import type { BuildAdapter, BuildAdapterContext } from '@hcbridge/build-adapter-core';
import fs from 'node:fs';
import path from 'node:path';
export class ViteBuildAdapter implements BuildAdapter {
  name = 'vite';
  async inspect(ctx: BuildAdapterContext): Promise<Record<string, unknown>> {
    const config = ['vite.config.ts','vite.config.js','vite.config.mjs'].find((x) => fs.existsSync(path.join(ctx.projectRoot, x)));
    return { adapter: this.name, config: config ?? null, packageJson: fs.existsSync(path.join(ctx.projectRoot,'package.json')) };
  }
}
