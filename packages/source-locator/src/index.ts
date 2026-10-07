import crypto from 'node:crypto';
import path from 'node:path';
import type { SourceRange, SourceRef, LocatorState } from '@hcbridge/source-model';

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function shortHash(input: string, length = 16): string {
  return sha256(input).slice(0, length);
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function fingerprint(parts: string[]): string {
  return shortHash(parts.map(normalizeWhitespace).join('|'));
}

export function createNodeId(file: string, structuralPath: string, kind: string, name: string): string {
  const absolute = path.resolve(file);
  const logicalFile = (path.relative(process.cwd(), absolute) || path.basename(absolute)).split(path.sep).join('/');
  return `node_${shortHash(`${logicalFile}|${structuralPath}|${kind}|${name}`)}`;
}

export function createSourceRef(params: {
  file: string;
  text: string;
  range: SourceRange;
  nodeId: string;
  syntaxFingerprint: string;
}): SourceRef {
  const raw = params.text.slice(params.range.start.offset, params.range.end.offset);
  return {
    file: params.file,
    range: params.range,
    nodeId: params.nodeId,
    syntaxFingerprint: params.syntaxFingerprint,
    textHash: sha256(raw),
    locatorState: 'exact',
  };
}

export interface LocateCandidate {
  nodeId: string;
  syntaxFingerprint: string;
  start: number;
  end: number;
  parentFingerprint?: string;
  siblingFingerprint?: string;
}

export function locateByEvidence(
  text: string,
  original: { text: string; syntaxFingerprint: string; start: number; end: number },
  candidates: LocateCandidate[],
): { state: LocatorState; candidate?: LocateCandidate } {
  const current = text.slice(original.start, original.end);
  if (sha256(current) === sha256(original.text)) {
    const same = candidates.find((c) => c.start === original.start && c.end === original.end);
    if (same) return { state: 'exact', candidate: same };
  }
  const fp = candidates.filter((c) => c.syntaxFingerprint === original.syntaxFingerprint);
  if (fp.length === 1) return { state: 'relocated', candidate: fp[0] };
  if (fp.length > 1) return { state: 'ambiguous' };
  return { state: 'lost' };
}
