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

export function toProjectRelative(file: string, projectRoot = process.cwd()): string {
  const absolute = path.resolve(file);
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  return relative || path.basename(absolute);
}

/**
 * Stable across machines when the same logical file exists under the same project root.
 * structuralPath is evidence, not the only identity signal; callers should persist source refs.
 */
export function createNodeId(
  file: string,
  structuralPath: string,
  kind: string,
  name: string,
  projectRoot = process.cwd(),
): string {
  const logicalFile = toProjectRelative(file, projectRoot);
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
  tag?: string;
  kind?: string;
}

export interface LocateEvidence {
  text: string;
  syntaxFingerprint: string;
  start: number;
  end: number;
  parentFingerprint?: string;
  siblingFingerprint?: string;
  tag?: string;
  kind?: string;
}

export function locateByEvidence(
  text: string,
  original: LocateEvidence,
  candidates: LocateCandidate[],
): { state: LocatorState; candidate?: LocateCandidate } {
  const current = text.slice(original.start, original.end);
  const exactTextHash = sha256(current);
  if (exactTextHash === sha256(original.text)) {
    const exact = candidates.find((c) => c.start === original.start && c.end === original.end);
    if (exact) return { state: 'exact', candidate: exact };
  }

  let ranked = candidates
    .map((candidate) => ({
      candidate,
      score:
        (candidate.syntaxFingerprint === original.syntaxFingerprint ? 10 : 0) +
        (candidate.parentFingerprint && candidate.parentFingerprint === original.parentFingerprint ? 4 : 0) +
        (candidate.siblingFingerprint && candidate.siblingFingerprint === original.siblingFingerprint ? 3 : 0) +
        (candidate.tag && candidate.tag === original.tag ? 2 : 0) +
        (candidate.kind && candidate.kind === original.kind ? 1 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 1) return { state: 'relocated', candidate: ranked[0]!.candidate };
  if (ranked.length > 1 && ranked[0]!.score > ranked[1]!.score) return { state: 'relocated', candidate: ranked[0]!.candidate };
  return { state: ranked.length ? 'ambiguous' : 'lost' };
}
