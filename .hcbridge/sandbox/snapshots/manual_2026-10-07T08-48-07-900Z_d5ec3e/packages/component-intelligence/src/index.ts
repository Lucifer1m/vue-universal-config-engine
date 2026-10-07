import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import type { ComponentResolution } from '@hcbridge/component-resolver';
import { resolveImportedComponents } from '@hcbridge/component-resolver';
import type { ImportSemantic } from '@hcbridge/ts-analyzer';
import { analyzeScriptSetup } from '@hcbridge/ts-analyzer';
import type { ParsedSfc } from '@hcbridge/vue-parser';
import { flattenTemplate, readAndParseSfc } from '@hcbridge/vue-parser';
import { createNodeId, createSourceRef, fingerprint } from '@hcbridge/source-locator';
import type { ComponentContract, ComponentPropContract, ComponentEventContract, ComponentSlotContract } from '@hcbridge/source-model';

export interface ComponentContractAnalysis {
  file: string;
  contract: ComponentContract;
  imports: ImportSemantic[];
  resolutions: Record<string, ComponentResolution>;
  diagnostics: string[];
}

export interface ComponentGraphNode {
  id: string;
  file: string;
  relativeFile: string;
  name: string;
  depth: number;
  contract: ComponentContract;
}

export interface ComponentGraphEdge {
  from: string;
  to: string;
  localName: string;
  importSource: string;
  usedInTemplate: boolean;
  source?: ComponentContractAnalysis['contract']['source'];
}

export interface ComponentDependencyGraph {
  projectRoot: string;
  entryFile: string;
  nodes: ComponentGraphNode[];
  edges: ComponentGraphEdge[];
  cycles: string[][];
  diagnostics: string[];
}

export interface ComponentIntelligenceOptions {
  maxDepth?: number;
  maxFiles?: number;
}

export function analyzeComponentContract(file: string, projectRoot = process.cwd()): ComponentContractAnalysis {
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(file);
  const parsed = readAndParseSfc(absolute, { projectRoot: root });
  const scriptBlock = parsed.descriptor.scriptSetup;
  const script = scriptBlock
    ? analyzeScriptSetup(absolute, parsed.text, { content: scriptBlock.content, offset: scriptBlock.loc.start.offset })
    : { file: absolute, states: [], functions: [], imports: [], diagnostics: [] };
  const resolutions = resolveImportedComponents(script.imports, { projectRoot: root, sourceFile: absolute });
  const contract = extractContract(parsed, script.imports);
  return {
    file: absolute,
    contract,
    imports: script.imports,
    resolutions: Object.fromEntries(resolutions.entries()),
    diagnostics: [
      ...parsed.diagnostics.map((item) => item.message),
      ...script.diagnostics.map((item) => item.message),
    ],
  };
}

export function buildComponentDependencyGraph(
  entryFile: string,
  projectRoot = process.cwd(),
  options: ComponentIntelligenceOptions = {},
): ComponentDependencyGraph {
  const root = path.resolve(projectRoot);
  const entry = path.resolve(entryFile);
  const maxDepth = options.maxDepth ?? 8;
  const maxFiles = options.maxFiles ?? 200;
  const nodes = new Map<string, ComponentGraphNode>();
  const edges: ComponentGraphEdge[] = [];
  const diagnostics: string[] = [];
  const visiting: string[] = [];
  const stackIndex = new Map<string, number>();
  const cycles: string[][] = [];

  function visit(file: string, depth: number): void {
    const absolute = path.resolve(file);
    if (depth > maxDepth) {
      diagnostics.push(`MAX_DEPTH:${toRelative(absolute, root)}`);
      return;
    }
    if (nodes.size >= maxFiles && !nodes.has(absolute)) {
      diagnostics.push(`MAX_FILES:${maxFiles}`);
      return;
    }
    if (stackIndex.has(absolute)) {
      const start = stackIndex.get(absolute)!;
      cycles.push([...visiting.slice(start), absolute].map((item) => toRelative(item, root)));
      return;
    }
    const existing = nodes.get(absolute);
    if (existing) return;
    if (!fs.existsSync(absolute)) {
      diagnostics.push(`MISSING:${toRelative(absolute, root)}`);
      return;
    }

    const analysis = analyzeComponentContract(absolute, root);
    const name = resolveComponentFileName(absolute, analysis.contract.name);
    const nodeId = `component_${fingerprint([toRelative(absolute, root), name])}`;
    nodes.set(absolute, {
      id: nodeId,
      file: absolute,
      relativeFile: toRelative(absolute, root),
      name,
      depth,
      contract: analysis.contract,
    });

    visiting.push(absolute);
    stackIndex.set(absolute, visiting.length - 1);
    const imported = analysis.resolutions;
    const rendered = new Set(flattenTemplate(analysisTemplate(absolute, root).template).map((node) => node.componentName).filter(Boolean));
    for (const item of Object.values(imported)) {
      if (item.kind !== 'local-vue' || !item.resolvedFile) continue;
      const target = path.resolve(item.resolvedFile);
      const usedInTemplate = rendered.has(item.localName);
      const targetAnalysis = analyzeComponentContract(target, root);
      edges.push({
        from: nodeId,
        to: `component_${fingerprint([toRelative(target, root), targetAnalysis.contract.name])}`,
        localName: item.localName,
        importSource: item.importSource,
        usedInTemplate,
        source: analysis.imports.find((entry) => entry.local === item.localName)?.sourceRef,
      });
      visit(target, depth + 1);
    }
    stackIndex.delete(absolute);
    visiting.pop();
  }

  visit(entry, 0);
  return { projectRoot: root, entryFile: entry, nodes: [...nodes.values()], edges, cycles, diagnostics };
}

function extractContract(parsed: ParsedSfc, imports: ImportSemantic[]): ComponentContract {
  const script = parsed.descriptor.scriptSetup?.content ?? '';
  const scriptOffset = parsed.descriptor.scriptSetup?.loc.start.offset ?? 0;
  const sf = ts.createSourceFile(`${parsed.file}.ts`, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const props: ComponentPropContract[] = [];
  const events: ComponentEventContract[] = [];
  const models: ComponentContract['models'] = [];
  const exposes: ComponentContract['exposes'] = [];
  let explicitName: string | undefined;

  const typeDecls = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
  sf.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node)) typeDecls.set(node.name.text, node.type);
    if (ts.isInterfaceDeclaration(node)) typeDecls.set(node.name.text, node);
  });

  const addProp = (name: string, type: string, required: boolean, defaultValue: string | undefined, node: ts.Node) => {
    props.push({
      name,
      type,
      required,
      defaultValue,
      source: sourceRef(parsed, scriptOffset + node.getStart(sf), scriptOffset + node.getEnd()),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === 'defineProps') parseDefineProps(node, typeDecls, addProp, parsed, sf);
      if (callee === 'defineEmits') parseDefineEmits(node, events, typeDecls, parsed, sf);
      if (callee === 'defineModel') parseDefineModel(node, models, parsed, sf);
      if (callee === 'defineExpose') parseDefineExpose(node, exposes, parsed, sf);
      if (callee === 'defineOptions') explicitName = parseDefineOptionsName(node, sf) ?? explicitName;
      if (callee === 'defineSlots') parseDefineSlots(node, slotsFromType, parsed, sf);
    }
    ts.forEachChild(node, visit);
  };
  const slotsFromType: ComponentSlotContract[] = [];
  visit(sf);

  applyWithDefaults(props, sf, scriptOffset);
  const slots = mergeSlots(extractSlots(parsed), slotsFromType);
  const contractName = explicitName ?? inferSfcName(parsed.file);
  return {
    name: contractName,
    source: sourceRef(parsed, 0, parsed.text.length),
    props: dedupeByName(props),
    events: dedupeByName(events),
    models,
    slots,
    exposes,
    imports: imports.map((item) => ({ local: item.local, imported: item.imported, source: item.source })),
  };
}

function parseDefineProps(
  call: ts.CallExpression,
  typeDecls: Map<string, ts.TypeNode | ts.InterfaceDeclaration>,
  addProp: (name: string, type: string, required: boolean, defaultValue: string | undefined, node: ts.Node) => void,
  parsed: ParsedSfc,
  sf: ts.SourceFile,
): void {
  const arg = call.arguments[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    for (const property of arg.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
      const name = property.name && getPropertyName(property.name, sf);
      if (!name) continue;
      if (!ts.isPropertyAssignment(property)) {
        addProp(name, 'unknown', false, undefined, property);
        continue;
      }
      const initializer = property.initializer;
      if (ts.isIdentifier(initializer)) {
        addProp(name, initializer.text, false, undefined, property);
      } else if (ts.isObjectLiteralExpression(initializer)) {
        let type = 'unknown';
        let required = false;
        let defaultValue: string | undefined;
        for (const child of initializer.properties) {
          if (!ts.isPropertyAssignment(child)) continue;
          const key = getPropertyName(child.name, sf);
          if (key === 'type') type = child.initializer.getText(sf);
          if (key === 'required') required = child.initializer.kind === ts.SyntaxKind.TrueKeyword;
          if (key === 'default') defaultValue = child.initializer.getText(sf);
        }
        addProp(name, type, required, defaultValue, property);
      } else {
        addProp(name, initializer.getText(sf), false, undefined, property);
      }
    }
  }

  const typeArg = call.typeArguments?.[0];
  if (!typeArg) return;
  for (const member of resolveTypeMembers(typeArg, typeDecls)) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    addProp(
      getPropertyName(member.name, sf) ?? 'unknown',
      member.type?.getText(sf) ?? 'unknown',
      !member.questionToken,
      undefined,
      member,
    );
  }
}

function resolveTypeMembers(
  node: ts.TypeNode,
  typeDecls: Map<string, ts.TypeNode | ts.InterfaceDeclaration>,
  seen = new Set<string>(),
): ts.NodeArray<ts.TypeElement> | [] {
  if (ts.isTypeLiteralNode(node)) return node.members;
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (seen.has(name)) return [];
    seen.add(name);
    const declaration = typeDecls.get(name);
    if (!declaration) return [];
    if (ts.isInterfaceDeclaration(declaration)) return declaration.members;
    return resolveTypeMembers(declaration, typeDecls, seen);
  }
  if (ts.isParenthesizedTypeNode(node)) return resolveTypeMembers(node.type, typeDecls, seen);
  return [];
}

function applyWithDefaults(props: ComponentPropContract[], sf: ts.SourceFile, scriptOffset: number): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'withDefaults') {
      const defaults = node.arguments[1];
      if (defaults && ts.isObjectLiteralExpression(defaults)) {
        for (const item of defaults.properties) {
          if (!ts.isPropertyAssignment(item)) continue;
          const name = getPropertyName(item.name, sf);
          if (!name) continue;
          const target = props.find((prop) => prop.name === name);
          if (target) target.defaultValue = item.initializer.getText(sf);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function parseDefineEmits(call: ts.CallExpression, events: ComponentEventContract[], typeDecls: Map<string, ts.TypeNode | ts.InterfaceDeclaration>, parsed: ParsedSfc, sf: ts.SourceFile): void {
  const scriptOffset = parsed.descriptor.scriptSetup?.loc.start.offset ?? 0;
  const arg = call.arguments[0];
  if (arg && ts.isArrayLiteralExpression(arg)) {
    for (const el of arg.elements) {
      if (ts.isStringLiteral(el)) events.push({ name: el.text, source: sourceRef(parsed, scriptOffset + el.getStart(sf), scriptOffset + el.getEnd()) });
    }
  }
  const typeArg = call.typeArguments?.[0];
  if (!typeArg) return;
  for (const member of resolveTypeMembers(typeArg, typeDecls)) {
    if (ts.isPropertySignature(member) || ts.isMethodSignature(member)) {
      const name = member.name && getPropertyName(member.name, sf);
      if (!name) continue;
      const params = ts.isMethodSignature(member) ? member.parameters.map((item) => item.name.getText(sf)) : [];
      events.push({ name, params, source: sourceRef(parsed, scriptOffset + member.getStart(sf), scriptOffset + member.getEnd()) });
    }
    if (ts.isCallSignatureDeclaration(member) && member.parameters.length) {
      const first = member.parameters[0];
      if (first?.type && ts.isLiteralTypeNode(first.type) && ts.isStringLiteral(first.type.literal)) {
        events.push({
          name: first.type.literal.text,
          params: member.parameters.slice(1).map((item) => item.name.getText(sf)),
          source: sourceRef(parsed, scriptOffset + member.getStart(sf), scriptOffset + member.getEnd()),
        });
      }
    }
  }
}

function parseDefineSlots(call: ts.CallExpression, slots: ComponentSlotContract[], parsed: ParsedSfc, sf: ts.SourceFile): void {
  const typeArg = call.typeArguments?.[0];
  if (!typeArg || !ts.isTypeLiteralNode(typeArg)) return;
  const scriptOffset = parsed.descriptor.scriptSetup?.loc.start.offset ?? 0;
  for (const member of typeArg.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = getPropertyName(member.name, sf);
    if (!name) continue;
    slots.push({ name, source: sourceRef(parsed, scriptOffset + member.getStart(sf), scriptOffset + member.getEnd()) });
  }
}

function parseDefineModel(call: ts.CallExpression, models: NonNullable<ComponentContract['models']>, parsed: ParsedSfc, sf: ts.SourceFile): void {
  const first = call.arguments[0];
  const name = first && ts.isStringLiteral(first) ? first.text : 'modelValue';
  const type = call.typeArguments?.[0]?.getText(sf) ?? 'unknown';
  models.push({
    name,
    type,
    source: sourceRef(parsed, parsed.descriptor.scriptSetup!.loc.start.offset + call.getStart(sf), parsed.descriptor.scriptSetup!.loc.start.offset + call.getEnd()),
  });
}

function parseDefineExpose(call: ts.CallExpression, exposes: NonNullable<ComponentContract['exposes']>, parsed: ParsedSfc, sf: ts.SourceFile): void {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return;
  for (const item of arg.properties) {
    if (!item.name) continue;
    const name = getPropertyName(item.name, sf);
    if (!name) continue;
    exposes.push({ name, source: sourceRef(parsed, parsed.descriptor.scriptSetup!.loc.start.offset + item.getStart(sf), parsed.descriptor.scriptSetup!.loc.start.offset + item.getEnd()) });
  }
}

function parseDefineOptionsName(call: ts.CallExpression, sf: ts.SourceFile): string | undefined {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined;
  for (const item of arg.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    if (getPropertyName(item.name, sf) !== 'name') continue;
    return ts.isStringLiteral(item.initializer) ? item.initializer.text : undefined;
  }
  return undefined;
}

function extractSlots(parsed: ParsedSfc): ComponentSlotContract[] {
  const root = parsed.template;
  const slots: ComponentSlotContract[] = [];
  for (const node of flattenTemplate(root)) {
    if (node.tag !== 'slot') continue;
    const name = node.attributes.find((attr) => attr.name === 'name')?.value ?? 'default';
    const source = node.attributes.find((attr) => attr.name === 'name')?.range ?? node.range;
    slots.push({ name, source: { file: parsed.file, range: source, nodeId: `${node.nodeId}:slot`, syntaxFingerprint: fingerprint(['slot', name]), textHash: shortHash(parsed.text.slice(source.start.offset, source.end.offset)) } });
  }
  return dedupeByName(slots);
}

function mergeSlots(templateSlots: ComponentSlotContract[], declaredSlots: ComponentSlotContract[]): ComponentSlotContract[] {
  const map = new Map<string, ComponentSlotContract>();
  for (const slot of templateSlots) map.set(slot.name, slot);
  for (const slot of declaredSlots) if (!map.has(slot.name)) map.set(slot.name, slot);
  return [...map.values()];
}

function analysisTemplate(file: string, root: string): ParsedSfc {
  return readAndParseSfc(file, { projectRoot: root });
}

function getPropertyName(node: ts.PropertyName, sf: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return node.expression.getText(sf);
  return undefined;
}

function sourceRef(parsed: ParsedSfc, start: number, end: number) {
  return createSourceRef({
    file: parsed.file,
    text: parsed.text,
    range: {
      start: { offset: start, line: lineOf(parsed.text, start), column: columnOf(parsed.text, start) },
      end: { offset: end, line: lineOf(parsed.text, end), column: columnOf(parsed.text, end) },
    },
    nodeId: createNodeId(parsed.file, `component:${start}:${end}`, 'contract', 'component', path.dirname(parsed.file)),
    syntaxFingerprint: fingerprint([parsed.text.slice(start, end)]),
  });
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}
function columnOf(text: string, offset: number): number {
  const last = text.lastIndexOf('\n', Math.max(0, offset - 1));
  return last < 0 ? offset : offset - last - 1;
}
function inferSfcName(file: string): string {
  return path.basename(file, '.vue');
}
function resolveComponentFileName(file: string, contractName: string): string {
  return contractName || path.basename(file, '.vue');
}
function toRelative(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.name, item);
  return [...map.values()];
}

function shortHash(value: string): string {
  return fingerprint([value]);
}
