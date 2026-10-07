import type { HcpProject, ChangeSet } from '@hcbridge/hcp';
import type { PatchPlan } from '@hcbridge/patch-engine';
import type { PlatformAdapter, PlatformCapabilities, PlatformProjection } from '@hcbridge/platform-contract';
import type { HcpNode } from '@hcbridge/hcp';

export class JsonPlatformAdapter implements PlatformAdapter {
  constructor(private readonly schemaVersion = 'demo-0.1') {}

  async getCapabilities(): Promise<PlatformCapabilities> {
    return { schemaVersion: this.schemaVersion, supportedCapabilityTypes: ['prop', 'binding', 'event'], supportedComponents: [] };
  }

  async project(project: HcpProject): Promise<PlatformProjection> {
    return {
      schemaVersion: this.schemaVersion,
      document: project.nodes.map((node: HcpNode) => ({
        id: node.id,
        component: node.tag,
        mode: node.mode,
        capabilities: node.capabilities,
      })),
      sourceMap: Object.fromEntries(project.nodes.map((node) => [node.id, node.source])),
    };
  }

  async changesToPatch(_changes: ChangeSet[]): Promise<PatchPlan> {
    return { version: '0.2', sourceHash: '', operations: [], inverse: [], diagnostics: [{ severity: 'error', code: 'ADAPTER_DEMO', message: 'Map platform changes to PatchPlan in your platform adapter.' }] };
  }
}
