export function makePosition(text, offset) {
    const before = text.slice(0, offset);
    const lastNl = before.lastIndexOf('\n');
    const line = before.split('\n').length;
    const column = lastNl === -1 ? offset : offset - lastNl - 1;
    return { offset, line, column };
}
export function makeRange(text, start, end) {
    return { start: makePosition(text, start), end: makePosition(text, end) };
}
//# sourceMappingURL=index.js.map