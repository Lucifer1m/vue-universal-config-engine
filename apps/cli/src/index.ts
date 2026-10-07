#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeVueFile,
  scanProject,
  createEvolutionPlan,
  applyEvolutionPlan,
  writeProjectArtifacts,
  createProjectSnapshot,
  compareSnapshot,
  detectProject,
  type EvolutionChangeSet,
  type EvolutionPlan,
} from '@hcbridge/evolution-engine';
import { flattenTemplate, parseVueSfc } from '@hcbridge/vue-parser';
import { createAntDesignVueRegistry } from '@hcbridge/capability-registry';
import { createPatchPlan, applyPatchToFile } from '@hcbridge/patch-engine';
import { verifyProject } from '@hcbridge/verifier';

const [, , command, ...args] = process.argv;

if (!command) usage(1);

try {
  switch (command) {
    case 'init': init(args[0] ?? '.'); break;
    case 'doctor': doctor(args[0] ?? '.'); break;
    case 'scan': scan(args[0] ?? '.'); break;
    case 'analyze': analyze(args[0]); break;
    case 'inspect': inspect(args[0], args[1]); break;
    case 'capabilities': capabilities(args[0]); break;
    case 'plan': plan(args[0], args[1], args[2]); break;
    case 'apply': apply(args[0], args[1]); break;
    case 'evolve': evolve(args[0] ?? '.', args[1]); break;
    case 'rollback': rollback(args[0], args[1]); break;
    case 'snapshot': snapshot(args[0] ?? '.', args[1]); break;
    case 'status': status(args[0] ?? '.', args[1]); break;
    case 'history': history(args[0] ?? '.'); break;
    case 'verify': verify(args[0] ?? '.'); break;
    case 'report': report(args[0] ?? '.'); break;
    default: console.error(`Unknown command: ${command}`); usage(1);
  }
} catch (error) {
  console.error(`hcbridge: ${String(error)}`);
  process.exit(2);
}

function usage(code = 0): never {
  console.log(`hcbridge - Vue 3 High-Code Evolver\n\nCommands:\n  init <projectDir>\n  doctor <projectDir>\n  scan <projectDir>\n  analyze <file>\n  inspect <file> [nodeId]\n  capabilities <file>\n  plan <file|projectDir> <changes.json> [out.json]\n  apply <file> <change.json>\n  evolve <projectDir> <changes.json>\n  rollback <file> <inverse.json>\n  snapshot <projectDir> [out.json]\n  verify <projectDir>\n  report <projectDir>\n\nChangeSet examples:\n  set-prop       existing or new static prop\n  remove-prop    remove attr/directive by target\n  set-binding    set or add :prop expression\n  set-event      set or add @event handler\n  set-visibility set or add v-if expression\n  set-text       replace direct text node\n  insert-child   append/prepend raw child template (target=append|prepend)\n  delete-node    delete a template node\n`);
  process.exit(code);
  throw new Error('unreachable');
}

function init(projectDir: string) {
  const dir = path.resolve(projectDir);
  const hc = path.join(dir, '.hcbridge');
  fs.mkdirSync(hc, { recursive: true });
  const config = {
    version: '0.2',
    include: ['.'],
    exclude: ['node_modules', 'dist', '.git', '.hcbridge'],
    policy: { mode: 'safe-reject', autoPatchConfidence: 0.9 },
    adapters: { platform: null, build: detectProject(dir).vite ? 'vite' : null },
  };
  fs.writeFileSync(path.join(hc, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Initialized ${path.join(hc, 'config.json')}`);
}

function doctor(projectDir: string) {
  const root = path.resolve(projectDir);
  const framework = detectProject(root);
  const checks = {
    packageJson: fs.existsSync(path.join(root, 'package.json')),
    pnpmLock: fs.existsSync(path.join(root, 'pnpm-lock.yaml')),
    vue: framework.vue,
    vite: framework.vite,
    nuxt: framework.nuxt,
    hcbridge: fs.existsSync(path.join(root, '.hcbridge')),
  };
  console.log(JSON.stringify({ projectRoot: root, framework, checks, ok: checks.packageJson && checks.vue }, null, 2));
}

function scan(projectDir: string) {
  const root = path.resolve(projectDir);
  const result = scanProject(root);
  console.log(JSON.stringify({
    projectRoot: result.projectRoot,
    framework: result.framework,
    generatedAt: result.generatedAt,
    totals: result.totals,
    files: result.files.map((f) => ({ file: f.relativeFile, sourceHash: f.sourceHash, metrics: f.metrics })),
  }, null, 2));
}

function analyze(file?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!));
  console.log(JSON.stringify({
    file: result.file,
    sourceHash: result.sourceHash,
    metrics: result.metrics,
    diagnostics: result.graph.diagnostics,
    components: result.graph.components,
    bindings: result.graph.bindings,
    events: result.graph.events,
    states: result.graph.states,
    hcp: result.hcp,
  }, null, 2));
}

function inspect(file?: string, nodeId?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!));
  if (!nodeId) {
    console.log(JSON.stringify({
      file: result.file,
      nodes: flattenTemplate(result.parsed.template).map((n) => ({
        id: n.nodeId,
        kind: n.kind,
        tag: n.tag,
        path: n.structuralPath,
        range: n.range,
        source: n.sourceText,
      })),
    }, null, 2));
    return;
  }
  const node = flattenTemplate(result.parsed.template).find((n) => n.nodeId === nodeId);
  if (!node) throw new Error(`NODE_NOT_FOUND: ${nodeId}`);
  const hcpNode = result.hcp.nodes.find((n) => n.id === nodeId);
  const semantic = result.graph.components.find((c) => c.nodeId === nodeId);
  console.log(JSON.stringify({ node, semantic, hcp: hcpNode }, null, 2));
}

function capabilities(file?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!), process.cwd(), createAntDesignVueRegistry());
  console.log(JSON.stringify({ file: result.file, capabilities: result.hcp.nodes.map((n) => ({ id: n.id, tag: n.tag, mode: n.mode, capabilities: n.capabilities })) }, null, 2));
}

function plan(input?: string, changesFile?: string, outFile?: string) {
  assertPath(input); assertFile(changesFile);
  const root = resolveProjectRoot(input!);
  const changes = readChanges(changesFile!);
  const evolution = createEvolutionPlan(root, changes);
  if (outFile) { fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true }); fs.writeFileSync(path.resolve(outFile), JSON.stringify(evolution, null, 2)); console.log(`Wrote ${path.resolve(outFile)}`); }
  else console.log(JSON.stringify(evolution, null, 2));
}

function apply(file?: string, changeFile?: string) {
  assertFile(file); assertFile(changeFile);
  const abs = path.resolve(file!);
  const changes = readChanges(changeFile!);
  const change = changes.changes[0];
  if (!change) throw new Error('No changes provided.');
  const parsed = parseVueSfc(abs, fs.readFileSync(abs, 'utf8'));
  const patchPlan = createPatchPlan(parsed, { ...change, file: abs });
  const result = applyPatchToFile(abs, patchPlan);
  persistInverse(abs, result.inversePlan);
  console.log(result.gitDiff || 'No changes.');
}

function evolve(projectDir: string, changesFile?: string) {
  assertFile(changesFile);
  const root = path.resolve(projectDir);
  const changes = readChanges(changesFile!);
  const planResult = createEvolutionPlan(root, changes);
  console.log(JSON.stringify({ phase: 'plan', plan: planResult }, null, 2));
  if (planResult.diagnostics.some((d) => d.severity === 'error')) process.exit(2);
  const result = applyEvolutionPlan(root, planResult, { verify: true, stopOnFailure: true });
  const rollback = { version: '0.2', createdAt: new Date().toISOString(), projectRoot: root, files: result.inversePlans };
  const hc = path.join(root, '.hcbridge', 'rollback');
  fs.mkdirSync(hc, { recursive: true });
  const rollbackPath = path.join(hc, `evolution-${Date.now()}.json`);
  fs.writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));
  console.log(JSON.stringify({ changedFiles: result.changedFiles, skippedFiles: result.skippedFiles, diffs: result.diffs, verification: result.verification, rollbackPath }, null, 2));
}

function rollback(file?: string, inverseFile?: string) {
  assertFile(file); assertFile(inverseFile);
  const abs = path.resolve(file!);
  const raw = JSON.parse(fs.readFileSync(inverseFile!, 'utf8'));
  if (Array.isArray(raw.files)) {
    for (const item of raw.files as Array<{ file: string; plan: unknown }>) {
      const target = path.isAbsolute(item.file) ? item.file : path.resolve(path.dirname(abs), item.file);
      const result = applyPatchToFile(target, item.plan as any);
      console.log(result.gitDiff || `Rollback produced no changes: ${target}`);
    }
    return;
  }
  const plan = raw.plan ?? raw;
  const result = applyPatchToFile(abs, plan);
  console.log(result.gitDiff || 'Rollback produced no changes.');
}

function snapshot(projectDir: string, outFile?: string) {
  const project = scanProject(path.resolve(projectDir));
  const value = createProjectSnapshot(project);
  const file = outFile ? path.resolve(outFile) : path.join(project.projectRoot, '.hcbridge', 'snapshot.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  console.log(`Snapshot: ${file}`);
}


function status(projectDir: string, snapshotFile?: string) {
  const root = path.resolve(projectDir);
  const project = scanProject(root);
  const file = snapshotFile ? path.resolve(snapshotFile) : path.join(root, '.hcbridge', 'snapshot.json');
  if (!fs.existsSync(file)) throw new Error(`Snapshot not found: ${file}`);
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(compareSnapshot(project, snapshot), null, 2));
}

function history(projectDir: string) {
  const dir = path.join(path.resolve(projectDir), '.hcbridge', 'rollback');
  if (!fs.existsSync(dir)) { console.log(JSON.stringify({ rollbackDir: dir, entries: [] }, null, 2)); return; }
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().reverse().map((name) => ({ file: name, path: path.join(dir, name), size: fs.statSync(path.join(dir, name)).size }));
  console.log(JSON.stringify({ rollbackDir: dir, entries }, null, 2));
}

function verify(projectDir: string) {
  console.log(JSON.stringify(verifyProject(path.resolve(projectDir)), null, 2));
}

function report(projectDir: string) {
  const project = scanProject(path.resolve(projectDir));
  const artifacts = writeProjectArtifacts(project);
  console.log(JSON.stringify({ projectRoot: project.projectRoot, totals: project.totals, artifacts }, null, 2));
}

function readChanges(file: string): EvolutionChangeSet {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as EvolutionChangeSet | ChangeSetLike;
  if (Array.isArray((value as EvolutionChangeSet).changes)) {
    return value as EvolutionChangeSet;
  }
  return { changes: [value as unknown as ChangeSetLike] as any };
}

type ChangeSetLike = {
  file: string;
  nodeId: string;
  operation: string;
  target: string;
  value: string;
};

function persistInverse(file: string, plan: unknown) {
  const rollbackDir = path.resolve('.hcbridge', 'rollback');
  fs.mkdirSync(rollbackDir, { recursive: true });
  const safe = path.basename(file).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const inversePath = path.join(rollbackDir, `${Date.now()}-${safe}.inverse.json`);
  fs.writeFileSync(inversePath, JSON.stringify(plan, null, 2));
  console.log(`\nInverse plan: ${inversePath}`);
}

function resolveProjectRoot(input: string): string {
  const abs = path.resolve(input);
  return abs.endsWith('.vue') ? path.dirname(abs) : abs;
}

function assertFile(file?: string): asserts file is string {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${file ?? ''}`);
}
function assertPath(file?: string): asserts file is string {
  if (!file || !fs.existsSync(file)) throw new Error(`Path not found: ${file ?? ''}`);
}
