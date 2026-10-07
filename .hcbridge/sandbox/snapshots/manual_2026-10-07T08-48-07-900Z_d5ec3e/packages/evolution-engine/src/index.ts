import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readAndParseSfc, flattenTemplate, type ParsedSfc } from '@hcbridge/vue-parser';
import { analyzeScriptSetup, type ScriptAnalysis } from '@hcbridge/ts-analyzer';
import { resolveImportedComponents, type ComponentResolution } from '@hcbridge/component-resolver';
import { buildSemanticGraph, type SemanticGraph } from '@hcbridge/semantic-graph';
import { projectToHcp, type ChangeSet, type HcpProject } from '@hcbridge/hcp';
import { createAntDesignVueRegistry, type CapabilityRegistry } from '@hcbridge/capability-registry';
import { createPatchPlan, applyPatchToFile, mergePatchPlans, type PatchPlan } from '@hcbridge/patch-engine';
import { verifyFile, verifyProject, type VerifyResult } from '@hcbridge/verifier';
import { analyzeComponentContract } from '@hcbridge/component-intelligence';
import type { ComponentContract } from '@hcbridge/source-model';

export type SafetyLevel = 'SAFE' | 'ASSISTED' | 'RISKY' | 'REJECTED';

export interface FileAnalysis {
  file: string;
  relativeFile: string;
  sourceHash: string;
  parsed: ParsedSfc;
  script: ScriptAnalysis;
  graph: SemanticGraph;
  hcp: HcpProject;
  resolutions: Record<string, ComponentResolution>;
  contract: ComponentContract;
  metrics: {
    templateNodes: number;
    components: number;
    bindings: number;
    events: number;
    states: number;
    structured: number;
    blackbox: number;
    opaque: number;
    diagnostics: number;
    configurable: number;
    localComponents: number;
    unresolvedComponents: number;
    contractProps: number;
    contractEvents: number;
    contractSlots: number;
    contractModels: number;
    contractExposes: number;
  };
}

export interface ProjectIndexEntry {
  file: string;
  hash: string;
  components: string[];
  importedComponents: Record<string, { source: string; resolvedFile?: string; kind: string }>;
  routes: string[];
  states: string[];
  contract: { name: string; props: string[]; events: string[]; models: string[]; slots: string[]; exposes: string[] };
  diagnostics: number;
}

export interface ProjectAnalysis {
  projectRoot: string;
  framework: { vue: boolean; vite: boolean; nuxt: boolean; typescript: boolean; packageManager: string | null };
  files: FileAnalysis[];
  failedFiles: Array<{ file: string; error: string }>;
  totals: FileAnalysis['metrics'] & { vueFiles: number };
  index: ProjectIndexEntry[];
  generatedAt: string;
}

export interface EvolutionChangeSet {
  version?: string;
  changes: ChangeSet[];
}

export interface PlannedChange {
  change: ChangeSet;
  safety: SafetyLevel;
  rationale: string;
  patchOperations: number;
}

export interface EvolutionFilePlan {
  file: string;
  relativeFile: string;
  sourceHash: string;
  plannedChanges: PlannedChange[];
  patch: PatchPlan;
}

export interface EvolutionPlan {
  version: '0.4';
  projectRoot: string;
  createdAt: string;
  files: EvolutionFilePlan[];
  diagnostics: { severity: 'warning' | 'error'; code: string; message: string; file?: string }[];
  summary: Record<SafetyLevel, number> & { changes: number; operations: number };
}

export interface EvolutionJournal {
  version: '0.4';
  id: string;
  createdAt: string;
  projectRoot: string;
  status: 'committed' | 'rolled-back';
  files: Array<{
    file: string;
    relativeFile: string;
    beforeHash: string;
    afterHash: string;
    diff: string;
    inversePlan: PatchPlan;
  }>;
  verification: Record<string, VerifyResult>;
  safety: Record<SafetyLevel, number>;
}

export interface EvolutionApplyResult {
  id: string;
  changedFiles: string[];
  skippedFiles: string[];
  blockedChanges: PlannedChange[];
  inversePlans: Array<{ file: string; plan: PatchPlan }>;
  diffs: string[];
  verification: Record<string, VerifyResult>;
  journal?: string;
}

export interface SnapshotEntry {
  file: string;
  hash: string;
  nodes: Array<{ nodeId: string; kind: string; tag?: string; syntaxFingerprint: string }>;
}

export interface ProjectSnapshot {
  version: '0.4';
  projectRoot: string;
  createdAt: string;
  files: SnapshotEntry[];
}

export interface SnapshotStatus {
  projectRoot: string;
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface EvolutionPolicy {
  maxSafety: SafetyLevel;
  stopOnFailure: boolean;
  verifyReparse: boolean;
  verifyTypecheck: boolean;
  verifyBuild: boolean;
}

const SAFETY_ORDER: SafetyLevel[] = ['SAFE', 'ASSISTED', 'RISKY', 'REJECTED'];

export function analyzeVueFile(
  file: string,
  projectRoot = process.cwd(),
  registry: CapabilityRegistry = createAntDesignVueRegistry(),
): FileAnalysis {
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(file);
  const parsed = readAndParseSfc(absolute, { projectRoot: root });
  const scriptBlock = parsed.descriptor.scriptSetup;
  const script = scriptBlock
    ? analyzeScriptSetup(absolute, parsed.text, { content: scriptBlock.content, offset: scriptBlock.loc.start.offset })
    : { file: absolute, states: [], functions: [], imports: [], diagnostics: [] };
  const graph = buildSemanticGraph(parsed, script);
  const resolutions = resolveImportedComponents(script.imports, { projectRoot: root, sourceFile: absolute });
  const hcp = projectToHcp(graph, (name) => registry.resolve(name), resolutions);
  const contract = analyzeComponentContract(absolute, root).contract;
  const structured = hcp.nodes.filter((n) => n.mode === 'structured').length;
  const blackbox = hcp.nodes.filter((n) => n.mode === 'blackbox').length;
  const opaque = hcp.nodes.filter((n) => n.mode === 'opaque').length;
  const configurable = hcp.nodes.reduce((count, node) => count + node.capabilities.filter((c) => c.editable).length, 0);
  const localComponents = Object.values(resolutions).filter((r) => r.kind === 'local-vue').length;
  const unresolvedComponents = Object.values(resolutions).filter((r) => r.kind === 'unresolved').length;
  return {
    file: absolute,
    relativeFile: toPosix(path.relative(root, absolute)),
    sourceHash: sha256(parsed.text),
    parsed,
    script,
    graph,
    hcp,
    resolutions: Object.fromEntries(resolutions.entries()),
    contract,
    metrics: {
      templateNodes: graph.templateNodes.length,
      components: graph.components.length,
      bindings: graph.bindings.length,
      events: graph.events.length,
      states: graph.states.length,
      structured,
      blackbox,
      opaque,
      diagnostics: graph.diagnostics.length,
      configurable,
      localComponents,
      unresolvedComponents,
      contractProps: contract.props.length,
      contractEvents: contract.events.length,
      contractSlots: contract.slots.length,
      contractModels: contract.models.length,
      contractExposes: contract.exposes.length,
    },
  };
}

export function scanProject(
  projectRoot: string,
  options: { include?: string[]; exclude?: string[]; maxFiles?: number } = {},
): ProjectAnalysis {
  const root = path.resolve(projectRoot);
  const include = options.include ?? ['.'];
  const exclude = new Set(options.exclude ?? ['node_modules', 'dist', '.git', '.hcbridge', 'coverage']);
  const candidates = collectVueFiles(root, include, exclude);
  const files: FileAnalysis[] = [];
  const failedFiles: Array<{ file: string; error: string }> = [];
  for (const file of candidates.slice(0, options.maxFiles ?? 5000)) {
    try { files.push(analyzeVueFile(file, root)); }
    catch (error) { failedFiles.push({ file: toPosix(path.relative(root, file)), error: String(error) }); }
  }
  const totals = files.reduce<FileAnalysis['metrics'] & { vueFiles: number }>((acc, file) => {
    acc.vueFiles += 1;
    for (const key of Object.keys(file.metrics) as Array<keyof FileAnalysis['metrics']>) acc[key] += file.metrics[key];
    return acc;
  }, {
    vueFiles: 0, templateNodes: 0, components: 0, bindings: 0, events: 0, states: 0,
    structured: 0, blackbox: 0, opaque: 0, diagnostics: 0, configurable: 0, localComponents: 0, unresolvedComponents: 0,
    contractProps: 0, contractEvents: 0, contractSlots: 0, contractModels: 0, contractExposes: 0,
  });
  return {
    projectRoot: root,
    framework: detectProject(root),
    files,
    failedFiles,
    totals,
    index: buildProjectIndex(files, root),
    generatedAt: new Date().toISOString(),
  };
}

export function createEvolutionPlan(projectRoot: string, changeSet: EvolutionChangeSet, policy?: Partial<EvolutionPolicy>): EvolutionPlan {
  const root = path.resolve(projectRoot);
  const maxSafety = policy?.maxSafety ?? 'SAFE';
  const grouped = new Map<string, ChangeSet[]>();
  for (const incoming of changeSet.changes) {
    const file = path.resolve(root, incoming.file);
    const list = grouped.get(file) ?? [];
    list.push({ ...incoming, file });
    grouped.set(file, list);
  }

  const files: EvolutionFilePlan[] = [];
  const diagnostics: EvolutionPlan['diagnostics'] = [];
  const summary: EvolutionPlan['summary'] = { SAFE: 0, ASSISTED: 0, RISKY: 0, REJECTED: 0, changes: 0, operations: 0 };

  for (const [file, changes] of grouped) {
    if (!fs.existsSync(file)) {
      diagnostics.push({ severity: 'error', code: 'FILE_NOT_FOUND', message: `File not found: ${file}`, file });
      continue;
    }
    try {
      const analysis = analyzeVueFile(file, root);
      const plannedChanges: PlannedChange[] = [];
      const plans: PatchPlan[] = [];
      for (const change of changes) {
        const safety = classifyChange(change);
        const rationale = safetyRationale(safety, change);
        let patch: PatchPlan;
        try {
          patch = createPatchPlan(analysis.parsed, change);
        } catch (error) {
          patch = { version: '0.2', sourceHash: analysis.sourceHash, operations: [], inverse: [], diagnostics: [{ severity: 'error', code: 'PATCH_PLANNING_EXCEPTION', message: String(error) }] };
        }
        plannedChanges.push({ change, safety, rationale, patchOperations: patch.operations.length });
        plans.push(patch);
        summary[safety] += 1;
        summary.changes += 1;
        summary.operations += patch.operations.length;
        if (isHigherThan(safety, maxSafety)) {
          diagnostics.push({ severity: 'warning', code: 'SAFETY_BLOCKED', message: `${change.operation}:${change.target} is ${safety}; policy allows up to ${maxSafety}.`, file });
        }
        for (const diag of patch.diagnostics) diagnostics.push({ ...diag, file });
      }
      const patch = mergePatchPlans(plans);
      files.push({ file, relativeFile: toPosix(path.relative(root, file)), sourceHash: analysis.sourceHash, plannedChanges, patch });
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'ANALYZE_FAILED', message: String(error), file });
    }
  }

  return { version: '0.4', projectRoot: root, createdAt: new Date().toISOString(), files, diagnostics, summary };
}

export function applyEvolutionPlan(
  projectRoot: string,
  plan: EvolutionPlan,
  policy: Partial<EvolutionPolicy> = {},
): EvolutionApplyResult {
  const root = path.resolve(projectRoot);
  const effective: EvolutionPolicy = {
    maxSafety: policy.maxSafety ?? 'SAFE',
    stopOnFailure: policy.stopOnFailure ?? true,
    verifyReparse: policy.verifyReparse ?? true,
    verifyTypecheck: policy.verifyTypecheck ?? false,
    verifyBuild: policy.verifyBuild ?? false,
  };
  if (plan.projectRoot !== root) throw new Error('EVOLUTION_PROJECT_MISMATCH');
  if (plan.diagnostics.some((d) => d.severity === 'error')) throw new Error('EVOLUTION_PLAN_HAS_ERRORS');
  const blockedChanges = plan.files.flatMap((file) => file.plannedChanges.filter((change) => isHigherThan(change.safety, effective.maxSafety) || change.safety === 'REJECTED'));
  if (effective.stopOnFailure && blockedChanges.length) throw new Error(`SAFETY_POLICY_BLOCKED:${blockedChanges.map((c) => c.change.operation).join(',')}`);

  const id = `ev_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const inversePlans: EvolutionApplyResult['inversePlans'] = [];
  const diffs: string[] = [];
  const verification: Record<string, VerifyResult> = {};
  const backups = new Map<string, string>();
  const journalFiles: EvolutionJournal['files'] = [];
  let journalPath: string | undefined;
  try {
    for (const item of plan.files) {
      const approved = item.plannedChanges.filter((change) => !isHigherThan(change.safety, effective.maxSafety) && change.safety !== 'REJECTED');
      if (!approved.length) { skippedFiles.push(item.file); continue; }
      const current = fs.readFileSync(item.file, 'utf8');
      if (sha256(current) !== item.sourceHash) {
        if (effective.stopOnFailure) throw new Error(`STALE_SOURCE:${item.relativeFile}`);
        skippedFiles.push(item.file);
        continue;
      }
      backups.set(item.file, current);
      const freshParsed = readAndParseSfc(item.file, { projectRoot: root });
      const approvedPlans = approved.map((entry) => createPatchPlan(freshParsed, entry.change));
      const approvedPatch = mergePatchPlans(approvedPlans);
      if (approvedPatch.diagnostics.some((d) => d.severity === 'error')) throw new Error(`APPROVED_PATCH_INVALID:${item.relativeFile}`);
      const result = applyPatchToFile(item.file, approvedPatch);
      if (!result.changed) { skippedFiles.push(item.file); continue; }
      const afterText = result.text;
      if (effective.verifyReparse) {
        const verify = verifyFile(item.file, afterText);
        verification[item.relativeFile] = verify;
        if (!verify.reparse.ok) throw new Error(`VERIFY_FAILED:${item.relativeFile}`);
      }
      const afterHash = sha256(afterText);
      changedFiles.push(item.file);
      inversePlans.push({ file: item.file, plan: result.inversePlan });
      diffs.push(result.gitDiff);
      journalFiles.push({ file: item.file, relativeFile: item.relativeFile, beforeHash: item.sourceHash, afterHash, diff: result.gitDiff, inversePlan: result.inversePlan });
    }
    if (effective.verifyTypecheck || effective.verifyBuild) {
      const projectVerify = verifyProject(root, { runTypecheck: effective.verifyTypecheck, runBuild: effective.verifyBuild });
      verification.__project__ = projectVerify;
      if ((effective.verifyTypecheck && !projectVerify.typecheck.ok) || (effective.verifyBuild && !projectVerify.build.ok)) {
        throw new Error('PROJECT_VERIFY_FAILED');
      }
    }
    const journal: EvolutionJournal = {
      version: '0.4', id, createdAt: new Date().toISOString(), projectRoot: root, status: 'committed', files: journalFiles, verification, safety: plan.summary,
    };
    journalPath = writeJournal(root, journal);
    return { id, changedFiles, skippedFiles, blockedChanges, inversePlans, diffs, verification, journal: journalPath };
  } catch (error) {
    for (const [file, text] of backups.entries()) fs.writeFileSync(file, text, 'utf8');
    const journal: EvolutionJournal = {
      version: '0.4', id, createdAt: new Date().toISOString(), projectRoot: root, status: 'rolled-back', files: journalFiles, verification, safety: plan.summary,
    };
    journalPath = writeJournal(root, journal);
    throw new Error(`${String(error)}\nROLLBACK_JOURNAL:${journalPath}`);
  }
}

export function rollbackJournal(projectRoot: string, journalFile: string): { rolledBack: string[]; diffs: string[] } {
  const root = path.resolve(projectRoot);
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as EvolutionJournal;
  if (journal.projectRoot !== root) throw new Error('JOURNAL_PROJECT_MISMATCH');
  if (journal.status === 'rolled-back') throw new Error('JOURNAL_ALREADY_ROLLED_BACK');
  const rolledBack: string[] = [];
  const diffs: string[] = [];
  for (const item of [...journal.files].reverse()) {
    const result = applyPatchToFile(path.resolve(root, item.relativeFile), item.inversePlan);
    if (result.changed) rolledBack.push(item.relativeFile);
    if (result.gitDiff) diffs.push(result.gitDiff);
  }
  journal.status = 'rolled-back';
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  return { rolledBack, diffs };
}

export function createProjectSnapshot(project: ProjectAnalysis): ProjectSnapshot {
  return {
    version: '0.4', projectRoot: project.projectRoot, createdAt: new Date().toISOString(),
    files: project.files.map((file) => ({
      file: file.relativeFile,
      hash: file.sourceHash,
      nodes: flattenTemplate(file.parsed.template).map((node) => ({ nodeId: node.nodeId, kind: node.kind, tag: node.tag, syntaxFingerprint: node.syntaxFingerprint })),
    })),
  };
}

export function compareSnapshot(project: ProjectAnalysis, snapshot: ProjectSnapshot): SnapshotStatus {
  const current = new Map(project.files.map((f) => [f.relativeFile, f.sourceHash]));
  const previous = new Map(snapshot.files.map((f) => [f.file, f.hash]));
  const changed: string[] = [], added: string[] = [], removed: string[] = [], unchanged: string[] = [];
  for (const [file, hash] of current) {
    if (!previous.has(file)) added.push(file);
    else if (previous.get(file) !== hash) changed.push(file);
    else unchanged.push(file);
  }
  for (const file of previous.keys()) if (!current.has(file)) removed.push(file);
  return { projectRoot: project.projectRoot, changed, added, removed, unchanged };
}

export function createMarkdownReport(project: ProjectAnalysis): string {
  const t = project.totals;
  const capabilityRate = t.templateNodes ? ((t.configurable / t.templateNodes) * 100).toFixed(1) : '0.0';
  return [
    '# Vue High-Code Evolution Report', '',
    `- Project: \`${project.projectRoot}\``,
    `- Generated: ${project.generatedAt}`,
    `- Framework: Vue ${project.framework.vue ? '3+' : 'unknown'} / Vite: ${project.framework.vite ? 'yes' : 'no'} / TypeScript: ${project.framework.typescript ? 'yes' : 'no'}`,
    `- Package manager: ${project.framework.packageManager ?? 'unknown'}`,
    '', '## Coverage', '',
    `- Vue files: ${t.vueFiles}`,
    `- Template nodes: ${t.templateNodes}`,
    `- Components: ${t.components}`,
    `- Bindings: ${t.bindings}`,
    `- Events: ${t.events}`,
    `- States: ${t.states}`,
    `- Configurable capabilities: ${t.configurable}`,
    `- Capability density: ${capabilityRate}%`,
    `- Local Vue components resolved: ${t.localComponents}`,
    `- Unresolved imports: ${t.unresolvedComponents}`,
    `- BlackBox nodes: ${t.blackbox}`,
    `- Diagnostics: ${t.diagnostics}`,
    '', '## Files', '',
    '| File | Components | Bindings | Events | Local Components | BlackBox | Configurable |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...project.files.map((f) => `| ${f.relativeFile} | ${f.metrics.components} | ${f.metrics.bindings} | ${f.metrics.events} | ${f.metrics.localComponents} | ${f.metrics.blackbox} | ${f.metrics.configurable} |`),
    '', '## Safety', '',
    'SAFE changes can be automated; ASSISTED/RISKY changes require an explicit policy; REJECTED changes never execute automatically.',
    '', '## Preservation', '',
    'The engine patches source ranges and leaves unrelated source text untouched. Unsupported semantics remain opaque/black-box.',
  ].join('\n');
}

export function writeProjectArtifacts(project: ProjectAnalysis, outputDir = path.join(project.projectRoot, '.hcbridge')) {
  fs.mkdirSync(outputDir, { recursive: true });
  const report = path.join(outputDir, 'report.md');
  const snapshot = path.join(outputDir, 'snapshot.json');
  const index = path.join(outputDir, 'index.json');
  fs.writeFileSync(report, createMarkdownReport(project));
  fs.writeFileSync(snapshot, JSON.stringify(createProjectSnapshot(project), null, 2));
  fs.writeFileSync(index, JSON.stringify({ version: '0.4', projectRoot: project.projectRoot, generatedAt: project.generatedAt, framework: project.framework, totals: project.totals, files: project.index }, null, 2));
  return { report, snapshot, index };
}

export function detectProject(projectRoot: string) {
  const pkgPath = path.join(projectRoot, 'package.json');
  let packageJson: Record<string, any> = {};
  try { packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* optional */ }
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  return {
    vue: Boolean(deps.vue),
    vite: Boolean(deps.vite) || ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].some((f) => fs.existsSync(path.join(projectRoot, f))),
    nuxt: Boolean(deps.nuxt) || ['nuxt.config.ts', 'nuxt.config.js'].some((f) => fs.existsSync(path.join(projectRoot, f))),
    typescript: Boolean(deps.typescript) || fs.existsSync(path.join(projectRoot, 'tsconfig.json')),
    packageManager: fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(projectRoot, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(projectRoot, 'package-lock.json')) ? 'npm' : null,
  };
}

export function classifyChange(change: ChangeSet): SafetyLevel {
  switch (change.operation) {
    case 'set-prop':
    case 'remove-prop':
    case 'set-text':
    case 'set-binding':
    case 'set-event':
      return 'SAFE';
    case 'insert-child':
    case 'delete-node':
      return 'ASSISTED';
    case 'set-visibility':
      return 'RISKY';
    default:
      return 'REJECTED';
  }
}

function safetyRationale(safety: SafetyLevel, change: ChangeSet): string {
  if (safety === 'SAFE') return `${change.operation} changes a narrow template range and can be preconditioned by source hash.`;
  if (safety === 'ASSISTED') return `${change.operation} changes template structure; review the generated diff before committing.`;
  if (safety === 'RISKY') return `${change.operation} can alter control flow and runtime behavior.`;
  return 'The engine does not automatically transform this semantic class.';
}

function isHigherThan(a: SafetyLevel, b: SafetyLevel): boolean {
  return SAFETY_ORDER.indexOf(a) > SAFETY_ORDER.indexOf(b);
}

function buildProjectIndex(files: FileAnalysis[], projectRoot: string): ProjectIndexEntry[] {
  return files.map((file) => ({
    file: file.relativeFile,
    hash: file.sourceHash,
    components: file.graph.components.map((c) => c.name),
    importedComponents: Object.fromEntries(Object.entries(file.resolutions).map(([name, resolution]) => [name, { source: resolution.importSource, resolvedFile: resolution.resolvedFile ? toPosix(path.relative(projectRoot, resolution.resolvedFile)) : undefined, kind: resolution.kind }])),
    routes: [],
    states: file.graph.states.map((s) => s.id),
    contract: {
      name: file.contract.name,
      props: file.contract.props.map((item) => item.name),
      events: file.contract.events.map((item) => item.name),
      models: file.contract.models.map((item) => item.name),
      slots: file.contract.slots.map((item) => item.name),
      exposes: file.contract.exposes.map((item) => item.name),
    },
    diagnostics: file.metrics.diagnostics,
  }));
}

function writeJournal(root: string, journal: EvolutionJournal): string {
  const dir = path.join(root, '.hcbridge', 'history');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${journal.id}.json`);
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
  return file;
}

function collectVueFiles(root: string, include: string[], exclude: Set<string>): string[] {
  const starts = include.length ? include.map((item) => path.resolve(root, item)) : [root];
  const files = new Set<string>();
  for (const start of starts) visit(start, exclude, files);
  return [...files].sort();
}

function visit(current: string, exclude: Set<string>, files: Set<string>): void {
  if (!fs.existsSync(current)) return;
  const stat = fs.statSync(current);
  if (stat.isFile()) { if (current.endsWith('.vue')) files.add(current); return; }
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const next = path.join(current, entry.name);
    if (entry.isDirectory()) visit(next, exclude, files);
    else if (entry.isFile() && entry.name.endsWith('.vue')) files.add(next);
  }
}

function sha256(text: string): string { return crypto.createHash('sha256').update(text).digest('hex'); }
function toPosix(value: string): string { return value.split(path.sep).join('/'); }
