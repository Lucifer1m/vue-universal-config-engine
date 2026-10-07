import type { SourceRange, SourceRef, LocatorState } from '@hcbridge/source-model';
export declare function sha256(input: string): string;
export declare function shortHash(input: string, length?: number): string;
export declare function normalizeWhitespace(input: string): string;
export declare function fingerprint(parts: string[]): string;
export declare function toProjectRelative(file: string, projectRoot?: string): string;
/**
 * Stable across machines when the same logical file exists under the same project root.
 * structuralPath is evidence, not the only identity signal; callers should persist source refs.
 */
export declare function createNodeId(file: string, structuralPath: string, kind: string, name: string, projectRoot?: string): string;
export declare function createSourceRef(params: {
    file: string;
    text: string;
    range: SourceRange;
    nodeId: string;
    syntaxFingerprint: string;
}): SourceRef;
export interface LocateCandidate {
    nodeId: string;
    syntaxFingerprint: string;
    start: number;
    end: number;
    parentFingerprint?: string;
    siblingFingerprint?: string;
    tag?: string;
    kind?: string;
}
export interface LocateEvidence {
    text: string;
    syntaxFingerprint: string;
    start: number;
    end: number;
    parentFingerprint?: string;
    siblingFingerprint?: string;
    tag?: string;
    kind?: string;
}
export declare function locateByEvidence(text: string, original: LocateEvidence, candidates: LocateCandidate[]): {
    state: LocatorState;
    candidate?: LocateCandidate;
};
