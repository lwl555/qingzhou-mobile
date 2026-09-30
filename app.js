/* 轻舟手机版
   三种连接，按优先级自动选：
     1) 局域网 lan   ：手机和电脑同一 Wi-Fi → 直连 http://<电脑IP>:8787（用电脑的模型/文件/工具）
     2) 远程   remote：电脑上开了「远程操作」→ 走云端中继，在外面也能操作自己电脑
     3) 云端   cloud ：以上都连不上 → 直接用云端模型聊天
   注：https 页面请求 http 局域网属"混合内容"，普通浏览器会拦；
      装成 App（WebView 允许混合内容 + usesCleartextTraffic）后才能局域网直连。 */

const PORT = 8787;
const CLOUD = {
  url: 'https://wcnssyiqitugqfmcbdhe.functions.supabase.co/agnes-proxy/v1/chat/completions',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjbnNzeWlxaXR1Z3FmbWNiZGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDEyNzUsImV4cCI6MjA5ODk3NzI3NX0.9EfbEr7BQhZtbOwHJ3IrkOy16kcaxlmzuJuV0A2Z8Eg',
  model: 'agnes-2.0-flash'
};
const SB = { url: 'https://wcnssyiqitugqfmcbdhe.supabase.co', key: CLOUD.key };
// 云端可选模型（走 agnes-proxy）
const CLOUD_MODELS = ['agnes-2.0-flash', 'agnes-2.5-flash', 'agnes-2.5-pro', 'agnes-3.0-flash'];

const state = { ip: '', mode: 'cloud', remotePcId: '', sessionId: null, history: [], awaitName: false, askedName: false, cloudModel: '', model: '' };
const $ = s => document.querySelector(s);
const msgs = $('#msgs'), txt = $('#txt'), wrap = $('#wrap'), empty = $('#empty');

const name = () => localStorage.getItem('qz_name') || '轻舟';
const greet = () => { const h = new Date().getHours(); return h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };

/* ---------------- 状态栏（含速率） ---------------- */
let statLabel = '云端 · 在线模型', statRate = '';
function setMode(mode, detail) {
  state.mode = mode;
  const dot = $('#dot');
  dot.className = 'dot ' + (mode === 'cloud' ? 'cloud' : 'lan');
  statLabel = mode === 'lan' ? '局域网 · 用你电脑本地模型'
    : mode === 'remote' ? '远程 · 已连电脑（在线）'
      : (detail || '云端 · 在线模型');
  statRate = '';
  renderStat();
}
function renderStat() {
  const t = $('#statText');
  if (t) t.textContent = statRate ? `${statLabel} · ${statRate}` : statLabel;
}

/* ---------------- 速率（字数/秒） ---------------- */
let rateTimer = null, rateStart = 0, rateChars = 0;
function startRate() { rateStart = Date.now(); rateChars = 0; statRate = ''; if (!rateTimer) rateTimer = setInterval(updateRate, 400); renderStat(); }
function tickRate(n) { rateChars += n; }
function updateRate() {
  if (!rateStart) return;
  const s = (Date.now() - rateStart) / 1000;
  if (s >= 0.4) { statRate = `${Math.round(rateChars / s)} 字/秒`; renderStat(); }
}
function stopRate() { if (rateTimer) { clearInterval(rateTimer); rateTimer = null; } rateStart = 0; }

async function probe(ip, ms = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`http://${ip}:${PORT}/manifest.webmanifest`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return r.ok;
  } catch { clearTimeout(timer); return false; }
}

async function boot() {
  $('#hi').textContent = greet();
  document.querySelector('.hd-title').textContent = name();
  renderList();
  state.askedName = localStorage.getItem('qz_asked_name') === '1';
  state.ip = localStorage.getItem('qz_ip') || '';
  state.remotePcId = localStorage.getItem('qz_pc') || '';
  state.cloudModel = localStorage.getItem('qz_cloud_model') || '';
  state.model = localStorage.getItem('qz_model') || '';
  if (state.remotePcId) $('#pcIdInput').value = state.remotePcId;
  fillModels();

  // 1) 先试局域网
  if (state.ip) {
    setMode('cloud', '正在找电脑…');
    if (await probe(state.ip)) { setMode('lan'); fillModels(); afterBoot(); return; }
  }
  // 2) 再试远程（电脑开了「远程操作」才行；连不上会明确报错，不再假连）
  if (state.remotePcId) {
    setMode('cloud', '正在远程连接…');
    try {
      await remoteConnect(state.remotePcId);
      if (!state.model && rMeta?.activeModel) state.model = rMeta.activeModel;
      setMode('remote');
      fillModels();
      afterBoot();
      return;
    } catch (e) { console.warn('[remote] ' + e.message); }
  }
  setMode('cloud', '云端模式 · 点「连接」可连电脑');
  fillModels();
  afterBoot();
}

function afterBoot() {
  if (!state.askedName) setTimeout(() => askName(false), 700);
}

/* ---------------- 远程：通过云端中继操作自己的电脑 ----------------
   电脑端必须先打开「远程操作」开关并建立通道，手机才连得上；关掉就连不上。 */
let rClient = null, rChannel = null, rMeta = null, pendingPong = null;

// 电脑端回的元信息：pong（在线确认 + 可用模型）
function onRemoteMeta({ payload }) {
  if (!payload) return;
  if (payload.type === 'pong') { rMeta = payload; if (pendingPong) { pendingPong(payload); pendingPong = null; } }
}

async function remoteConnect(pcId) {
  const id = String(pcId || '').trim().toUpperCase();
  if (!id) throw new Error('还没填远程号码');
  if (!window.supabase) throw new Error('远程组件没加载（网络不通）');
  if (rChannel) { try { await rClient.removeChannel(rChannel); } catch {} }
  rClient = window.supabase.createClient(SB.url, SB.key, { realtime: { params: { eventsPerSecond: 20 } } });
  rChannel = rClient.channel('qz-' + id, { config: { broadcast: { self: false, ack: false } } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('连接超时')), 12000);
    rChannel.subscribe(s => {
      if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { clearTimeout(t); reject(new Error('连不上这个号码（电脑开了远程吗）')); }
    });
  });
  // 关键：订阅成功只说明"手机进了频道"，不代表电脑在线。发 ping 等电脑回 pong，
  // 等不到就明确报错（而不是像以前那样假装连上了，让消息石沉大海）。
  rChannel.on('broadcast', { event: 'chunk' }, onRemoteMeta);
  rMeta = null;
  const pong = await new Promise((resolve, reject) => {
    pendingPong = resolve;
    setTimeout(() => { if (pendingPong) { pendingPong = null; reject(new Error('没找到这台电脑（确认电脑上「远程操作」已开启、号码填对）')); } }, 8000);
    rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId: 'ping-' + Date.now(), ping: true } }).catch(() => {});
  });
  state.remotePcId = id;
  return pong;
}

// 一次性向电脑查询（列会话 / 读某个会话）
function remoteQuery(extra, expectType, ms = 8000) {
  return new Promise((resolve, reject) => {
    const reqId = Math.random().toString(36).slice(2);
    const on = ({ payload }) => {
      if (!payload || payload.reqId !== reqId || payload.type !== expectType) return;
      try { rChannel.off('broadcast', { event: 'chunk' }, on); } catch {}
      resolve(payload);
    };
    rChannel.on('broadcast', { event: 'chunk' }, on);
    rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId, ...extra } }).catch(reject);
    setTimeout(() => { try { rChannel.off('broadcast', { event: 'chunk' }, on); } catch {} reject(new Error('电脑没回应')); }, ms);
  });
}

// 远程对话。返回 { promise, stop }：
//  - 每个包带 seq 序号，按序重组（Supabase 广播不保证顺序，以前文字错乱就出在这）；
//  - stop() 让手机立刻停下，并通知电脑别再吐字。
function chatRemote(text, onDelta, image, model, regenerate) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    let done = false;
    const reqId = Math.random().toString(36).slice(2);
    let nextSeq = 0;
    const buf = new Map();
    let lastProgress = Date.now();

    const cleanup = () => { try { rChannel.off('broadcast', { event: 'chunk' }, on); } catch {} clearInterval(sweeper); clearTimeout(to); };
    const done_ = (err) => { if (done) return; done = true; cleanup(); err ? reject(err) : resolve(); };
    finish = done_;

    const consume = (payload) => {
      lastProgress = Date.now();
      if (payload.type === 'session') state.sessionId = payload.sessionId;
      else if (payload.type === 'delta') onDelta(payload.text || '');
      else if (payload.type === 'tool_start') onDelta(`\n[电脑执行] ${payload.name}…`);
      else if (payload.type === 'approval_request') onDelta('\n[需要你在电脑上点一下确认]');
      else if (payload.type === 'error') { onDelta('\n[电脑端出错] ' + (payload.text || payload.message || '未知错误')); done_(); }
      else if (payload.type === 'done') done_();
    };
    const drain = () => { let p; while ((p = buf.get(nextSeq))) { buf.delete(nextSeq); nextSeq++; consume(p); } };
    const on = ({ payload }) => {
      if (!payload || payload.reqId !== reqId) return;
      const s = typeof payload.seq === 'number' ? payload.seq : null;
      if (s == null) { consume(payload); return; }        // 老版本电脑端没序号，直接显示
      if (s === nextSeq) { nextSeq++; consume(payload); drain(); }
      else if (s > nextSeq) { buf.set(s, payload); }      // 先到的等一等
      // s < nextSeq：迟到/重复，丢弃
    };
    rChannel.on('broadcast', { event: 'chunk' }, on);

    // 兜底：万一某个包丢了导致卡住，1.5 秒没进展就按现有顺序强行冲出
    const sweeper = setInterval(() => {
      if (buf.size && Date.now() - lastProgress > 1500) {
        for (const k of [...buf.keys()].sort((a, b) => a - b)) { consume(buf.get(k)); }
        buf.clear(); lastProgress = Date.now();
      }
    }, 700);
    const to = setTimeout(() => done_(new Error('电脑没回应（可能关机或已关闭远程）')), 120000);

    rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId, text, sessionId: state.sessionId, image, model, regenerate: !!regenerate } })
      .catch(e => done_(e));
    // 供「停止」用
    chatRemote._reqId = reqId;
  });
  const stop = () => {
    try { rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId: chatRemote._reqId, stop: true } }).catch(() => {}); } catch {}
    finish && finish();
  };
  return { promise, stop };
}

/* ---------------- 首屏列表 ---------------- */
function renderList() {
  const ex = [
    { t: `给${name()}起个名字`, s: '它会主动问你', act: 'name' },
    { t: '盯着一个网页的价格', s: '降价了提醒我', q: '帮我盯着这个网页的价格，降价了告诉我：' },
    { t: '把这段话改专业点', s: '贴进来即可', q: '把下面这段话改得更专业：\n' },
    { t: '搜一下最新消息', s: '联网查', q: '帮我联网搜一下最新的：' }
  ];
  const box = $('#list');
  box.className = 'chips';
  box.innerHTML = '';
  for (const it of ex) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<span class="ct">${it.t}</span><span class="cs">${it.s}</span>`;
    b.onclick = () => {
      if (it.act === 'name') { askName(true); return; }
      txt.value = it.q;
      txt.dispatchEvent(new Event('input'));
      send();
    };
    box.appendChild(b);
  }
}

/* ---------------- AI 主动问名字 ---------------- */
function askName(force) {
  if (!force && localStorage.getItem('qz_asked_name') === '1') return;
  showMsgs();
  addMsg('ai', '我一直还没名字。你想叫我什么？\n说一个就行，之后我就用这个名字自称。');
  state.awaitName = true;
  localStorage.setItem('qz_asked_name', '1');
}

function setName(v) {
  const n = (v || '').trim().replace(/[。！？.!?，,、\s]/g, '').slice(0, 8);
  if (/^(随便|随意|你定|你决定|你看着办|都行|都可以|不知道|无所谓|看你)/.test(n)) {
    addMsg('ai', '那我替你想也行。先给个方向：想要短一点的，还是文气一点的？或者江湖气重些？');
    state.awaitName = true;
    return false;
  }
  if (!n || n.length > 8) {
    addMsg('ai', '两到四个字好记一些。你想叫我什么？');
    state.awaitName = true;
    return false;
  }
  localStorage.setItem('qz_name', n);
  document.querySelector('.hd-title').textContent = n;
  renderList();
  addMsg('ai', `好，以后我就叫「${n}」。\n要改名随时说一句「改个名字」。`);
  state.awaitName = false;
  return true;
}

/* ---------------- 扫描局域网 ---------------- */
async function scanLAN() {
  const log = $('#scanLog');
  const guess = (state.ip || localStorage.getItem('qz_ip') || '192.168.1.1').split('.').slice(0, 3).join('.');
  log.textContent = `扫描 ${guess}.1 ~ ${guess}.254 …`;
  const found = [], ips = [];
  for (let i = 1; i <= 254; i++) ips.push(`${guess}.${i}`);
  for (let i = 0; i < ips.length; i += 40) {
    const part = ips.slice(i, i + 40);
    const hits = await Promise.all(part.map(async ip => ((await probe(ip, 700)) ? ip : null)));
    for (const h of hits) if (h) found.push(h);
    log.textContent = `已扫 ${Math.min(i + 40, 254)} / 254${found.length ? `，找到 ${found.join('、')}` : '…'}`;
    if (found.length) break;
  }
  if (found.length) {
    state.ip = found[0];
    localStorage.setItem('qz_ip', state.ip);
    $('#ipInput').value = state.ip;
    log.textContent = `找到电脑：${found.join('、')}`;
    setMode('lan');
  } else {
    log.textContent = '没扫到。确认电脑轻舟开着、手机与电脑同一 Wi-Fi，也可手填 IP。';
  }
}

/* ---------------- 发消息 ---------------- */
let streaming = false, streamStop = null, lastUserText = '';

async function send() {
  if (streaming) return;
  const text = txt.value.trim();
  if (!text && !pendingImage) return;
  const img = pendingImage;
  txt.value = '';
  txt.style.height = 'auto';
  $('#send').classList.remove('on');
  showMsgs();
  addMsg('me', text || '（图片）');
  if (state.awaitName && text) { setName(text); clearAttach(); return; }
  lastUserText = text;
  await runChat(text, img, false);
}

async function runChat(text, img, isRegen) {
  streaming = true;
  setBusy(true);
  startRate();
  let stopped = false;
  const ctl = new AbortController();
  let remoteStopFn = null;
  streamStop = () => { stopped = true; try { ctl.abort(); } catch {} if (remoteStopFn) remoteStopFn(); };

  const el = addMsg('ai', '', { thinking: true });
  const bub = el.querySelector('.bub');
  let acc = '';
  const paint = () => { bub.innerHTML = md(acc); scrollBottom(); };

  try {
    if (state.mode === 'lan') {
      await chatLan(text, d => { acc += d; tickRate(d.length); paint(); }, img, ctl.signal, isRegen);
      if (!acc && !stopped) bub.textContent = '(没有回复)';
    } else if (state.mode === 'remote') {
      const r = chatRemote(text, d => { acc += d; tickRate(d.length); paint(); }, img, state.model, isRegen);
      remoteStopFn = r.stop;
      await r.promise;
      if (!acc && !stopped) bub.textContent = '(电脑没有回复)';
    } else {
      if (img) addMsg('ai', '（云端模型暂不支持图片，已用文字回复；连上电脑后可发图）');
      if (!isRegen) state.history.push({ role: 'user', content: text });
      const reply = await chatCloud(state.history, ctl.signal);
      acc = reply || '';
      bub.innerHTML = md(acc);
      if (!state.history.length || state.history[state.history.length - 1].role !== 'assistant') state.history.push({ role: 'assistant', content: reply });
      else state.history[state.history.length - 1].content = reply;
      if (state.history.length > 20) state.history = state.history.slice(-20);
    }
  } catch (e) {
    if (stopped) { if (!acc) bub.textContent = '(已停止)'; }
    else bub.innerHTML = md('出错：' + e.message);
  }
  stopRate();
  if (!stopped) addActions(el);
  streaming = false;
  setBusy(false);
  streamStop = null;
  clearAttach();
  scrollBottom();
}

function setBusy(on) {
  const s = $('#send');
  if (!s) return;
  s.classList.toggle('stop', on);
  s.textContent = on ? '停止' : '发送';
}

function clearAttach() { pendingImage = null; const a = $('#attachBar'); if (a) a.remove(); }

/* 重新生成：删掉这条 AI 回复，用上一次的提问重来 */
function regenerate(aiEl) {
  if (!lastUserText || streaming) return;
  const h = state.history;
  if (state.mode !== 'cloud' && state.mode !== 'lan') { /* 远程：电脑端没有 regenerate，直接重发 */ }
  if (h.length && h[h.length - 1].role === 'assistant') h.pop();
  aiEl.remove();
  runChat(lastUserText, null, true);
}

async function chatLan(text, onDelta, image, signal, regenerate) {
  const body = { text, sessionId: state.sessionId };
  if (image) body.image = image;
  if (regenerate) body.regenerate = true;
  const r = await fetch(`http://${state.ip}:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!r.ok || !r.body) throw new Error('电脑没响应（' + r.status + '）');
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      if (!p.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(String(p).slice(6));
        if (ev.type === 'session') state.sessionId = ev.sessionId;
        else if (ev.type === 'delta') onDelta(ev.text || '');
        else if (ev.type === 'error') onDelta('\n[电脑端出错] ' + ev.message);
      } catch {}
    }
  }
}

async function chatCloud(messages, signal) {
  const r = await fetch(CLOUD.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key },
    body: JSON.stringify({
      model: state.cloudModel || CLOUD.model,
      messages: [{ role: 'system', content: `你是${name()}，一个简洁实用的中文助手。回答要短、要具体，不说客套话。` }, ...messages]
    }),
    signal
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('云端没响应（' + r.status + '）');
  return j?.choices?.[0]?.message?.content || j?.error?.message || '(没有回复)';
}

/* ---------------- 模型选择 ---------------- */
function fillModels() {
  const sel = $('#modelSel'); if (!sel) return;
  const hasRemote = state.mode === 'remote' && rMeta && rMeta.models && rMeta.models.length;
  let cur;
  if (hasRemote) {
    sel.innerHTML = rMeta.models.map(m => `<option value="${m.ref}">${m.name}</option>`).join('');
    cur = state.model || rMeta.activeModel || (rMeta.models[0] && rMeta.models[0].ref) || '';
    $('#modelTip').textContent = '这些是你电脑上已配好的模型，切换后下一句生效。';
    sel.disabled = false;
  } else if (state.mode === 'lan') {
    sel.innerHTML = '<option value="">局域网用电脑当前模型（在电脑上切换）</option>';
    cur = '';
    $('#modelTip').textContent = '局域网直连电脑，模型在电脑的「模型」面板里切换。';
    sel.disabled = true;
  } else {
    sel.innerHTML = CLOUD_MODELS.map(m => `<option value="${m}">云端 · ${m}</option>`).join('');
    cur = state.cloudModel || CLOUD.model;
    $('#modelTip').textContent = '云端模式用在线模型；连上电脑后可用你电脑上的模型。';
    sel.disabled = false;
  }
  sel.value = cur;
  if (!sel.value && sel.options[0]) sel.value = sel.options[0].value;
}

/* ---------------- Markdown 渲染（安全：先转义再套格式） ---------------- */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function mdInline(s) {
  const stash = [];
  const keep = html => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, t, u) => keep(`<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(https?:\/\/[^\s<)]+)/g, (_, u) => keep(`<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
}
function md(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let out = '', inList = null;
  const flush = () => { if (inList) { out += `</${inList}>`; inList = null; } };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const fence = raw.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flush();
      const buf = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<pre class="code">${esc(buf.join('\n'))}</pre>`;
      continue;
    }
    const el = esc(raw);
    if (!el.trim()) { flush(); i++; continue; }
    let m;
    if ((m = el.match(/^(#{1,4})\s+(.*)$/))) { flush(); out += `<h${m[1].length + 2}>${mdInline(m[2])}</h${m[1].length + 2}>`; i++; continue; }
    if ((m = el.match(/^\s*[-*+]\s+(.*)$/))) { if (inList !== 'ul') { flush(); out += '<ul>'; inList = 'ul'; } out += `<li>${mdInline(m[1])}</li>`; i++; continue; }
    if ((m = el.match(/^\s*\d+[.)]\s+(.*)$/))) { if (inList !== 'ol') { flush(); out += '<ol>'; inList = 'ol'; } out += `<li>${mdInline(m[1])}</li>`; i++; continue; }
    if ((m = el.match(/^\s*&gt;\s?(.*)$/))) { flush(); out += `<blockquote>${mdInline(m[1])}</blockquote>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(el)) { flush(); out += '<hr>'; i++; continue; }
    flush();
    out += `<p>${mdInline(el)}</p>`;
    i++;
  }
  flush();
  return out;
}

/* ---------------- 渲染 ---------------- */
function showMsgs() { empty.hidden = true; }

function addMsg(who, text, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  const b = document.createElement('div');
  b.className = 'bub';
  if (opts.thinking) b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  else if (opts.html) b.innerHTML = text;
  else b.textContent = text;
  el.appendChild(b);
  msgs.appendChild(el);
  scrollBottom();
  return el;
}

// AI 消息下方的操作：复制 / 重新生成
function addActions(el) {
  if (!el || el.querySelector('.mact')) return;
  const bar = document.createElement('div');
  bar.className = 'mact';
  const cp = document.createElement('button');
  cp.type = 'button'; cp.textContent = '复制';
  cp.onclick = () => {
    const t = el.querySelector('.bub').innerText;
    try { navigator.clipboard.writeText(t); toast('已复制'); } catch { toast('复制失败'); }
  };
  const rg = document.createElement('button');
  rg.type = 'button'; rg.textContent = '重新生成';
  rg.onclick = () => regenerate(el);
  bar.appendChild(cp); bar.appendChild(rg);
  el.appendChild(bar);
}

function scrollBottom() { requestAnimationFrame(() => { wrap.scrollTop = wrap.scrollHeight; }); }

/* ---------------- 电脑上的历史会话 ---------------- */
function histLog(s) { const e = $('#histLog'); if (e) e.textContent = s || ''; }

async function loadHistory() {
  if (state.mode !== 'remote') { histLog('只有在远程连上电脑后，才能读电脑上的会话。'); return; }
  histLog('正在读取电脑上的会话…');
  try {
    const r = await remoteQuery({ cmd: 'list_sessions' }, 'sessions');
    const list = r.list || [];
    if (!list.length) { histLog('电脑上还没有会话。'); return; }
    histLog('');
    const box = $('#histList'); box.innerHTML = '';
    for (const s of list.slice(0, 60)) {
      const b = document.createElement('button');
      b.className = 'histitem';
      const t = new Date(s.updatedAt || Date.now());
      const when = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      b.innerHTML = `<span class="ht">${esc(s.title || '(无标题)')}</span><span class="hs">${s.count || 0} 条 · ${when}</span>`;
      b.onclick = () => openHistorySession(s.id, s.title);
      box.appendChild(b);
    }
  } catch (e) { histLog('读取失败：' + e.message); }
}

async function openHistorySession(id, title) {
  histLog('正在打开…');
  try {
    const r = await remoteQuery({ cmd: 'open_session', sessionId: id }, 'session_data');
    showMsgs();
    msgs.innerHTML = '';
    state.sessionId = id;
    const tip = addMsg('ai', '');
    tip.querySelector('.bub').innerHTML = md(`**（电脑上的会话：${esc(title || '')}）**`);
    for (const m of (r.messages || [])) {
      if (m.role === 'system' || m.role === 'tool') continue;
      if (m.role === 'user') addMsg('me', typeof m.content === 'string' ? m.content : '');
      else if (m.role === 'assistant' && m.content) {
        const el = addMsg('ai', '');
        el.querySelector('.bub').innerHTML = md(String(m.content));
      }
    }
    $('#sheet').hidden = true;
    scrollBottom();
  } catch (e) { histLog('打开失败：' + e.message); }
}

/* ---------------- 绑定 ---------------- */
$('#send').onclick = () => { if (streaming) { streamStop && streamStop(); return; } send(); };
txt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').click(); } });
txt.addEventListener('input', () => {
  txt.style.height = 'auto';
  txt.style.height = Math.min(txt.scrollHeight, 110) + 'px';
  $('#send').classList.toggle('on', !!txt.value.trim());
});
const openSheet = () => { $('#ipInput').value = state.ip || ''; $('#scanLog').textContent = ''; histLog(''); $('#sheet').hidden = false; };
$('#cfgBtn').onclick = openSheet;
$('#closeSheet').onclick = () => { $('#sheet').hidden = true; };
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });

$('#saveBtn').onclick = async () => {
  const ip = $('#ipInput').value.trim();
  if (!ip) return;
  $('#scanLog').textContent = '正在连接 ' + ip + ' …';
  if (await probe(ip)) {
    state.ip = ip;
    localStorage.setItem('qz_ip', ip);
    setMode('lan');
    fillModels();
    $('#sheet').hidden = true;
  } else {
    $('#scanLog').textContent = `连不上 ${ip}。确认电脑轻舟开着、同一 Wi-Fi、防火墙没挡 ${PORT} 端口。`;
  }
};
$('#scanBtn').onclick = scanLAN;

$('#modelSel').onchange = e => {
  if (state.mode === 'remote') { state.model = e.target.value; localStorage.setItem('qz_model', state.model); }
  else { state.cloudModel = e.target.value; localStorage.setItem('qz_cloud_model', state.cloudModel); }
};

$('#remoteBtn').onclick = async () => {
  const id = $('#pcIdInput').value.trim().toUpperCase();
  if (!id) { $('#scanLog').textContent = '先填电脑上显示的远程号码。'; return; }
  $('#scanLog').textContent = '正在远程连接 ' + id + ' …';
  try {
    await remoteConnect(id);
    localStorage.setItem('qz_pc', id);
    if (!state.model && rMeta?.activeModel) state.model = rMeta.activeModel;
    setMode('remote');
    fillModels();
    $('#scanLog').textContent = '已连上电脑（远程）。';
    setTimeout(() => { $('#sheet').hidden = true; }, 700);
  } catch (e) {
    $('#scanLog').textContent = '连不上：' + e.message;
  }
};

$('#histBtn') && ($('#histBtn').onclick = loadHistory);

/* ---------------- 语音 / 图片入口 ---------------- */
let pendingImage = null, micOn = false, rec = null;

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:rgba(17,24,39,.9);color:#fff;padding:9px 14px;border-radius:10px;font-size:13px;z-index:99;max-width:82%;text-align:center;animation:fadeIn .2s ease both';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

$('#micBtn').onclick = () => {
  if (micOn) { rec && rec.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('当前环境不支持语音，打字也行'); return; }
  rec = new SR();
  rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
  rec.onresult = e => { let s = ''; for (const r of e.results) s += r[0].transcript; txt.value = s; txt.dispatchEvent(new Event('input')); };
  rec.onend = () => { micOn = false; $('#micBtn').classList.remove('on'); };
  rec.onerror = () => { micOn = false; $('#micBtn').classList.remove('on'); };
  micOn = true; $('#micBtn').classList.add('on');
  try { rec.start(); } catch { micOn = false; $('#micBtn').classList.remove('on'); }
};

$('#attBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    pendingImage = rd.result;
    const a = document.createElement('div');
    a.className = 'attach';
    a.id = 'attachBar';
    a.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">附图：${f.name}</span><button class="x" id="attX" type="button">×</button>`;
    const c = document.querySelector('.composer');
    if (c) c.before(a);
    $('#attX').onclick = () => { pendingImage = null; a.remove(); };
  };
  rd.readAsDataURL(f);
  e.target.value = '';
};

boot();
