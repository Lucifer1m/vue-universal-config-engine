import { describe, expect, it } from 'vitest';
import { OpenAICompatibleAgentProvider, buildContextPack } from './index.js';

const context = {
  projectRoot: '/tmp/demo',
  request: { prompt: '把按钮改成 dashed' },
  selected: {
    file: 'src/App.vue',
    content: '<template>\n  <a-button id="save">保存</a-button>\n</template>\n',
    candidate: {
      file: 'src/App.vue', nodeId: 'n1', kind: 'component' as const, tag: 'a-button', structuralPath: '0.0',
      range: { start: { offset: 11, line: 2, column: 2 }, end: { offset: 45, line: 2, column: 36 } },
      sourceText: '<a-button id="save">保存</a-button>', score: 90, confidence: .96, reasons: ['id']
    },
    occurrenceCount: 1,
  },
  scripts: { build: 'vite build', typecheck: 'vue-tsc --noEmit' },
};

describe('llm-provider', () => {
  it('normalizes an OpenAI-compatible response into a safe AgentPlan', async () => {
    const provider = new OpenAICompatibleAgentProvider(
      { endpoint: 'http://agent.test/v1/chat/completions', model: 'demo-model', apiKey: 'secret' },
      async (request) => {
        expect(request.endpoint).toContain('/v1/chat/completions');
        expect(request.headers.authorization).toBe('Bearer secret');
        const body = request.body as { messages: Array<{ content: string }> };
        expect(body.messages[1]?.content).toContain('sourceIsTruth');
        return {
          status: 200,
          body: {
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: '修改按钮样式',
                  rationale: ['目标节点唯一'],
                  confidence: 0.97,
                  warnings: [],
                  verifyScripts: ['typecheck', 'build'],
                  intent: {
                    operations: [{
                      kind: 'replace-text', file: 'src/App.vue',
                      oldText: '<a-button id="save">保存</a-button>',
                      newText: '<a-button id="save" type="dashed">保存</a-button>',
                    }],
                  },
                }),
              },
            }],
          },
        };
      },
    );
    const plan = await provider.plan(context);
    expect(plan.provider).toBe('llm:demo-model');
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.intent.expectedHashes?.['src/App.vue']).toMatch(/[a-f0-9]{64}/);
    expect(plan.intent.operations[0]).toMatchObject({ kind: 'replace-text', file: 'src/App.vue' });
    expect(plan.verifyScripts).toEqual(['typecheck', 'build']);
  });

  it('rejects a plan that tries to modify files outside supplied context', async () => {
    const provider = new OpenAICompatibleAgentProvider(
      { endpoint: 'http://agent.test', model: 'demo' },
      async () => ({
        status: 200,
        body: {
          summary: 'bad',
          intent: {
            operations: [{ kind: 'replace-text', file: 'src/secret.ts', oldText: 'x', newText: 'y' }],
          },
        },
      }),
    );
    await expect(provider.plan(context)).rejects.toThrow('LLM_PROVIDER_FILE_OUT_OF_CONTEXT');
  });

  it('builds a bounded context pack', async () => {
    const pack = await buildContextPack(context);
    expect(pack).toMatchObject({
      prompt: '把按钮改成 dashed',
      constraints: { sourceIsTruth: true, doNotRewriteWholeFiles: true, operations: ['replace-text'] },
    });
  });
});
