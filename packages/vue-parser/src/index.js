import fs from 'node:fs';
import path from 'node:path';
import { baseParse } from '@vue/compiler-dom';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { createNodeId, createSourceRef, fingerprint, shortHash, } from '@hcbridge/source-locator';
import { makeRange } from '@hcbridge/source-model';
export function readAndParseSfc(file, options = {}) {
    const text = fs.readFileSync(file, 'utf8');
    return parseVueSfc(file, text, options);
}
export function parseVueSfc(file, text, options = {}) {
    const result = parseSfc(text, { filename: file, sourceMap: true });
    const diagnostics = result.errors.map((error) => ({
        code: 'SFC_PARSE',
        severity: 'error',
        message: typeof error === 'string' ? error : error.message,
    }));
    const templateBlock = result.descriptor.template;
    if (!templateBlock) {
        return {
            file,
            text,
            descriptor: result.descriptor,
            template: {
                nodeId: createNodeId(file, 'root', 'root', 'root', options.projectRoot ?? process.cwd()),
                kind: 'root',
                structuralPath: 'root',
                range: makeRange(text, 0, 0),
                sourceText: '',
                attributes: [],
                children: [],
                directives: [],
                syntaxFingerprint: fingerprint(['root']),
            },
            diagnostics,
            templateOffset: 0,
        };
    }
    const templateContentStart = templateBlock.loc.start.offset;
    const ast = baseParse(templateBlock.content, { comments: true });
    const template = mapRoot(file, text, templateBlock, ast, templateContentStart, options.projectRoot ?? process.cwd());
    return {
        file,
        text,
        descriptor: result.descriptor,
        templateAst: ast,
        template,
        diagnostics,
        templateOffset: templateContentStart,
    };
}
function mapRoot(file, fullText, block, ast, offset, projectRoot) {
    const range = makeRange(fullText, offset, offset + block.content.length);
    const children = ast.children.map((child, index) => mapNode(file, fullText, child, offset, `0.${index}`, undefined, projectRoot));
    return {
        nodeId: createNodeId(file, 'root', 'root', 'template', projectRoot),
        kind: 'root',
        structuralPath: 'root',
        range,
        sourceText: fullText.slice(range.start.offset, range.end.offset),
        attributes: [],
        children,
        directives: [],
        syntaxFingerprint: fingerprint(['root', children.map((c) => c.tag ?? c.kind).join(',')]),
    };
}
function mapNode(file, fullText, node, offset, structuralPath, parentNodeId, projectRoot = process.cwd()) {
    const range = makeRange(fullText, offset + node.loc.start.offset, offset + node.loc.end.offset);
    if (node.type === 2) {
        const content = node.content;
        return {
            nodeId: createNodeId(file, structuralPath, 'text', 'text', projectRoot),
            kind: 'text',
            structuralPath,
            range,
            sourceText: fullText.slice(range.start.offset, range.end.offset),
            attributes: [],
            children: [],
            directives: [],
            parentNodeId,
            syntaxFingerprint: fingerprint(['text', content]),
        };
    }
    if (node.type !== 1) {
        return {
            nodeId: createNodeId(file, structuralPath, 'node', String(node.type), projectRoot),
            kind: 'root',
            structuralPath,
            range,
            sourceText: fullText.slice(range.start.offset, range.end.offset),
            attributes: [],
            children: [],
            directives: [],
            parentNodeId,
            syntaxFingerprint: fingerprint(['node', String(node.type), fullText.slice(range.start.offset, range.end.offset)]),
        };
    }
    const el = node;
    const kind = isComponentTag(el.tag) ? 'component' : 'element';
    const nodeId = createNodeId(file, structuralPath, kind, el.tag, projectRoot);
    const attributes = el.props.map((prop) => mapProp(fullText, offset, prop));
    const directives = attributes
        .filter((a) => a.kind === 'directive')
        .map((a) => ({ name: a.name, arg: a.arg, expression: a.expression, range: a.range }));
    const children = el.children.map((child, index) => mapNode(file, fullText, child, offset, `${structuralPath}.${index}`, nodeId, projectRoot));
    const attrFingerprint = attributes.map((a) => `${a.kind}:${a.name}:${a.arg ?? ''}`).join(';');
    const syntaxFingerprint = fingerprint([kind, el.tag, attrFingerprint, children.length.toString()]);
    return {
        nodeId,
        kind,
        tag: el.tag,
        structuralPath,
        range,
        sourceText: fullText.slice(range.start.offset, range.end.offset),
        attributes,
        children,
        directives,
        parentNodeId,
        syntaxFingerprint,
        componentName: kind === 'component' ? normalizeComponentName(el.tag) : undefined,
    };
}
function mapProp(fullText, offset, prop) {
    const range = makeRange(fullText, offset + prop.loc.start.offset, offset + prop.loc.end.offset);
    if (prop.type === 6) {
        const value = prop.value?.content;
        const raw = fullText.slice(range.start.offset, range.end.offset);
        const valueStartRel = raw.indexOf('=');
        let valueRange;
        if (valueStartRel >= 0 && value !== undefined) {
            const quoteOffset = raw.indexOf(value, valueStartRel + 1);
            if (quoteOffset >= 0) {
                valueRange = makeRange(fullText, range.start.offset + quoteOffset, range.start.offset + quoteOffset + value.length);
            }
        }
        return { name: prop.name, value, kind: 'attribute', range, valueRange };
    }
    const arg = prop.arg && prop.arg.type === 4 ? prop.arg.content : undefined;
    const expression = prop.exp && prop.exp.type === 4 ? prop.exp.content : undefined;
    let valueRange;
    if (prop.exp) {
        valueRange = makeRange(fullText, offset + prop.exp.loc.start.offset, offset + prop.exp.loc.end.offset);
    }
    return { name: prop.name.name, arg, expression, kind: 'directive', range, valueRange };
}
function isComponentTag(tag) {
    return /^[A-Z]/.test(tag) || tag.includes('-');
}
function normalizeComponentName(tag) {
    return tag
        .replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
        .replace(/^([a-z])/, (_, c) => c.toUpperCase());
}
export function flattenTemplate(node) {
    return [node, ...node.children.flatMap(flattenTemplate)];
}
export function findTemplateNode(parsed, nodeId) {
    return flattenTemplate(parsed.template).find((n) => n.nodeId === nodeId);
}
export function sourceVersion(text) {
    return shortHash(text, 32);
}
export function resolveSfcPath(projectRoot, file) {
    return path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
}
//# sourceMappingURL=index.js.map