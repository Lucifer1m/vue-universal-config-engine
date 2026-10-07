import fs from 'node:fs';
import crypto from 'node:crypto';
import MagicString from 'magic-string';
import { parseVueSfc, findTemplateNode, type ParsedSfc } from '@hcbridge/vue-parser';
import type { ChangeSet } from '@hcbridge/hcp';
import type { SourceRange } from '@hcbridge/source-model';

export interface PatchOperation {
  file: string;
  nodeId: string;
  kind: 'replace' | 'insert' | 'delete';
  range: SourceRange;
  oldTextHash: string;
  semanticPrecondition: string;
  newText: string;
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
  if (!node) {
    return { version: '0.1', operations: [], inverse: [], diagnostics: [{ severity: 'error', code: 'NODE_NOT_FOUND', message: `Node ${change.nodeId} not found.` }] };
  }

  let range: SourceRange | undefined;
  let newText = '';

  if (change.operation === 'set-text') {
    const textChild = node.children.find((child) => child.kind === 'text');
    if (!textChild) return failure('TEXT_TARGET_NOT_FOUND', `No direct text child found for ${change.nodeId}.`);
    range = textChild.range;
    newText = change.value;
  } else if (change.operation === 'set-binding') {
    const attr = node.attributes.find((a) => a.kind === 'directive' && (a.name === 'bind' || a.name === 'model') && (a.arg === change.target || change.target === 'model'));
    if (!attr?.valueRange) return failure('BINDING_TARGET_NOT_FOUND', `Binding ${change.target} not found on ${change.nodeId}.`);
    range = attr.valueRange;
    newText = change.value;
  } else {
    const attr = node.attributes.find((a) => a.kind === 'attribute' && a.name === change.target);
    if (!attr) return failure('PROP_NOT_FOUND', `Static prop ${change.target} not found on ${change.nodeId}.`);
    if (!attr.valueRange) return failure('BOOLEAN_PROP_UNSUPPORTED', `Prop ${change.target} has no static value.`);
    range = attr.valueRange;
    newText = change.value;
  }

  const oldText = parsed.text.slice(range.start.offset, range.end.offset);
  const op: PatchOperation = {
    file: parsed.file,
    nodeId: change.nodeId,
    kind: 'replace',
    range,
    oldTextHash: sha256(oldText),
    semanticPrecondition: `${change.operation}:${change.target}`,
    newText,
  };
  const inverse: PatchOperation = { ...op, newText: oldText, oldTextHash: sha256(newText) };
  return { version: '0.1', operations: [op], inverse: [inverse], diagnostics: [] };
}

export function applyPatchPlan(parsed: ParsedSfc, plan: PatchPlan): ApplyResult {
  if (plan.diagnostics.some((d) => d.severity === 'error')) throw new Error('Patch plan contains errors.');
  const sorted = [...plan.operations].sort((a, b) => b.range.start.offset - a.range.start.offset);
  const ms = new MagicString(parsed.text);
  for (const op of sorted) {
    const current = parsed.text.slice(op.range.start.offset, op.range.end.offset);
    if (sha256(current) !== op.oldTextHash) {
      throw new Error(`PATCH_PRECONDITION_FAILED: ${op.file} ${op.nodeId}`);
    }
    ms.overwrite(op.range.start.offset, op.range.end.offset, op.newText);
  }
  const text = ms.toString();
  return { changed: text !== parsed.text, text, gitDiff: unifiedDiff(parsed.text, text, parsed.file), inversePlan: { ...plan, operations: plan.inverse, inverse: plan.operations } };
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
