import fs from 'node:fs';
import path from 'node:path';
import { baseParse, type RootNode, type ElementNode, type Node, type AttributeNode, type DirectiveNode } from '@vue/compiler-dom';
import { parse as parseSfc, type SFCDescriptor, type SFCTemplateBlock } from '@vue/compiler-sfc';
import {
  createNodeId,
  createSourceRef,
  fingerprint,
  shortHash,
} from '@hcbridge/source-locator';
import { makeRange, type SourceRange, type Diagnostic } from '@hcbridge/source-model';

export interface ParsedAttribute {
  name: string;
  value?: string;
  kind: 'attribute' | 'directive';
  arg?: string;
  expression?: string;
  range: SourceRange;
  valueRange?: SourceRange;
}

export interface ParsedTemplateNode {
  nodeId: string;
  kind: 'element' | 'component' | 'text' | 'root';
  tag?: string;
  structuralPath: string;
  range: SourceRange;
  sourceText: string;
  attributes: ParsedAttribute[];
  children: ParsedTemplateNode[];
  directives: { name: string; arg?: string; expression?: string; range: SourceRange }[];
  parentNodeId?: string;
  syntaxFingerprint: string;
  componentName?: string;
}

export interface ParseVueOptions {
  projectRoot?: string;
}

export interface ParsedSfc {
  file: string;
  text: string;
  descriptor: SFCDescriptor;
  templateAst?: RootNode;
  template: ParsedTemplateNode;
  diagnostics: Diagnostic[];
  templateOffset: number;
}

export function readAndParseSfc(file: string, options: ParseVueOptions = {}): ParsedSfc {
  const text = fs.readFileSync(file, 'utf8');
  return parseVueSfc(file, text, options);
}

export function parseVueSfc(file: string, text: string, options: ParseVueOptions = {}): ParsedSfc {
  const result = parseSfc(text, { filename: file, sourceMap: true });
  const diagnostics: Diagnostic[] = result.errors.map((error) => ({
    code: 'SFC_PARSE',
    severity: 'error' as const,
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

function mapRoot(
  file: string,
  fullText: string,
  block: SFCTemplateBlock,
  ast: RootNode,
  offset: number,
  projectRoot: string,
): ParsedTemplateNode {
  const range = makeRange(fullText, offset, offset + block.content.length);
  const children = ast.children.map((child: any, index: number) => mapNode(file, fullText, child, offset, `0.${index}`, undefined, projectRoot));
  return {
    nodeId: createNodeId(file, 'root', 'root', 'template', projectRoot),
    kind: 'root',
    structuralPath: 'root',
    range,
    sourceText: fullText.slice(range.start.offset, range.end.offset),
    attributes: [],
    children,
    directives: [],
    syntaxFingerprint: fingerprint(['root', children.map((c: ParsedTemplateNode) => c.tag ?? c.kind).join(',')]),
  };
}

function mapNode(
  file: string,
  fullText: string,
  node: Node,
  offset: number,
  structuralPath: string,
  parentNodeId?: string,
  projectRoot = process.cwd(),
): ParsedTemplateNode {
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

  const el = node as ElementNode;
  const kind = isComponentTag(el.tag) ? 'component' : 'element';
  const nodeId = createNodeId(file, structuralPath, kind, el.tag, projectRoot);
  const attributes = el.props.map((prop: any) => mapProp(fullText, offset, prop));
  const directives = attributes
    .filter((a: ParsedAttribute) => a.kind === 'directive')
    .map((a: ParsedAttribute) => ({ name: a.name, arg: a.arg, expression: a.expression, range: a.range }));
  const children = el.children.map((child: any, index: number) =>
    mapNode(file, fullText, child, offset, `${structuralPath}.${index}`, nodeId, projectRoot),
  );
  const attrFingerprint = attributes.map((a: ParsedAttribute) => `${a.kind}:${a.name}:${a.arg ?? ''}`).join(';');
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

function mapProp(fullText: string, offset: number, prop: AttributeNode | DirectiveNode): ParsedAttribute {
  const range = makeRange(fullText, offset + prop.loc.start.offset, offset + prop.loc.end.offset);
  if (prop.type === 6) {
    const value = prop.value?.content;
    const raw = fullText.slice(range.start.offset, range.end.offset);
    const valueStartRel = raw.indexOf('=');
    let valueRange: SourceRange | undefined;
    if (valueStartRel >= 0 && value !== undefined) {
      const quoteOffset = raw.indexOf(value, valueStartRel + 1);
      if (quoteOffset >= 0) {
        valueRange = makeRange(
          fullText,
          range.start.offset + quoteOffset,
          range.start.offset + quoteOffset + value.length,
        );
      }
    }
    return { name: prop.name, value, kind: 'attribute', range, valueRange };
  }
  const arg = prop.arg && prop.arg.type === 4 ? prop.arg.content : undefined;
  const expression = prop.exp && prop.exp.type === 4 ? prop.exp.content : undefined;
  let valueRange: SourceRange | undefined;
  if (prop.exp) {
    valueRange = makeRange(fullText, offset + prop.exp.loc.start.offset, offset + prop.exp.loc.end.offset);
  }
  return { name: prop.name.name, arg, expression, kind: 'directive', range, valueRange };
}

function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag) || tag.includes('-');
}

function normalizeComponentName(tag: string): string {
  return tag
    .replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())
    .replace(/^([a-z])/, (_, c: string) => c.toUpperCase());
}

export function flattenTemplate(node: ParsedTemplateNode): ParsedTemplateNode[] {
  return [node, ...node.children.flatMap(flattenTemplate)];
}

export function findTemplateNode(parsed: ParsedSfc, nodeId: string): ParsedTemplateNode | undefined {
  return flattenTemplate(parsed.template).find((n) => n.nodeId === nodeId);
}

export function sourceVersion(text: string): string {
  return shortHash(text, 32);
}

export function resolveSfcPath(projectRoot: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
}
