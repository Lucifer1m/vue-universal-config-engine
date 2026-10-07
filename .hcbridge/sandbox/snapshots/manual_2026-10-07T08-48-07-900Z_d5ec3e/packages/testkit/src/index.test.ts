import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVueSfc, flattenTemplate } from '@hcbridge/vue-parser';
import { analyzeScriptSetup } from '@hcbridge/ts-analyzer';
import { buildSemanticGraph } from '@hcbridge/semantic-graph';
import { createPatchPlan, applyPatchPlan } from '@hcbridge/patch-engine';
import { createAntDesignVueRegistry } from '@hcbridge/capability-registry';
import { projectToHcp } from '@hcbridge/hcp';

describe('Vue semantic pipeline', () => {
  const file = path.resolve('fixtures/basic/UserList.vue');
  const text = fs.readFileSync(file, 'utf8');

  it('parses SFC and template source ranges', () => {
    const parsed = parseVueSfc(file, text);
    const nodes = flattenTemplate(parsed.template);
    expect(parsed.descriptor.template).toBeTruthy();
    expect(nodes.some((n) => n.tag === 'a-button')).toBe(true);
    const button = nodes.find((n) => n.tag === 'a-button')!;
    expect(button.range.start.offset).toBeGreaterThan(0);
    expect(text.slice(button.range.start.offset, button.range.end.offset)).toContain('a-button');
  });

  it('analyzes script setup state and functions', () => {
    const parsed = parseVueSfc(file, text);
    const script = parsed.descriptor.scriptSetup!;
    const analysis = analyzeScriptSetup(file, text, { content: script.content, offset: script.loc.start.offset });
    expect(analysis.states.map((s) => s.id)).toEqual(expect.arrayContaining(['form', 'loading']));
    expect(analysis.functions.map((f) => f.name)).toContain('search');
  });

  it('builds semantic graph', () => {
    const parsed = parseVueSfc(file, text);
    const script = parsed.descriptor.scriptSetup!;
    const analysis = analyzeScriptSetup(file, text, { content: script.content, offset: script.loc.start.offset });
    const graph = buildSemanticGraph(parsed, analysis);
    expect(graph.components.map((c) => c.name)).toEqual(expect.arrayContaining(['AForm', 'AInput', 'AButton']));
  });

  it('patches only the targeted prop and reparses', () => {
    const parsed = parseVueSfc(file, text);
    const button = flattenTemplate(parsed.template).find((n) => n.tag === 'a-button')!;
    const plan = createPatchPlan(parsed, {
      file,
      nodeId: button.nodeId,
      operation: 'set-prop',
      target: 'type',
      value: 'default',
    });
    expect(plan.diagnostics).toHaveLength(0);
    const result = applyPatchPlan(parsed, plan);
    expect(result.text).toContain('type="default"');
    expect(result.text).toContain('@click="search"');
    expect(result.text).toContain('const search = async () =>');
    const reparsed = parseVueSfc(file, result.text);
    expect(reparsed.diagnostics).toHaveLength(0);
  });


  it('keeps unknown custom components as blackbox', () => {
    const customFile = path.resolve('fixtures/custom/Custom.vue');
    const customText = fs.readFileSync(customFile, 'utf8');
    const parsed = parseVueSfc(customFile, customText);
    const script = parsed.descriptor.scriptSetup!;
    const analysis = analyzeScriptSetup(customFile, customText, { content: script.content, offset: script.loc.start.offset });
    const graph = buildSemanticGraph(parsed, analysis);
    const hcp = projectToHcp(graph, (name) => createAntDesignVueRegistry().resolve(name));
    const custom = hcp.nodes.find((n) => n.tag === 'CompanyUserSelector');
    expect(custom?.mode).toBe('blackbox');
  });

  it('rejects stale patch preconditions', () => {
    const parsed = parseVueSfc(file, text);
    const button = flattenTemplate(parsed.template).find((n) => n.tag === 'a-button')!;
    const plan = createPatchPlan(parsed, {
      file,
      nodeId: button.nodeId,
      operation: 'set-prop',
      target: 'type',
      value: 'default',
    });
    plan.operations[0]!.oldTextHash = 'stale';
    expect(() => applyPatchPlan(parsed, plan)).toThrow('PATCH_PRECONDITION_FAILED');
  });
});
