import fs from 'node:fs';
import path from 'node:path';
import type { ImportSemantic } from '@hcbridge/ts-analyzer';

export type ComponentResolutionKind = 'local-vue' | 'external-package' | 'builtin' | 'unresolved';

export interface ComponentResolution {
  localName: string;
  importSource: string;
  kind: ComponentResolutionKind;
  resolvedFile?: string;
  packageName?: string;
  candidates: string[];
  confidence: number;
}

export interface ResolveOptions {
  projectRoot: string;
  sourceFile: string;
}

export function resolveImportedComponents(imports: ImportSemantic[], options: ResolveOptions): Map<string, ComponentResolution> {
  const result = new Map<string, ComponentResolution>();
  const aliases = loadPathAliases(options.projectRoot);
  for (const item of imports) {
    const resolved = resolveImport(item.source, options.sourceFile, options.projectRoot, aliases);
    result.set(item.local, {
      localName: item.local,
      importSource: item.source,
      kind: resolved.kind,
      resolvedFile: resolved.file,
      packageName: resolved.packageName,
      candidates: resolved.candidates,
      confidence: resolved.confidence,
    });
  }
  return result;
}

function resolveImport(
  specifier: string,
  sourceFile: string,
  projectRoot: string,
  aliases: Record<string, string[]>,
): { kind: ComponentResolutionKind; file?: string; packageName?: string; candidates: string[]; confidence: number } {
  if (specifier.startsWith('.') || specifier.startsWith('/') || Object.keys(aliases).some((key) => specifier === key || specifier.startsWith(`${key}/`))) {
    const candidates = candidatePaths(specifier, sourceFile, projectRoot, aliases);
    const vue = candidates.find((file) => file.endsWith('.vue') && fs.existsSync(file));
    if (vue) return { kind: 'local-vue', file: vue, candidates, confidence: 1 };
    return { kind: 'unresolved', candidates, confidence: 0.35 };
  }

  const packageName = packageRoot(specifier);
  return { kind: 'external-package', packageName, candidates: [], confidence: 0.8 };
}

function candidatePaths(specifier: string, sourceFile: string, projectRoot: string, aliases: Record<string, string[]>): string[] {
  let bases: string[] = [];
  if (specifier.startsWith('.')) {
    bases = [path.resolve(path.dirname(sourceFile), specifier)];
  } else if (specifier.startsWith('/')) {
    bases = [path.resolve(projectRoot, `.${specifier}`)];
  } else {
    for (const [alias, targets] of Object.entries(aliases)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        const suffix = specifier === alias ? '' : specifier.slice(alias.length + 1);
        bases.push(...targets.map((target) => path.resolve(projectRoot, target, suffix)));
      }
    }
  }
  const expanded: string[] = [];
  for (const base of bases) {
    expanded.push(base, `${base}.vue`, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.vue'), path.join(base, 'index.ts'));
  }
  return [...new Set(expanded)];
}

function loadPathAliases(projectRoot: string): Record<string, string[]> {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  try {
    const json = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    const paths = json.compilerOptions?.paths ?? {};
    const baseUrl = json.compilerOptions?.baseUrl ?? '.';
    return Object.fromEntries(Object.entries(paths).map(([alias, values]) => [
      alias.replace(/\/\*$/, ''),
      (values as string[]).map((value) => path.join(baseUrl, value.replace(/\*$/, ''))),
    ]));
  } catch {
    return {};
  }
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}
