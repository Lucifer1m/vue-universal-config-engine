import { describe, expect, it } from 'vitest';
import { HeuristicAgentProvider } from './index.js';

describe('agent-kernel heuristic provider', () => {
  it('plans a safe ant-design button type patch', async () => {
    const provider = new HeuristicAgentProvider();
    const plan = await provider.plan({
      projectRoot:'/tmp/demo',
      request:{
        prompt:'把这个按钮改成 dashed',
        inspection:{
          state:'exact',
          candidate:{file:'src/App.vue',nodeId:'n1',kind:'component',tag:'a-button',structuralPath:'0.0',range:{start:{offset:0,line:2,column:2},end:{offset:0,line:2,column:40}},sourceText:'<a-button type="primary">查询</a-button>',score:90,confidence:.96,reasons:['id']}
        }
      },
      selected:{
        file:'src/App.vue',
        content:'<template><a-button type="primary">查询</a-button></template>',
        candidate:{file:'src/App.vue',nodeId:'n1',kind:'component',tag:'a-button',structuralPath:'0.0',range:{start:{offset:10,line:1,column:10},end:{offset:58,line:1,column:58}},sourceText:'<a-button type="primary">查询</a-button>',score:90,confidence:.96,reasons:['id']},
        occurrenceCount:1
      },
      scripts:{build:'vite build'}
    } as never);
    expect(plan.confidence).toBeGreaterThan(.9);
    expect(plan.intent.operations[0]).toMatchObject({kind:'replace-text',newText:'<a-button type="dashed">查询</a-button>'});
    expect(plan.verifyScripts).toEqual(['build']);
  });

  it('rejects ambiguous or repeated source targets', async () => {
    const provider = new HeuristicAgentProvider();
    const plan = await provider.plan({
      projectRoot:'/tmp/demo',
      request:{prompt:'把这个按钮改成 dashed',inspection:{state:'exact'}},
      selected:{file:'src/App.vue',content:'<a-button>一</a-button>\n<a-button>一</a-button>',candidate:{file:'src/App.vue',nodeId:'n1',kind:'component',tag:'a-button',structuralPath:'0.0',range:{start:{offset:0,line:1,column:0},end:{offset:20,line:1,column:20}},sourceText:'<a-button>一</a-button>',score:50,confidence:.8,reasons:[]},occurrenceCount:2},
      scripts:{}
    } as never);
    expect(plan.confidence).toBe(0);
    expect(plan.intent.operations).toHaveLength(0);
  });
});
