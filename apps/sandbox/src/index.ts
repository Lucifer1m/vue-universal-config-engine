#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { createSandboxSession, type EditIntent, type SandboxSession } from '@hcbridge/sandbox-kernel';

const argv = process.argv.slice(2);
const projectArg = readFlag('--project') ?? '.';
const port = Number(readFlag('--port') ?? 4170);
const host = readFlag('--host') ?? '127.0.0.1';
const projectRoot = path.resolve(projectArg);
const sessions = new Map<string, SandboxSession>();

const session = createSandboxSession({ projectRoot, install: false });
sessions.set(session.id, session);

session.on('process:output', (event) => {
  process.stdout.write(`[sandbox:${event.stream}] ${event.chunk}`);
});
session.on('state', (status) => {
  process.stdout.write(`[sandbox] state=${status.state}\n`);
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
    if (req.method === 'GET' && url.pathname === '/') return sendHtml(res);
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, projectRoot });

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

function sendHtml(res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(HTML);
}

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>HCBridge Sandbox 0.5</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin:0; background:#0d1117; color:#e6edf3; height:100vh; overflow:hidden; }
button,input,textarea { font:inherit; }
button { border:1px solid #30363d; background:#161b22; color:#e6edf3; border-radius:6px; padding:7px 11px; cursor:pointer; }
button:hover { background:#21262d; }
header { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px; border-bottom:1px solid #21262d; }
header strong { margin-right:12px; }
#status { font-size:12px; color:#8b949e; margin-left:auto; }
main { display:grid; grid-template-columns:220px minmax(360px, 1fr) minmax(360px, 1fr); height:calc(100vh - 48px); }
section { min-width:0; border-right:1px solid #21262d; display:flex; flex-direction:column; }
section:last-child { border-right:0; }
.title { padding:9px 11px; border-bottom:1px solid #21262d; font-size:12px; color:#8b949e; text-transform:uppercase; }
#files { overflow:auto; padding:6px; }
.file { display:block; width:100%; text-align:left; border:0; padding:7px 8px; background:transparent; }
.file.active { background:#1f6feb33; color:#58a6ff; }
#editor { flex:1; resize:none; border:0; outline:0; background:#0d1117; color:#e6edf3; padding:14px; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; tab-size:2; }
#preview { flex:1; width:100%; border:0; background:white; }
#console { height:150px; border-top:1px solid #21262d; overflow:auto; padding:8px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; color:#8b949e; }
#ai { height:140px; border-top:1px solid #21262d; display:grid; grid-template-columns:1fr auto; gap:8px; padding:8px; }
#intent { resize:none; background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:6px; padding:8px; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
.toolbar { display:flex; gap:6px; padding:7px; border-bottom:1px solid #21262d; }
.small { font-size:12px; }
</style>
</head>
<body>
<header>
<strong>HCBridge Sandbox 0.5</strong>
<button id="prepare">Install</button><button id="start">Run</button><button id="stop">Stop</button><button id="snapshot">Snapshot</button><button id="restore">Restore</button>
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
</section>
<section>
<div class="title">Live Preview</div>
<iframe id="preview" title="Live Preview"></iframe>
<div id="console"></div>
</section>
</main>
<script>
const sessionId = ${JSON.stringify(session.id)};
let selected = '';
let selectedHash = '';
const $ = (id) => document.getElementById(id);
async function api(path, options={}) { const res = await fetch(path, {headers:{'content-type':'application/json'}, ...options}); const text=await res.text(); if(!res.ok) throw new Error(text); return text?JSON.parse(text):{}; }
function log(x){ $('console').textContent += (typeof x==='string'?x:JSON.stringify(x,null,2))+'\n'; $('console').scrollTop=$('console').scrollHeight; }
async function refreshFiles(){ const files=await api('/api/sessions/'+sessionId+'/files'); $('files').innerHTML=''; for(const f of files){ if(!/\.(vue|ts|tsx|js|jsx|css|scss|json|html)$/.test(f.path)) continue; const b=document.createElement('button'); b.className='file'+(f.path===selected?' active':''); b.textContent=f.path; b.onclick=()=>openFile(f.path); $('files').appendChild(b); } if(!selected && $('files').firstChild) $('files').firstChild.click(); }
async function openFile(file){ const r=await api('/api/sessions/'+sessionId+'/file?path='+encodeURIComponent(file)); selected=file; selectedHash=r.hash; $('editorTitle').textContent=file; $('editor').value=r.content; document.querySelectorAll('.file').forEach(x=>x.classList.toggle('active',x.textContent===file)); }
$('prepare').onclick=async()=>{ try { $('status').textContent='installing…'; log(await api('/api/sessions/'+sessionId+'/prepare',{method:'POST',body:'{}'})); refreshStatus(); } catch(e){log(e.message)} };
$('start').onclick=async()=>{ try { $('status').textContent='starting…'; const r=await api('/api/sessions/'+sessionId+'/start',{method:'POST',body:'{}'}); if(r.previewUrl) $('preview').src=r.previewUrl; log(r); refreshStatus(); } catch(e){log(e.message)} };
$('stop').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/stop',{method:'POST',body:'{}'})); refreshStatus(); } catch(e){log(e.message)} };
$('snapshot').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/snapshot',{method:'POST',body:JSON.stringify({label:'manual'})})); } catch(e){log(e.message)} };
$('restore').onclick=async()=>{ try { log(await api('/api/sessions/'+sessionId+'/restore',{method:'POST',body:'{}'})); await refreshFiles(); } catch(e){log(e.message)} };
$('save').onclick=async()=>{ if(!selected) return; try { const r=await api('/api/sessions/'+sessionId+'/file',{method:'PUT',body:JSON.stringify({path:selected,content:$('editor').value,expectedHash:selectedHash})}); selectedHash=r.hash; log(r.diff); await refreshFiles(); } catch(e){log(e.message)} };
$('reload').onclick=()=>selected&&openFile(selected);
$('applyIntent').onclick=async()=>{ try { const intent=JSON.parse($('intent').value); const r=await api('/api/sessions/'+sessionId+'/edit-intent',{method:'POST',body:JSON.stringify(intent)}); log(r); await refreshFiles(); if(selected) await openFile(selected); } catch(e){log(e.message)} };
async function refreshStatus(){ try { const r=await api('/api/sessions/'+sessionId+'/status'); $('status').textContent=r.state+(r.previewUrl?' · '+r.previewUrl:''); if(r.previewUrl) $('preview').src=r.previewUrl; } catch(e){log(e.message)} }
refreshFiles(); refreshStatus(); setInterval(refreshStatus,2000);
</script>
</body>
</html>`;
