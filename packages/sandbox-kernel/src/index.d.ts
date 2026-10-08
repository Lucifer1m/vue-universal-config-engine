import { EventEmitter } from 'node:events';
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
    rejectedFiles: Array<{
        file: string;
        reason: string;
    }>;
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
    readFile(relativeFile: string): Promise<{
        content: string;
        hash: string;
    }>;
    writeFile(relativeFile: string, content: string, expectedHash?: string): Promise<{
        hash: string;
        diff: string;
    }>;
    applyEditIntent(intent: EditIntent): Promise<EditResult>;
    snapshot(label?: string): Promise<SandboxSnapshot>;
    restore(snapshotId?: string): Promise<SandboxSnapshot>;
    diff(snapshotId?: string): Promise<SandboxDiff>;
    files(): Promise<SandboxFile[]>;
    dispose(): Promise<void>;
}
export declare function sha256(value: string | Buffer): string;
export declare function hashFile(file: string): Promise<string>;
export declare function detectPackageManager(projectRoot: string): PackageManagerInfo;
export declare function listProjectFiles(projectRoot: string, exclude?: string[]): Promise<SandboxFile[]>;
export declare class SandboxSession extends EventEmitter implements SandboxRuntime {
    readonly id: string;
    readonly projectRoot: string;
    readonly packageManager: PackageManagerInfo;
    readonly stateDir: string;
    readonly options: SandboxOptions & {
        startupTimeoutMs: number;
        commandTimeoutMs: number;
    };
    private state;
    private process;
    private previewUrl;
    private lastError;
    private createdAt;
    private updatedAt;
    private latestSnapshotId;
    constructor(options: SandboxOptions);
    status(): SandboxStatus;
    prepare(): Promise<SandboxStatus>;
    start(): Promise<SandboxStatus>;
    stop(): Promise<SandboxStatus>;
    dispose(): Promise<void>;
    exec(command: string, args?: string[], timeoutMs?: number): Promise<SandboxProcessResult>;
    readFile(relativeFile: string): Promise<{
        content: string;
        hash: string;
    }>;
    writeFile(relativeFile: string, content: string, expectedHash?: string): Promise<{
        hash: string;
        diff: string;
    }>;
    applyEditIntent(intent: EditIntent): Promise<EditResult>;
    snapshot(label?: string): Promise<SandboxSnapshot>;
    restore(snapshotId?: string): Promise<SandboxSnapshot>;
    diff(snapshotId?: string): Promise<SandboxDiff>;
    files(): Promise<SandboxFile[]>;
    private readFileIfExists;
    private resolveProjectPath;
    private attachProcess;
    private waitForPreviewUrl;
    private startupMessage;
    private ensureNotDisposed;
    private setState;
    private fail;
}
export declare function createSandboxSession(options: SandboxOptions): SandboxSession;
