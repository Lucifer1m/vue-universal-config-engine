import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EditIntent, EditResult, SandboxSession, SandboxSnapshot } from '@hcbridge/sandbox-kernel';

export interface AgentTarget {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  attributes?: Record<string, string | true>;
  href?: string;
}

export interface AgentCandidate {
  file: string;
  nodeId: string;
  kind: 'element' | 'component' | 'text' | 'root';
  tag?: string;
  structuralPath: string;
  range: { start: { offset: number; line: number; column: number }; end: { offset: number; line: number; column: number } };
  sourceText: string;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface AgentInspection {
  state: 'exact' | 'relocated' | 'ambiguous' | 'lost';
  target?: AgentTarget;
  candidate?: AgentCandidate;
  candidates?: AgentCandidate[];
}

export interface AgentRequest {
  prompt: string;
  target?: AgentTarget;
  inspection?: AgentInspection;
}

export interface AgentContext {
  projectRoot: string;
  request: AgentRequest;
  selected?: {
    file: string;
    content: string;
    candidate: AgentCandidate;
    occurrenceCount: number;
  };
  scripts: Record<string, string>;
}

export interface AgentPlan {
  id: string;
  provider: string;
  summary: string;
  rationale: string[];
  confidence: number;
  requiresConfirmation: boolean;
  warnings: string[];
  intent: EditIntent;
  verifyScripts: string[];
}

export interface AgentProvider {
  readonly name: string;
  plan(context: AgentContext): Promise<AgentPlan>;
}

export interface AgentApplyResult {
  plan: AgentPlan;
  snapshot: SandboxSnapshot;
  edit: EditResult;
  verification: Array<{ script: string; code: number | null; stdout: string; stderr: string }>;
  verified: boolean;
  rolledBack: boolean;
}

export interface AgentEngineOptions {
  provider?: AgentProvider;
  verify?: boolean;
  rollbackOnVerificationFailure?: boolean;
}

export async function buildAgentContext(projectRoot: string, request: AgentRequest): Promise<AgentContext> {
  const root = path.resolve(projectRoot);
  const scripts = await readScripts(root);
  const candidate = request.inspection?.candidate;
  let selected: AgentContext['selected'];
  if (candidate) {
    const file = path.resolve(root, candidate.file);
    try {
      const content = await fs.readFile(file, 'utf8');
      const occurrenceCount = countOccurrences(content, candidate.sourceText);
      selected = { file: candidate.file, content, candidate, occurrenceCount };
    } catch {
      selected = undefined;
    }
  }
  return { projectRoot: root, request, selected, scripts };
}

export function createHeuristicAgent(): AgentProvider {
  return new HeuristicAgentProvider();
}

export class HeuristicAgentProvider implements AgentProvider {
  readonly name = 'heuristic-local';

  async plan(context: AgentContext): Promise<AgentPlan> {
    const id = `plan_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const prompt = context.request.prompt.trim();
    const selected = context.selected;
    const warnings: string[] = [];
    const rationale: string[] = [];

    if (!selected) {
      return rejectedPlan(id, prompt, '没有可靠的源码选中目标。请先在 Preview 中 Inspect 一个元素。', ['先选择一个 exact/relocated 源码候选。']);
    }
    if (context.request.inspection?.state === 'ambiguous' || context.request.inspection?.state === 'lost') {
      return rejectedPlan(id, prompt, '当前视觉定位不是唯一安全目标，Agent 不会猜测要修改哪个节点。', ['请从候选列表明确选择源码节点后再次规划。']);
    }
    if (selected.occurrenceCount !== 1) {
      return rejectedPlan(id, prompt, `源码片段出现 ${selected.occurrenceCount} 次，无法安全使用 replace-text 自动修改。`, ['需要更精确的 SourceRef 或结构化 Patch。']);
    }

    const source = selected.candidate.sourceText;
    const tag = (selected.candidate.tag ?? '').toLowerCase();
    const operations: EditIntent['operations'] = [];
    let summary = '';
    let confidence = 0.5;

    const typeMatch = prompt.match(/(?:type|类型|按钮样式|样式).{0,8}(?:改成|设置为|变为|换成)\s*[`"“']?(primary|default|dashed|danger|link|text|ghost|主要|默认|虚线|危险|链接)[`"”']?/i);
    const looseType = prompt.match(/(?:改成|换成|设置为)\s*[`"“']?(primary|default|dashed|danger|link|text|ghost)[`"”']?/i);
    const requestedTypeRaw = typeMatch?.[1] ?? looseType?.[1];
    const requestedType = requestedTypeRaw ? ({主要:'primary',默认:'default',虚线:'dashed',危险:'danger',链接:'link'} as Record<string,string>)[requestedTypeRaw] ?? requestedTypeRaw : undefined;
    if (requestedType && /^(a-button|a-btn|button)$/.test(tag)) {
      if (tag === 'button' && requestedType !== 'default') {
        warnings.push('原生 button 的 type 与 Ant Design Vue Button 的 type 语义不同，因此不自动把颜色/样式映射到原生 button。');
      } else {
        const replacement = replaceStaticAttribute(source, 'type', requestedType);
        if (replacement) {
          operations.push({ kind:'replace-text', file:selected.file, oldText:source, newText:replacement });
          summary = `将 ${selected.file} 中的 ${tag} type 改为 ${requestedType}`;
          rationale.push('目标是一个唯一定位的按钮源码节点。');
          rationale.push('修改保持为局部文本 Patch，不重写整个 SFC。');
          confidence = 0.93;
        }
      }
    }

    const placeholderMatch = prompt.match(/placeholder.{0,10}(?:改成|改为|设置为|变成)\s*[`"“']?([^`"”']+)[`"”']?/i);
    if (!operations.length && placeholderMatch && /^(a-input|input|textarea)$/.test(tag)) {
      const replacement = replaceStaticAttribute(source, 'placeholder', placeholderMatch[1]!.trim());
      if (replacement) {
        operations.push({ kind:'replace-text', file:selected.file, oldText:source, newText:replacement });
        summary = `将 ${selected.file} 中的 ${tag} placeholder 修改为 ${placeholderMatch[1]!.trim()}`;
        rationale.push('目标是输入控件，修改仅涉及静态 placeholder 属性。');
        confidence = 0.91;
      }
    }

    const textMatch = prompt.match(/(?:文本|文字|内容).{0,10}(?:改成|改为|设置为|变成)\s*[`"“']?([^`"”']+)[`"”']?/i);
    if (!operations.length && textMatch) {
      const next = replaceDirectText(source, textMatch[1]!.trim());
      if (next) {
        operations.push({ kind:'replace-text', file:selected.file, oldText:source, newText:next });
        summary = `将 ${selected.file} 的目标文本修改为 ${textMatch[1]!.trim()}`;
        rationale.push('目标源码只有单层直接文本，属于低风险文本修改。');
        confidence = 0.86;
      }
    }

    if (!operations.length) {
      return rejectedPlan(id, prompt, '本地规则 Agent 无法安全把这句话转换成确定的源码 Patch。', [
        '当前 MVP 只支持安全的按钮 type、输入 placeholder 和单层直接文本修改。',
        '复杂布局、状态逻辑、CSS、跨文件修改应交给真正的 LLM Provider。',
      ]);
    }

    const verifyScripts = preferredVerifyScripts(context.scripts);
    if (!verifyScripts.length) warnings.push('项目没有暴露 typecheck/build script，Apply 后只能做文件级验证。');
    const intent: EditIntent = {
      id,
      actor: 'ai',
      description: prompt,
      expectedHashes: { [selected.file]: sha256(selected.content) },
      operations,
    };
    return { id, provider:this.name, summary, rationale, confidence, requiresConfirmation:true, warnings, intent, verifyScripts };
  }
}

export async function applyAgentPlan(session: SandboxSession, plan: AgentPlan, options: AgentEngineOptions = {}): Promise<AgentApplyResult> {
  const snapshot = await session.snapshot('agent');
  const edit = await session.applyEditIntent(plan.intent);
  const verification: AgentApplyResult['verification'] = [];
  let verified = edit.rejectedFiles.length === 0;
  let rolledBack = false;

  if (verified && (options.verify ?? true)) {
    for (const script of plan.verifyScripts) {
      const result = await session.exec(session.packageManager.executable, ['run', script]);
      verification.push({ script, code: result.code, stdout: result.stdout, stderr: result.stderr });
      if (result.code !== 0) {
        verified = false;
        break;
      }
    }
  }

  if (!verified && (options.rollbackOnVerificationFailure ?? true) && edit.rejectedFiles.length === 0) {
    await session.restore(snapshot.id);
    rolledBack = true;
  }
  return { plan, snapshot, edit, verification, verified, rolledBack };
}

async function readScripts(root: string): Promise<Record<string,string>> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string,string> };
    return manifest.scripts ?? {};
  } catch {
    return {};
  }
}

function preferredVerifyScripts(scripts: Record<string,string>): string[] {
  const result: string[] = [];
  if (scripts.typecheck) result.push('typecheck');
  else if (scripts['type-check']) result.push('type-check');
  if (scripts.build) result.push('build');
  return result;
}

function rejectedPlan(id:string, prompt:string, reason:string, warnings:string[]): AgentPlan {
  return {
    id,
    provider:'heuristic-local',
    summary:'无法生成安全 Patch',
    rationale:[reason],
    confidence:0,
    requiresConfirmation:true,
    warnings,
    intent:{ id, actor:'ai', description:prompt, operations:[] },
    verifyScripts:[],
  };
}

function countOccurrences(source:string, needle:string):number {
  if (!needle) return 0;
  let count=0, index=0;
  while ((index=source.indexOf(needle,index))>=0) { count += 1; index += needle.length || 1; }
  return count;
}

function replaceStaticAttribute(source:string, name:string, value:string):string | undefined {
  const escaped = value.replace(/\\/g,'\\\\').replace(/"/g,'&quot;');
  const existing = new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
  if (existing.test(source)) return source.replace(existing, `$1$2${escaped}$2`);
  const open = source.match(/^\s*<[^>]+/s);
  if (!open) return undefined;
  const opening = open[0];
  const nextOpening = `${opening} ${name}="${escaped}"`;
  return nextOpening + source.slice(opening.length);
}

function replaceDirectText(source:string, text:string):string | undefined {
  const match = source.match(/^(\s*<[^>]+>)([^<>]*?)(<\/[^>]+>\s*)$/s);
  if (!match) return undefined;
  return `${match[1]}${text}${match[3]}`;
}

function sha256(source:string):string {
  return crypto.createHash('sha256').update(source).digest('hex');
}
