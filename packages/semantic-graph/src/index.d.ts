import type { ScriptAnalysis } from '@hcbridge/ts-analyzer';
import type { ParsedSfc } from '@hcbridge/vue-parser';
import type { SourceRef, Diagnostic } from '@hcbridge/source-model';
export interface ComponentSemantic {
    nodeId: string;
    name: string;
    tag: string;
    source: SourceRef;
    mode: 'structured' | 'blackbox';
    props: Record<string, {
        staticValue?: string;
        binding?: string;
        source: SourceRef;
    }>;
    events: Record<string, {
        handler?: string;
        source: SourceRef;
    }>;
}
export interface BindingSemantic {
    nodeId: string;
    target: string;
    expression: string;
    kind: 'v-model' | 'prop' | 'text';
    source: SourceRef;
}
export interface EventSemantic {
    nodeId: string;
    event: string;
    handler?: string;
    source: SourceRef;
}
export interface StateSemantic {
    id: string;
    kind: string;
    source: SourceRef;
    expression?: string;
}
export interface TemplateNodeSemantic {
    nodeId: string;
    kind: 'element' | 'component' | 'text' | 'root';
    tag?: string;
    source: SourceRef;
    parentNodeId?: string;
    children: string[];
    directives: {
        name: string;
        arg?: string;
        expression?: string;
        source: SourceRef;
    }[];
    attributes: {
        name: string;
        value?: string;
        source: SourceRef;
    }[];
}
export interface SemanticGraph {
    file: string;
    templateNodes: TemplateNodeSemantic[];
    components: ComponentSemantic[];
    bindings: BindingSemantic[];
    events: EventSemantic[];
    states: StateSemantic[];
    diagnostics: Diagnostic[];
}
export declare function buildSemanticGraph(parsed: ParsedSfc, script: ScriptAnalysis): SemanticGraph;
