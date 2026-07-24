/**
 * Mobile remote-control shell HTML (served by LAN server).
 * 第三方-like home: connected header · workspace/task list · pair + bootstrap.
 */

export function buildWebRemoteControlMobileShellHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="theme-color" content="#4f7cf5"/>
  <title>StudiumX · 远程控制</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f0f3f9;
      --card: #ffffff;
      --text: #24324a;
      --muted: #68778f;
      --line: #e8edf5;
      --accent: #4f7cf5;
      --ok: #2f9b73;
      --warn: #b57617;
      --danger: #c45772;
      --chip: #eef2f8;
      font-family: Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #12151c;
        --card: #1c2028;
        --text: #e8edf5;
        --muted: #9aa7ba;
        --line: rgba(255,255,255,0.08);
        --chip: rgba(255,255,255,0.06);
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
    body { padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
    .app { max-width: 560px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; }
    .top {
      position: sticky; top: 0; z-index: 5;
      backdrop-filter: blur(12px);
      background: color-mix(in oklab, var(--bg) 86%, transparent);
      border-bottom: 1px solid var(--line);
      padding: 14px 16px 12px;
    }
    .top-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .title { font-size: 17px; font-weight: 700; line-height: 1.25; }
    .sub { margin-top: 4px; font-size: 12.5px; color: var(--muted); }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px; border-radius: 999px; background: var(--chip);
      font-size: 11px; font-weight: 650; color: var(--muted); white-space: nowrap;
    }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--warn); }
    .dot.ok { background: var(--ok); }
    .dot.err { background: var(--danger); }
    .content { flex: 1; padding: 12px 14px 24px; overflow: auto; }
    .notice {
      border: 1px solid var(--line); background: var(--card); border-radius: 12px;
      padding: 12px; font-size: 12.5px; line-height: 1.5; color: var(--muted); margin-bottom: 14px;
    }
    .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin: 4px 0 10px; }
    .section-head h2 { margin: 0; font-size: 13px; font-weight: 700; }
    .section-head p { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
    .toolbar { display: flex; gap: 6px; }
    .icon-btn, .primary, .ghost {
      border: 0; border-radius: 10px; font: inherit; cursor: pointer;
    }
    .icon-btn {
      width: 34px; height: 34px; display: grid; place-items: center;
      background: var(--card); border: 1px solid var(--line); color: var(--text);
    }
    .primary {
      width: 100%; height: 42px; background: var(--accent); color: #fff; font-weight: 650;
    }
    .primary:disabled { opacity: .55; cursor: default; }
    .ghost {
      height: 34px; padding: 0 10px; background: var(--card); border: 1px solid var(--line);
      color: var(--text); font-size: 12px; font-weight: 600;
    }
    .ws-group { margin-bottom: 14px; }
    .ws-title {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 2px; font-size: 12px; font-weight: 700; color: var(--muted);
    }
    .task {
      width: 100%; text-align: left; display: block;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 12px; margin: 0 0 8px; color: inherit; cursor: pointer;
    }
    .task:active { transform: scale(0.995); }
    .task-title { font-size: 14px; font-weight: 650; line-height: 1.35; }
    .task-meta { margin-top: 6px; font-size: 11.5px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
    .empty {
      border: 1px dashed var(--line); border-radius: 12px; padding: 22px 14px;
      text-align: center; color: var(--muted); font-size: 13px; background: color-mix(in oklab, var(--card) 70%, transparent);
    }
    .pair-card {
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 18px; box-shadow: 0 16px 40px rgba(20,47,95,.06);
    }
    .pair-card h1 { margin: 0 0 8px; font-size: 18px; }
    .pair-card p { margin: 0 0 10px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .foot { margin-top: 12px; font-size: 12px; color: var(--muted); line-height: 1.45; }
    .hidden { display: none !important; }
    .detail-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
    }
    .detail-body {
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px;
    }
    .detail-body h3 { margin: 0 0 8px; font-size: 16px; }
    .detail-body p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="app" id="app">
    <div id="pairView" class="content">
      <div class="pair-card">
        <h1>StudiumX 远程控制</h1>
        <p>连接桌面端后可浏览工作区与对话。请从桌面「移动端远程控制」打开本链接。</p>
        <div class="chip" style="margin:12px 0"><span class="dot" id="pairDot"></span><span id="pairStatus">准备连接…</span></div>
        <div class="foot" id="pairMeta"></div>
        <button class="primary" type="button" id="pairBtn">开始配对</button>
        <p class="foot">默认仅局域网。完整对话流将在后续版本开放。</p>
      </div>
    </div>

    <div id="homeView" class="hidden">
      <header class="top">
        <div class="top-row">
          <div>
            <div class="title">远程工作区</div>
            <div class="sub" id="homeSub">已连接</div>
          </div>
          <div class="chip"><span class="dot ok"></span><span>已连接</span></div>
        </div>
      </header>
      <main class="content">
        <div class="notice" id="notice">手机端可浏览工作区与对话列表；发消息与工具审批将陆续对齐桌面能力。</div>
        <div class="section-head">
          <div>
            <h2>任务</h2>
            <p id="summary">0 个任务 · 0 个工作区</p>
          </div>
          <div class="toolbar">
            <button class="ghost" type="button" id="refreshBtn">刷新</button>
            <button class="ghost" type="button" id="orgBtn">按工作区</button>
          </div>
        </div>
        <div id="list"></div>
      </main>
    </div>

    <div id="detailView" class="hidden">
      <header class="top">
        <div class="detail-bar">
          <button class="icon-btn" type="button" id="backBtn" aria-label="返回">←</button>
          <div>
            <div class="title" id="detailTitle">对话</div>
            <div class="sub" id="detailSub"></div>
          </div>
        </div>
      </header>
      <main class="content">
        <div class="detail-body">
          <h3 id="detailHeading">对话</h3>
          <p id="detailBody">完整聊天桥接开发中。当前可确认桌面目录与会话元数据已同步到手机。</p>
        </div>
      </main>
    </div>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const sid = params.get('sid') || '';
    const hash = params.get('hash') || '';
    let ws = null;
    let boot = null;
    let organizeBy = 'workspace'; // workspace | timeline
    let reqSeq = 0;

    const pairView = document.getElementById('pairView');
    const homeView = document.getElementById('homeView');
    const detailView = document.getElementById('detailView');
    const pairStatus = document.getElementById('pairStatus');
    const pairDot = document.getElementById('pairDot');
    const pairMeta = document.getElementById('pairMeta');
    const pairBtn = document.getElementById('pairBtn');
    const listEl = document.getElementById('list');
    const summaryEl = document.getElementById('summary');
    const homeSub = document.getElementById('homeSub');

    function setPair(text, kind) {
      pairStatus.textContent = text;
      pairDot.className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
    }
    function show(view) {
      pairView.classList.toggle('hidden', view !== 'pair');
      homeView.classList.toggle('hidden', view !== 'home');
      detailView.classList.toggle('hidden', view !== 'detail');
    }
    function wsUrl() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + location.host + '/ws';
    }
    function utf8ToBytes(str) { return new TextEncoder().encode(str); }
    function base64Url(buf) {
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
    }
    async function hmacProof(passHash, nonce, role, deviceSid) {
      const key = await crypto.subtle.importKey('raw', utf8ToBytes(passHash), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, utf8ToBytes(nonce + '|' + role + '|' + deviceSid));
      return base64Url(sig);
    }
    function sendApp(payload) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'data', payload, client_ts: Date.now() }));
    }
    function requestId() { return 'r' + (++reqSeq) + '-' + Date.now(); }
    function formatTime(ts) {
      if (!ts) return '';
      try { return new Date(ts).toLocaleString(); } catch { return ''; }
    }
    function renderHome() {
      if (!boot) return;
      const workspaces = boot.workspaces || [];
      const tasks = boot.tasks || [];
      summaryEl.textContent = tasks.length + ' 个任务 · ' + workspaces.length + ' 个工作区';
      homeSub.textContent = '会话 ' + (boot.windowControlSessionId || sid).toString().slice(0, 10) + '…';
      listEl.innerHTML = '';
      if (!tasks.length) {
        listEl.innerHTML = '<div class="empty">暂无对话任务。在桌面创建或打开对话后点刷新。</div>';
        return;
      }
      if (organizeBy === 'timeline') {
        const sorted = tasks.slice().sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
        for (const task of sorted) listEl.appendChild(taskCard(task));
        return;
      }
      const byWs = new Map();
      for (const task of tasks) {
        const key = task.workspaceKey || task.workspacePath || 'unknown';
        if (!byWs.has(key)) byWs.set(key, { label: task.workspaceLabel || key, tasks: [] });
        byWs.get(key).tasks.push(task);
      }
      for (const [, group] of byWs) {
        const wrap = document.createElement('section');
        wrap.className = 'ws-group';
        wrap.innerHTML = '<div class="ws-title"><span>' + escapeHtml(group.label) + '</span><span>' + group.tasks.length + '</span></div>';
        for (const task of group.tasks) wrap.appendChild(taskCard(task));
        listEl.appendChild(wrap);
      }
    }
    function taskCard(task) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task';
      btn.innerHTML =
        '<div class="task-title">' + escapeHtml(task.title || task.taskId) + '</div>' +
        '<div class="task-meta"><span>' + escapeHtml(task.workspaceLabel || '') + '</span>' +
        (task.pinned ? '<span>置顶</span>' : '') +
        (task.archived ? '<span>已归档</span>' : '') +
        '<span>' + escapeHtml(formatTime(task.updatedAt)) + '</span></div>';
      btn.addEventListener('click', () => openDetail(task));
      return btn;
    }
    function openDetail(task) {
      document.getElementById('detailTitle').textContent = task.title || '对话';
      document.getElementById('detailHeading').textContent = task.title || task.taskId;
      document.getElementById('detailSub').textContent = task.workspaceLabel || '';
      document.getElementById('detailBody').textContent =
        '任务 ID：' + task.taskId + '\\n工作区：' + (task.workspacePath || task.workspaceKey || '') +
        '\\n更新时间：' + formatTime(task.updatedAt) +
        '\\n\\n聊天流与工具审批桥接仍在建设中；列表与元数据已与桌面同步。';
      show('detail');
    }
    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[c]));
    }
    function applyCatalog(result) {
      boot = Object.assign({}, boot || {}, {
        windowControlSessionId: (boot && boot.windowControlSessionId) || sid,
        workspaces: result.workspaces || [],
        tasks: result.tasks || []
      });
      renderHome();
      show('home');
    }

    pairMeta.innerHTML = sid
      ? 'session <code style="font-family:ui-monospace,Menlo,monospace">' + escapeHtml(sid.slice(0, 12)) + '…</code>'
      : '缺少连接参数：请用桌面端生成的链接打开。';
    if (!sid || !hash) {
      setPair('缺少配对参数', 'err');
      pairBtn.disabled = true;
    }

    function connect() {
      if (!sid || !hash) return;
      pairBtn.disabled = true;
      setPair('正在连接…');
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        setPair('鉴权中…');
        ws.send(JSON.stringify({ type: 'auth_init', role: 'mobile', device_sid: sid, client_ts: Date.now() }));
      };
      ws.onmessage = async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'auth_challenge') {
          try {
            const proof = await hmacProof(hash, msg.nonce, 'mobile', sid);
            ws.send(JSON.stringify({ type: 'auth_response', device_sid: sid, proof, client_ts: Date.now() }));
          } catch {
            setPair('证明计算失败', 'err');
            pairBtn.disabled = false;
          }
          return;
        }
        if (msg.type === 'auth_ack' && msg.pair_status === 'matched') {
          setPair('已配对 · 拉取目录…', 'ok');
          sendApp({ zcode_type: 'bootstrap-request', requestId: requestId() });
          return;
        }
        if (msg.type === 'data' && msg.payload) {
          const p = msg.payload;
          if (p.zcode_type === 'bootstrap-response' && p.success) {
            applyCatalog(p.result || {});
            return;
          }
          if (p.zcode_type === 'workspace-list-response' && p.success) {
            applyCatalog(p.result || {});
            return;
          }
          if (p.zcode_type === 'workspace-list-updated' && p.result) {
            applyCatalog(p.result);
            return;
          }
          if (p.zcode_type === 'app-error') {
            setPair(p.error || p.reason || '会话错误', 'err');
            show('pair');
            pairBtn.disabled = false;
          }
        }
        if (msg.type === 'error') {
          setPair(msg.message || msg.code || '错误', 'err');
          pairBtn.disabled = false;
        }
      };
      ws.onerror = () => { setPair('连接错误', 'err'); pairBtn.disabled = false; };
      ws.onclose = () => {
        if (homeView.classList.contains('hidden') === false) {
          homeSub.textContent = '连接已断开';
        } else if (!pairStatus.textContent.includes('已')) {
          setPair('连接关闭', 'err');
        }
        pairBtn.disabled = false;
      };
    }

    pairBtn.addEventListener('click', connect);
    document.getElementById('refreshBtn').addEventListener('click', () => {
      sendApp({ zcode_type: 'workspace-list-request', requestId: requestId() });
    });
    document.getElementById('orgBtn').addEventListener('click', () => {
      organizeBy = organizeBy === 'workspace' ? 'timeline' : 'workspace';
      document.getElementById('orgBtn').textContent = organizeBy === 'workspace' ? '按工作区' : '按时间';
      renderHome();
    });
    document.getElementById('backBtn').addEventListener('click', () => show('home'));

    // Auto-connect when opened from desktop QR/link
    if (sid && hash) {
      connect();
    }
  </script>
</body>
</html>`
}
