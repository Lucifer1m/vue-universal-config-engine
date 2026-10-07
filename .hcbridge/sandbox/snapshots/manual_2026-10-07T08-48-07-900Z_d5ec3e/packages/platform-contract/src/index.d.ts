import type { HcpProject, ChangeSet } from '@hcbridge/hcp';
import type { PatchPlan } from '@hcbridge/patch-engine';
export interface PlatformCapabilities {
    schemaVersion: string;
    supportedCapabilityTypes: string[];
    supportedComponents: string[];
}
export interface PlatformProjection {
    schemaVersion: string;
    document: unknown;
    sourceMap: Record<string, unknown>;
}
export interface PlatformAdapter {
    getCapabilities(): Promise<PlatformCapabilities>;
    project(project: HcpProject): Promise<PlatformProjection>;
    changesToPatch(changes: ChangeSet[]): Promise<PatchPlan>;
}
