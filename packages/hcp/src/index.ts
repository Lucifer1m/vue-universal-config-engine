import type { SemanticGraph } from '@hcbridge/semantic-graph';
import type { SourceRef, SemanticMode, Ownership } from '@hcbridge/source-model';
import type { ComponentCapabilityMeta } from '@hcbridge/capability-registry';

export type HcpCapabilityType = 'prop' | 'binding' | 'event' | 'slot' | 'style' | 'visibility' | 'data' | 'action' | 'permission' | 'custom';

export type HcpValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'expression'; value: string }
  | { kind: 'symbol'; value: string | null }
  | { kind: 'unknown'; value: string };

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

export function projectToHcp(
  graph: SemanticGraph,
  resolveMeta: (name: string) => ComponentCapabilityMeta | undefined,
): HcpProject {
  const componentById = new Map(graph.components.map((component) => [component.nodeId, component]));
  const nodes: HcpNode[] = graph.templateNodes.map((templateNode) => {
    const component = componentById.get(templateNode.nodeId);
    const meta = component ? resolveMeta(component.name) : undefined;
    const capabilities: Capability[] = [];

    if (component) {
      for (const [name, prop] of Object.entries(component.props)) {
        capabilities.push({
          type: 'prop', name, editable: true,
          value: prop.staticValue !== undefined ? { kind: 'literal', value: prop.staticValue } : { kind: 'unknown', value: '' },
          confidence: meta?.props[name] ? 0.99 : 0.92,
          ownership: 'PLATFORM', source: prop.source,
        });
      }
      for (const [name, event] of Object.entries(component.events)) {
        capabilities.push({ type: 'event', name, editable: false, value: { kind: 'symbol', value: event.handler ?? null }, confidence: event.handler ? 0.98 : 0.8, ownership: 'CODE', source: event.source });
      }
      if (meta?.blackBox) {
        return { id: templateNode.nodeId, kind: 'component', tag: templateNode.tag, source: [templateNode.source], capabilities, children: templateNode.children, mode: 'blackbox' };
      }
    }

    if (templateNode.kind === 'text') {
      capabilities.push({ type: 'custom', name: 'text', editable: true, value: { kind: 'unknown', value: '' }, confidence: 0.99, ownership: 'PLATFORM', source: templateNode.source });
    }

    for (const directive of templateNode.directives) {
      if (directive.name === 'if' || directive.name === 'for') {
        capabilities.push({ type: 'visibility', name: directive.name, editable: false, value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'unknown', value: '' }, confidence: 0.98, ownership: 'CODE', source: directive.source });
      }
      if (directive.name === 'bind' || directive.name === 'model') {
        capabilities.push({ type: 'binding', name: directive.arg ?? directive.name, editable: true, value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'unknown', value: '' }, confidence: 0.98, ownership: 'SHARED', source: directive.source });
      }
      if (directive.name === 'on') {
        capabilities.push({ type: 'event', name: directive.arg ?? 'unknown', editable: false, value: directive.expression ? { kind: 'symbol', value: directive.expression } : { kind: 'unknown', value: '' }, confidence: 0.95, ownership: 'CODE', source: directive.source });
      }
      if (directive.name === 'slot') {
        capabilities.push({ type: 'slot', name: directive.arg ?? 'default', editable: false, value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'symbol', value: 'default' }, confidence: 0.9, ownership: 'CODE', source: directive.source });
      }
      if (directive.name === 'style' || directive.name === 'class') {
        capabilities.push({ type: 'style', name: directive.name, editable: true, value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'unknown', value: '' }, confidence: 0.9, ownership: 'SHARED', source: directive.source });
      }
    }

    return {
      id: templateNode.nodeId,
      kind: templateNode.kind === 'component' ? 'component' : 'element',
      tag: templateNode.tag,
      source: [templateNode.source],
      capabilities,
      children: templateNode.children,
      mode: component ? (meta ? 'structured' : 'blackbox') : 'structured',
    };
  });
  return { version: '0.1', sourceFiles: [], nodes, diagnostics: graph.diagnostics };
}
