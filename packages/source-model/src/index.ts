export type SourceLanguage = 'vue' | 'ts' | 'tsx' | 'js' | 'css' | 'scss' | 'unknown';

export interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface SourceRange {
  start: Position;
  end: Position;
}

export type LocatorState = 'exact' | 'relocated' | 'ambiguous' | 'lost';

export interface SourceRef {
  file: string;
  range: SourceRange;
  nodeId: string;
  syntaxFingerprint: string;
  textHash: string;
  locatorState?: LocatorState;
}

export interface SourceDocument {
  file: string;
  language: SourceLanguage;
  text: string;
  textHash: string;
  version: string;
}

export type Ownership = 'CODE' | 'PLATFORM' | 'SHARED' | 'OPAQUE';

export type SemanticMode = 'structured' | 'assisted' | 'blackbox' | 'opaque';

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  source?: SourceRef;
  details?: Record<string, unknown>;
}

export function makePosition(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const lastNl = before.lastIndexOf('\n');
  const line = before.split('\n').length;
  const column = lastNl === -1 ? offset : offset - lastNl - 1;
  return { offset, line, column };
}

export function makeRange(text: string, start: number, end: number): SourceRange {
  return { start: makePosition(text, start), end: makePosition(text, end) };
}
