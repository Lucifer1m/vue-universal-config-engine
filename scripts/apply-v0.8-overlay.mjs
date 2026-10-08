import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFile(path.join(root, file), content, 'utf8');

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`OVERLAY_ANCHOR_NOT_FOUND: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

async function patchJson(file, mutator) {
  const value = JSON.parse(await read(file));
  mutator(value);
  await write(file, JSON.stringify(value, null, 2) + '\n');
}

await patchJson('package.json', (pkg) => {
  pkg.version = '0.8.0';
  pkg.description = 'Vue 3 high-code evolution engine with sandbox, visual inspection and provider-agnostic AI code evolution.';
  pkg.scripts['agent-provider:fixture'] ??= 'tsx apps/cli/src/index.ts agent-provider fixtures/agent fixtures/agent/button.json "把这个按钮改成 dashed"';
  pkg.scripts['context:fixture'] ??= 'tsx apps/cli/src/index.ts agent-context fixtures/agent fixtures/agent/button.json';
});

await patchJson('apps/cli/package.json', (pkg) => {
  pkg.version = '0.8.0';
  pkg.dependencies['@hcbridge/llm-provider'] = 'workspace:*';
});

await patchJson('apps/sandbox/package.json', (pkg) => {
  pkg.version = '0.8.0';
  pkg.dependencies['@hcbridge/llm-provider'] = 'workspace:*';
});

let tsconfig = await read('tsconfig.json');
if (!tsconfig.includes('"./packages/llm-provider"')) {
  tsconfig = replaceOnce(
    tsconfig,
    '    {\n      "path": "./packages/agent-kernel"\n    },',
    '    {\n      "path": "./packages/agent-kernel"\n    },\n    {\n      "path": "./packages/llm-provider"\n    },',
    'root tsconfig agent-kernel reference',
  );
  await write('tsconfig.json', tsconfig);
}

let sandbox = await read('apps/sandbox/src/index.ts');
if (!sandbox.includes("from '@hcbridge/llm-provider'")) {
  sandbox = replaceOnce(
    sandbox,
    "import { applyAgentPlan, buildAgentContext, type AgentPlan, type AgentRequest } from '@hcbridge/agent-kernel';",
    "import { applyAgentPlan, buildAgentContext, type AgentPlan, type AgentRequest } from '@hcbridge/agent-kernel';\nimport { createConfiguredAgent } from '@hcbridge/llm-provider';",
    'sandbox provider import',
  );
}
sandbox = sandbox.replace('const plan = await createHeuristicAgent().plan(context);', 'const plan = await createConfiguredAgent().plan(context);');
if (sandbox.includes('createHeuristicAgent')) sandbox = sandbox.replace("import { createHeuristicAgent, ", "import { ");
await write('apps/sandbox/src/index.ts', sandbox);

let cli = await read('apps/cli/src/index.ts');
if (!cli.includes("from '@hcbridge/llm-provider'")) {
  cli = replaceOnce(
    cli,
    "import { buildAgentContext, createHeuristicAgent } from '@hcbridge/agent-kernel';",
    "import { buildAgentContext } from '@hcbridge/agent-kernel';\nimport { buildContextPack, createConfiguredAgent } from '@hcbridge/llm-provider';",
    'cli provider import',
  );
}
cli = cli.replace("const plan = await createHeuristicAgent().plan(context);", "const plan = await createConfiguredAgent().plan(context);");
if (!cli.includes("case 'agent-provider':")) {
  cli = replaceOnce(cli, "    case 'agent-plan': agentPlan(args[0], args[1], args.slice(2).join(' ')); break;", "    case 'agent-plan': agentPlan(args[0], args[1], args.slice(2).join(' ')); break;\n    case 'agent-provider': agentPlan(args[0], args[1], args.slice(2).join(' ')); break;\n    case 'agent-context': agentContext(args[0], args[1]); break;", 'cli agent commands');
}
if (!cli.includes('async function agentContext(')) {
  const anchor = '\nfunction capabilities(file?: string) {';
  const addition = `\nasync function agentContext(projectDir?: string, targetFile?: string) {\n  assertPath(projectDir);\n  assertFile(targetFile);\n  const root = path.resolve(projectDir!);\n  const target = JSON.parse(fs.readFileSync(path.resolve(targetFile!), 'utf8')) as DomTargetSignature;\n  const inspection = await inspectDomTarget(root, target);\n  const context = await buildAgentContext(root, { prompt: 'context-preview', target, inspection });\n  console.log(JSON.stringify({ inspection, context: await buildContextPack(context) }, null, 2));\n}\n\n`;
  cli = replaceOnce(cli, anchor, '\n' + addition + 'function capabilities(file?: string) {', 'cli context function');
}
await write('apps/cli/src/index.ts', cli);


try {
  let lock = await read('pnpm-lock.yaml');
  if (!lock.includes("      '@hcbridge/llm-provider':
        specifier: workspace:*
        version: link:../../packages/llm-provider")) {
    lock = replaceOnce(
      lock,
      "      '@hcbridge/visual-inspector':
        specifier: workspace:*
        version: link:../../packages/visual-inspector
      '@hcbridge/vue-parser':",
      "      '@hcbridge/visual-inspector':
        specifier: workspace:*
        version: link:../../packages/visual-inspector
      '@hcbridge/llm-provider':
        specifier: workspace:*
        version: link:../../packages/llm-provider
      '@hcbridge/vue-parser':",
      'cli lockfile llm-provider dependency',
    );
  }
  if (!lock.includes("      '@hcbridge/llm-provider':
        specifier: workspace:*
        version: link:../../packages/llm-provider
      '@hcbridge/visual-inspector':")) {
    lock = replaceOnce(
      lock,
      "      '@hcbridge/sandbox-kernel':
        specifier: workspace:*
        version: link:../../packages/sandbox-kernel
      '@hcbridge/visual-inspector':",
      "      '@hcbridge/sandbox-kernel':
        specifier: workspace:*
        version: link:../../packages/sandbox-kernel
      '@hcbridge/llm-provider':
        specifier: workspace:*
        version: link:../../packages/llm-provider
      '@hcbridge/visual-inspector':",
      'sandbox lockfile llm-provider dependency',
    );
  }
  if (!lock.includes('
  packages/llm-provider:
')) {
    lock = replaceOnce(
      lock,
      "  packages/agent-kernel:
    dependencies:
      '@hcbridge/sandbox-kernel':
        specifier: workspace:*
        version: link:../sandbox-kernel

",
      "  packages/agent-kernel:
    dependencies:
      '@hcbridge/sandbox-kernel':
        specifier: workspace:*
        version: link:../sandbox-kernel

  packages/llm-provider:
    dependencies:
      '@hcbridge/agent-kernel':
        specifier: workspace:*
        version: link:../agent-kernel

",
      'llm-provider lockfile importer',
    );
  }
  await write('pnpm-lock.yaml', lock);
} catch (error) {
  console.warn(`Skipping optional lockfile patch: ${String(error)}`);
}

let ignore = await read('.gitignore');
if (!ignore.includes('.hcbridge/sandbox/')) ignore += '\n.hcbridge/sandbox/\n*.tsbuildinfo\n';
await write('.gitignore', ignore);

console.log('v0.8 overlay applied. Run: pnpm install && pnpm run typecheck && pnpm run test');
console.log('LLM env: HCBRIDGE_AGENT_ENDPOINT, HCBRIDGE_AGENT_API_KEY, HCBRIDGE_AGENT_MODEL');
