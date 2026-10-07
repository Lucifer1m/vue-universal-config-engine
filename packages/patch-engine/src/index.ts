import fs from 'node:fs';
import crypto from 'node:crypto';
import MagicString from 'magic-string';
import { parseVueSfc, findTemplateNode, type ParsedSfc, type ParsedTemplateNode } from '@hcbridge/vue-parser';
import type { ChangeSet } from '@hcbridge/hcp';
import type { SourceRange } from '@hcbridge/source-model';

export type PatchKind = 'replace' | 'insert' | 'delete';

export interface PatchOperation {
  file: string;
  nodeId: string;
  kind: PatchKind;
  range: SourceRange;
  oldTextHash: string;
  semanticPrecondition: string;
  newText: string;
  oldText?: string;
}

export interface PatchPlan {
  version: '0.1';
  operations: PatchOperation[];
  inverse: PatchOperation[];
  diagnostics: { severity: 'warning' | 'error'; code: string; message: string }[];
}

export interface ApplyResult {
  changed: boolean;
  text: string;
  gitDiff: string;
  inversePlan: PatchPlan;
}

export function createPatchPlan(parsed: ParsedSfc, change: ChangeSet): PatchPlan {
  const node = findTemplateNode(parsed, change.nodeId);
  if (!node) return failure('NODE_NOT_FOUND', `Node ${change.nodeId} not found.`);

  switch (change.operation) {
    case 'set-text': return planSetText(parsed, node, change.value);
    case 'set-binding': return planSetBinding(parsed, node, change.target, change.value);
    case 'set-event': return planSetEvent(parsed, node, change.target, change.value);
    case 'set-visibility': return planSetDirective(parsed, node, 'if', change.value);
    case 'set-prop': return planSetProp(parsed, node, change.target, change.value);
    case 'remove-prop': return planRemoveProp(parsed, node, change.target);
    case 'delete-node': return planDeleteNode(parsed, node);
    case 'insert-child': return planInsertChild(parsed, node, change.value, change.target || 'append');
    default: return failure('UNSUPPORTED_OPERATION', `Unsupported operation: ${(change as ChangeSet).operation}`);
  }
}

function planSetText(parsed: ParsedSfc, node: ParsedTemplateNode, value: string): PatchPlan {
  const textChild = node.children.find((child) => child.kind === 'text');
  if (!textChild) return failure('TEXT_TARGET_NOT_FOUND', `No direct text child found for ${node.nodeId}.`);
  return singleReplace(parsed, node.nodeId, textChild.range, value, 'set-text');
}

function planSetBinding(parsed: ParsedSfc, node: ParsedTemplateNode, target: string, value: string): PatchPlan {
  const attr = node.attributes.find((a) => a.kind === 'directive' && ((a.name === 'bind' && a.arg === target) || (a.name === 'model' && target === 'model')));
  if (attr?.valueRange) return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-binding:${target}`);
  if (attr && !attr.valueRange) return failure('BINDING_VALUE_UNSUPPORTED', `Binding ${target} has no expression value.`);
  const insertion = openingTagInsertion(parsed, node, ` :${target}=${quote(value)}`);
  return singleInsert(parsed, node.nodeId, insertion, `set-binding:${target}`);
}

function planSetEvent(parsed: ParsedSfc, node: ParsedTemplateNode, target: string, value: string): PatchPlan {
  const attr = node.attributes.find((a) => a.kind === 'directive' && a.name === 'on' && a.arg === target);
  if (attr?.valueRange) return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-event:${target}`);
  const insertion = openingTagInsertion(parsed, node, ` @${target}=${quote(value)}`);
  return singleInsert(parsed, node.nodeId, insertion, `set-event:${target}`);
}

function planSetDirective(parsed: ParsedSfc, node: ParsedTemplateNode, directive: string, value: string): PatchPlan {
  const attr = node.attributes.find((a) => a.kind === 'directive' && a.name === directive);
  if (attr?.valueRange) return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-${directive}`);
  const insertion = openingTagInsertion(parsed, node, ` v-${directive}=${quote(value)}`);
  return singleInsert(parsed, node.nodeId, insertion, `set-${directive}`);
}

function planSetProp(parsed: ParsedSfc, node: ParsedTemplateNode, target: string, value: string): PatchPlan {
  const attr = node.attributes.find((a) => a.kind === 'attribute' && a.name === target);
  if (attr?.valueRange) return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-prop:${target}`);
  if (attr && !attr.valueRange) {
    const range = attr.range;
    const raw = parsed.text.slice(range.start.offset, range.end.offset);
    const replacement = `${target}=${quote(value)}`;
    return singleReplace(parsed, node.nodeId, range, replacement, `set-prop:${target}`);
  }
  const insertion = openingTagInsertion(parsed, node, ` ${target}=${quote(value)}`);
  return singleInsert(parsed, node.nodeId, insertion, `set-prop:${target}`);
}

function planRemoveProp(parsed: ParsedSfc, node: ParsedTemplateNode, target: string): PatchPlan {
  const attr = node.attributes.find((a) => (a.kind === 'attribute' && a.name === target) || (a.kind === 'directive' && a.arg === target));
  if (!attr) return failure('PROP_NOT_FOUND', `Prop ${target} not found on ${node.nodeId}.`);
  return singleDelete(parsed, node.nodeId, attr.range, `remove-prop:${target}`);
}

function planDeleteNode(parsed: ParsedSfc, node: ParsedTemplateNode): PatchPlan {
  if (node.kind === 'root') return failure('ROOT_DELETE_FORBIDDEN', 'Cannot delete template root.');
  return singleDelete(parsed, node.nodeId, node.range, 'delete-node');
}

function planInsertChild(parsed: ParsedSfc, node: ParsedTemplateNode, childSource: string, position: string): PatchPlan {
  if (node.kind === 'root') {
    const rootChildren = node.children;
    const offset = position === 'prepend'
      ? (rootChildren[0]?.range.start.offset ?? parsed.template.range.end.offset)
      : parsed.template.range.end.offset;
    const range = { start: { ...parsed.template.range.start, offset }, end: { ...parsed.template.range.start, offset } };
    return singleInsert(parsed, node.nodeId, range, 'insert-child', childSource);
  }
  const openingEnd = findOpeningTagEnd(parsed.text, node.range.start.offset, node.range.end.offset);
  if (openingEnd < 0) return failure('OPENING_TAG_NOT_FOUND', `Cannot locate opening tag for ${node.nodeId}.`);
  const closingStart = parsed.text.lastIndexOf('</', node.range.end.offset);
  if (closingStart < 0 || closingStart < openingEnd) return failure('CLOSING_TAG_NOT_FOUND', `Cannot locate closing tag for ${node.nodeId}.`);
  const offset = position === 'prepend' ? openingEnd + 1 : closingStart;
  const text = position === 'prepend' ? `\n${childSource}` : `${childSource}\n`;
  const range = { start: { ...parsed.template.range.start, offset }, end: { ...parsed.template.range.start, offset } };
  return singleInsert(parsed, node.nodeId, range, 'insert-child', text);
}

function singleReplace(parsed: ParsedSfc, nodeId: string, range: SourceRange, newText: string, precondition: string): PatchPlan {
  const oldText = parsed.text.slice(range.start.offset, range.end.offset);
  return makePlan(parsed.file, nodeId, 'replace', range, oldText, newText, precondition);
}

function singleInsert(parsed: ParsedSfc, nodeId: string, range: SourceRange, precondition: string, newText?: string): PatchPlan {
  return makePlan(parsed.file, nodeId, 'insert', range, '', newText ?? precondition, precondition);
}

function singleDelete(parsed: ParsedSfc, nodeId: string, range: SourceRange, precondition: string): PatchPlan {
  const oldText = parsed.text.slice(range.start.offset, range.end.offset);
  return makePlan(parsed.file, nodeId, 'delete', range, oldText, '', precondition);
}

function makePlan(file: string, nodeId: string, kind: PatchKind, range: SourceRange, oldText: string, newText: string, precondition: string): PatchPlan {
  const op: PatchOperation = {
    file,
    nodeId,
    kind,
    range,
    oldTextHash: sha256(oldText),
    semanticPrecondition: precondition,
    newText,
    oldText,
  };
  return { version: '0.1', operations: [op], inverse: [], diagnostics: [] };
}

export function mergePatchPlans(plans: PatchPlan[]): PatchPlan {
  const operations = plans.flatMap((p) => p.operations);
  const diagnostics = plans.flatMap((p) => p.diagnostics);
  const overlap = findOverlaps(operations);
  if (overlap) diagnostics.push({ severity: 'error', code: 'OVERLAPPING_PATCHES', message: `Overlapping patch ranges for ${overlap.a.nodeId} and ${overlap.b.nodeId}.` });
  return { version: '0.1', operations, inverse: [], diagnostics };
}

export function applyPatchPlan(parsed: ParsedSfc, plan: PatchPlan): ApplyResult {
  if (plan.diagnostics.some((d) => d.severity === 'error')) throw new Error('Patch plan contains errors.');
  if (plan.operations.some((op) => op.file !== parsed.file)) throw new Error('PATCH_FILE_MISMATCH');
  const overlap = findOverlaps(plan.operations);
  if (overlap) throw new Error(`OVERLAPPING_PATCHES: ${overlap.a.nodeId} ${overlap.b.nodeId}`);

  const operations = [...plan.operations].sort((a, b) => b.range.start.offset - a.range.start.offset);
  const inverse: PatchOperation[] = [];
  const ms = new MagicString(parsed.text);
  for (const op of operations) {
    const current = parsed.text.slice(op.range.start.offset, op.range.end.offset);
    if (sha256(current) !== op.oldTextHash) throw new Error(`PATCH_PRECONDITION_FAILED: ${op.file} ${op.nodeId}`);
    if (op.kind === 'insert') ms.appendLeft(op.range.start.offset, op.newText);
    else if (op.kind === 'delete') ms.remove(op.range.start.offset, op.range.end.offset);
    else ms.overwrite(op.range.start.offset, op.range.end.offset, op.newText);
  }
  const text = ms.toString();

  // Rebuild inverse ranges against the final document so different-length replacements and inserts rollback safely.
  for (const op of [...operations].sort((a, b) => a.range.start.offset - b.range.start.offset)) {
    const oldLength = op.range.end.offset - op.range.start.offset;
    const deltaBefore = operations.reduce((sum, other) => {
      if (other.range.start.offset < op.range.start.offset) {
        return sum + other.newText.length - (other.range.end.offset - other.range.start.offset);
      }
      return sum;
    }, 0);
    const finalStart = op.range.start.offset + deltaBefore;
    const finalEnd = finalStart + op.newText.length;
    const range = makeRangeLike(parsed.text, finalStart, finalEnd);
    inverse.push({
      ...op,
      kind: op.newText.length === 0 ? 'delete' : 'replace',
      range,
      oldTextHash: sha256(op.newText),
      newText: op.oldText ?? parsed.text.slice(op.range.start.offset, op.range.end.offset),
    });
    void oldLength;
  }

  return {
    changed: text !== parsed.text,
    text,
    gitDiff: unifiedDiff(parsed.text, text, parsed.file),
    inversePlan: { version: '0.1', operations: inverse.reverse(), inverse: [], diagnostics: [] },
  };
}

export function applyPatchToFile(file: string, plan: PatchPlan): ApplyResult {
  const parsed = parseVueSfc(file, fs.readFileSync(file, 'utf8'));
  const result = applyPatchPlan(parsed, plan);
  if (result.changed) fs.writeFileSync(file, result.text, 'utf8');
  return result;
}

export function rollbackFile(file: string, inverse: PatchPlan): ApplyResult {
  return applyPatchToFile(file, inverse);
}

function openingTagInsertion(parsed: ParsedSfc, node: ParsedTemplateNode, text: string): SourceRange {
  const end = findOpeningTagEnd(parsed.text, node.range.start.offset, node.range.end.offset);
  if (end < 0) throw new Error(`OPENING_TAG_NOT_FOUND: ${node.nodeId}`);
  const at = parsed.text[end] === '/' ? end - 1 : end;
  return makeRangeLike(parsed.text, at, at);
}

function findOpeningTagEnd(text: string, start: number, end: number): number {
  let quote: string | undefined;
  for (let i = start; i < end; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
}

function quote(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  throw new Error('ATTRIBUTE_QUOTE_UNSUPPORTED: value contains both quote styles.');
}

function makeRangeLike(text: string, start: number, end: number): SourceRange {
  const position = (offset: number) => {
    const before = text.slice(0, offset);
    const last = before.lastIndexOf('\n');
    return { offset, line: before.split('\n').length, column: last < 0 ? offset : offset - last - 1 };
  };
  return { start: position(start), end: position(end) };
}

function findOverlaps(operations: PatchOperation[]): { a: PatchOperation; b: PatchOperation } | undefined {
  const sorted = [...operations].sort((a, b) => a.range.start.offset - b.range.start.offset || a.range.end.offset - b.range.end.offset);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const current = sorted[i]!;
    const samePoint = prev.range.start.offset === prev.range.end.offset && current.range.start.offset === current.range.end.offset;
    if (samePoint && prev.range.start.offset === current.range.start.offset) return { a: prev, b: current };
    if (current.range.start.offset < prev.range.end.offset) return { a: prev, b: current };
  }
  return undefined;
}

function failure(code: string, message: string): PatchPlan {
  return { version: '0.1', operations: [], inverse: [], diagnostics: [{ severity: 'error', code, message }] };
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function unifiedDiff(before: string, after: string, file: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const removed = a.slice(start, endA + 1).map((l) => `-${l}`).join('\n');
  const added = b.slice(start, endB + 1).map((l) => `+${l}`).join('\n');
  return `--- a/${file}\n+++ b/${file}\n@@ lines ${start + 1}..${Math.max(endA + 1, endB + 1)} @@\n${removed}\n${added}`;
}
