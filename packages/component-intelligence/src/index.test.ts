import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeComponentContract, buildComponentDependencyGraph } from './index';

describe('component intelligence', () => {
  it('extracts local component contract', () => {
    const file = path.resolve('fixtures/local/UserSelector.vue');
    const result = analyzeComponentContract(file, path.resolve('fixtures/local'));
    expect(result.contract.name).toBe('UserSelector');
    expect(result.contract.props.map((item) => item.name)).toContain('modelValue');
    expect(result.contract.events.map((item) => item.name)).toContain('change');
  });

  it('builds a recursive local component graph', () => {
    const root = path.resolve('fixtures/local');
    const graph = buildComponentDependencyGraph(path.join(root, 'Parent.vue'), root);
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.some((edge) => edge.localName === 'UserSelector' && edge.usedInTemplate)).toBe(true);
    expect(graph.cycles).toHaveLength(0);
  });
});
