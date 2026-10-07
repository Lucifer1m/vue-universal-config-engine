import fs from 'node:fs';
import path from 'node:path';
import { parseVueSfc } from '@hcbridge/vue-parser';
import { analyzeScriptSetup } from '@hcbridge/ts-analyzer';
import { buildSemanticGraph } from '@hcbridge/semantic-graph';
import { projectToHcp } from '@hcbridge/hcp';
import { createAntDesignVueRegistry } from '@hcbridge/capability-registry';
import { createPatchPlan, applyPatchPlan } from '@hcbridge/patch-engine';

export interface FixtureRunResult {
  fixture: string;
  nodeCount: number;
  hcpCount: number;
  patchChanged: boolean;
  reparsed: boolean;
}

export function runFixture(file: string, change?: import('@hcbridge/hcp').ChangeSet): FixtureRunResult {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseVueSfc(file, text);
  const script = parsed.descriptor.scriptSetup;
  const scriptAnalysis = script
    ? analyzeScriptSetup(file, text, { content: script.content, offset: script.loc.start.offset })
    : { file, states: [], functions: [], imports: [], diagnostics: [] };
  const graph = buildSemanticGraph(parsed, scriptAnalysis);
  const hcp = projectToHcp(graph, (name) => createAntDesignVueRegistry().resolve(name));
  if (!change) return { fixture: path.basename(file), nodeCount: graph.components.length, hcpCount: hcp.nodes.length, patchChanged: false, reparsed: true };
  const plan = createPatchPlan(parsed, change);
  if (plan.diagnostics.some((d) => d.severity === 'error')) throw new Error(plan.diagnostics.map((d) => d.message).join('\n'));
  const result = applyPatchPlan(parsed, plan);
  const reparsed = parseVueSfc(file, result.text).diagnostics.every((d) => d.severity !== 'error');
  return { fixture: path.basename(file), nodeCount: graph.components.length, hcpCount: hcp.nodes.length, patchChanged: result.changed, reparsed };
}
