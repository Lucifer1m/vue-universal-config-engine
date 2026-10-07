import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readAndParseSfc, flattenTemplate, type ParsedSfc } from '@hcbridge/vue-parser';
import { analyzeScriptSetup, type ScriptAnalysis } from '@hcbridge/ts-analyzer';
import { buildSemanticGraph, type SemanticGraph } from '@hcbridge/semantic-graph';
import { projectToHcp, type ChangeSet, type HcpProject } from '@hcbridge/hcp';
import { createAntDesignVueRegistry, type CapabilityRegistry } from '@hcbridge/capability-registry';
import { createPatchPlan, applyPatchToFile, type PatchPlan, type ApplyResult } from '@hcbridge/patch-engine';
import { verifyFile, verifyProject, type VerifyResult } from '@hcbridge/verifier';

export interface FileAnalysis {
  file: string;
  relativeFile: string;
  sourceHash: string;
  parsed: ParsedSfc;
  script: ScriptAnalysis;
  graph: SemanticGraph;
  hcp: HcpProject;
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
  };
}

export interface ProjectAnalysis {
  projectRoot: string;
  framework: { vue: boolean; vite: boolean; nuxt: boolean; packageManager: string | null };
  files: FileAnalysis[];
  failedFiles: Array<{ file: string; error: string }>;
  totals: FileAnalysis['metrics'] & { vueFiles: number };
  generatedAt: string;
}

export interface EvolutionChangeSet {
  version?: string;
  changes: ChangeSet[];
}

export interface EvolutionFilePlan {
  file: string;
  sourceHash: string;
  patch: PatchPlan;
}

export interface EvolutionPlan {
  version: '0.2';
  projectRoot: string;
  createdAt: string;
  files: EvolutionFilePlan[];
  diagnostics: { severity: 'warning' | 'error'; code: string; message: string; file?: string }[];
}

export interface EvolutionApplyResult {
  changedFiles: string[];
  skippedFiles: string[];
  inversePlans: Array<{ file: string; plan: PatchPlan }>;
  diffs: string[];
  verification: Record<string, VerifyResult>;
}

export interface SnapshotEntry {
  file: string;
  hash: string;
  nodes: Array<{ nodeId: string; kind: string; tag?: string; syntaxFingerprint: string }>;
}

export interface ProjectSnapshot {
  version: '0.2';
  projectRoot: string;
  createdAt: string;
  files: SnapshotEntry[];
}

export function analyzeVueFile(file: string, projectRoot = process.cwd(), registry: CapabilityRegistry = createAntDesignVueRegistry()): FileAnalysis {
  const absolute = path.resolve(file);
  const text = fs.readFileSync(absolute, 'utf8');
  const parsed = readAndParseSfc(absolute);
  const scriptBlock = parsed.descriptor.scriptSetup;
  const script = scriptBlock
    ? analyzeScriptSetup(absolute, parsed.text, { content: scriptBlock.content, offset: scriptBlock.loc.start.offset })
    : { file: absolute, states: [], functions: [], imports: [], diagnostics: [] };
  const graph = buildSemanticGraph(parsed, script);
  const hcp = projectToHcp(graph, (name) => registry.resolve(name));
  const structured = hcp.nodes.filter((n) => n.mode === 'structured').length;
  const blackbox = hcp.nodes.filter((n) => n.mode === 'blackbox').length;
  const opaque = hcp.nodes.filter((n) => n.mode === 'opaque').length;
  const configurable = hcp.nodes.reduce((count, node) => count + node.capabilities.filter((c) => c.editable).length, 0);
  return {
    file: absolute,
    relativeFile: toPosix(path.relative(projectRoot, absolute)),
    sourceHash: sha256(text),
    parsed,
    script,
    graph,
    hcp,
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
    },
  };
}

export function scanProject(projectRoot: string, options: { include?: string[]; exclude?: string[]; maxFiles?: number } = {}): ProjectAnalysis {
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
    structured: 0, blackbox: 0, opaque: 0, diagnostics: 0, configurable: 0,
  });
  return {
    projectRoot: root,
    framework: detectProject(root),
    files,
    failedFiles,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

export function createProjectSnapshot(project: ProjectAnalysis): ProjectSnapshot {
  return {
    version: '0.2',
    projectRoot: project.projectRoot,
    createdAt: new Date().toISOString(),
    files: project.files.map((file) => ({
      file: file.relativeFile,
      hash: file.sourceHash,
      nodes: flattenTemplate(file.parsed.template).map((node) => ({
        nodeId: node.nodeId,
        kind: node.kind,
        tag: node.tag,
        syntaxFingerprint: node.syntaxFingerprint,
      })),
    })),
  };
}

export function createEvolutionPlan(projectRoot: string, changeSet: EvolutionChangeSet): EvolutionPlan {
  const root = path.resolve(projectRoot);
  const grouped = new Map<string, ChangeSet[]>();
  for (const change of changeSet.changes) {
    const file = path.resolve(root, change.file);
    const list = grouped.get(file) ?? [];
    list.push({ ...change, file });
    grouped.set(file, list);
  }
  const files: EvolutionFilePlan[] = [];
  const diagnostics: EvolutionPlan['diagnostics'] = [];
  for (const [file, changes] of grouped) {
    if (!fs.existsSync(file)) {
      diagnostics.push({ severity: 'error', code: 'FILE_NOT_FOUND', message: `File not found: ${file}`, file });
      continue;
    }
    try {
      const analysis = analyzeVueFile(file, root);
      let patch: PatchPlan = { version: '0.1', operations: [], inverse: [], diagnostics: [] };
      for (const change of changes) {
        const single = createPatchPlan(analysis.parsed, change);
        patch = mergePatchPlans(patch, single);
      }
      files.push({ file, sourceHash: analysis.sourceHash, patch });
      for (const diag of patch.diagnostics) diagnostics.push({ ...diag, file });
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'ANALYZE_FAILED', message: String(error), file });
    }
  }
  return { version: '0.2', projectRoot: root, createdAt: new Date().toISOString(), files, diagnostics };
}

export function applyEvolutionPlan(projectRoot: string, plan: EvolutionPlan, options: { verify?: boolean; stopOnFailure?: boolean } = {}): EvolutionApplyResult {
  const root = path.resolve(projectRoot);
  if (plan.diagnostics.some((d) => d.severity === 'error')) throw new Error('Evolution plan contains errors.');
  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const inversePlans: EvolutionApplyResult['inversePlans'] = [];
  const diffs: string[] = [];
  const verification: Record<string, VerifyResult> = {};
  const backups = new Map<string, string>();
  try {
    for (const item of plan.files) {
      const current = fs.readFileSync(item.file, 'utf8');
      if (sha256(current) !== item.sourceHash) {
        skippedFiles.push(item.file);
        if (options.stopOnFailure) throw new Error(`STALE_SOURCE: ${item.file}`);
        continue;
      }
      backups.set(item.file, current);
      const result = applyPatchToFile(item.file, item.patch);
      if (!result.changed) {
        skippedFiles.push(item.file);
        continue;
      }
      const verify = verifyFile(item.file, result.text);
      if (!verify.reparse.ok) throw new Error(`VERIFY_FAILED: ${item.file}\n${verify.reparse.diagnostics.join('\n')}`);
      changedFiles.push(item.file);
      inversePlans.push({ file: item.file, plan: result.inversePlan });
      diffs.push(result.gitDiff);
      if (options.verify) verification[item.file] = verify;
    }
    if (options.verify) verification.__project__ = verifyProject(root);
    return { changedFiles, skippedFiles, inversePlans, diffs, verification };
  } catch (error) {
    for (const [file, text] of backups) fs.writeFileSync(file, text, 'utf8');
    throw error;
  }
}

export function createMarkdownReport(project: ProjectAnalysis): string {
  const t = project.totals;
  const configRate = t.components ? ((t.configurable / Math.max(t.components, 1)) * 100).toFixed(1) : '0.0';
  const lines = [
    '# Vue High-Code Evolution Report',
    '',
    `- Project: \`${project.projectRoot}\``,
    `- Generated: ${project.generatedAt}`,
    `- Vue: ${project.framework.vue ? 'yes' : 'no'}`,
    `- Vite: ${project.framework.vite ? 'yes' : 'no'}`,
    `- Nuxt: ${project.framework.nuxt ? 'yes' : 'no'}`,
    `- Package manager: ${project.framework.packageManager ?? 'unknown'}`,
    `- Failed files: ${project.failedFiles.length}`,
    '',
    '## Coverage',
    '',
    `- Vue files: ${t.vueFiles}`,
    `- Template nodes: ${t.templateNodes}`,
    `- Components: ${t.components}`,
    `- Bindings: ${t.bindings}`,
    `- Events: ${t.events}`,
    `- Script states: ${t.states}`,
    `- Structured nodes: ${t.structured}`,
    `- BlackBox nodes: ${t.blackbox}`,
    `- Opaque nodes: ${t.opaque}`,
    `- Editable capabilities: ${t.configurable}`,
    `- Raw capability ratio: ${configRate}%`,
    '',
    '## Failed files',
    '',
    ...(project.failedFiles.length ? project.failedFiles.map((f) => `- ${f.file}: ${f.error}`) : ['- None']),
    '',
    '## Files',
    '',
    '| File | Components | Bindings | Events | Structured | BlackBox | Diagnostics |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...project.files.map((f) => `| ${f.relativeFile} | ${f.metrics.components} | ${f.metrics.bindings} | ${f.metrics.events} | ${f.metrics.structured} | ${f.metrics.blackbox} | ${f.metrics.diagnostics} |`),
    '',
    '## Safety policy',
    '',
    'Changes must pass source preconditions and reparse verification. Unsupported/unknown semantics remain BlackBox or Opaque instead of being guessed.',
  ];
  return lines.join('\n');
}

export function writeProjectArtifacts(project: ProjectAnalysis, outputDir = path.join(project.projectRoot, '.hcbridge')): { report: string; snapshot: string; index: string } {
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'report.md');
  const snapshotPath = path.join(outputDir, 'snapshot.json');
  const indexPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(reportPath, createMarkdownReport(project));
  fs.writeFileSync(snapshotPath, JSON.stringify(createProjectSnapshot(project), null, 2));
  fs.writeFileSync(indexPath, JSON.stringify({
    version: '0.2',
    projectRoot: project.projectRoot,
    generatedAt: project.generatedAt,
    framework: project.framework,
    totals: project.totals,
    failedFiles: project.failedFiles,
    files: project.files.map((f) => ({
      file: f.relativeFile,
      sourceHash: f.sourceHash,
      metrics: f.metrics,
      nodes: f.hcp.nodes,
      diagnostics: f.hcp.diagnostics,
    })),
  }, null, 2));
  return { report: reportPath, snapshot: snapshotPath, index: indexPath };
}

export interface SnapshotStatus {
  projectRoot: string;
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: string[];
}

export function compareSnapshot(project: ProjectAnalysis, snapshot: ProjectSnapshot): SnapshotStatus {
  const current = new Map(project.files.map((f) => [f.relativeFile, f.sourceHash]));
  const previous = new Map(snapshot.files.map((f) => [f.file, f.hash]));
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const [file, hash] of current) {
    if (!previous.has(file)) added.push(file);
    else if (previous.get(file) !== hash) changed.push(file);
    else unchanged.push(file);
  }
  for (const file of previous.keys()) if (!current.has(file)) removed.push(file);
  return { projectRoot: project.projectRoot, changed, added, removed, unchanged };
}

export function detectProject(projectRoot: string) {
  const pkgPath = path.join(projectRoot, 'package.json');
  let packageJson: Record<string, any> = {};
  try { packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* optional */ }
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  return {
    vue: Boolean(deps.vue),
    vite: Boolean(deps.vite) || fs.existsSync(path.join(projectRoot, 'vite.config.ts')) || fs.existsSync(path.join(projectRoot, 'vite.config.js')),
    nuxt: Boolean(deps.nuxt) || fs.existsSync(path.join(projectRoot, 'nuxt.config.ts')) || fs.existsSync(path.join(projectRoot, 'nuxt.config.js')),
    packageManager: fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(projectRoot, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(projectRoot, 'package-lock.json')) ? 'npm' : null,
  };
}

function mergePatchPlans(a: PatchPlan, b: PatchPlan): PatchPlan {
  return {
    version: '0.1',
    operations: [...a.operations, ...b.operations],
    inverse: [...b.inverse, ...a.inverse],
    diagnostics: [...a.diagnostics, ...b.diagnostics],
  };
}

function collectVueFiles(root: string, include: string[], exclude: Set<string>): string[] {
  const starts = include.length ? include.map((item) => path.resolve(root, item)) : [root];
  const files = new Set<string>();
  for (const start of starts) visit(start, root, exclude, files);
  return [...files].sort();
}

function visit(current: string, root: string, exclude: Set<string>, files: Set<string>): void {
  if (!fs.existsSync(current)) return;
  const stat = fs.statSync(current);
  if (stat.isFile()) { if (current.endsWith('.vue')) files.add(current); return; }
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const next = path.join(current, entry.name);
    if (entry.isDirectory()) visit(next, root, exclude, files);
    else if (entry.isFile() && entry.name.endsWith('.vue')) files.add(next);
  }
}

function sha256(text: string): string { return crypto.createHash('sha256').update(text).digest('hex'); }
function toPosix(value: string): string { return value.split(path.sep).join('/'); }
