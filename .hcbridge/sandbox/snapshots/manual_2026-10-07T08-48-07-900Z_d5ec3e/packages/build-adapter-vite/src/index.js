import fs from 'node:fs';
import path from 'node:path';
export class ViteBuildAdapter {
    name = 'vite';
    async inspect(ctx) {
        const config = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].find((x) => fs.existsSync(path.join(ctx.projectRoot, x)));
        return { adapter: this.name, config: config ?? null, packageJson: fs.existsSync(path.join(ctx.projectRoot, 'package.json')) };
    }
}
//# sourceMappingURL=index.js.map