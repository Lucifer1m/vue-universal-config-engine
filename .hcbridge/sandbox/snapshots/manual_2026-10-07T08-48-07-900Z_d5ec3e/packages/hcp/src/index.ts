import type { SemanticGraph } from '@hcbridge/semantic-graph';
import type { SourceRef, SemanticMode, Ownership } from '@hcbridge/source-model';
import type { ComponentCapabilityMeta } from '@hcbridge/capability-registry';
import type { ComponentResolution } from '@hcbridge/component-resolver';

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
  resolution?: ComponentResolution;
}

export interface HcpProject {
  version: '0.1';
  sourceFiles: SourceRef[];
  nodes: HcpNode[];
  diagnostics: SemanticGraph['diagnostics'];
}

export type ChangeOperation =
  | 'set-prop'
  | 'remove-prop'
  | 'set-text'
  | 'set-binding'
  | 'set-event'
  | 'set-visibility'
  | 'delete-node'
  | 'insert-child';

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
  resolutions: Map<string, ComponentResolution> = new Map(),
): HcpProject {
  const componentById = new Map(graph.components.map((component) => [component.nodeId, component]));
  const nodes: HcpNode[] = graph.templateNodes.map((templateNode) => {
    const component = componentById.get(templateNode.nodeId);
    const meta = component ? resolveMeta(component.name) : undefined;
    const capabilities: Capability[] = [];

    if (component) {
      for (const [name, prop] of Object.entries(component.props)) {
        capabilities.push({
          type: 'prop',
          name,
          editable: true,
          value: prop.staticValue !== undefined ? { kind: 'literal', value: prop.staticValue } : { kind: 'unknown', value: '' },
          confidence: meta?.props[name] ? 0.99 : 0.90,
          ownership: 'PLATFORM',
          source: prop.source,
        });
      }
      for (const [name, event] of Object.entries(component.events)) {
        capabilities.push({
          type: 'event',
          name,
          editable: true,
          value: { kind: 'symbol', value: event.handler ?? null },
          confidence: event.handler ? 0.98 : 0.82,
          ownership: 'SHARED',
          source: event.source,
        });
      }
      if (meta?.blackBox) {
        return {
          id: templateNode.nodeId,
          kind: 'component',
          tag: templateNode.tag,
          source: [templateNode.source],
          capabilities,
          children: templateNode.children,
          mode: 'blackbox',
          resolution: resolutions.get(component.name),
        };
      }
    }

    if (templateNode.kind === 'text') {
      capabilities.push({
        type: 'custom',
        name: 'text',
        editable: true,
        value: { kind: 'literal', value: '' },
        confidence: 0.99,
        ownership: 'PLATFORM',
        source: templateNode.source,
      });
    }

    if (templateNode.kind === 'element') {
      for (const attr of templateNode.attributes) {
        capabilities.push({
          type: attr.name === 'class' || attr.name === 'style' ? 'style' : 'prop',
          name: attr.name,
          editable: true,
          value: { kind: 'literal', value: attr.value ?? true },
          confidence: 0.96,
          ownership: 'PLATFORM',
          source: attr.source,
        });
      }
    }

    for (const directive of templateNode.directives) {
      if (directive.name === 'if' || directive.name === 'for') {
        capabilities.push({
          type: 'visibility',
          name: directive.name,
          editable: false,
          value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'unknown', value: '' },
          confidence: 0.98,
          ownership: 'CODE',
          source: directive.source,
        });
      }
      if (directive.name === 'bind' || directive.name === 'model') {
        capabilities.push({
          type: 'binding',
          name: directive.arg ?? directive.name,
          editable: true,
          value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'unknown', value: '' },
          confidence: 0.98,
          ownership: 'SHARED',
          source: directive.source,
        });
      }
      if (directive.name === 'on') {
        capabilities.push({
          type: 'event',
          name: directive.arg ?? 'unknown',
          editable: true,
          value: directive.expression ? { kind: 'symbol', value: directive.expression } : { kind: 'unknown', value: '' },
          confidence: 0.95,
          ownership: 'SHARED',
          source: directive.source,
        });
      }
      if (directive.name === 'slot') {
        capabilities.push({
          type: 'slot',
          name: directive.arg ?? 'default',
          editable: false,
          value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'symbol', value: 'default' },
          confidence: 0.90,
          ownership: 'CODE',
          source: directive.source,
        });
      }
      if (directive.name === 'style' || directive.name === 'class') {
        capabilities.push({
          type: 'style',
          name: directive.name,
          editable: true,
          value: directive.expression ? { kind: 'expression', value: directive.expression } : { kind: 'literal', value: '' },
          confidence: 0.90,
          ownership: 'SHARED',
          source: directive.source,
        });
      }
    }

    // Native/template attributes are also configurable, even when the node is not a registered component.
    for (const attr of findNativeAttributes(graph, templateNode.nodeId)) {
      capabilities.push(attr);
    }

    return {
      id: templateNode.nodeId,
      kind: templateNode.kind === 'component' ? 'component' : 'element',
      tag: templateNode.tag,
      source: [templateNode.source],
      capabilities,
      children: templateNode.children,
      mode: component ? (meta ? 'structured' : 'blackbox') : 'structured',
      resolution: component ? resolutions.get(component.name) : undefined,
    };
  });
  return { version: '0.1', sourceFiles: [], nodes, diagnostics: graph.diagnostics };
}


function findNativeAttributes(graph: SemanticGraph, nodeId: string): Capability[] {
  const node = graph.templateNodes.find((item) => item.nodeId === nodeId);
  if (!node) return [];
  return node.attributes.map((attr) => ({
    type: attr.name === 'class' || attr.name === 'style' ? 'style' : 'prop',
    name: attr.name,
    editable: true,
    value: { kind: 'literal', value: attr.value ?? true },
    confidence: 0.95,
    ownership: 'PLATFORM',
    source: attr.source,
  })).filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index);
}
