import crypto from 'node:crypto';
import path from 'node:path';
export function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
export function shortHash(input, length = 16) {
    return sha256(input).slice(0, length);
}
export function normalizeWhitespace(input) {
    return input.replace(/\s+/g, ' ').trim();
}
export function fingerprint(parts) {
    return shortHash(parts.map(normalizeWhitespace).join('|'));
}
export function toProjectRelative(file, projectRoot = process.cwd()) {
    const absolute = path.resolve(file);
    const root = path.resolve(projectRoot);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    return relative || path.basename(absolute);
}
/**
 * Stable across machines when the same logical file exists under the same project root.
 * structuralPath is evidence, not the only identity signal; callers should persist source refs.
 */
export function createNodeId(file, structuralPath, kind, name, projectRoot = process.cwd()) {
    const logicalFile = toProjectRelative(file, projectRoot);
    return `node_${shortHash(`${logicalFile}|${structuralPath}|${kind}|${name}`)}`;
}
export function createSourceRef(params) {
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
export function locateByEvidence(text, original, candidates) {
    const current = text.slice(original.start, original.end);
    const exactTextHash = sha256(current);
    if (exactTextHash === sha256(original.text)) {
        const exact = candidates.find((c) => c.start === original.start && c.end === original.end);
        if (exact)
            return { state: 'exact', candidate: exact };
    }
    let ranked = candidates
        .map((candidate) => ({
        candidate,
        score: (candidate.syntaxFingerprint === original.syntaxFingerprint ? 10 : 0) +
            (candidate.parentFingerprint && candidate.parentFingerprint === original.parentFingerprint ? 4 : 0) +
            (candidate.siblingFingerprint && candidate.siblingFingerprint === original.siblingFingerprint ? 3 : 0) +
            (candidate.tag && candidate.tag === original.tag ? 2 : 0) +
            (candidate.kind && candidate.kind === original.kind ? 1 : 0),
    }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
    if (ranked.length === 1)
        return { state: 'relocated', candidate: ranked[0].candidate };
    if (ranked.length > 1 && ranked[0].score > ranked[1].score)
        return { state: 'relocated', candidate: ranked[0].candidate };
    return { state: ranked.length ? 'ambiguous' : 'lost' };
}
//# sourceMappingURL=index.js.map