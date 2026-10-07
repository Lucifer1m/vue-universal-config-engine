import { flattenTemplate } from '@hcbridge/vue-parser';
export function buildSemanticGraph(parsed, script) {
    const components = [];
    const templateNodes = [];
    const bindings = [];
    const events = [];
    const states = script.states.map((s) => ({ ...s }));
    const diagnostics = [...parsed.diagnostics, ...script.diagnostics.map((d) => ({ ...d, severity: 'warning' }))];
    for (const node of flattenTemplate(parsed.template)) {
        const nodeSource = sourceRefForRange(parsed.file, parsed.text, node.range, `${node.nodeId}:node`);
        const templateNode = {
            nodeId: node.nodeId,
            kind: node.kind,
            tag: node.tag,
            source: nodeSource,
            parentNodeId: node.parentNodeId,
            children: node.children.map((child) => child.nodeId),
            attributes: node.attributes.filter((attr) => attr.kind === 'attribute').map((attr) => ({
                name: attr.name,
                value: attr.value,
                source: sourceRefForRange(parsed.file, parsed.text, attr.range, `${node.nodeId}:attr:${attr.name}`),
            })),
            directives: node.directives.map((directive) => ({
                name: directive.name,
                arg: directive.arg,
                expression: directive.expression,
                source: sourceRefForRange(parsed.file, parsed.text, directive.range, `${node.nodeId}:directive:${directive.name}:${directive.arg ?? ''}`),
            })),
        };
        templateNodes.push(templateNode);
        if (node.kind === 'component' && node.tag) {
            const props = {};
            const eventMap = {};
            for (const attr of node.attributes) {
                if (attr.kind === 'attribute') {
                    props[attr.name] = { staticValue: attr.value, source: sourceRefForAttr(parsed.file, parsed.text, node, attr) };
                }
                else if (attr.arg === 'click' || attr.arg) {
                    if (attr.arg?.startsWith('on'))
                        continue;
                    if (attr.name === 'bind') {
                        const target = attr.arg ?? '';
                        const source = sourceRefForRange(parsed.file, parsed.text, attr.valueRange ?? attr.range, `${node.nodeId}:binding`);
                        bindings.push({ nodeId: node.nodeId, target, expression: attr.expression ?? '', kind: target === 'modelValue' || target === 'value' ? 'prop' : 'prop', source });
                    }
                    else if (attr.name === 'on') {
                        const eventName = attr.arg ?? 'unknown';
                        const eventSource = sourceRefForRange(parsed.file, parsed.text, attr.range, `${node.nodeId}:event:${eventName}`);
                        eventMap[eventName] = { handler: attr.expression, source: eventSource };
                        events.push({ nodeId: node.nodeId, event: eventName, handler: attr.expression, source: eventSource });
                    }
                    if (attr.name === 'model') {
                        const source = sourceRefForRange(parsed.file, parsed.text, attr.valueRange ?? attr.range, `${node.nodeId}:v-model`);
                        bindings.push({ nodeId: node.nodeId, target: 'model', expression: attr.expression ?? '', kind: 'v-model', source });
                    }
                }
            }
            components.push({
                nodeId: node.nodeId,
                name: node.componentName ?? node.tag,
                tag: node.tag,
                source: sourceRefForRange(parsed.file, parsed.text, node.range, `${node.nodeId}:component`),
                mode: 'structured',
                props,
                events: eventMap,
            });
        }
    }
    return { file: parsed.file, templateNodes, components, bindings, events, states, diagnostics };
}
function sourceRefForAttr(file, text, node, attr) {
    return sourceRefForRange(file, text, attr.range, `${node.nodeId}:attr:${attr.name}:${attr.arg ?? ''}`);
}
function sourceRefForRange(file, text, range, nodeId) {
    const raw = text.slice(range.start.offset, range.end.offset);
    return {
        file,
        range,
        nodeId,
        syntaxFingerprint: `${nodeId}:${raw.replace(/\s+/g, ' ').trim()}`,
        textHash: sha(raw),
        locatorState: 'exact',
    };
}
function sha(v) {
    let h = 2166136261;
    for (let i = 0; i < v.length; i++)
        h = Math.imul(h ^ v.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
}
//# sourceMappingURL=index.js.map