import * as ts from 'typescript';
import { createNodeId, createSourceRef, fingerprint } from '@hcbridge/source-locator';
export function analyzeScriptSetup(file, fullText, script) {
    const sf = ts.createSourceFile(`${file}.ts`, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const states = [];
    const functions = [];
    const imports = [];
    const diagnostics = [];
    function srcRef(node, kind, name) {
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
    sf.forEachChild((node) => {
        if (ts.isImportDeclaration(node)) {
            const spec = node.importClause;
            if (spec) {
                const source = String(node.moduleSpecifier.text);
                if (spec.name)
                    imports.push({ local: spec.name.text, source, sourceRef: srcRef(node, 'import', spec.name.text) });
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
                if (!ts.isIdentifier(decl.name))
                    continue;
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
                }
                else if (callee === 'defineProps') {
                    states.push({ id: decl.name.text, kind: 'props', source: srcRef(decl, 'props', decl.name.text) });
                }
                else if (callee === 'defineEmits') {
                    states.push({ id: decl.name.text, kind: 'emits', source: srcRef(decl, 'emits', decl.name.text) });
                }
                if (initializer && ts.isArrowFunction(initializer)) {
                    functions.push({
                        id: decl.name.text,
                        name: decl.name.text,
                        source: srcRef(decl, 'function', decl.name.text),
                        async: initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
                        parameters: initializer.parameters.map((p) => p.name.getText(sf)),
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
                parameters: node.parameters.map((p) => p.name.getText(sf)),
            });
            return;
        }
        if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isArrowFunction(decl.initializer))
                    continue;
                functions.push({
                    id: decl.name.text,
                    name: decl.name.text,
                    source: srcRef(decl, 'function', decl.name.text),
                    async: decl.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
                    parameters: decl.initializer.parameters.map((p) => p.name.getText(sf)),
                });
            }
        }
    });
    return { file, states, functions, imports, diagnostics };
}
function lineOf(text, offset) {
    return text.slice(0, offset).split('\n').length;
}
function columnOf(text, offset) {
    const last = text.lastIndexOf('\n', Math.max(0, offset - 1));
    return last < 0 ? offset : offset - last - 1;
}
//# sourceMappingURL=index.js.map