import type { SourceRef } from '@hcbridge/source-model';
export interface StateSemantic {
    id: string;
    kind: 'ref' | 'reactive' | 'computed' | 'props' | 'emits' | 'unknown';
    source: SourceRef;
    expression?: string;
}
export interface FunctionSemantic {
    id: string;
    name: string;
    source: SourceRef;
    async: boolean;
    parameters: string[];
}
export interface ImportSemantic {
    local: string;
    imported?: string;
    source: string;
    sourceRef: SourceRef;
}
export interface ScriptAnalysis {
    file: string;
    states: StateSemantic[];
    functions: FunctionSemantic[];
    imports: ImportSemantic[];
    diagnostics: {
        code: string;
        message: string;
        source?: SourceRef;
    }[];
}
export declare function analyzeScriptSetup(file: string, fullText: string, script: {
    content: string;
    offset: number;
}): ScriptAnalysis;
