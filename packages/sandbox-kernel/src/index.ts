import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type SandboxState = 'created' | 'installing' | 'ready' | 'starting' | 'running' | 'stopped' | 'failed' | 'disposed';
export type EditActor = 'human' | 'ai' | 'system';

export interface SandboxOptions {
  projectRoot: string;
  stateDir?: string;
  command?: string;
  args?: string[];
  script?: string;
  install?: boolean;
  installArgs?: string[];
  env?: Record<string, string>;
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  exclude?: string[];
}

export interface PackageManagerInfo {
  name: 'pnpm' | 'npm' | 'yarn' | 'bun';
  executable: string;
  reason: string;
}

export interface SandboxProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxFile {
  path: string;
  size: number;
  hash: string;
}

export interface SandboxStatus {
  id: string;
  projectRoot: string;
  state: SandboxState;
  packageManager: PackageManagerInfo;
  previewUrl: string | null;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface ReplaceTextOperation {
  kind: 'replace-text';
  file: string;
  oldText: string;
  newText: string;
  occurrence?: number;
}

export interface WriteFileOperation {
  kind: 'write-file';
  file: string;
  content: string;
}

export interface DeleteFileOperation {
  kind: 'delete-file';
  file: string;
}

export type SandboxEditOperation = ReplaceTextOperation | WriteFileOperation | DeleteFileOperation;

export interface EditIntent {
  id?: string;
  actor: EditActor;
  description: string;
  expectedHashes?: Record<string, string>;
  operations: SandboxEditOperation[];
  createdAt?: string;
}

export interface EditResult {
  intentId: string;
  changedFiles: string[];
  diffs: string[];
  rejectedFiles: Array<{ file: string; reason: string }>;
}

export interface SandboxSnapshotFile {
  path: string;
  hash: string;
  size: number;
}

export interface SandboxSnapshot {
  id: string;
  createdAt: string;
  projectRoot: string;
  sourceDir: string;
  files: SandboxSnapshotFile[];
}

export interface SandboxDiff {
  snapshotId: string | null;
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface SandboxRuntime {
  status(): SandboxStatus;
  prepare(): Promise<SandboxStatus>;
  start(): Promise<SandboxStatus>;
  stop(): Promise<SandboxStatus>;
  exec(command: string, args?: string[], timeoutMs?: number): Promise<SandboxProcessResult>;
  readFile(relativeFile: string): Promise<{ content: string; hash: string }>;
  writeFile(relativeFile: string, content: string, expectedHash?: string): Promise<{ hash: string; diff: string }>;
  applyEditIntent(intent: EditIntent): Promise<EditResult>;
  snapshot(label?: string): Promise<SandboxSnapshot>;
  restore(snapshotId?: string): Promise<SandboxSnapshot>;
  diff(snapshotId?: string): Promise<SandboxDiff>;
  files(): Promise<SandboxFile[]>;
  dispose(): Promise<void>;
}

const DEFAULT_EXCLUDES = ['node_modules', 'dist', '.git', '.hcbridge', 'coverage', '.cache'];

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function hashFile(file: string): Promise<string> {
  return sha256(await fsp.readFile(file));
}

export function detectPackageManager(projectRoot: string): PackageManagerInfo {
  let current = path.resolve(projectRoot);
  while (true) {
    const detected = detectPackageManagerInDirectory(current);
    if (detected) return detected;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { name: 'npm', executable: executableFor('npm'), reason: 'fallback' };
}

function detectPackageManagerInDirectory(directory: string): PackageManagerInfo | undefined {
  const packageJsonPath = path.join(directory, 'package.json');
  let packageJson: Record<string, unknown> = {};
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const packageManager = typeof packageJson.packageManager === 'string' ? packageJson.packageManager : '';
  const fromManifest = packageManager.split('@')[0];
  if (fromManifest === 'pnpm' || fromManifest === 'npm' || fromManifest === 'yarn' || fromManifest === 'bun') {
    return { name: fromManifest, executable: executableFor(fromManifest), reason: 'packageManager field' };
  }
  const checks: Array<[PackageManagerInfo['name'], string]> = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
  ];
  for (const [name, lockfile] of checks) {
    if (fs.existsSync(path.join(directory, lockfile))) {
      return { name, executable: executableFor(name), reason: lockfile };
    }
  }
  return undefined;
}

function executableFor(name: PackageManagerInfo['name']): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

export async function listProjectFiles(projectRoot: string, exclude = DEFAULT_EXCLUDES): Promise<SandboxFile[]> {
  const root = path.resolve(projectRoot);
  const ignored = new Set(exclude.map((value) => normalizeRelative(value)));
  const results: SandboxFile[] = [];
  await walk(root, '', async (absolute, relative, stat) => {
    if (ignored.has(relative.split('/')[0] ?? '')) return false;
    if (stat.isFile()) {
      results.push({ path: relative, size: stat.size, hash: await hashFile(absolute) });
    }
    return true;
  });
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(
  root: string,
  relative: string,
  visitor: (absolute: string, relative: string, stat: fs.Stats) => Promise<boolean>,
): Promise<void> {
  const absolute = path.join(root, relative);
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRelative = normalizeRelative(path.join(relative, entry.name));
    const childAbsolute = path.join(root, childRelative);
    const stat = await fsp.lstat(childAbsolute);
    const shouldDescend = await visitor(childAbsolute, childRelative, stat);
    if (shouldDescend && stat.isDirectory()) await walk(root, childRelative, visitor);
  }
}

export class SandboxSession extends EventEmitter implements SandboxRuntime {
  readonly id: string;
  readonly projectRoot: string;
  readonly packageManager: PackageManagerInfo;
  readonly stateDir: string;
  readonly options: SandboxOptions & { startupTimeoutMs: number; commandTimeoutMs: number };
  private state: SandboxState = 'created';
  private process: ChildProcessWithoutNullStreams | null = null;
  private previewUrl: string | null = null;
  private lastError: string | null = null;
  private createdAt = new Date().toISOString();
  private updatedAt = this.createdAt;
  private latestSnapshotId: string | null = null;

  constructor(options: SandboxOptions) {
    super();
    const root = path.resolve(options.projectRoot);
    if (!fs.existsSync(path.join(root, 'package.json'))) {
      throw new Error(`SANDBOX_PROJECT_INVALID: package.json not found in ${root}`);
    }
    this.id = crypto.randomUUID();
    this.projectRoot = root;
    this.packageManager = detectPackageManager(root);
    this.stateDir = path.resolve(options.stateDir ?? path.join(root, '.hcbridge', 'sandbox'));
    this.options = {
      ...options,
      projectRoot: root,
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      commandTimeoutMs: options.commandTimeoutMs ?? 120_000,
    };
  }

  status(): SandboxStatus {
    return {
      id: this.id,
      projectRoot: this.projectRoot,
      state: this.state,
      packageManager: this.packageManager,
      previewUrl: this.previewUrl,
      pid: this.process?.pid ?? null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastError: this.lastError,
    };
  }

  async prepare(): Promise<SandboxStatus> {
    this.ensureNotDisposed();
    if (this.options.install === false) {
      this.setState('ready');
      return this.status();
    }
    this.setState('installing');
    const result = await this.exec(this.packageManager.executable, installArgs(this.packageManager, this.options.installArgs));
    if (result.code !== 0) {
      this.fail(`Dependency installation failed with exit code ${String(result.code)}.`);
      throw new Error(`SANDBOX_INSTALL_FAILED: ${result.stderr || result.stdout}`);
    }
    this.setState('ready');
    return this.status();
  }

  async start(): Promise<SandboxStatus> {
    this.ensureNotDisposed();
    if (this.process) return this.status();
    if (this.state === 'created' || this.state === 'stopped' || this.state === 'failed') await this.prepare();
    this.setState('starting');
    const command = this.options.command ?? this.packageManager.executable;
    const args = this.options.command
      ? (this.options.args ?? [])
      : packageManagerRunArgs(this.packageManager, this.options.script ?? 'dev', this.options.args ?? []);
    const child = spawnProjectCommand(command, args, {
      cwd: this.projectRoot,
      env: {
        ...process.env,
        ...this.options.env,
        ...(this.options.host ? { HOST: this.options.host } : {}),
        ...(this.options.port ? { PORT: String(this.options.port) } : {}),
      },
    });
    this.process = child;
    this.attachProcess(child);
    try {
      this.previewUrl = await this.waitForPreviewUrl();
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.setState('running');
    return this.status();
  }

  async stop(): Promise<SandboxStatus> {
    const child = this.process;
    if (!child) {
      if (this.state !== 'disposed') this.setState('stopped');
      return this.status();
    }
    await killProcessTree(child);
    this.process = null;
    this.previewUrl = null;
    if (this.state !== 'disposed') this.setState('stopped');
    return this.status();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.setState('disposed');
    this.removeAllListeners();
  }

  async exec(command: string, args: string[] = [], timeoutMs = this.options.commandTimeoutMs): Promise<SandboxProcessResult> {
    this.ensureNotDisposed();
    const started = Date.now();
    const child = spawnProjectCommand(command, args, {
      cwd: this.projectRoot,
      env: { ...process.env, ...this.options.env },
    });
    return await collectProcess(child, timeoutMs, started, (stream, chunk) => this.emit('process:output', { stream, chunk }));
  }

  async readFile(relativeFile: string): Promise<{ content: string; hash: string }> {
    const absolute = this.resolveProjectPath(relativeFile);
    const content = await fsp.readFile(absolute, 'utf8');
    return { content, hash: sha256(content) };
  }

  async writeFile(relativeFile: string, content: string, expectedHash?: string): Promise<{ hash: string; diff: string }> {
    const rel = normalizeRelative(relativeFile);
    const absolute = this.resolveProjectPath(rel);
    let before = '';
    if (fs.existsSync(absolute)) {
      before = await fsp.readFile(absolute, 'utf8');
      if (expectedHash && sha256(before) !== expectedHash) throw new Error(`STALE_FILE: ${rel}`);
    } else if (expectedHash) {
      throw new Error(`STALE_FILE: ${rel}`);
    }
    await atomicWrite(absolute, content);
    const hash = sha256(content);
    this.emit('file:changed', { file: rel, hash, actor: 'human' });
    return { hash, diff: createUnifiedDiff(rel, before, content) };
  }

  async applyEditIntent(intent: EditIntent): Promise<EditResult> {
    this.ensureNotDisposed();
    const intentId = intent.id ?? `edit_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const rejectedFiles: Array<{ file: string; reason: string }> = [];
    const changedFiles: string[] = [];
    const diffs: string[] = [];
    const grouped = new Set(intent.operations.map((operation) => normalizeRelative(operation.file)));
    for (const file of grouped) {
      const expected = intent.expectedHashes?.[file];
      if (!expected) continue;
      const absolute = this.resolveProjectPath(file);
      if (!fs.existsSync(absolute) || sha256(await fsp.readFile(absolute)) !== expected) {
        rejectedFiles.push({ file, reason: 'STALE_FILE' });
      }
    }
    if (rejectedFiles.length) return { intentId, changedFiles, diffs, rejectedFiles };

    const before = new Map<string, { exists: boolean; content: string }>();
    const touched = new Set<string>();
    for (const operation of intent.operations) {
      const file = normalizeRelative(operation.file);
      if (!before.has(file)) {
        const absolute = this.resolveProjectPath(file);
        before.set(file, { exists: fs.existsSync(absolute), content: fs.existsSync(absolute) ? await fsp.readFile(absolute, 'utf8') : '' });
      }
      try {
        switch (operation.kind) {
          case 'replace-text': {
            const current = await this.readFileIfExists(file);
            const index = findOccurrence(current, operation.oldText, operation.occurrence ?? 0);
            if (index === -1) throw new Error(`TEXT_NOT_FOUND: ${file}`);
            const next = current.slice(0, index) + operation.newText + current.slice(index + operation.oldText.length);
            await atomicWrite(this.resolveProjectPath(file), next);
            touched.add(file);
            break;
          }
          case 'write-file':
            await atomicWrite(this.resolveProjectPath(file), operation.content);
            touched.add(file);
            break;
          case 'delete-file':
            await fsp.rm(this.resolveProjectPath(file), { force: true });
            touched.add(file);
            break;
        }
      } catch (error) {
        for (const rollbackFile of touched) {
          const original = before.get(rollbackFile);
          if (!original?.exists) await fsp.rm(this.resolveProjectPath(rollbackFile), { force: true });
          else await atomicWrite(this.resolveProjectPath(rollbackFile), original.content);
        }
        rejectedFiles.push({ file, reason: String(error) });
        return { intentId, changedFiles, diffs, rejectedFiles };
      }
    }
    for (const file of touched) {
      const current = await this.readFileIfExists(file);
      const original = before.get(file)?.content ?? '';
      const originalExists = before.get(file)?.exists ?? false;
      if (current !== original || !originalExists) {
        changedFiles.push(file);
        diffs.push(createUnifiedDiff(file, original, current));
        this.emit('file:changed', { file, actor: intent.actor, hash: sha256(current) });
      }
    }
    return { intentId, changedFiles, diffs, rejectedFiles };
  }

  async snapshot(label?: string): Promise<SandboxSnapshot> {
    this.ensureNotDisposed();
    await fsp.mkdir(path.join(this.stateDir, 'snapshots'), { recursive: true });
    const id = `${label ? sanitizeLabel(label) + '_' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}`;
    const snapshotDir = path.join(this.stateDir, 'snapshots', id);
    await fsp.mkdir(snapshotDir, { recursive: true });
    const files = await listProjectFiles(this.projectRoot, this.options.exclude ?? DEFAULT_EXCLUDES);
    for (const file of files) {
      const source = this.resolveProjectPath(file.path);
      const target = path.join(snapshotDir, file.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
    }
    const snapshot: SandboxSnapshot = {
      id,
      createdAt: new Date().toISOString(),
      projectRoot: this.projectRoot,
      sourceDir: snapshotDir,
      files: files.map(({ path: filePath, hash, size }) => ({ path: filePath, hash, size })),
    };
    await atomicWrite(path.join(snapshotDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    this.latestSnapshotId = id;
    return snapshot;
  }

  async restore(snapshotId?: string): Promise<SandboxSnapshot> {
    this.ensureNotDisposed();
    const id = snapshotId ?? this.latestSnapshotId;
    if (!id) throw new Error('NO_SNAPSHOT');
    const snapshotFile = path.join(this.stateDir, 'snapshots', id, 'snapshot.json');
    if (!fs.existsSync(snapshotFile)) throw new Error(`SNAPSHOT_NOT_FOUND: ${id}`);
    const snapshot = JSON.parse(await fsp.readFile(snapshotFile, 'utf8')) as SandboxSnapshot;
    const current = await listProjectFiles(this.projectRoot, this.options.exclude ?? DEFAULT_EXCLUDES);
    const currentPaths = new Set(current.map((file) => file.path));
    const snapshotPaths = new Set(snapshot.files.map((file) => file.path));
    for (const file of currentPaths) {
      if (!snapshotPaths.has(file)) await fsp.rm(this.resolveProjectPath(file), { force: true });
    }
    for (const file of snapshot.files) {
      const source = path.join(snapshot.sourceDir, file.path);
      const target = this.resolveProjectPath(file.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
    }
    this.latestSnapshotId = snapshot.id;
    this.emit('snapshot:restored', snapshot);
    return snapshot;
  }

  async diff(snapshotId?: string): Promise<SandboxDiff> {
    const id = snapshotId ?? this.latestSnapshotId;
    const current = await listProjectFiles(this.projectRoot, this.options.exclude ?? DEFAULT_EXCLUDES);
    if (!id) return { snapshotId: null, changed: [], added: current.map((file) => file.path), removed: [], unchanged: [] };
    const snapshotFile = path.join(this.stateDir, 'snapshots', id, 'snapshot.json');
    if (!fs.existsSync(snapshotFile)) throw new Error(`SNAPSHOT_NOT_FOUND: ${id}`);
    const snapshot = JSON.parse(await fsp.readFile(snapshotFile, 'utf8')) as SandboxSnapshot;
    const currentMap = new Map(current.map((file) => [file.path, file.hash]));
    const snapshotMap = new Map(snapshot.files.map((file) => [file.path, file.hash]));
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];
    for (const [file, hash] of currentMap) {
      if (!snapshotMap.has(file)) added.push(file);
      else if (snapshotMap.get(file) === hash) unchanged.push(file);
      else changed.push(file);
    }
    for (const file of snapshotMap.keys()) if (!currentMap.has(file)) removed.push(file);
    return { snapshotId: id, changed: changed.sort(), added: added.sort(), removed: removed.sort(), unchanged: unchanged.sort() };
  }

  async files(): Promise<SandboxFile[]> {
    return await listProjectFiles(this.projectRoot, this.options.exclude ?? DEFAULT_EXCLUDES);
  }

  private async readFileIfExists(file: string): Promise<string> {
    const absolute = this.resolveProjectPath(file);
    return fs.existsSync(absolute) ? await fsp.readFile(absolute, 'utf8') : '';
  }

  private resolveProjectPath(relativeFile: string): string {
    const rel = normalizeRelative(relativeFile);
    if (!rel || rel === '..' || rel.startsWith('../')) throw new Error(`INVALID_PROJECT_PATH: ${relativeFile}`);
    const absolute = path.resolve(this.projectRoot, rel);
    if (!absolute.startsWith(`${this.projectRoot}${path.sep}`)) throw new Error(`INVALID_PROJECT_PATH: ${relativeFile}`);
    return absolute;
  }

  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    child.stdout.on('data', (chunk) => this.emit('process:output', { stream: 'stdout', chunk: chunk.toString() }));
    child.stderr.on('data', (chunk) => this.emit('process:output', { stream: 'stderr', chunk: chunk.toString() }));
    child.once('error', (error) => {
      this.lastError = error.message;
      this.fail(`Sandbox process error: ${error.message}`);
    });
    child.once('close', (code, signal) => {
      this.emit('process:exit', { code, signal });
      if (this.process === child) {
        this.process = null;
        if (code !== 0 && this.state !== 'stopped' && this.state !== 'disposed') this.fail(`Preview process exited with code ${String(code)}.`);
      }
    });
  }

  private async waitForPreviewUrl(): Promise<string> {
    const timeout = Date.now() + this.options.startupTimeoutMs;
    return await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const onOutput = (event: { stream: string; chunk: string }) => {
        buffer += event.chunk;
        const previewUrl = extractPreviewUrl(buffer);
        if (previewUrl) {
          cleanup();
          resolve(previewUrl);
        }
      };
      const onExit = (event: { code: number | null }) => {
        cleanup();
        reject(new Error(`SANDBOX_START_FAILED: ${this.startupMessage(buffer)} (exit=${String(event.code)})`));
      };
      const timer = setInterval(() => {
        if (Date.now() >= timeout) {
          cleanup();
          reject(new Error(`SANDBOX_START_TIMEOUT: ${this.startupMessage(buffer)}`));
        }
      }, 100);
      const cleanup = () => {
        clearInterval(timer);
        this.off('process:output', onOutput);
        this.off('process:exit', onExit);
      };
      this.on('process:output', onOutput);
      this.on('process:exit', onExit);
    });
  }

  private startupMessage(buffer: string): string {
    return buffer.slice(-1_500);
  }

  private ensureNotDisposed(): void {
    if (this.state === 'disposed') throw new Error('SANDBOX_DISPOSED');
  }

  private setState(next: SandboxState): void {
    this.state = next;
    this.updatedAt = new Date().toISOString();
    this.emit('state', this.status());
  }

  private fail(message: string): void {
    this.lastError = message;
    this.setState('failed');
  }
}

export function createSandboxSession(options: SandboxOptions): SandboxSession {
  return new SandboxSession(options);
}

export function extractPreviewUrl(output: string): string | undefined {
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const match = plain.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+(?:\/[^\s]*)?/);
  return match?.[0].replace('0.0.0.0', '127.0.0.1');
}

function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('close', done);
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => {
        try { child.kill(); } catch { done(); }
      });
    } else {
      try { child.kill('SIGTERM'); } catch { done(); }
    }
    setTimeout(done, 3_000).unref();
  });
}

function spawnProjectCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  const windowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'pipe',
    shell: windowsBatch,
    windowsHide: true,
  });
}

function installArgs(manager: PackageManagerInfo, extra: string[] | undefined): string[] {
  return ['install', ...(extra ?? [])];
}

function packageManagerRunArgs(manager: PackageManagerInfo, script: string, args: string[]): string[] {
  if (manager.name === 'npm') return ['run', script, ...(args.length ? ['--', ...args] : [])];
  if (manager.name === 'yarn') return ['run', script, ...args];
  if (manager.name === 'bun') return ['run', script, ...args];
  return ['run', script, ...(args.length ? ['--', ...args] : [])];
}

async function collectProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  started: number,
  onChunk: (stream: 'stdout' | 'stderr', chunk: string) => void,
): Promise<SandboxProcessResult> {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    onChunk('stdout', text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    onChunk('stderr', text);
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 1_000).unref();
  }, timeoutMs);
  return await new Promise<SandboxProcessResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? null : code, signal, stdout, stderr: timedOut ? `${stderr}\nCOMMAND_TIMEOUT\n` : stderr, durationMs: Date.now() - started });
    });
  });
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.hcbridge-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(temp, content, 'utf8');
  await fsp.rename(temp, file);
}

function findOccurrence(haystack: string, needle: string, occurrence: number): number {
  if (!needle) return 0;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) return -1;
    if (index === occurrence) return found;
    from = found + needle.length;
  }
  return -1;
}

function createUnifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const chunks = [`--- a/${file}`, `+++ b/${file}`, '@@'];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max && index < 500; index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) chunks.push(` ${left ?? ''}`);
    else {
      if (left !== undefined) chunks.push(`-${left}`);
      if (right !== undefined) chunks.push(`+${right}`);
    }
  }
  if (max > 500) chunks.push('@@ diff truncated after 500 lines @@');
  return chunks.join('\n');
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64) || 'snapshot';
}
