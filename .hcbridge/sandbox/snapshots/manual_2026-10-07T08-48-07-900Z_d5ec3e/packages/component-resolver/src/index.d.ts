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
export declare function resolveImportedComponents(imports: ImportSemantic[], options: ResolveOptions): Map<string, ComponentResolution>;
