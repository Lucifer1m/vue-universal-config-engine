#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readAndParseSfc, findTemplateNode, flattenTemplate } from '@hcbridge/vue-parser';
import { analyzeScriptSetup } from '@hcbridge/ts-analyzer';
import { buildSemanticGraph } from '@hcbridge/semantic-graph';
import { projectToHcp } from '@hcbridge/hcp';
import { createAntDesignVueRegistry } from '@hcbridge/capability-registry';
import { createPatchPlan, applyPatchToFile } from '@hcbridge/patch-engine';
import { verifyProject } from '@hcbridge/verifier';
import type { ChangeSet } from '@hcbridge/hcp';

const [, , command, ...args] = process.argv;

if (!command) usage(1);

switch (command) {
  case 'init': init(); break;
  case 'analyze': analyze(args[0]); break;
  case 'inspect': inspect(args[0], args[1]); break;
  case 'plan': plan(args[0], args[1]); break;
  case 'apply': apply(args[0], args[1]); break;
  case 'rollback': rollback(args[0], args[1]); break;
  case 'verify': verify(args[0] ?? '.'); break;
  case 'report': report(args[0] ?? '.'); break;
  default: console.error(`Unknown command: ${command}`); usage(1);
}

function usage(code = 0): never {
  console.log(`hcbridge\n\nCommands:\n  init\n  analyze <file>\n  inspect <file> [nodeId]\n  plan <file> <change.json>\n  apply <file> <change.json>\n  verify <projectDir>\n  report <projectDir>`);
  process.exit(code);
  throw new Error('unreachable');
}

function parseProject(file: string) {
  const parsed = readAndParseSfc(file);
  const script = parsed.descriptor.scriptSetup;
  const scriptAnalysis = script
    ? analyzeScriptSetup(file, parsed.text, { content: script.content, offset: script.loc.start.offset })
    : { file, states: [], functions: [], imports: [], diagnostics: [] };
  const graph = buildSemanticGraph(parsed, scriptAnalysis);
  const registry = createAntDesignVueRegistry();
  const hcp = projectToHcp(graph, (name) => registry.resolve(name));
  return { parsed, scriptAnalysis, graph, hcp, registry };
}

function analyze(file?: string) {
  assertFile(file);
  const { graph, hcp } = parseProject(path.resolve(file!));
  console.log(JSON.stringify({
    file,
    components: graph.components,
    bindings: graph.bindings,
    events: graph.events,
    states: graph.states,
    hcp,
  }, null, 2));
}

function inspect(file?: string, nodeId?: string) {
  assertFile(file);
  const abs = path.resolve(file!);
  const { parsed, graph, hcp } = parseProject(abs);
  if (!nodeId) {
    console.log(JSON.stringify({ file: abs, nodes: flattenTemplate(parsed.template).map((n) => ({ id: n.nodeId, kind: n.kind, tag: n.tag, path: n.structuralPath, range: n.range })) }, null, 2));
    return;
  }
  const node = findTemplateNode(parsed, nodeId);
  const hcpNode = hcp.nodes.find((n) => n.id === nodeId);
  const semantic = graph.components.find((c) => c.nodeId === nodeId);
  console.log(JSON.stringify({ node, semantic, hcp: hcpNode }, null, 2));
}

function plan(file?: string, changeFile?: string, outFile?: string) {
  assertFile(file); assertFile(changeFile);
  const abs = path.resolve(file!);
  const change = readChange(changeFile!);
  const { parsed } = parseProject(abs);
  const patchPlan = createPatchPlan(parsed, change);
  const json = JSON.stringify(patchPlan, null, 2);
  if (outFile) { fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true }); fs.writeFileSync(path.resolve(outFile), json); console.log(`Wrote ${path.resolve(outFile)}`); }
  else console.log(json);
}

function apply(file?: string, changeFile?: string) {
  assertFile(file); assertFile(changeFile);
  const abs = path.resolve(file!);
  const change = readChange(changeFile!);
  const { parsed } = parseProject(abs);
  const patchPlan = createPatchPlan(parsed, change);
  if (patchPlan.diagnostics.some((d) => d.severity === 'error')) {
    console.error(JSON.stringify(patchPlan, null, 2));
    process.exit(2);
  }
  const result = applyPatchToFile(abs, patchPlan);
  console.log(result.gitDiff || 'No changes.');
  const rollbackDir = path.resolve('.hcbridge', 'rollback');
  fs.mkdirSync(rollbackDir, { recursive: true });
  const safeName = abs.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const inversePath = path.join(rollbackDir, `${safeName}.inverse.json`);
  fs.writeFileSync(inversePath, JSON.stringify(result.inversePlan, null, 2));
  console.log(`\nInverse plan: ${inversePath}`);
}

function rollback(file?: string, inverseFile?: string) {
  assertFile(file); assertFile(inverseFile);
  const abs = path.resolve(file!);
  const inverse = JSON.parse(fs.readFileSync(inverseFile!, 'utf8'));
  const result = applyPatchToFile(abs, inverse);
  console.log(result.gitDiff || 'Rollback produced no changes.');
}

function verify(projectDir: string) {
  console.log(JSON.stringify(verifyProject(path.resolve(projectDir)), null, 2));
}

function report(projectDir: string) {
  const dir = path.resolve(projectDir);
  const vueFiles = walk(dir).filter((f) => f.endsWith('.vue'));
  const rows = vueFiles.map((file) => {
    try {
      const { graph, hcp } = parseProject(file);
      const opaque = hcp.nodes.filter((n) => n.mode === 'opaque').length;
      return { file: path.relative(dir, file), components: graph.components.length, hcpNodes: hcp.nodes.length, opaque };
    } catch (error) {
      return { file: path.relative(dir, file), error: String(error) };
    }
  });
  console.log(JSON.stringify({ projectDir: dir, vueFiles: vueFiles.length, files: rows }, null, 2));
}

function init() {
  const dir = path.resolve('.hcbridge');
  fs.mkdirSync(dir, { recursive: true });
  const config = { version: '0.1', include: ['src/**/*.vue'], mode: 'safe-reject', platform: 'adapter' };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  console.log(`Created ${path.relative(process.cwd(), path.join(dir, 'config.json'))}`);
}

function readChange(file: string): ChangeSet {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ChangeSet;
  if (!value.file || !value.nodeId || !value.operation || !value.target) throw new Error('Invalid ChangeSet JSON');
  return value;
}
function assertFile(file?: string): asserts file is string {
  if (!file || !fs.existsSync(file)) { console.error(`File not found: ${file ?? ''}`); process.exit(2); }
}
function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules','.git','dist','.hcbridge'].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
