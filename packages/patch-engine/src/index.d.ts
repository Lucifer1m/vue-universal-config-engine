import { type ParsedSfc } from '@hcbridge/vue-parser';
import type { ChangeSet } from '@hcbridge/hcp';
import type { SourceRange } from '@hcbridge/source-model';
export type PatchKind = 'replace' | 'insert' | 'delete';
export interface PatchOperation {
    file: string;
    nodeId: string;
    kind: PatchKind;
    range: SourceRange;
    oldTextHash: string;
    semanticPrecondition: string;
    newText: string;
    oldText?: string;
}
export interface PatchPlan {
    version: '0.2';
    sourceHash: string;
    operations: PatchOperation[];
    inverse: PatchOperation[];
    diagnostics: {
        severity: 'warning' | 'error';
        code: string;
        message: string;
    }[];
}
export interface ApplyResult {
    changed: boolean;
    text: string;
    gitDiff: string;
    inversePlan: PatchPlan;
}
export declare function createEmptyPatchPlan(sourceHash?: string): PatchPlan;
export declare function createPatchPlan(parsed: ParsedSfc, change: ChangeSet): PatchPlan;
export declare function mergePatchPlans(plans: PatchPlan[]): PatchPlan;
export declare function applyPatchPlan(parsed: ParsedSfc, plan: PatchPlan): ApplyResult;
export declare function applyPatchToFile(file: string, plan: PatchPlan): ApplyResult;
export declare function rollbackFile(file: string, inverse: PatchPlan): ApplyResult;
