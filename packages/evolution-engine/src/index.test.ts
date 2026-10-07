import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeVueFile, scanProject, createEvolutionPlan, applyEvolutionPlan } from './index';
import { parseVueSfc, flattenTemplate } from '@hcbridge/vue-parser';
import { createPatchPlan, applyPatchPlan } from '@hcbridge/patch-engine';

describe('high-code evolution engine', () => {
  const fixture = path.resolve('fixtures/basic/UserList.vue');
  const projectRoot = path.resolve('fixtures');

  it('scans a project and returns coverage metrics', () => {
    const result = scanProject(projectRoot);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.totals.vueFiles).toBeGreaterThan(0);
    expect(result.totals.templateNodes).toBeGreaterThan(0);
  });

  it('creates a capability report for a real Vue file', () => {
    const result = analyzeVueFile(fixture, path.resolve('fixtures'));
    expect(result.metrics.components).toBeGreaterThan(0);
    expect(result.hcp.nodes.length).toBeGreaterThan(0);
    expect(result.sourceHash).toHaveLength(64);
  });

  it('adds and updates static props without rewriting the file', () => {
    const text = fs.readFileSync(fixture, 'utf8');
    const parsed = parseVueSfc(fixture, text);
    const button = flattenTemplate(parsed.template).find((node) => node.tag === 'a-button')!;
    const plan = createPatchPlan(parsed, { file: fixture, nodeId: button.nodeId, operation: 'set-prop', target: 'danger', value: 'true' });
    const result = applyPatchPlan(parsed, plan);
    expect(result.text).toContain('danger="true"');
    expect(result.text).toContain('@click="search"');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('round-trips inserted children with the generated inverse plan', () => {
    const text = fs.readFileSync(fixture, 'utf8');
    const parsed = parseVueSfc(fixture, text);
    const form = flattenTemplate(parsed.template).find((node) => node.tag === 'a-form')!;
    const plan = createPatchPlan(parsed, { file: fixture, nodeId: form.nodeId, operation: 'insert-child', target: 'append', value: '<a-button>新增</a-button>' });
    const result = applyPatchPlan(parsed, plan);
    expect(result.text).toContain('<a-button>新增</a-button>');
    const reparsed = parseVueSfc(fixture, result.text);
    const rolledBack = applyPatchPlan(reparsed, result.inversePlan);
    expect(rolledBack.text).toBe(text);
  });

  it('creates a project evolution plan from semantic node ids', () => {
    const analysis = analyzeVueFile(fixture, projectRoot);
    const button = analysis.hcp.nodes.find((node) => node.tag === 'a-button')!;
    const changes = {
      changes: [
        { file: 'basic/UserList.vue', nodeId: button.id, operation: 'set-prop', target: 'danger', value: 'true' },
      ],
    } as any;
    const plan = createEvolutionPlan(projectRoot, changes);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.patch.diagnostics).toHaveLength(0);
    expect(plan.files[0]!.patch.operations).toHaveLength(1);
  });
});
