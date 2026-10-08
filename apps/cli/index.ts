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
  rollbackJournal,
  type EvolutionChangeSet,
  type EvolutionPlan,
  type SafetyLevel,
} from '@hcbridge/evolution-engine';
import { flattenTemplate, parseVueSfc } from '@hcbridge/vue-parser';
import { createPatchPlan, applyPatchToFile } from '@hcbridge/patch-engine';
import { verifyProject } from '@hcbridge/verifier';
import { analyzeComponentContract, buildComponentDependencyGraph } from '@hcbridge/component-intelligence';
import { createSandboxSession, type EditIntent } from '@hcbridge/sandbox-kernel';
import { inspectDomTarget, type DomTargetSignature } from '@hcbridge/visual-inspector';
import { buildAgentContext } from '@hcbridge/agent-kernel';
import { buildContextPack, createConfiguredAgent } from '@hcbridge/llm-provider';

const [, , command, ...args] = process.argv;

if (!command) usage(1);

try {
  switch (command) {
    case 'init': init(args[0] ?? '.'); break;
    case 'doctor': doctor(args[0] ?? '.'); break;
    case 'scan': scan(args[0] ?? '.'); break;
    case 'index': index(args[0] ?? '.'); break;
    case 'analyze': analyze(args[0]); break;
    case 'inspect': inspect(args[0], args[1]); break;
    case 'inspect-runtime': inspectRuntime(args[0], args[1]); break;
    case 'agent-plan': agentPlan(args[0], args[1], args.slice(2).join(' ')); break;
    case 'agent-provider': agentProviderPlan(args[0], args[1], args.slice(2).join(' ')); break;
    case 'agent-context': agentContext(args[0], args[1]); break;
    case 'capabilities': capabilities(args[0]); break;
    case 'contract': contract(args[0]); break;
    case 'graph': graph(args[0], args.slice(1)); break;
    case 'plan': plan(args[0], args[1], args[2]); break;
    case 'apply': apply(args[0], args[1]); break;
    case 'evolve': evolve(args); break;
    case 'rollback': rollback(args[0], args[1]); break;
    case 'snapshot': snapshot(args[0] ?? '.', args[1]); break;
    case 'status': status(args[0] ?? '.', args[1]); break;
    case 'history': history(args[0] ?? '.'); break;
    case 'verify': verify(args[0] ?? '.'); break;
    case 'report': report(args[0] ?? '.'); break;
    case 'sandbox': sandbox(args); break;
    default: console.error(`Unknown command: ${command}`); usage(1);
  }
} catch (error) {
  console.error(`hcbridge: ${String(error)}`);
  process.exit(2);
}

function usage(code = 0): never {
  console.log(`hcbridge - Vue 3 High-Code Evolver\n\nCommands:\n  init <projectDir>\n  doctor <projectDir>\n  scan <projectDir>\n  index <projectDir>\n  analyze <file>\n  inspect <file> [nodeId]\n  inspect-runtime <projectDir> <dom-target.json>\n  agent-plan <projectDir> <dom-target.json> <prompt>\n  agent-provider <projectDir> <dom-target.json> <prompt>\n  agent-context <projectDir> <dom-target.json>\n  capabilities <file>\n  plan <file|projectDir> <changes.json> [out.json]\n  apply <file> <change.json>\n  evolve <projectDir> <changes.json> [--max-safety=SAFE|ASSISTED|RISKY|REJECTED] [--dry-run]\n  rollback <projectDir> <journal.json>\n  snapshot <projectDir> [out.json]\n  status <projectDir> [snapshot.json]\n  history <projectDir>\n  verify <projectDir>\n  report <projectDir>\n  sandbox <doctor|prepare|run|snapshot|restore|diff|read|edit> <projectDir> [args...]\n\nChangeSet operations:\n  set-prop       existing or new static prop\n  remove-prop    remove attr/directive by target\n  set-binding    set or add :prop / v-model expression\n  set-event      set or add @event handler\n  set-visibility set or add v-if expression (RISKY)\n  set-text       replace direct text node\n  insert-child   append/prepend raw child template (ASSISTED)\n  delete-node    delete a template node (ASSISTED)\n`);
  process.exit(code);
  throw new Error('unreachable');
}

function init(projectDir: string) {
  const dir = path.resolve(projectDir);
  const hc = path.join(dir, '.hcbridge');
  fs.mkdirSync(hc, { recursive: true });
  const config = {
    version: '0.5',
    include: ['.'],
    exclude: ['node_modules', 'dist', '.git', '.hcbridge', 'coverage'],
    policy: { maxSafety: 'SAFE', stopOnFailure: true, verifyReparse: true, verifyTypecheck: false, verifyBuild: false },
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
    typescript: framework.typescript,
    hcbridge: fs.existsSync(path.join(root, '.hcbridge')),
  };
  console.log(JSON.stringify({ projectRoot: root, framework, checks, ok: checks.packageJson && checks.vue }, null, 2));
}

function scan(projectDir: string) {
  const result = scanProject(path.resolve(projectDir));
  console.log(JSON.stringify({ projectRoot: result.projectRoot, framework: result.framework, generatedAt: result.generatedAt, totals: result.totals, failedFiles: result.failedFiles, files: result.files.map((f) => ({ file: f.relativeFile, sourceHash: f.sourceHash, metrics: f.metrics })) }, null, 2));
}

function index(projectDir: string) {
  const result = scanProject(path.resolve(projectDir));
  const artifacts = writeProjectArtifacts(result);
  console.log(JSON.stringify({ index: artifacts.index, snapshot: artifacts.snapshot, report: artifacts.report, totals: result.totals }, null, 2));
}

function analyze(file?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!));
  console.log(JSON.stringify({ file: result.file, sourceHash: result.sourceHash, metrics: result.metrics, contract: result.contract, diagnostics: result.graph.diagnostics, components: result.graph.components, bindings: result.graph.bindings, events: result.graph.events, states: result.graph.states, resolutions: result.resolutions, hcp: result.hcp }, null, 2));
}

function inspect(file?: string, nodeId?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!));
  if (!nodeId) {
    console.log(JSON.stringify({ file: result.file, nodes: flattenTemplate(result.parsed.template).map((n) => ({ id: n.nodeId, kind: n.kind, tag: n.tag, path: n.structuralPath, range: n.range, source: n.sourceText })) }, null, 2));
    return;
  }
  const node = flattenTemplate(result.parsed.template).find((n) => n.nodeId === nodeId);
  if (!node) throw new Error(`NODE_NOT_FOUND: ${nodeId}`);
  const hcpNode = result.hcp.nodes.find((n) => n.id === nodeId);
  const semantic = result.graph.components.find((c) => c.nodeId === nodeId);
  console.log(JSON.stringify({ node, semantic, hcp: hcpNode }, null, 2));
}

function inspectRuntime(projectDir?: string, targetFile?: string) {
  assertPath(projectDir);
  assertFile(targetFile);
  const target = JSON.parse(fs.readFileSync(path.resolve(targetFile!), 'utf8')) as DomTargetSignature;
  if (!target || typeof target.tag !== 'string') throw new Error('Invalid DOM target JSON: expected { tag: string, ... }.');
  inspectDomTarget(path.resolve(projectDir!), target)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(`hcbridge: ${String(error)}`); process.exitCode = 2; });
}

async function agentPlan(projectDir?: string, targetFile?: string, prompt?: string) {
  assertPath(projectDir);
  assertFile(targetFile);
  if (!prompt?.trim()) throw new Error('agent-plan requires a prompt.');
  const root = path.resolve(projectDir!);
  const target = JSON.parse(fs.readFileSync(path.resolve(targetFile!), 'utf8')) as DomTargetSignature;
  const inspection = await inspectDomTarget(root, target);
  const context = await buildAgentContext(root, { prompt, target, inspection });
  const plan = await createConfiguredAgent().plan(context);
  console.log(JSON.stringify({ provider: plan.provider, inspection, plan }, null, 2));
}

async function agentProviderPlan(projectDir?: string, targetFile?: string, prompt?: string) {
  return agentPlan(projectDir, targetFile, prompt);
}

async function agentContext(projectDir?: string, targetFile?: string) {
  assertPath(projectDir);
  assertFile(targetFile);
  const root = path.resolve(projectDir!);
  const target = JSON.parse(fs.readFileSync(path.resolve(targetFile!), 'utf8')) as DomTargetSignature;
  const inspection = await inspectDomTarget(root, target);
  const context = await buildAgentContext(root, { prompt: 'context-preview', target, inspection });
  console.log(JSON.stringify({ inspection, context: await buildContextPack(context) }, null, 2));
}

function capabilities(file?: string) {
  assertFile(file);
  const result = analyzeVueFile(path.resolve(file!));
  console.log(JSON.stringify({ file: result.file, capabilities: result.hcp.nodes.map((n) => ({ id: n.id, tag: n.tag, mode: n.mode, resolution: n.resolution, capabilities: n.capabilities })) }, null, 2));
}

function contract(file?: string) {
  assertFile(file);
  const result = analyzeComponentContract(path.resolve(file!), resolveProjectRoot(file!));
  console.log(JSON.stringify(result, null, 2));
}

function graph(entryFile?: string, argv: string[] = []) {
  assertFile(entryFile);
  const root = resolveProjectRoot(entryFile!);
  const maxDepth = Number(argv.find((arg) => arg.startsWith('--max-depth='))?.split('=')[1] ?? 8);
  const maxFiles = Number(argv.find((arg) => arg.startsWith('--max-files='))?.split('=')[1] ?? 200);
  console.log(JSON.stringify(buildComponentDependencyGraph(path.resolve(entryFile!), root, { maxDepth, maxFiles }), null, 2));
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
  fs.mkdirSync(path.join(path.dirname(abs), '.hcbridge'), { recursive: true });
  console.log(JSON.stringify({ changed: result.changed, diff: result.gitDiff, inversePlan: result.inversePlan }, null, 2));
}

function evolve(argv: string[]) {
  const projectDir = argv[0] && !argv[0]!.startsWith('--') ? argv[0]! : '.';
  const changesFile = argv.find((arg) => !arg.startsWith('--') && arg !== projectDir);
  if (!changesFile) throw new Error('evolve requires <changes.json>.');
  const maxSafety = (argv.find((arg) => arg.startsWith('--max-safety='))?.split('=')[1] ?? 'SAFE') as SafetyLevel;
  const dryRun = argv.includes('--dry-run');
  const verify = argv.includes('--verify');
  const root = path.resolve(projectDir);
  const changes = readChanges(changesFile);
  const planResult = createEvolutionPlan(root, changes, { maxSafety });
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, plan: planResult }, null, 2));
    return;
  }
  const result = applyEvolutionPlan(root, planResult, { maxSafety, stopOnFailure: true, verifyReparse: true, verifyTypecheck: verify, verifyBuild: verify });
  console.log(JSON.stringify(result, null, 2));
}

function rollback(projectDir?: string, journalFile?: string) {
  assertPath(projectDir); assertFile(journalFile);
  console.log(JSON.stringify(rollbackJournal(path.resolve(projectDir!), path.resolve(journalFile!)), null, 2));
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
  const dir = path.join(path.resolve(projectDir), '.hcbridge', 'history');
  if (!fs.existsSync(dir)) { console.log(JSON.stringify({ historyDir: dir, entries: [] }, null, 2)); return; }
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().reverse().map((name) => ({ file: name, path: path.join(dir, name), size: fs.statSync(path.join(dir, name)).size }));
  console.log(JSON.stringify({ historyDir: dir, entries }, null, 2));
}

function verify(projectDir: string) {
  console.log(JSON.stringify(verifyProject(path.resolve(projectDir), { runTypecheck: true, runBuild: true }), null, 2));
}

function report(projectDir: string) {
  const result = scanProject(path.resolve(projectDir));
  const artifacts = writeProjectArtifacts(result);
  console.log(JSON.stringify({ artifacts, totals: result.totals, failedFiles: result.failedFiles }, null, 2));
}


async function sandbox(argv: string[]) {
  const action = argv[0] ?? 'doctor';
  const projectDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : '.';
  const root = path.resolve(projectDir);
  const session = createSandboxSession({ projectRoot: root, install: action === 'prepare' || action === 'run' });
  try {
    switch (action) {
      case 'doctor':
        console.log(JSON.stringify(session.status(), null, 2));
        break;
      case 'prepare':
        console.log(JSON.stringify(await session.prepare(), null, 2));
        break;
      case 'run': {
        const status = await session.start();
        console.log(JSON.stringify(status, null, 2));
        await new Promise<void>((resolve) => {
          const stop = async () => {
            await session.stop();
            resolve();
          };
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
        break;
      }
      case 'snapshot':
        console.log(JSON.stringify(await session.snapshot(argv[2]), null, 2));
        break;
      case 'restore':
        console.log(JSON.stringify(await session.restore(argv[2]), null, 2));
        break;
      case 'diff':
        console.log(JSON.stringify(await session.diff(argv[2]), null, 2));
        break;
      case 'read': {
        if (!argv[2]) throw new Error('sandbox read requires <file>.');
        console.log((await session.readFile(argv[2])).content);
        break;
      }
      case 'edit': {
        if (!argv[2]) throw new Error('sandbox edit requires <intent.json>.');
        const intent = JSON.parse(fs.readFileSync(path.resolve(argv[2]), 'utf8')) as EditIntent;
        console.log(JSON.stringify(await session.applyEditIntent(intent), null, 2));
        break;
      }
      default:
        throw new Error(`Unknown sandbox action: ${action}`);
    }
  } finally {
    if (action !== 'run') await session.dispose();
  }
}
function readChanges(file: string): EvolutionChangeSet {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as EvolutionChangeSet;
  if (!value || !Array.isArray(value.changes)) throw new Error('Invalid changes JSON: expected {changes: []}.');
  return value;
}

function assertFile(file?: string): asserts file is string {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${file ?? ''}`);
}
function assertPath(file?: string): asserts file is string {
  if (!file || !fs.existsSync(file)) throw new Error(`Path not found: ${file ?? ''}`);
}
function resolveProjectRoot(input: string): string {
  const abs = path.resolve(input);
  if (fs.statSync(abs).isDirectory()) return abs;
  return path.dirname(abs);
}
