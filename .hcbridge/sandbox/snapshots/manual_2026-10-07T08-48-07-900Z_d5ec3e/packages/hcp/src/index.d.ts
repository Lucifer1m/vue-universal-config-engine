import type { SemanticGraph } from '@hcbridge/semantic-graph';
import type { SourceRef, SemanticMode, Ownership } from '@hcbridge/source-model';
import type { ComponentCapabilityMeta } from '@hcbridge/capability-registry';
import type { ComponentResolution } from '@hcbridge/component-resolver';
export type HcpCapabilityType = 'prop' | 'binding' | 'event' | 'slot' | 'style' | 'visibility' | 'data' | 'action' | 'permission' | 'custom';
export type HcpValue = {
    kind: 'literal';
    value: unknown;
} | {
    kind: 'expression';
    value: string;
} | {
    kind: 'symbol';
    value: string | null;
} | {
    kind: 'unknown';
    value: string;
};
export interface Capability {
    type: HcpCapabilityType;
    name: string;
    editable: boolean;
    value: HcpValue;
    confidence: number;
    ownership?: Ownership;
    source?: SourceRef;
}
export interface HcpNode {
    id: string;
    kind: 'element' | 'component' | 'fragment' | 'opaque';
    tag?: string;
    source: SourceRef[];
    capabilities: Capability[];
    children: string[];
    mode: SemanticMode;
    resolution?: ComponentResolution;
}
export interface HcpProject {
    version: '0.1';
    sourceFiles: SourceRef[];
    nodes: HcpNode[];
    diagnostics: SemanticGraph['diagnostics'];
}
export type ChangeOperation = 'set-prop' | 'remove-prop' | 'set-text' | 'set-binding' | 'set-event' | 'set-visibility' | 'delete-node' | 'insert-child';
export interface ChangeSet {
    file: string;
    nodeId: string;
    operation: ChangeOperation;
    target: string;
    value: string;
}
export declare function projectToHcp(graph: SemanticGraph, resolveMeta: (name: string) => ComponentCapabilityMeta | undefined, resolutions?: Map<string, ComponentResolution>): HcpProject;
