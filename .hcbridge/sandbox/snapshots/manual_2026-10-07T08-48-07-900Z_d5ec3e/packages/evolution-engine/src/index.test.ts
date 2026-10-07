import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeVueFile, scanProject, createEvolutionPlan, applyEvolutionPlan, classifyChange } from './index';
import { parseVueSfc, flattenTemplate } from '@hcbridge/vue-parser';
import { createPatchPlan, applyPatchPlan } from '@hcbridge/patch-engine';

describe('high-code evolution engine v0.3', () => {
  const fixture = path.resolve('fixtures/basic/UserList.vue');
  const projectRoot = path.resolve('fixtures');

  it('scans a project and builds an index', () => {
    const result = scanProject(projectRoot);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.index.length).toBe(result.files.length);
    expect(result.totals.vueFiles).toBeGreaterThan(0);
    expect(result.totals.templateNodes).toBeGreaterThan(0);
  });

  it('resolves local components as a first-class import signal', () => {
    const result = analyzeVueFile(path.resolve('fixtures/local/Parent.vue'), projectRoot);
    expect(result.metrics.localComponents).toBe(1);
    const node = result.hcp.nodes.find((n) => n.tag === 'UserSelector');
    expect(node?.resolution?.kind).toBe('local-vue');
    expect(node?.mode).toBe('blackbox');
  });

  it('classifies evolution safety explicitly', () => {
    expect(classifyChange({ file: fixture, nodeId: 'x', operation: 'set-prop', target: 'type', value: 'default' })).toBe('SAFE');
    expect(classifyChange({ file: fixture, nodeId: 'x', operation: 'delete-node', target: '', value: '' })).toBe('ASSISTED');
    expect(classifyChange({ file: fixture, nodeId: 'x', operation: 'set-visibility', target: 'if', value: 'ok' })).toBe('RISKY');
  });

  it('creates a plan and preserves the original source hash', () => {
    const result = analyzeVueFile(fixture, projectRoot);
    const button = result.hcp.nodes.find((node) => node.tag === 'a-button')!;
    const plan = createEvolutionPlan(projectRoot, { version: '0.3', changes: [
      { file: 'basic/UserList.vue', nodeId: button.id, operation: 'set-prop', target: 'type', value: 'dashed' },
    ] });
    expect(plan.summary.SAFE).toBe(1);
    expect(plan.files[0]?.sourceHash).toBe(result.sourceHash);
    expect(plan.files[0]?.patch.sourceHash).toBe(result.sourceHash);
  });

  it('patches, reparses and rolls back an insert', () => {
    const text = fs.readFileSync(fixture, 'utf8');
    const parsed = parseVueSfc(fixture, text, { projectRoot });
    const form = flattenTemplate(parsed.template).find((node) => node.tag === 'a-form')!;
    const plan = createPatchPlan(parsed, { file: fixture, nodeId: form.nodeId, operation: 'insert-child', target: 'append', value: '<a-button>新增</a-button>' });
    const result = applyPatchPlan(parsed, plan);
    const reparsed = parseVueSfc(fixture, result.text, { projectRoot });
    expect(reparsed.diagnostics).toHaveLength(0);
    const rollback = applyPatchPlan(reparsed, result.inversePlan);
    expect(rollback.text).toBe(text);
  });

  it('detects stale source before a project evolution is applied', () => {
    const result = analyzeVueFile(fixture, projectRoot);
    const button = result.hcp.nodes.find((node) => node.tag === 'a-button')!;
    const plan = createEvolutionPlan(projectRoot, { changes: [
      { file: 'basic/UserList.vue', nodeId: button.id, operation: 'set-prop', target: 'type', value: 'dashed' },
    ] });
    const original = fs.readFileSync(fixture, 'utf8');
    fs.writeFileSync(fixture, original + '\n');
    expect(() => applyEvolutionPlan(projectRoot, plan)).toThrow('STALE_SOURCE');
    fs.writeFileSync(fixture, original);
  });
});
