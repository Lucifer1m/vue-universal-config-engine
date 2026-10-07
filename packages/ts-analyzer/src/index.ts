import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import type { SourceRef } from '@hcbridge/source-model';
import { createNodeId, createSourceRef, fingerprint } from '@hcbridge/source-locator';

export interface StateSemantic {
  id: string;
  kind: 'ref' | 'reactive' | 'computed' | 'props' | 'emits' | 'unknown';
  source: SourceRef;
  expression?: string;
}

export interface FunctionSemantic {
  id: string;
  name: string;
  source: SourceRef;
  async: boolean;
  parameters: string[];
}

export interface ImportSemantic {
  local: string;
  imported?: string;
  source: string;
  sourceRef: SourceRef;
}

export interface ScriptAnalysis {
  file: string;
  states: StateSemantic[];
  functions: FunctionSemantic[];
  imports: ImportSemantic[];
  diagnostics: { code: string; message: string; source?: SourceRef }[];
}

const virtualConfig = '/hcbridge-virtual/tsconfig.json';
const virtualFile = '/hcbridge-virtual/script.ts';

let parser: { api: API; vfs: ReturnType<typeof createVirtualFileSystem>; opened: boolean } | undefined;

function parseScript(content: string): { sourceFile: ts.SourceFile; release: () => void } {
  if (!parser) {
    const vfs = createVirtualFileSystem({
      [virtualConfig]: JSON.stringify({
        compilerOptions: { target: 'ESNext', module: 'ESNext', strict: true },
        files: ['script.ts'],
      }),
      [virtualFile]: content,
    });
    const api = new API({ fs: vfs, cwd: '/hcbridge-virtual' });
    // The native parser process keeps Node's event loop alive. Detach it so test runs can exit.
    const child = (api as unknown as { client?: { channel?: { child?: { unref(): void } } } }).client?.channel?.child;
    child?.unref();
    process.once('exit', () => api.close());
    parser = { api, vfs, opened: false };
  } else {
    parser.vfs.writeFile(virtualFile, content);
  }

  const snapshot = parser.opened
    ? parser.api.updateSnapshot({ fileChanges: { changed: [virtualFile] } })
    : parser.api.updateSnapshot({ openProjects: [virtualConfig] });
  parser.opened = true;
  const sourceFile = snapshot.getProjects()[0]?.program.getSourceFile(virtualFile);
  if (!sourceFile) {
    snapshot.dispose();
    throw new Error('Failed to parse <script setup> with the TypeScript parser');
  }
  return { sourceFile, release: () => snapshot.dispose() };
}

export function analyzeScriptSetup(
  file: string,
  fullText: string,
  script: { content: string; offset: number },
): ScriptAnalysis {
  const parsed = parseScript(script.content);
  try {
    return analyzeParsedScript(file, fullText, script, parsed.sourceFile);
  } finally {
    parsed.release();
  }
}

function analyzeParsedScript(
  file: string,
  fullText: string,
  script: { content: string; offset: number },
  sf: ts.SourceFile,
): ScriptAnalysis {
  const states: StateSemantic[] = [];
  const functions: FunctionSemantic[] = [];
  const imports: ImportSemantic[] = [];
  const diagnostics: ScriptAnalysis['diagnostics'] = [];

  function srcRef(node: ts.Node, kind: string, name: string): SourceRef {
    const start = script.offset + node.getStart(sf);
    const end = script.offset + node.getEnd();
    const range = {
      start: { offset: start, line: lineOf(fullText, start), column: columnOf(fullText, start) },
      end: { offset: end, line: lineOf(fullText, end), column: columnOf(fullText, end) },
    };
    return createSourceRef({
      file,
      text: fullText,
      range,
      nodeId: createNodeId(file, `script:${start}`, kind, name),
      syntaxFingerprint: fingerprint([kind, name, fullText.slice(start, end)]),
    });
  }

  sf.forEachChild((node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.importClause;
      if (spec) {
        const source = String((node.moduleSpecifier as ts.StringLiteral).text);
        if (spec.name) imports.push({ local: spec.name.text, source, sourceRef: srcRef(node, 'import', spec.name.text) });
        if (spec.namedBindings && ts.isNamedImports(spec.namedBindings)) {
          for (const element of spec.namedBindings.elements) {
            imports.push({
              local: element.name.text,
              imported: element.propertyName?.text ?? element.name.text,
              source,
              sourceRef: srcRef(element, 'import', element.name.text),
            });
          }
        }
      }
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const initializer = decl.initializer;
        const call = initializer && ts.isCallExpression(initializer) ? initializer : undefined;
        const callee = call && ts.isIdentifier(call.expression) ? call.expression.text : undefined;
        if (callee === 'ref' || callee === 'reactive' || callee === 'computed') {
          states.push({
            id: decl.name.text,
            kind: callee,
            source: srcRef(decl, 'state', decl.name.text),
            expression: initializer?.getText(sf),
          });
        } else if (callee === 'defineProps') {
          states.push({ id: decl.name.text, kind: 'props', source: srcRef(decl, 'props', decl.name.text) });
        } else if (callee === 'defineEmits') {
          states.push({ id: decl.name.text, kind: 'emits', source: srcRef(decl, 'emits', decl.name.text) });
        }
        if (initializer && ts.isArrowFunction(initializer)) {
          functions.push({
            id: decl.name.text,
            name: decl.name.text,
            source: srcRef(decl, 'function', decl.name.text),
            async: initializer.modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
            parameters: initializer.parameters.map((p: ts.ParameterDeclaration) => p.name.getText(sf)),
          });
        }
      }
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.push({
        id: node.name.text,
        name: node.name.text,
        source: srcRef(node, 'function', node.name.text),
        async: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
        parameters: node.parameters.map((p: ts.ParameterDeclaration) => p.name.getText(sf)),
      });
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isArrowFunction(decl.initializer)) continue;
        functions.push({
          id: decl.name.text,
          name: decl.name.text,
          source: srcRef(decl, 'function', decl.name.text),
          async: decl.initializer.modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
          parameters: decl.initializer.parameters.map((p: ts.ParameterDeclaration) => p.name.getText(sf)),
        });
      }
    }
  });

  return { file, states, functions, imports, diagnostics };
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}
function columnOf(text: string, offset: number): number {
  const last = text.lastIndexOf('\n', Math.max(0, offset - 1));
  return last < 0 ? offset : offset - last - 1;
}
