export class JsonPlatformAdapter {
    schemaVersion;
    constructor(schemaVersion = 'demo-0.1') {
        this.schemaVersion = schemaVersion;
    }
    async getCapabilities() {
        return { schemaVersion: this.schemaVersion, supportedCapabilityTypes: ['prop', 'binding', 'event'], supportedComponents: [] };
    }
    async project(project) {
        return {
            schemaVersion: this.schemaVersion,
            document: project.nodes.map((node) => ({
                id: node.id,
                component: node.tag,
                mode: node.mode,
                capabilities: node.capabilities,
            })),
            sourceMap: Object.fromEntries(project.nodes.map((node) => [node.id, node.source])),
        };
    }
    async changesToPatch(_changes) {
        return { version: '0.1', operations: [], inverse: [], diagnostics: [{ severity: 'error', code: 'ADAPTER_DEMO', message: 'Map platform changes to PatchPlan in your platform adapter.' }] };
    }
}
//# sourceMappingURL=index.js.map