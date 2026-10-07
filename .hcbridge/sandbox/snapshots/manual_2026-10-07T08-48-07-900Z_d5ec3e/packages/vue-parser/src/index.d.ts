import { type RootNode } from '@vue/compiler-dom';
import { type SFCDescriptor } from '@vue/compiler-sfc';
import { type SourceRange, type Diagnostic } from '@hcbridge/source-model';
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
    directives: {
        name: string;
        arg?: string;
        expression?: string;
        range: SourceRange;
    }[];
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
export declare function readAndParseSfc(file: string, options?: ParseVueOptions): ParsedSfc;
export declare function parseVueSfc(file: string, text: string, options?: ParseVueOptions): ParsedSfc;
export declare function flattenTemplate(node: ParsedTemplateNode): ParsedTemplateNode[];
export declare function findTemplateNode(parsed: ParsedSfc, nodeId: string): ParsedTemplateNode | undefined;
export declare function sourceVersion(text: string): string;
export declare function resolveSfcPath(projectRoot: string, file: string): string;
