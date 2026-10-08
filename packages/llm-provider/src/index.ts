import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  createHeuristicAgent,
  type AgentContext,
  type AgentPlan,
  type AgentProvider,
} from '@hcbridge/agent-kernel';
import type { EditIntent } from '@hcbridge/sandbox-kernel';

export interface LlmProviderConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  temperature?: number;
}

export interface LlmHttpResponse {
  status: number;
  body: unknown;
}

export type LlmHttpTransport = (request: {
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}) => Promise<LlmHttpResponse>;

export interface LlmPlanEnvelope {
  summary: string;
  rationale?: string[];
  confidence?: number;
  warnings?: string[];
  verifyScripts?: string[];
  intent: {
    operations: EditIntent['operations'];
  };
}

const DEFAULT_TIMEOUT = 60_000;
const MAX_OPERATION_COUNT = 8;
const MAX_TEXT_SIZE = 8_000;
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_FILE_BYTES = 24_000;

export class OpenAICompatibleAgentProvider implements AgentProvider {
  readonly name: string;
  private readonly config: Required<Pick<LlmProviderConfig, 'endpoint' | 'model'>> & LlmProviderConfig;
  private readonly transport: LlmHttpTransport;

  constructor(config: LlmProviderConfig, transport: LlmHttpTransport = defaultTransport) {
    this.config = { ...config, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT };
    this.name = `llm:${config.model}`;
    this.transport = transport;
  }

  async plan(context: AgentContext): Promise<AgentPlan> {
    const contextPack = await buildContextPack(context);
    const requestBody = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify(contextPack, null, 2),
        },
      ],
      response_format: { type: 'json_object' },
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...this.config.headers,
    };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

    const response = await this.transport({
      endpoint: this.config.endpoint,
      headers,
      body: requestBody,
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`LLM_PROVIDER_HTTP_${response.status}`);
    }

    const envelope = parseLlmEnvelope(response.body);
    const validated = await validateModelEnvelope(context, envelope);
    const id = `plan_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const verifyScripts = sanitizeVerifyScripts(context.scripts, envelope.verifyScripts);
    return {
      id,
      provider: this.name,
      summary: envelope.summary,
      rationale: envelope.rationale?.length ? envelope.rationale : ['由外部 LLM 根据当前源码上下文生成。'],
      confidence: clamp(envelope.confidence ?? 0.7, 0, 1),
      requiresConfirmation: true,
      warnings: [
        ...(envelope.warnings ?? []),
        ...(validated.warnings.length ? validated.warnings : []),
      ],
      intent: {
        id,
        actor: 'ai',
        description: context.request.prompt,
        expectedHashes: validated.expectedHashes,
        operations: validated.operations,
      },
      verifyScripts,
    };
  }
}

export function createConfiguredAgent(env: NodeJS.ProcessEnv = process.env): AgentProvider {
  const endpoint = env.HCBRIDGE_AGENT_ENDPOINT?.trim();
  const model = env.HCBRIDGE_AGENT_MODEL?.trim();
  if (!endpoint || !model) {
    // Deliberately keep the local deterministic provider as a safe fallback.
    return createHeuristicAgent();
  }
  return new OpenAICompatibleAgentProvider({
    endpoint,
    model,
    apiKey: env.HCBRIDGE_AGENT_API_KEY,
    timeoutMs: parsePositiveInteger(env.HCBRIDGE_AGENT_TIMEOUT_MS, DEFAULT_TIMEOUT),
    temperature: 0,
  });
}

export async function buildContextPack(context: AgentContext): Promise<Record<string, unknown>> {
  const related = await collectRelatedFiles(context);
  return {
    prompt: context.request.prompt,
    inspection: context.request.inspection ?? null,
    selected: context.selected
      ? {
          file: context.selected.file,
          candidate: context.selected.candidate,
          occurrenceCount: context.selected.occurrenceCount,
          content: clip(context.selected.content, MAX_CONTEXT_FILE_BYTES),
        }
      : null,
    scripts: context.scripts,
    relatedFiles: related,
    constraints: {
      sourceIsTruth: true,
      doNotRewriteWholeFiles: true,
      useMinimalPatches: true,
      operations: ['replace-text'],
      maximumOperations: MAX_OPERATION_COUNT,
    },
  };
}

async function collectRelatedFiles(context: AgentContext): Promise<Array<{ file: string; content: string }>> {
  const selected = context.selected;
  if (!selected) return [];
  const root = path.resolve(context.projectRoot);
  const importPaths = [...selected.content.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)]
    .map((match) => match[2]!)
    .filter(Boolean)
    .slice(0, MAX_CONTEXT_FILES);
  const result: Array<{ file: string; content: string }> = [];
  for (const specifier of importPaths) {
    const file = resolveImport(root, selected.file, specifier);
    if (!file || file === path.resolve(root, selected.file)) continue;
    try {
      const content = await fs.readFile(file, 'utf8');
      result.push({
        file: path.relative(root, file).split(path.sep).join('/'),
        content: clip(content, MAX_CONTEXT_FILE_BYTES),
      });
    } catch {
      // Unreadable files are omitted from model context and therefore cannot be safely patched.
    }
  }
  return result;
}

function resolveImport(root: string, sourceFile: string, specifier: string): string | undefined {
  const base = path.resolve(root, path.dirname(sourceFile));
  const raw = path.resolve(base, specifier);
  const candidates = [
    raw,
    `${raw}.vue`,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.jsx`,
    path.join(raw, 'index.ts'),
    path.join(raw, 'index.js'),
  ];
  return candidates.find((candidate) => candidate.startsWith(`${root}${path.sep}`) && fsSync.existsSync(candidate));
}

function parseLlmEnvelope(body: unknown): LlmPlanEnvelope {
  const candidate = extractJsonCandidate(body);
  if (!candidate || typeof candidate !== 'object') throw new Error('LLM_PROVIDER_INVALID_JSON');
  const value = candidate as Record<string, unknown>;
  if (typeof value.summary !== 'string' || !value.intent || typeof value.intent !== 'object') {
    throw new Error('LLM_PROVIDER_INVALID_PLAN');
  }
  const intent = value.intent as Record<string, unknown>;
  if (!Array.isArray(intent.operations)) throw new Error('LLM_PROVIDER_OPERATIONS_REQUIRED');
  return {
    summary: value.summary,
    rationale: Array.isArray(value.rationale) ? value.rationale.filter((x): x is string => typeof x === 'string') : undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((x): x is string => typeof x === 'string') : undefined,
    verifyScripts: Array.isArray(value.verifyScripts) ? value.verifyScripts.filter((x): x is string => typeof x === 'string') : undefined,
    intent: { operations: intent.operations as EditIntent['operations'] },
  };
}

function extractJsonCandidate(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (record.summary && record.intent) return record;
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length) {
    const message = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).message : undefined;
    const content = message && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined;
    if (typeof content === 'string') return JSON.parse(stripCodeFence(content));
  }
  const output = record.output;
  if (typeof output === 'string') return JSON.parse(stripCodeFence(output));
  return undefined;
}

async function validateModelEnvelope(
  context: AgentContext,
  envelope: LlmPlanEnvelope,
): Promise<{ operations: EditIntent['operations']; expectedHashes: Record<string, string>; warnings: string[] }> {
  const operations = envelope.intent.operations;
  if (operations.length < 1 || operations.length > MAX_OPERATION_COUNT) throw new Error('LLM_PROVIDER_OPERATION_LIMIT');
  const allowedFiles = new Map<string, string>();
  if (context.selected) allowedFiles.set(normalizeFile(context.selected.file), context.selected.content);
  for (const related of await collectRelatedFiles(context)) allowedFiles.set(normalizeFile(related.file), related.content);

  const expectedHashes: Record<string, string> = {};
  const warnings: string[] = [];
  const normalized: EditIntent['operations'] = [];
  for (const operation of operations) {
    if (!operation || operation.kind !== 'replace-text' || typeof operation.file !== 'string' || typeof operation.oldText !== 'string' || typeof operation.newText !== 'string') {
      throw new Error('LLM_PROVIDER_OPERATION_INVALID');
    }
    const file = normalizeFile(operation.file);
    const source = allowedFiles.get(file);
    if (source === undefined) throw new Error(`LLM_PROVIDER_FILE_OUT_OF_CONTEXT: ${file}`);
    if (!operation.oldText || operation.oldText.length > MAX_TEXT_SIZE || operation.newText.length > MAX_TEXT_SIZE) {
      throw new Error(`LLM_PROVIDER_TEXT_LIMIT: ${file}`);
    }
    const count = countOccurrences(source, operation.oldText);
    const occurrence = operation.occurrence ?? 0;
    if (!Number.isInteger(occurrence) || occurrence < 0) throw new Error(`LLM_PROVIDER_OCCURRENCE_INVALID: ${file}`);
    if (count === 0) throw new Error(`LLM_PROVIDER_OLD_TEXT_NOT_FOUND: ${file}`);
    if (count > 1 && operation.occurrence === undefined) {
      throw new Error(`LLM_PROVIDER_OLD_TEXT_AMBIGUOUS: ${file}`);
    }
    if (operation.occurrence !== undefined && occurrence >= count) {
      throw new Error(`LLM_PROVIDER_OLD_TEXT_AMBIGUOUS: ${file}`);
    }
    expectedHashes[file] = sha256(source);
    normalized.push({ ...operation, file });
    if (count > 1) warnings.push(`${file}: replace-text 命中 ${count} 次，已要求显式 occurrence=${occurrence}。`);
  }
  return { operations: normalized, expectedHashes, warnings };
}

function sanitizeVerifyScripts(scripts: Record<string, string>, requested?: string[]): string[] {
  const allowed = new Set(Object.keys(scripts));
  const safe = (requested ?? ['typecheck', 'build']).filter((script) => allowed.has(script));
  return [...new Set(safe)];
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const index = source.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    from = index + Math.max(1, needle.length);
  }
}

function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function clip(content: string, max: number): string {
  return content.length <= max ? content : `${content.slice(0, max)}\n/* …context clipped… */`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function stripCodeFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

async function defaultTransport(request: { endpoint: string; headers: Record<string, string>; body: unknown; timeoutMs: number }): Promise<LlmHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `You are a source-preserving Vue code evolution agent.\n\nReturn JSON only with this shape:\n{\n  "summary": string,\n  "rationale": string[],\n  "confidence": number,\n  "warnings": string[],\n  "verifyScripts": string[],\n  "intent": {\n    "operations": [\n      { "kind": "replace-text", "file": string, "oldText": string, "newText": string, "occurrence": number? }\n    ]\n  }\n}\n\nRules:\n1. Source code is truth. Never invent a virtual configuration layer.\n2. Make the smallest local patch that satisfies the user request.\n3. Only edit files present in the supplied context.\n4. Do not rewrite an entire SFC.\n5. Do not alter unrelated code.\n6. Use exact source text in oldText.\n7. Use occurrence when oldText appears multiple times.\n8. Do not guess when evidence is insufficient; return zero operations and explain why.\n9. Keep the plan suitable for human confirmation before application.`;
