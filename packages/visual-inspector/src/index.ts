import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocatorState, SourceRange } from '@hcbridge/source-model';
import { flattenTemplate, readAndParseSfc, type ParsedTemplateNode } from '@hcbridge/vue-parser';

export interface DomAncestorSignature {
  tag: string;
  id?: string;
  classes?: string[];
}

export interface DomTargetSignature {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string | true>;
  text?: string;
  ancestors?: DomAncestorSignature[];
  path?: number[];
  href?: string;
}

export interface SourceCandidate {
  file: string;
  nodeId: string;
  kind: ParsedTemplateNode['kind'];
  tag?: string;
  structuralPath: string;
  range: SourceRange;
  sourceText: string;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface VisualInspectionResult {
  state: LocatorState;
  target: DomTargetSignature;
  candidate?: SourceCandidate;
  candidates: SourceCandidate[];
  scannedFiles: number;
  scannedNodes: number;
}

export interface VisualInspectorOptions {
  maxCandidates?: number;
  maxFiles?: number;
  minScore?: number;
}

interface CandidateRecord {
  candidate: SourceCandidate;
  strongIdentity: boolean;
}

const DEFAULT_MAX_CANDIDATES = 8;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MIN_SCORE = 18;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.hcbridge', 'coverage', '.cache']);

export async function inspectDomTarget(
  projectRoot: string,
  target: DomTargetSignature,
  options: VisualInspectorOptions = {},
): Promise<VisualInspectionResult> {
  const root = path.resolve(projectRoot);
  const files = await findVueFiles(root, options.maxFiles ?? DEFAULT_MAX_FILES);
  const records: CandidateRecord[] = [];
  let scannedNodes = 0;
  for (const file of files) {
    let parsed;
    try {
      parsed = readAndParseSfc(file, { projectRoot: root });
    } catch {
      continue;
    }
    const nodes = flattenTemplate(parsed.template);
    const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
    for (const node of nodes) {
      if (node.kind !== 'element' && node.kind !== 'component') continue;
      scannedNodes += 1;
      const scored = scoreNode(target, node, nodeMap);
      if (scored.score < (options.minScore ?? DEFAULT_MIN_SCORE)) continue;
      records.push({
        candidate: {
          file: path.relative(root, file).split(path.sep).join('/'),
          nodeId: node.nodeId,
          kind: node.kind,
          tag: node.tag,
          structuralPath: node.structuralPath,
          range: node.range,
          sourceText: node.sourceText,
          score: scored.score,
          confidence: 0,
          reasons: scored.reasons,
        },
        strongIdentity: scored.strongIdentity,
      });
    }
  }

  records.sort((a, b) => b.candidate.score - a.candidate.score);
  const candidates = records.slice(0, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES).map((entry, index, list) => ({
    ...entry.candidate,
    confidence: confidenceFor(entry.candidate.score, list[0]?.candidate.score ?? 0, list[1]?.candidate.score ?? 0, index === 0, entry.strongIdentity),
  }));

  const best = candidates[0];
  const second = candidates[1];
  let state: LocatorState = 'lost';
  if (best) {
    const margin = best.score - (second?.score ?? 0);
    if (best.confidence >= 0.82 && margin >= 8) state = 'exact';
    else if (best.confidence >= 0.5 && margin >= 4) state = 'relocated';
    else state = 'ambiguous';
  }

  return {
    state,
    target,
    candidate: state === 'ambiguous' || state === 'lost' ? undefined : best,
    candidates,
    scannedFiles: files.length,
    scannedNodes,
  };
}

function scoreNode(target: DomTargetSignature, node: ParsedTemplateNode, nodeMap: Map<string, ParsedTemplateNode>): { score: number; reasons: string[]; strongIdentity: boolean } {
  const reasons: string[] = [];
  let score = 0;
  let strongIdentity = false;
  const nodeTag = node.tag?.toLowerCase();
  const targetTag = target.tag.toLowerCase();

  if (nodeTag === targetTag) {
    score += 28;
    reasons.push('tag');
  } else if (nodeTag && componentAliasMatches(nodeTag, targetTag)) {
    score += 16;
    reasons.push('component-root-tag');
  }

  const nodeAttrs = new Map(node.attributes.filter((attr) => attr.kind === 'attribute').map((attr) => [attr.name, attr.value ?? '']));
  if (target.id && nodeAttrs.get('id') === target.id) {
    score += 42;
    strongIdentity = true;
    reasons.push('id');
  }

  const targetClasses = new Set(target.classes ?? []);
  const nodeClasses = String(nodeAttrs.get('class') ?? '').split(/\s+/).filter(Boolean);
  const classHits = nodeClasses.filter((value) => targetClasses.has(value));
  if (classHits.length) {
    score += Math.min(18, classHits.length * 6);
    reasons.push(`class:${classHits.length}`);
  }

  for (const [name, value] of Object.entries(target.attributes ?? {})) {
    if (name === 'id' || name === 'class') continue;
    const candidateValue = nodeAttrs.get(name);
    if (candidateValue === undefined) continue;
    score += candidateValue === value || value === true ? 5 : 2;
    reasons.push(`attr:${name}`);
  }

  const targetText = normalizeText(target.text ?? '');
  const nodeText = normalizeText(directText(node));
  if (targetText && nodeText && targetText === nodeText) {
    score += 20;
    strongIdentity = true;
    reasons.push('text');
  } else if (targetText && nodeText && (nodeText.includes(targetText) || targetText.includes(nodeText)) && Math.min(targetText.length, nodeText.length) >= 4) {
    score += 8;
    reasons.push('text-partial');
  }

  if (target.href && nodeAttrs.get('href') === target.href) {
    score += 12;
    reasons.push('href');
  }

  const ancestorMatch = ancestorScore(target.ancestors ?? [], node, nodeMap);
  if (ancestorMatch > 0) {
    score += ancestorMatch;
    reasons.push(`ancestors:${ancestorMatch}`);
  }

  return { score, reasons, strongIdentity };
}

function confidenceFor(score: number, topScore: number, secondScore: number, isTop: boolean, strongIdentity: boolean): number {
  if (!isTop) return Math.min(0.78, score / 100);
  const margin = score - secondScore;
  const base = Math.min(1, score / 95);
  const marginBoost = Math.min(0.18, Math.max(0, margin) / 60);
  const identityBoost = strongIdentity ? 0.08 : 0;
  return Math.min(0.99, Math.max(0.05, base + marginBoost + identityBoost + (score === topScore ? 0.02 : 0)));
}

function ancestorScore(ancestors: DomAncestorSignature[], node: ParsedTemplateNode, nodeMap: Map<string, ParsedTemplateNode>): number {
  if (!ancestors.length) return 0;
  let parentId = node.parentNodeId;
  let matched = 0;
  let index = 0;
  while (parentId && index < 4) {
    const parent = nodeMap.get(parentId);
    const observed = ancestors[index];
    if (!parent || !observed) break;
    if (normalizeTag(parent.tag ?? '') === normalizeTag(observed.tag)) matched += 3;
    parentId = parent.parentNodeId;
    index += 1;
  }
  return Math.min(12, matched);
}

function directText(node: ParsedTemplateNode): string {
  return node.children
    .filter((child) => child.kind === 'text')
    .map((child) => child.sourceText)
    .join(' ');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTag(tag: string): string {
  return tag.replace(/\s+/g, '').toLowerCase();
}

function componentAliasMatches(sourceTag: string, domTag: string): boolean {
  const normalized = sourceTag.replace(/-/g, '').toLowerCase();
  const dom = domTag.replace(/-/g, '').toLowerCase();
  if (!normalized || !dom) return false;
  return normalized.endsWith(dom) || dom.endsWith(normalized);
}

async function findVueFiles(root: string, maxFiles: number): Promise<string[]> {
  const result: string[] = [];
  await visit(root, '');
  return result;

  async function visit(directory: string, relative: string): Promise<void> {
    if (result.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      if (entry.name.startsWith('.') && entry.name !== '.vite') continue;
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(root, nextRelative);
      if (entry.isDirectory()) await visit(absolute, nextRelative);
      else if (entry.isFile() && entry.name.endsWith('.vue')) result.push(absolute);
    }
  }
}

export function createInspectorBridgeScript(sessionId: string): string {
  return `(function(){\n` +
    `const SESSION=${JSON.stringify(sessionId)};let enabled=false,overlay=null,last=null;\n` +
    `function sig(el){const attrs={};for(const a of Array.from(el.attributes).slice(0,40))attrs[a.name]=a.value||true;const ancestors=[];let p=el.parentElement;while(p&&ancestors.length<6){ancestors.push({tag:p.tagName.toLowerCase(),id:p.id||undefined,classes:Array.from(p.classList)});p=p.parentElement;}return {tag:el.tagName.toLowerCase(),id:el.id||undefined,classes:Array.from(el.classList),attributes:attrs,text:(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,180),href:el.getAttribute('href')||undefined,ancestors,path:(()=>{const result=[];let n=el;while(n&&n.parentElement&&result.length<8){result.unshift(Array.prototype.indexOf.call(n.parentElement.children,n));n=n.parentElement;}return result;})(),rect:(()=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()};}\n` +
    `function draw(el){if(!overlay){overlay=document.createElement('div');overlay.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #58a6ff;background:#58a6ff18;box-sizing:border-box';document.documentElement.appendChild(overlay);}const r=el.getBoundingClientRect();overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';}\n` +
    `window.addEventListener('message',e=>{if(!e.data||e.data.type!=='hcbridge-inspector')return;enabled=!!e.data.enabled;if(!enabled&&overlay){overlay.remove();overlay=null;}});\n` +
    `document.addEventListener('mousemove',e=>{if(!enabled)return;const el=e.target instanceof Element?e.target:null;if(!el||el===overlay)return;last=el;draw(el);window.parent.postMessage({type:'hcbridge:probe',sessionId:SESSION,target:sig(el)},'*');},{capture:true});\n` +
    `document.addEventListener('click',e=>{if(!enabled)return;const el=e.target instanceof Element?e.target:null;if(!el)return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:'hcbridge:select',sessionId:SESSION,target:sig(el)},'*');},{capture:true});\n` +
    `})();`;
}
