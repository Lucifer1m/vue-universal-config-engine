import fs from 'node:fs';
import crypto from 'node:crypto';
import MagicString from 'magic-string';
import { parseVueSfc, findTemplateNode } from '@hcbridge/vue-parser';
export function createEmptyPatchPlan(sourceHash = '') {
    return { version: '0.2', sourceHash, operations: [], inverse: [], diagnostics: [] };
}
export function createPatchPlan(parsed, change) {
    const base = createEmptyPatchPlan(sha256(parsed.text));
    const node = findTemplateNode(parsed, change.nodeId);
    if (!node)
        return failure('NODE_NOT_FOUND', `Node ${change.nodeId} not found.`);
    switch (change.operation) {
        case 'set-text': return planSetText(parsed, node, change.value);
        case 'set-binding': return planSetBinding(parsed, node, change.target, change.value);
        case 'set-event': return planSetEvent(parsed, node, change.target, change.value);
        case 'set-visibility': return planSetDirective(parsed, node, 'if', change.value);
        case 'set-prop': return planSetProp(parsed, node, change.target, change.value);
        case 'remove-prop': return planRemoveProp(parsed, node, change.target);
        case 'delete-node': return planDeleteNode(parsed, node);
        case 'insert-child': return planInsertChild(parsed, node, change.value, change.target || 'append');
        default: return failure('UNSUPPORTED_OPERATION', `Unsupported operation: ${String(change.operation)}`);
    }
}
function planSetText(parsed, node, value) {
    const textChild = node.children.find((child) => child.kind === 'text');
    if (!textChild)
        return failure('TEXT_TARGET_NOT_FOUND', `No direct text child found for ${node.nodeId}.`);
    return singleReplace(parsed, node.nodeId, textChild.range, value, 'set-text');
}
function planSetBinding(parsed, node, target, value) {
    const model = target === 'model' || target === 'modelValue';
    const attr = node.attributes.find((a) => a.kind === 'directive' && ((a.name === 'bind' && a.arg === target) || (a.name === 'model' && model)));
    if (attr?.valueRange)
        return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-binding:${target}`);
    if (attr && !attr.valueRange)
        return failure('BINDING_VALUE_UNSUPPORTED', `Binding ${target} has no expression value.`);
    const insertion = model ? ` v-model=${quote(value)}` : ` :${target}=${quote(value)}`;
    return singleInsert(parsed, node.nodeId, openingTagInsertion(parsed, node, insertion), `set-binding:${target}`, insertion);
}
function planSetEvent(parsed, node, target, value) {
    const attr = node.attributes.find((a) => a.kind === 'directive' && a.name === 'on' && a.arg === target);
    if (attr?.valueRange)
        return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-event:${target}`);
    const insertion = ` @${target}=${quote(value)}`;
    return singleInsert(parsed, node.nodeId, openingTagInsertion(parsed, node, insertion), `set-event:${target}`, insertion);
}
function planSetDirective(parsed, node, directive, value) {
    const attr = node.attributes.find((a) => a.kind === 'directive' && a.name === directive && !a.arg);
    if (attr?.valueRange)
        return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-${directive}`);
    const insertion = ` v-${directive}=${quote(value)}`;
    return singleInsert(parsed, node.nodeId, openingTagInsertion(parsed, node, insertion), `set-${directive}`, insertion);
}
function planSetProp(parsed, node, target, value) {
    const attr = node.attributes.find((a) => a.kind === 'attribute' && a.name === target);
    if (attr?.valueRange)
        return singleReplace(parsed, node.nodeId, attr.valueRange, value, `set-prop:${target}`);
    if (attr)
        return singleReplace(parsed, node.nodeId, attr.range, `${target}=${quote(value)}`, `set-prop:${target}`);
    const insertion = ` ${target}=${quote(value)}`;
    return singleInsert(parsed, node.nodeId, openingTagInsertion(parsed, node, insertion), `set-prop:${target}`, insertion);
}
function planRemoveProp(parsed, node, target) {
    const attr = node.attributes.find((a) => (a.kind === 'attribute' && a.name === target) ||
        (a.kind === 'directive' && ((a.name === 'bind' && a.arg === target) || (a.name === 'model' && target === 'model'))));
    if (!attr)
        return failure('PROP_NOT_FOUND', `Prop ${target} not found on ${node.nodeId}.`);
    return singleDelete(parsed, node.nodeId, attr.range, `remove-prop:${target}`);
}
function planDeleteNode(parsed, node) {
    if (node.kind === 'root')
        return failure('ROOT_DELETE_FORBIDDEN', 'Cannot delete template root.');
    return singleDelete(parsed, node.nodeId, node.range, 'delete-node');
}
function planInsertChild(parsed, node, childSource, position) {
    if (!childSource.trim())
        return failure('EMPTY_CHILD', 'insert-child requires non-empty Vue template source.');
    if (node.kind === 'root') {
        const first = node.children[0];
        const offset = position === 'prepend' ? (first?.range.start.offset ?? parsed.template.range.end.offset) : parsed.template.range.end.offset;
        const range = emptyRange(parsed.text, offset);
        const text = position === 'prepend' ? `${childSource}\n` : `\n${childSource}`;
        return singleInsert(parsed, node.nodeId, range, 'insert-child', text);
    }
    const openingEnd = findOpeningTagEnd(parsed.text, node.range.start.offset, node.range.end.offset);
    if (openingEnd < 0)
        return failure('OPENING_TAG_NOT_FOUND', `Cannot locate opening tag for ${node.nodeId}.`);
    const closingStart = parsed.text.lastIndexOf('</', node.range.end.offset);
    if (closingStart < 0 || closingStart < openingEnd)
        return failure('CLOSING_TAG_NOT_FOUND', `Cannot locate closing tag for ${node.nodeId}.`);
    const offset = position === 'prepend' ? openingEnd + 1 : closingStart;
    const text = position === 'prepend' ? `\n${childSource}` : `${childSource}\n`;
    return singleInsert(parsed, node.nodeId, emptyRange(parsed.text, offset), 'insert-child', text);
}
function singleReplace(parsed, nodeId, range, newText, precondition) {
    const oldText = parsed.text.slice(range.start.offset, range.end.offset);
    return makePlan(parsed, nodeId, 'replace', range, oldText, newText, precondition);
}
function singleInsert(parsed, nodeId, range, precondition, newText) {
    return makePlan(parsed, nodeId, 'insert', range, '', newText, precondition);
}
function singleDelete(parsed, nodeId, range, precondition) {
    const oldText = parsed.text.slice(range.start.offset, range.end.offset);
    return makePlan(parsed, nodeId, 'delete', range, oldText, '', precondition);
}
function makePlan(parsed, nodeId, kind, range, oldText, newText, precondition) {
    const op = {
        file: parsed.file,
        nodeId,
        kind,
        range,
        oldTextHash: sha256(oldText),
        semanticPrecondition: precondition,
        newText,
        oldText,
    };
    return { version: '0.2', sourceHash: sha256(parsed.text), operations: [op], inverse: [], diagnostics: [] };
}
export function mergePatchPlans(plans) {
    const sourceHash = plans.find((p) => p.sourceHash)?.sourceHash ?? '';
    const operations = plans.flatMap((p) => p.operations);
    const diagnostics = plans.flatMap((p) => p.diagnostics);
    const overlap = findOverlaps(operations);
    if (overlap)
        diagnostics.push({ severity: 'error', code: 'OVERLAPPING_PATCHES', message: `Overlapping patch ranges for ${overlap.a.nodeId} and ${overlap.b.nodeId}.` });
    return { version: '0.2', sourceHash, operations, inverse: [], diagnostics };
}
export function applyPatchPlan(parsed, plan) {
    if (plan.diagnostics.some((d) => d.severity === 'error'))
        throw new Error('Patch plan contains errors.');
    if (plan.sourceHash && plan.sourceHash !== sha256(parsed.text))
        throw new Error(`PATCH_SOURCE_PRECONDITION_FAILED: ${parsed.file}`);
    if (plan.operations.some((op) => op.file !== parsed.file))
        throw new Error('PATCH_FILE_MISMATCH');
    const overlap = findOverlaps(plan.operations);
    if (overlap)
        throw new Error(`OVERLAPPING_PATCHES: ${overlap.a.nodeId} ${overlap.b.nodeId}`);
    const operations = [...plan.operations].sort((a, b) => b.range.start.offset - a.range.start.offset);
    const ms = new MagicString(parsed.text);
    for (const op of operations) {
        const current = parsed.text.slice(op.range.start.offset, op.range.end.offset);
        if (sha256(current) !== op.oldTextHash)
            throw new Error(`PATCH_PRECONDITION_FAILED: ${op.file} ${op.nodeId}`);
        if (op.kind === 'insert')
            ms.appendLeft(op.range.start.offset, op.newText);
        else if (op.kind === 'delete')
            ms.remove(op.range.start.offset, op.range.end.offset);
        else
            ms.overwrite(op.range.start.offset, op.range.end.offset, op.newText);
    }
    const text = ms.toString();
    const inverse = buildInverse(operations);
    return {
        changed: text !== parsed.text,
        text,
        gitDiff: unifiedDiff(parsed.text, text, parsed.file),
        inversePlan: {
            version: '0.2',
            sourceHash: sha256(text),
            operations: inverse,
            inverse: operations,
            diagnostics: [],
        },
    };
}
function buildInverse(operations) {
    const ascending = [...operations].sort((a, b) => a.range.start.offset - b.range.start.offset);
    const inverses = [];
    for (const op of ascending) {
        const deltaBefore = ascending
            .filter((other) => other !== op && other.range.start.offset < op.range.start.offset)
            .reduce((sum, other) => sum + other.newText.length - (other.range.end.offset - other.range.start.offset), 0);
        const finalStart = op.range.start.offset + deltaBefore;
        const finalLength = op.newText.length;
        const finalRange = makeRangeLike('', finalStart, finalStart + finalLength);
        if (op.kind === 'insert') {
            inverses.push({ ...op, kind: 'delete', range: finalRange, oldTextHash: sha256(op.newText), newText: '', oldText: op.newText });
        }
        else if (op.kind === 'delete') {
            const point = makeRangeLike('', finalStart, finalStart);
            inverses.push({ ...op, kind: 'insert', range: point, oldTextHash: sha256(''), newText: op.oldText ?? '', oldText: '' });
        }
        else {
            inverses.push({ ...op, kind: 'replace', range: finalRange, oldTextHash: sha256(op.newText), newText: op.oldText ?? '', oldText: op.newText });
        }
    }
    return inverses.sort((a, b) => b.range.start.offset - a.range.start.offset);
}
export function applyPatchToFile(file, plan) {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parseVueSfc(file, text);
    const result = applyPatchPlan(parsed, plan);
    if (result.changed)
        fs.writeFileSync(file, result.text, 'utf8');
    return result;
}
export function rollbackFile(file, inverse) {
    return applyPatchToFile(file, inverse);
}
function openingTagInsertion(parsed, node, _text) {
    const end = findOpeningTagEnd(parsed.text, node.range.start.offset, node.range.end.offset);
    if (end < 0)
        throw new Error(`OPENING_TAG_NOT_FOUND: ${node.nodeId}`);
    const at = parsed.text[end] === '/' ? end - 1 : end;
    return emptyRange(parsed.text, at);
}
function findOpeningTagEnd(text, start, end) {
    let quote;
    for (let i = start; i < end; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === '"' || char === "'")
            quote = char;
        else if (char === '>')
            return i;
    }
    return -1;
}
function quote(value) {
    if (!value.includes('"'))
        return `"${value}"`;
    if (!value.includes("'"))
        return `'${value}'`;
    throw new Error('ATTRIBUTE_QUOTE_UNSUPPORTED: value contains both quote styles.');
}
function emptyRange(_text, offset) {
    return makeRangeLike('', offset, offset);
}
function makeRangeLike(_text, start, end) {
    return {
        start: { offset: start, line: 0, column: 0 },
        end: { offset: end, line: 0, column: 0 },
    };
}
function findOverlaps(operations) {
    const sorted = [...operations].sort((a, b) => a.range.start.offset - b.range.start.offset || a.range.end.offset - b.range.end.offset);
    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        const samePoint = prev.range.start.offset === prev.range.end.offset && current.range.start.offset === current.range.end.offset;
        if (samePoint && prev.range.start.offset === current.range.start.offset)
            return { a: prev, b: current };
        if (current.range.start.offset < prev.range.end.offset)
            return { a: prev, b: current };
    }
    return undefined;
}
function failure(code, message) {
    return { version: '0.2', sourceHash: '', operations: [], inverse: [], diagnostics: [{ severity: 'error', code, message }] };
}
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function unifiedDiff(before, after, file) {
    if (before === after)
        return '';
    const a = before.split('\n');
    const b = after.split('\n');
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
        start += 1;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA -= 1;
        endB -= 1;
    }
    const removed = a.slice(start, endA + 1).map((line) => `-${line}`).join('\n');
    const added = b.slice(start, endB + 1).map((line) => `+${line}`).join('\n');
    return `--- a/${file}\n+++ b/${file}\n@@ lines ${start + 1}..${Math.max(endA + 1, endB + 1)} @@\n${removed}\n${added}`;
}
//# sourceMappingURL=index.js.map