import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseVueSfc } from '@hcbridge/vue-parser';

export interface VerifyResult {
  reparse: { ok: boolean; diagnostics: string[] };
  typecheck: { attempted: boolean; ok: boolean; output?: string };
  build: { attempted: boolean; ok: boolean; output?: string };
}

export function verifyFile(file: string, text: string): VerifyResult {
  try {
    const parsed = parseVueSfc(file, text);
    return { reparse: { ok: parsed.diagnostics.every((d) => d.severity !== 'error'), diagnostics: parsed.diagnostics.map((d) => d.message) }, typecheck: { attempted: false, ok: true }, build: { attempted: false, ok: true } };
  } catch (error) {
    return { reparse: { ok: false, diagnostics: [String(error)] }, typecheck: { attempted: false, ok: false }, build: { attempted: false, ok: false } };
  }
}

export function verifyProject(projectDir: string): VerifyResult {
  const result = verifyFile(path.join(projectDir, '__synthetic__.vue'), '<template><div /></template>');
  const command = 'pnpm';
  const execPrefix = ['exec'];
  const typecheck = runOptional(projectDir, command, [...execPrefix, 'vue-tsc', '--noEmit']);
  const build = fs.existsSync(path.join(projectDir, 'vite.config.ts')) || fs.existsSync(path.join(projectDir, 'vite.config.js'))
    ? runOptional(projectDir, command, [...execPrefix, 'vite', 'build'])
    : { attempted: false, ok: true, output: 'No Vite config found; build skipped.' };
  return { ...result, typecheck, build };
}

function runOptional(cwd: string, command: string, args: string[]) {
  try {
    const output = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { attempted: true, ok: true, output };
  } catch (error: any) {
    return { attempted: true, ok: false, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
  }
}
