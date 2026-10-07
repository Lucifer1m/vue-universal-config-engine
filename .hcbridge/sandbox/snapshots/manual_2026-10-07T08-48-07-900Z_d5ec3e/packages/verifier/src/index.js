import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseVueSfc } from '@hcbridge/vue-parser';
export function verifyFile(file, text) {
    try {
        const parsed = parseVueSfc(file, text);
        return {
            reparse: { ok: parsed.diagnostics.every((d) => d.severity !== 'error'), diagnostics: parsed.diagnostics.map((d) => d.message) },
            typecheck: { attempted: false, ok: true },
            build: { attempted: false, ok: true },
        };
    }
    catch (error) {
        return { reparse: { ok: false, diagnostics: [String(error)] }, typecheck: { attempted: false, ok: false }, build: { attempted: false, ok: false } };
    }
}
export function verifyProject(projectDir, options = {}) {
    const files = collectVueFiles(projectDir);
    const projectFiles = files.map((file) => {
        try {
            const parsed = parseVueSfc(file, fs.readFileSync(file, 'utf8'));
            const diagnostics = parsed.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
            return { file: path.relative(projectDir, file), ok: diagnostics.length === 0, diagnostics };
        }
        catch (error) {
            return { file: path.relative(projectDir, file), ok: false, diagnostics: [String(error)] };
        }
    });
    const reparseOk = projectFiles.every((item) => item.ok);
    const typecheck = options.runTypecheck ? runPackageCommand(projectDir, ['exec', 'vue-tsc', '--noEmit']) : { attempted: false, ok: true, output: 'Typecheck skipped.' };
    const viteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].some((name) => fs.existsSync(path.join(projectDir, name)));
    const build = options.runBuild && viteConfig ? runPackageCommand(projectDir, ['exec', 'vite', 'build']) : { attempted: false, ok: true, output: options.runBuild ? 'No Vite config found; build skipped.' : 'Build skipped.' };
    return { reparse: { ok: reparseOk, diagnostics: projectFiles.flatMap((item) => item.diagnostics) }, typecheck, build, projectFiles };
}
function runPackageCommand(cwd, args) {
    try {
        const output = execFileSync('pnpm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { attempted: true, ok: true, output };
    }
    catch (error) {
        return { attempted: true, ok: false, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim() };
    }
}
function collectVueFiles(root) {
    const out = [];
    const visit = (current) => {
        if (!fs.existsSync(current))
            return;
        const stat = fs.statSync(current);
        if (stat.isFile()) {
            if (current.endsWith('.vue'))
                out.push(current);
            return;
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (['node_modules', 'dist', '.git', '.hcbridge', 'coverage'].includes(entry.name))
                continue;
            const next = path.join(current, entry.name);
            if (entry.isDirectory())
                visit(next);
            else if (entry.name.endsWith('.vue'))
                out.push(next);
        }
    };
    visit(root);
    return out.sort();
}
//# sourceMappingURL=index.js.map