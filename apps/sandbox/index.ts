#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import {
  createInspectorBridgeScript,
  inspectDomTarget,
  type DomTargetSignature,
} from '@hcbridge/visual-inspector';
import { createSandboxSession, type EditIntent, type SandboxSession, type SandboxStatus } from '@hcbridge/sandbox-kernel';
import { applyAgentPlan, buildAgentContext, type AgentPlan, type AgentRequest } from '@hcbridge/agent-kernel';
import { createConfiguredAgent } from '@hcbridge/llm-provider';

const argv = process.argv.slice(2);
const projectArg = readFlag('--project') ?? '.';
const port = Number(readFlag('--port') ?? 4170);
const host = readFlag('--host') ?? '127.0.0.1';
const projectRoot = path.resolve(projectArg);
const sessions = new Map<string, SandboxSession>();

const session = createSandboxSession({ projectRoot, install: false });
sessions.set(session.id, session);

session.on('process:output', (event: { stream: string; chunk: string }) => {
  process.stdout.write(`[sandbox:${event.stream}] ${event.chunk}`);
});
session.on('state', (status: SandboxStatus) => {
  process.stdout.write(`[sandbox] state=${status.state}\n`);
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
    if (req.method === 'GET' && url.pathname === '/') return sendHtml(res);
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, projectRoot });

    const previewMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
    if (req.method === 'GET' && previewMatch) {
      const previewSession = sessions.get(previewMatch[1]!);
      if (!previewSession) return sendJson(res, 404, { error: 'SESSION_NOT_FOUND' });
      return proxyPreview(previewSession, previewMatch[2] ?? '/', url.search, req, res);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
    if (!match) return sendJson(res, 404, { error: 'NOT_FOUND' });
    const sessionId = match[1]!;
    const action = match[2] ?? '';
    const target = sessions.get(sessionId);
    if (!target) return sendJson(res, 404, { error: 'SESSION_NOT_FOUND' });

    if (req.method === 'GET' && action === 'status') return sendJson(res, 200, target.status());
    if (req.method === 'GET' && action === 'files') return sendJson(res, 200, await target.files());
    if (req.method === 'GET' && action === 'file') {
      const file = url.searchParams.get('path');
      if (!file) return sendJson(res, 400, { error: 'PATH_REQUIRED' });
      return sendJson(res, 200, { path: file, ...(await target.readFile(file)) });
    }
    if (req.method === 'GET' && action === 'diff') return sendJson(res, 200, await target.diff(url.searchParams.get('snapshot') ?? undefined));
    if (req.method === 'POST' && action === 'prepare') return sendJson(res, 200, await target.prepare());
    if (req.method === 'POST' && action === 'start') return sendJson(res, 200, await target.start());
    if (req.method === 'POST' && action === 'stop') return sendJson(res, 200, await target.stop());
    if (req.method === 'POST' && action === 'snapshot') {
      const body = await readJson(req);
      return sendJson(res, 200, await target.snapshot(typeof body?.label === 'string' ? body.label : undefined));
    }
    if (req.method === 'POST' && action === 'restore') {
      const body = await readJson(req);
      return sendJson(res, 200, await target.restore(typeof body?.snapshotId === 'string' ? body.snapshotId : undefined));
    }
    if (req.method === 'POST' && action === 'inspect') {
      const body = await readJson(req) as DomTargetSignature;
      if (!body || typeof body.tag !== 'string') return sendJson(res, 400, { error: 'INVALID_INSPECT_TARGET' });
      return sendJson(res, 200, await inspectDomTarget(target.projectRoot, body));
    }
    if (req.method === 'POST' && action === 'agent/plan') {
      const body = await readJson(req) as AgentRequest;
      if (!body || typeof body.prompt !== 'string') return sendJson(res, 400, { error: 'PROMPT_REQUIRED' });
      let request = body;
      if (body.target && !body.inspection) {
        request = { ...body, inspection: await inspectDomTarget(target.projectRoot, body.target) };
      }
      const context = await buildAgentContext(target.projectRoot, request);
      const plan = await createConfiguredAgent().plan(context);
      return sendJson(res, 200, plan);
    }
    if (req.method === 'POST' && action === 'agent/apply') {
      const body = await readJson(req) as { plan?: AgentPlan };
      if (!body?.plan?.intent) return sendJson(res, 400, { error: 'PLAN_REQUIRED' });
      return sendJson(res, 200, await applyAgentPlan(target, body.plan));
    }
    if (req.method === 'PUT' && action === 'file') {
      const body = await readJson(req);
      if (typeof body?.path !== 'string' || typeof body?.content !== 'string') return sendJson(res, 400, { error: 'PATH_AND_CONTENT_REQUIRED' });
      return sendJson(res, 200, await target.writeFile(body.path, body.content, typeof body.expectedHash === 'string' ? body.expectedHash : undefined));
    }
    if (req.method === 'POST' && action === 'edit-intent') {
      const body = await readJson(req) as EditIntent;
      return sendJson(res, 200, await target.applyEditIntent(body));
    }
    return sendJson(res, 404, { error: 'ACTION_NOT_FOUND' });
  } catch (error) {
    return sendJson(res, 400, { error: String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`HCBridge Sandbox: http://${host}:${port}`);
  console.log(`Project: ${projectRoot}`);
  console.log(`Session: ${session.id}`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
async function shutdown() {
  await session.dispose();
  server.close();
  process.exit(0);
}

function readFlag(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value, null, 2));
}

async function proxyPreview(
  target: SandboxSession,
  pathname: string,
  search: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const previewUrl = target.status().previewUrl;
  if (!previewUrl) return sendJson(res, 409, { error: 'PREVIEW_NOT_RUNNING' });
  const upstreamUrl = new URL(pathname.replace(/^\//, '/'), `${previewUrl.replace(/\/$/, '')}/`);
  upstreamUrl.search = search;
  const upstream = await fetch(upstreamUrl, {
    method: req.method ?? 'GET',
    headers: {
      accept: req.headers.accept ?? '*/*',
      'user-agent': req.headers['user-agent'] ?? 'hcbridge-sandbox',
    },
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-length');
  responseHeaders.set('cache-control', 'no-store');
  let body = Buffer.from(await upstream.arrayBuffer());
  const contentType = responseHeaders.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    const bridge = createInspectorBridgeScript(target.id);
    const html = body.toString('utf8');
    body = Buffer.from(injectBridge(html, bridge), 'utf8');
    responseHeaders.set('content-type', 'text/html; charset=utf-8');
  }
  responseHeaders.set('content-length', String(body.byteLength));
  res.writeHead(upstream.status, Object.fromEntries(responseHeaders.entries()));
  res.end(body);
}

function injectBridge(html: string, script: string): string {
  const tag = `<script data-hcbridge-inspector>${script}</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
  return `${tag}${html}`;
}

function sendHtml(res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(HTML);
}

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>HCBridge Sandbox 0.6</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin:0; background:#0d1117; color:#e6edf3; height:100vh; overflow:hidden; }
button,input,textarea { font:inherit; }
button { border:1px solid #30363d; background:#161b22; color:#e6edf3; border-radius:6px; padding:7px 11px; cursor:pointer; }
button:hover { background:#21262d; }
button.active { border-color:#58a6ff; color:#58a6ff; background:#1f6feb33; }
header { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px; border-bottom:1px solid #21262d; }
header strong { margin-right:12px; }
#status { font-size:12px; color:#8b949e; margin-left:auto; }
main { display:grid; grid-template-columns:220px minmax(360px, 1fr) minmax(420px, 1fr); height:calc(100vh - 48px); }
section { min-width:0; border-right:1px solid #21262d; display:flex; flex-direction:column; }
section:last-child { border-right:0; }
.title { padding:9px 11px; border-bottom:1px solid #21262d; font-size:12px; color:#8b949e; text-transform:uppercase; }
#files { overflow:auto; padding:6px; }
.file { display:block; width:100%; text-align:left; border:0; padding:7px 8px; background:transparent; }
.file.active { background:#1f6feb33; color:#58a6ff; }
#editor { flex:1; min-height:0; resize:none; border:0; outline:0; background:#0d1117; color:#e6edf3; padding:14px; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; tab-size:2; }
#preview { flex:1; min-height:0; width:100%; border:0; background:white; }
#console { height:130px; border-top:1px solid #21262d; overflow:auto; padding:8px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; color:#8b949e; }
#agentHelp { border-top:1px solid #21262d; padding:6px 8px; font-size:11px; color:#8b949e; }
#ai { height:120px; border-top:1px solid #21262d; display:grid; grid-template-columns:1fr auto; gap:8px; padding:8px; }
#intent { resize:none; min-height:0; background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:8px; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
.toolbar { display:flex; gap:6px; padding:7px; border-bottom:1px solid #21262d; }
#inspector { min-height:138px; max-height:220px; overflow:auto; border-top:1px solid #21262d; padding:10px; font-size:12px; }
.inspect-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.badge { border:1px solid #30363d; border-radius:999px; padding:2px 7px; color:#8b949e; }
.badge.exact { color:#3fb950; }
.badge.relocated { color:#d29922; }
.badge.ambiguous { color:#f0883e; }
.badge.lost { color:#f85149; }
.candidate { width:100%; text-align:left; margin-top:5px; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.small { font-size:11px; color:#8b949e; }
</style>
</head>
<body>
<header>
<strong>HCBridge Sandbox 0.6</strong>
<button id="prepare">Install</button><button id="start">Run</button><button id="stop">Stop</button><button id="inspectToggle">Inspect</button><button id="aiPlan">AI Plan</button><button id="applyPlan" disabled>Apply Plan</button><button id="snapshot">Snapshot</button><button id="restore">Restore</button>
<span id="status">loading…</span>
</header>
<main>
<section>
<div class="title">Files</div>
<div id="files"></div>
</section>
<section>
<div class="title" id="editorTitle">Source</div>
<div class="toolbar"><button id="save">Save</button><button id="reload">Reload</button></div>
<textarea id="editor" spellcheck="false"></textarea>
<div id="ai"><textarea id="intent" placeholder='AI / 人工 Intent，例如：{"actor":"ai","description":"...","operations":[...]}'></textarea><button id="applyIntent">Apply Intent</button></div>
<div id="agentHelp">Provider: 自动检测 HCBRIDGE_AGENT_ENDPOINT / MODEL；未配置时使用 heuristic-local。</div>
</section>
<section>
<div class="title">Live Preview</div>
<iframe id="preview" title="Live Preview"></iframe>
<div id="inspector"><div class="small">Visual Inspector: 关闭。点击 Inspect 后在预览中选择元素。</div></div>
<div id="console"></div>
</section>
</main>
<script>
const sessionId = ${JSON.stringify(session.id)};
let selected = '';
let selectedHash = '';
let inspectMode = false;
let lastInspection = null;
let lastPlan = null;
const $ = (id) => document.getElementById(id);
async function api(path, options={}) { const res = await fetch(path, {headers:{'content-type':'application/json'}, ...options}); const text=await res.text(); if(!res.ok) throw new Error(text); return text?JSON.parse(text):{}; }
function log(x){ $('console').textContent += (typeof x==='string'?x:JSON.stringify(x,null,2))+'\n'; $('console').scrollTop=$('console').scrollHeight; }
function previewUrl(){ return '/preview/'+sessionId+'/'; }
function notifyInspector(){ const frame=$('preview'); frame.contentWindow?.postMessage({type:'hcbridge-inspector',enabled:inspectMode},'*'); }
async function refreshFiles(){ const files=await api('/api/sessions/'+sessionId+'/files'); $('files').innerHTML=''; for(const f of files){ if(!/\.(vue|ts|tsx|js|jsx|css|scss|json|html)$/.test(f.path)) continue; const b=document.createElement('button'); b.className='file'+(f.path===selected?' active':''); b.textContent=f.path; b.onclick=()=>openFile(f.path); $('files').appendChild(b); } if(!selected && $('files').firstChild) $('files').firstChild.click(); }
async function openFile(file, range){ const r=await api('/api/sessions/'+sessionId+'/file?path='+encodeURIComponent(file)); selected=file; selectedHash=r.hash; $('editorTitle').textContent=file; $('editor').value=r.content; document.querySelectorAll('.file').forEach(x=>x.classList.toggle('active',x.textContent===file)); if(range){ requestAnimationFrame(()=>{ $('editor').focus(); $('editor').setSelectionRange(range.start.offset,range.end.offset); }); } }
function renderInspection(result){ lastInspection=result; const node=$('inspector'); let html='<div class="inspect-head"><strong>Selection</strong><span class="badge '+result.state+'">'+result.state+'</span><span class="small">'+result.scannedFiles+' files · '+result.scannedNodes+' nodes</span></div>'; if(result.candidate){ const c=result.candidate; html+='<div class="mono">'+escapeHtml(c.file)+':'+c.range.start.line+':'+(c.range.start.column+1)+' · '+Math.round(c.confidence*100)+'%</div><div class="small">'+escapeHtml(c.reasons.join(', '))+'</div>'; } else { html+='<div class="small">没有足够证据自动选定源码。下面是候选：</div>'; } if(result.candidates?.length){ html+='<div>'; result.candidates.forEach((c,i)=>{ html+='<button class="candidate mono" data-candidate="'+i+'">'+escapeHtml(c.file+':'+c.range.start.line+' · '+Math.round(c.confidence*100)+'% · '+c.tag)+'</button>'; }); html+='</div>'; } node.innerHTML=html; Array.from(node.querySelectorAll('[data-candidate]')).forEach((el)=>el.onclick=()=>{const c=result.candidates[Number(el.dataset.candidate)]; if(c){ lastInspection={...result,state:'relocated',candidate:c}; openFile(c.file,c.range); renderInspection(lastInspection); }}); }
function escapeHtml(value){ return String(value).replace(/[&<>\"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\':'&#92;','"':'&quot;'}[c])); }
$('prepare').onclick=async()=>{ try { $('status').textContent='installing…'; log(await api('/api/sessions/'+sessionId+'/prepare',{method:'POST',body:'{}'})); refreshStatus(); } catch(e){log(e.message)} };
$('start').onclick=async()=>{ try { $('status').textContent='starting…'; const r=await api('/api/sessions/'+sessionId+'/start',{method:'POST',body:'{}'}); $('preview').src=previewUrl(); log(r); refreshStatus(); } catch(e){log(e.message)} };
$('stop').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/stop',{method:'POST',body:'{}'})); refreshStatus(); } catch(e){log(e.message)} };
$('inspectToggle').onclick=()=>{ inspectMode=!inspectMode; $('inspectToggle').classList.toggle('active',inspectMode); $('inspectToggle').textContent=inspectMode?'Inspect ON':'Inspect'; notifyInspector(); log('Visual Inspector '+(inspectMode?'enabled':'disabled')); };
$('snapshot').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/snapshot',{method:'POST',body:JSON.stringify({label:'manual'})})); } catch(e){log(e.message)} };
$('restore').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/restore',{method:'POST',body:'{}'})); await refreshFiles(); } catch(e){log(e.message)} };
$('save').onclick=async()=>{ if(!selected) return; try { const r=await api('/api/sessions/'+sessionId+'/file',{method:'PUT',body:JSON.stringify({path:selected,content:$('editor').value,expectedHash:selectedHash})}); selectedHash=r.hash; log(r.diff); await refreshFiles(); } catch(e){log(e.message)} };
$('reload').onclick=()=>selected&&openFile(selected);
$('aiPlan').onclick=async()=>{ try {
  if(!lastInspection){ throw new Error('请先 Inspect 一个页面元素。'); }
  const prompt=$('intent').value.trim(); if(!prompt) throw new Error('请输入自然语言修改要求。');
  const plan=await api('/api/sessions/'+sessionId+'/agent/plan',{method:'POST',body:JSON.stringify({prompt,inspection:lastInspection,target:lastInspection.target})});
  lastPlan=plan; $('applyPlan').disabled=!plan.intent?.operations?.length; log(plan);
} catch(e){ log(e.message); } };
$('applyPlan').onclick=async()=>{ try {
  if(!lastPlan) throw new Error('没有可执行的 Agent Plan。');
  const r=await api('/api/sessions/'+sessionId+'/agent/apply',{method:'POST',body:JSON.stringify({plan:lastPlan})});
  log(r); $('applyPlan').disabled=true; lastPlan=null; await refreshFiles(); if(selected) await openFile(selected); refreshStatus();
} catch(e){ log(e.message); } };
$('applyIntent').onclick=async()=>{ try { const intent=JSON.parse($('intent').value); const r=await api('/api/sessions/'+sessionId+'/edit-intent',{method:'POST',body:JSON.stringify(intent)}); log(r); await refreshFiles(); if(selected) await openFile(selected); } catch(e){log(e.message)} };
$('preview').addEventListener('load',notifyInspector);
window.addEventListener('message',async(event)=>{ const data=event.data; if(!data||data.sessionId!==sessionId||data.type!=='hcbridge:select') return; try { const result=await api('/api/sessions/'+sessionId+'/inspect',{method:'POST',body:JSON.stringify(data.target)}); renderInspection(result); if(result.candidate) await openFile(result.candidate.file,result.candidate.range); } catch(e){ log(e.message); } });
async function refreshStatus(){ try { const r=await api('/api/sessions/'+sessionId+'/status'); $('status').textContent=r.state+(r.previewUrl?' · '+r.previewUrl:''); if(r.previewUrl && $('preview').src==='') $('preview').src=previewUrl(); } catch(e){log(e.message)} }
refreshFiles(); refreshStatus(); setInterval(refreshStatus,2000);
</script>
</body>
</html>`;
