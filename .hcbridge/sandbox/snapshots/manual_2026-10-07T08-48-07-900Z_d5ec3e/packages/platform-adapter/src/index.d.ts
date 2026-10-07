import type { HcpProject, ChangeSet } from '@hcbridge/hcp';
import type { PatchPlan } from '@hcbridge/patch-engine';
import type { PlatformAdapter, PlatformCapabilities, PlatformProjection } from '@hcbridge/platform-contract';
export declare class JsonPlatformAdapter implements PlatformAdapter {
    private readonly schemaVersion;
    constructor(schemaVersion?: string);
    getCapabilities(): Promise<PlatformCapabilities>;
    project(project: HcpProject): Promise<PlatformProjection>;
    changesToPatch(_changes: ChangeSet[]): Promise<PatchPlan>;
}
