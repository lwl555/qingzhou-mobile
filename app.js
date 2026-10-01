/* 轻舟手机版 v1.16
   三种连接，按优先级自动选：
     1) 局域网 lan   ：手机和电脑同一 Wi-Fi → 直连 http://<电脑IP>:8787
     2) 远程   remote：电脑开了「远程操作」→ 走云端中继，在外面也能操作自己电脑
     3) 云端   cloud ：以上都连不上 → 直接用云端模型聊天
   界面：底部导航 对话/灵感/历史/连接，借鉴 Muse 的「主动建议」思路。 */

const PORT = 8787;
const CLOUD = {
  url: 'https://wcnssyiqitugqfmcbdhe.functions.supabase.co/agnes-proxy/v1/chat/completions',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjbnNzeWlxaXR1Z3FmbWNiZGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDEyNzUsImV4cCI6MjA5ODk3NzI3NX0.9EfbEr7BQhZtbOwHJ3IrkOy16kcaxlmzuJuV0A2Z8Eg',
  model: 'agnes-2.0-flash'
};
const SB = { url: 'https://wcnssyiqitugqfmcbdhe.supabase.co', key: CLOUD.key };
const CLOUD_MODELS = ['agnes-2.0-flash', 'agnes-2.5-flash', 'agnes-2.5-pro', 'agnes-3.0-flash'];

const state = {
  ip: '', mode: 'cloud', remotePcId: '', sessionId: null,
  awaitName: false, askedName: false, cloudModel: '', model: '',
  cur: null
};
const $ = s => document.querySelector(s);
const msgs = $('#msgs'), txt = $('#txt'), wrap = $('#wrap'), empty = $('#empty');

const name = () => localStorage.getItem('qz_name') || '轻舟';
const greet = () => { const h = new Date().getHours(); return h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };

/* ================= 会话存储（本机持久化） ================= */
const SESS_KEY = 'qz_sessions', CUR_KEY = 'qz_cur';
function allSessions() {
  try { const a = JSON.parse(localStorage.getItem(SESS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeSessions(a) { try { localStorage.setItem(SESS_KEY, JSON.stringify(a.slice(0, 40))); } catch {} }

function newSession() {
  state.cur = {
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: '', updatedAt: Date.now(), msgs: []
  };
  state.sessionId = null;
  localStorage.setItem(CUR_KEY, state.cur.id);
}
function persist() {
  if (!state.cur) return;
  state.cur.updatedAt = Date.now();
  if (!state.cur.title) {
    const first = (state.cur.msgs.find(m => m.role === 'user') || {}).content || '';
    state.cur.title = (first || '').replace(/\s+/g, ' ').slice(0, 18) || '(空对话)';
  }
  const all = allSessions();
  const i = all.findIndex(s => s.id === state.cur.id);
  if (i >= 0) all[i] = state.cur; else all.unshift(state.cur);
  all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  writeSessions(all);
  localStorage.setItem(CUR_KEY, state.cur.id);
}
function loadCur() {
  const id = localStorage.getItem(CUR_KEY);
  const s = allSessions().find(x => x.id === id);
  if (s) { state.cur = s; state.sessionId = null; return; }
  newSession();
}
function pushUser(text) { if (text) state.cur.msgs.push({ role: 'user', content: text }); }
function pushAI(text) { if (text) state.cur.msgs.push({ role: 'assistant', content: text }); }

function sanitizeHistory(list) {
  const out = [];
  for (const m of (list || [])) {
    const c = typeof m.content === 'string' ? m.content : (m.content == null ? '' : String(m.content));
    if (!c.trim()) continue;
    if (out.length && out[out.length - 1].role === m.role) { out[out.length - 1] = { role: m.role, content: c }; continue; }
    out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/* ================= 状态栏 + 连接横幅 ================= */
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
  renderBanner();
}
function renderStat() {
  const t = $('#statText');
  if (t) t.textContent = statRate ? `${statLabel} · ${statRate}` : statLabel;
}
function renderBanner() {
  const b = $('#banner'); if (!b) return;
  if (state.mode === 'lan') {
    b.hidden = false; b.className = 'banner lan';
    b.innerHTML = `<span>🟢 已连上你电脑（局域网）</span><span class="bk">用本地模型</span>`;
  } else if (state.mode === 'remote') {
    b.hidden = false; b.className = 'banner remote';
    b.innerHTML = `<span>🟠 已远程连上电脑</span><span class="bk">在外面也能操作</span>`;
  } else {
    b.hidden = true;
  }
}

/* ================= 速率 ================= */
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

/* ================= 底部导航 ================= */
function switchTab(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  $('#composer').classList.toggle('hide', view !== 'chat');
  if (view === 'history') { renderLocalHistory(); }
  if (view === 'ideas') { renderIdeas(); }
  if (view === 'connect') { $('#ipInput').value = state.ip || ''; $('#nameInput').value = localStorage.getItem('qz_name') || ''; renderLocalHistory(); }
  scrollBottom();
}

/* ================= 首屏引导 ================= */
function maybeOnboard() {
  if (localStorage.getItem('qz_onboarded') === '1') return;
  const ob = $('#ob'); ob.hidden = false; requestAnimationFrame(() => ob.classList.add('on'));
  let step = 0; const steps = ob.querySelectorAll('.ob-step'), dots = ob.querySelectorAll('.ob-dots i');
  const go = i => {
    step = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(s => s.classList.toggle('on', +s.dataset.i === step));
    dots.forEach((d, k) => d.classList.toggle('on', k === step));
    $('#obNext').textContent = step === steps.length - 1 ? '开始使用' : '下一步';
  };
  $('#obNext').onclick = () => { if (step === steps.length - 1) finishOnboard(); else go(step + 1); };
  $('#obSkip').onclick = finishOnboard;
  function finishOnboard() { ob.classList.remove('on'); setTimeout(() => ob.hidden = true, 350); localStorage.setItem('qz_onboarded', '1'); }
}

async function boot() {
  $('#hi').textContent = greet();
  document.querySelector('.hd-title').textContent = name();
  state.askedName = localStorage.getItem('qz_asked_name') === '1';
  state.ip = localStorage.getItem('qz_ip') || '';
  state.remotePcId = localStorage.getItem('qz_pc') || '';
  state.cloudModel = localStorage.getItem('qz_cloud_model') || '';
  state.model = localStorage.getItem('qz_model') || '';
  if (state.remotePcId) $('#pcIdInput').value = state.remotePcId;

  loadCur();
  renderCur();
  renderList();
  fillModels();

  if (state.ip) {
    setMode('cloud', '正在找电脑…');
    if (await probe(state.ip)) { setMode('lan'); fillModels(); afterBoot(); return; }
  }
  if (state.remotePcId) {
    setMode('cloud', '正在远程连接…');
    try {
      await remoteConnect(state.remotePcId);
      if (!state.model && rMeta?.activeModel) state.model = rMeta.activeModel;
      setMode('remote'); fillModels(); afterBoot(); return;
    } catch (e) { console.warn('[remote] ' + e.message); }
  }
  setMode('cloud', '云端模式 · 点「连接」可连电脑');
  fillModels();
  afterBoot();
}

function afterBoot() {
  document.querySelector('.hd-title').textContent = name();
  renderList();
  maybeOnboard();
  const named = !!localStorage.getItem('qz_name');
  const fresh = !state.cur || !state.cur.msgs.length;
  if (!named && !state.askedName && fresh) setTimeout(() => askName(false), 900);
}

/* ================= 渲染消息 ================= */
function showEmpty() { empty.hidden = false; }
function hideEmpty() { empty.hidden = true; }
function renderCur() {
  msgs.innerHTML = '';
  const list = (state.cur && state.cur.msgs) || [];
  if (!list.length) { showEmpty(); return; }
  hideEmpty();
  for (const m of list) {
    if (m.role === 'user') addMsg('me', m.content);
    else {
      const el = addMsg('ai', '');
      el.querySelector('.bub').innerHTML = md(m.content);
      addActions(el);
    }
  }
  scrollBottom();
}

/* ================= AI 主动问名字 ================= */
function askName(force) {
  if (!force && (localStorage.getItem('qz_asked_name') === '1' || localStorage.getItem('qz_name'))) return;
  showMsgs();
  const cur = localStorage.getItem('qz_name');
  const msg = cur
    ? `想换个名字？你想让我叫什么？\n说一个就行，之后我就用新名字自称。`
    : '我一直还没名字。你想叫我什么？\n说一个就行，之后我就用这个名字自称。';
  addMsg('ai', msg);
  pushAI(msg); persist();
  state.awaitName = true;
  localStorage.setItem('qz_asked_name', '1');
  renderList();
}
function setName(v) {
  const n = (v || '').trim().replace(/[。！？.!?，,、\s]/g, '').slice(0, 8);
  const say = t => { addMsg('ai', t); pushAI(t); persist(); };
  if (/^(随便|随意|你定|你决定|你看着办|都行|都可以|不知道|无所谓|看你)/.test(n)) {
    say('那我替你想也行。先给个方向：想要短一点的，还是文气一点的？或者江湖气重些？');
    state.awaitName = true; return false;
  }
  if (!n || n.length > 8) {
    say('两到四个字好记一些。你想叫我什么？');
    state.awaitName = true; return false;
  }
  localStorage.setItem('qz_name', n);
  document.querySelector('.hd-title').textContent = n;
  const ok = `好，以后我就叫「${n}」。\n要改名随时说一句「改个名字」。`;
  say(ok); renderList(); state.awaitName = false; return true;
}

/* ================= 首屏示例 + 灵感 ================= */
function renderList() {
  const named = !!localStorage.getItem('qz_name');
  const ex = [
    named
      ? { t: `换个名字`, s: `现在是「${name()}」`, act: 'name' }
      : { t: `给${name()}起个名字`, s: '它会主动问你', act: 'name' },
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
      switchTab('chat');
      txt.value = it.q; txt.dispatchEvent(new Event('input')); send();
    };
    box.appendChild(b);
  }
}

const DEFAULT_IDEAS = [
  { t: '盯价格', s: '把商品链接发我，降价了就提醒你', icon: '🔔' },
  { t: '改文案 / 润色', s: '贴一段文字，我帮你改专业或口语', icon: '✍️' },
  { t: '联网搜最新', s: '问时事、查资料、比价格', icon: '🌐' },
  { t: '连电脑干活', s: '远程让电脑跑任务、读本地文件', icon: '💻' }
];
function renderIdeas(list) {
  const box = $('#ideaList'); if (!box) return;
  const arr = list || DEFAULT_IDEAS;
  box.innerHTML = '';
  for (const it of arr) {
    const b = document.createElement('button');
    b.className = 'idea';
    b.innerHTML = `<div class="ico">${it.icon || '💡'}</div><div><div class="it">${esc(it.t)}</div><div class="is">${esc(it.s || '')}</div></div>`;
    b.onclick = () => {
      switchTab('chat');
      const q = it.q || it.t;
      txt.value = q; txt.dispatchEvent(new Event('input')); send();
    };
    box.appendChild(b);
  }
}
async function genIdeas() {
  const box = $('#ideaList');
  box.innerHTML = '<p class="tip">正在让 AI 帮你想想能帮你做什么…</p>';
  const prompt = '你是轻舟（用户的私人手机助手）。请给 4 条"轻舟能帮普通用户做的事"的具体建议。'
    + '每条返回 JSON：{"t":"简短标题(不超过12个字)","s":"为什么值得做(一句话)","icon":"一个emoji","q":"用户点这条时应自动发出的示例问句"}。'
    + '只返回 JSON 数组，不要任何解释或代码块标记。';
  try {
    const raw = await chatCloud([{ role: 'user', content: prompt }], null);
    const arr = parseJsonArray(raw);
    if (Array.isArray(arr) && arr.length) renderIdeas(arr); else renderIdeas();
  } catch { renderIdeas(); }
}
function parseJsonArray(s) {
  try {
    const m = String(s).match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return null;
}

/* ================= 远程：通过云端中继操作自己的电脑 ================= */
let rClient = null, rChannel = null, rMeta = null, pendingPong = null;
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
function chatRemote(text, onDelta, onSync, image, model, regenerate) {
  const ctl = { errored: false };
  let finish;
  const promise = new Promise((resolve, reject) => {
    let done = false;
    const reqId = Math.random().toString(36).slice(2);
    let nextSeq = 0;
    const buf = new Map();
    let lastProgress = Date.now();
    const cleanup = () => { try { rChannel.off('broadcast', { event: 'chunk' }, on); } catch {} clearInterval(sweeper); };
    const done_ = (err) => { if (done) return; done = true; cleanup(); err ? reject(err) : resolve(); };
    finish = done_;
    const consume = (payload) => {
      lastProgress = Date.now();
      const t = payload.type;
      if (t === 'session') state.sessionId = payload.sessionId;
      else if (t === 'delta') onDelta(payload.text || '');
      else if (t === 'sync') onSync(payload.full || '');
      else if (t === 'tool_start') onDelta(`\n[电脑执行] ${payload.name || '工具'}…\n`);
      else if (t === 'approval_request') onDelta('\n[需要你在电脑上点一下确认]\n');
      else if (t === 'error') {
        if (typeof payload.full === 'string') onSync(payload.full);
        else onDelta('\n[电脑端出错] ' + (payload.text || payload.message || '未知错误'));
        ctl.errored = true; done_();
      }
      else if (t === 'done') { if (typeof payload.full === 'string') onSync(payload.full); done_(); }
    };
    const drain = () => { let p; while ((p = buf.get(nextSeq))) { buf.delete(nextSeq); nextSeq++; consume(p); } };
    const on = ({ payload }) => {
      if (!payload || payload.reqId !== reqId) return;
      const s = typeof payload.seq === 'number' ? payload.seq : null;
      if (s == null) { consume(payload); return; }
      if (s === nextSeq) { nextSeq++; consume(payload); drain(); }
      else if (s > nextSeq) { buf.set(s, payload); }
    };
    rChannel.on('broadcast', { event: 'chunk' }, on);
    const sweeper = setInterval(() => {
      if (buf.size && Date.now() - lastProgress > 1500) {
        for (const k of [...buf.keys()].sort((a, b) => a - b)) consume(buf.get(k));
        buf.clear(); lastProgress = Date.now();
      }
      if (Date.now() - lastProgress > 60000) done_(new Error('电脑没回应（可能关机、断网或已关闭远程）'));
    }, 700);
    rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId, text, sessionId: state.sessionId, image, model, regenerate: !!regenerate } })
      .catch(e => done_(e));
    chatRemote._reqId = reqId;
  });
  const stop = () => {
    try { rChannel.send({ type: 'broadcast', event: 'cmd', payload: { reqId: chatRemote._reqId, stop: true } }).catch(() => {}); } catch {}
    finish && finish();
  };
  return { promise, stop, ctl };
}

/* ================= 扫描局域网 ================= */
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
    setMode('lan'); fillModels();
  } else {
    log.textContent = '没扫到。确认电脑轻舟开着、手机与电脑同一 Wi-Fi，也可手填 IP。';
  }
}

/* ================= 发消息 ================= */
let streaming = false, streamStop = null, lastUserText = '';
async function send() {
  if (streaming) return;
  const text = txt.value.trim();
  if (!text && !pendingImage) return;
  const img = pendingImage;
  txt.value = '';
  txt.style.height = 'auto';
  $('#send').classList.remove('on');
  if (state.awaitName && text) {
    showMsgs(); addMsg('me', text); clearAttach(); setName(text); return;
  }
  if (text && /^(改|换)(个|一下)?名字$|^重命名$|^换个名字吧?$/.test(text)) {
    showMsgs(); addMsg('me', text); clearAttach(); setTimeout(() => askName(true), 150); return;
  }
  showMsgs();
  addMsg('me', text || '（图片）');
  if (img && state.mode === 'cloud') toast('云端看不了图片，这条只发文字；连上电脑才能发图');
  pushUser(text);
  lastUserText = text;
  await runChat(text, img, false);
}
async function runChat(text, img, isRegen) {
  streaming = true; setBusy(true); startRate();
  let stopped = false;
  const ctl = new AbortController();
  let remoteStopFn = null;
  streamStop = () => { stopped = true; try { ctl.abort(); } catch {} if (remoteStopFn) remoteStopFn(); };
  const el = addMsg('ai', '', { thinking: true });
  const bub = el.querySelector('.bub');
  let acc = '';
  const paint = () => { bub.innerHTML = md(acc); scrollBottom(); };
  try {
    if (state.mode === 'cloud') {
      if (img && !text) {
        acc = '（云端模型看不了图片。连上电脑后，可以把图发给电脑上的模型识别。）';
        paint(); pushAI(acc); persist();
      } else {
        acc = await chatCloud(sanitizeHistory(state.cur.msgs), ctl.signal);
        paint(); pushAI(acc); persist();
      }
    } else if (state.mode === 'lan') {
      await chatLan(text, d => { acc += d; tickRate(d.length); paint(); }, img, ctl.signal, isRegen);
      if (!acc && !stopped) acc = '(没有回复)';
      paint(); if (acc) { pushAI(acc); persist(); }
    } else {
      const r = chatRemote(text,
        d => { acc += d; tickRate(d.length); paint(); },
        full => { acc = full; paint(); },
        img, state.model, isRegen);
      remoteStopFn = r.stop;
      await r.promise;
      if (!acc && !stopped) acc = '(电脑没有回复)';
      paint();
      if (acc && !r.ctl.errored && !stopped) { pushAI(acc); persist(); }
    }
  } catch (e) {
    if (stopped) { if (!acc) { acc = '(已停止)'; paint(); } }
    else { acc = '出错：' + e.message; paint(); }
  }
  stopRate();
  if (!stopped) addActions(el);
  streaming = false; setBusy(false); streamStop = null; clearAttach(); scrollBottom();
}
function setBusy(on) {
  const s = $('#send');
  if (!s) return;
  s.classList.toggle('stop', on);
  s.textContent = on ? '停止' : '发送';
}
function clearAttach() { pendingImage = null; const a = $('#attachBar'); if (a) a.remove(); }
function regenerate(aiEl) {
  if (!lastUserText || streaming) return;
  const h = state.cur.msgs;
  if (h.length && h[h.length - 1].role === 'assistant') h.pop();
  aiEl.remove(); persist();
  runChat(lastUserText, null, true);
}
async function chatLan(text, onDelta, image, signal, regenerate) {
  const body = { text, sessionId: state.sessionId };
  if (image) body.image = image;
  if (regenerate) body.regenerate = true;
  const r = await fetch(`http://${state.ip}:${PORT}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
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

/* 云端：身份 + 时间 + 主动理解用户（借鉴豆包/元宝：会反问、给下一步、不一根筋） */
function sysPrompt() {
  const d = new Date(), p = x => String(x).padStart(2, '0');
  const wk = '日一二三四五六'[d.getDay()];
  const now = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())} 星期${wk}`;
  return `你是「${name()}」，用户自己的私人助手（产品名「轻舟」），直接跑在用户手机 / 电脑上。\n`
    + `现在时间：${now}（这是用户设备的本地时间；被问到现在几点、今天几号，直接用它回答，别再说"无法提供实时时间"）。\n\n`
    + `怎么说话（核心：真正理解用户，而不是只会执行）：\n`
    + `1. 像个靠谱的老朋友——口语、自然、有分寸。不客套、不喊口号、不写小作文、不堆排比句。\n`
    + `2. 简短优先：先一句话给结论，需要再补细节。\n`
    + `3. 手机屏幕，别输出 markdown 表格、别用「##」大标题；分点用「- 」短横线，一行一条，说人话。\n`
    + `4. 你就是「${name()}」，由用户自己部署。不要自称别的公司的产品，不要编造开发商、版本号、设备型号——不知道就直说。\n`
    + `5. 主动理解：用户说的不清、缺信息时，先简短反问一句最关键的（一次一个问题，别连珠炮），而不是瞎猜或干等。\n`
    + `6. 给完方案顺手给"下一步可以做什么"（1-2 条），让用户少想一步；但别啰嗦。\n`
    + `7. 用户让你做就直接做，别反复确认；只有涉及花钱、发消息、删东西这类才先问一句。\n`
    + `8. 被问"你能干嘛/帮我做点什么"，结合上下文举 2-3 个具体例子，别只说"我什么都能做"。`;
}
async function chatCloud(messages, signal) {
  const hist = sanitizeHistory(messages);
  if (!hist.length) return '(没有可发送的内容)';
  let r;
  try {
    r = await fetch(CLOUD.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key },
      body: JSON.stringify({ model: state.cloudModel || CLOUD.model, messages: [{ role: 'system', content: sysPrompt() }, ...hist] }),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上云端（' + (e.message || '网络错误') + '）');
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) {
    const detail = j?.error?.message || j?.message || '';
    throw new Error('云端没响应（' + r.status + '）' + (detail ? '：' + String(detail).slice(0, 140) : ''));
  }
  return j?.choices?.[0]?.message?.content || '(没有回复)';
}

/* ================= 模型选择 ================= */
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

/* ================= Markdown 渲染 ================= */
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
    if (/^\s*\|.*\|\s*$/.test(el) && i + 1 < lines.length) {
      const sep = esc(lines[i + 1]);
      if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep) && sep.includes('|')) {
        flush();
        const cells = ln => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => mdInline(esc(c.trim())));
        const head = cells(el);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(esc(lines[i]))); i++; }
        let t = '<div class="tblwrap"><table class="mdtbl"><thead><tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
        for (const r of rows) t += '<tr>' + head.map((_, k) => `<td>${r[k] || ''}</td>`).join('') + '</tr>';
        out += t + '</tbody></table></div>';
        continue;
      }
    }
    flush();
    out += `<p>${mdInline(el)}</p>`;
    i++;
  }
  flush();
  return out;
}

/* ================= DOM 渲染 ================= */
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
function showMsgs() { hideEmpty(); }

/* ================= 历史对话（本机 + 电脑） ================= */
function histLog(s) { const e = $('#histLog'); if (e) e.textContent = s || ''; }
const fmtTime = ts => { const t = new Date(ts || Date.now()); return `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
function renderLocalHistory() {
  const box = $('#localList'); if (!box) return;
  const all = allSessions();
  box.innerHTML = '';
  if (!all.length) { box.innerHTML = '<div class="histempty">还没有历史对话</div>'; return; }
  for (const s of all) {
    const b = document.createElement('button');
    b.className = 'histitem' + (state.cur && s.id === state.cur.id ? ' cur' : '');
    b.innerHTML = `<span class="ht">${esc(s.title || '(空对话)')}</span><span class="hs">${(s.msgs || []).length} 条 · ${fmtTime(s.updatedAt)}</span>`;
    b.onclick = () => openLocalSession(s.id);
    box.appendChild(b);
  }
}
function openLocalSession(id) {
  if (streaming) return;
  persist();
  const s = allSessions().find(x => x.id === id);
  if (!s) return;
  state.cur = s; state.sessionId = null;
  localStorage.setItem(CUR_KEY, s.id);
  renderCur(); renderList(); switchTab('chat');
  toast('已打开：' + (s.title || '对话'));
}
async function loadPCHistory() {
  if (state.mode !== 'remote') { histLog('只有远程连上电脑后，才能读电脑上的会话。'); return; }
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
      b.innerHTML = `<span class="ht">${esc(s.title || '(无标题)')}</span><span class="hs">${s.count || 0} 条 · ${fmtTime(s.updatedAt)}</span>`;
      b.onclick = () => openPCSession(s.id, s.title);
      box.appendChild(b);
    }
  } catch (e) { histLog('读取失败：' + e.message); }
}
async function openPCSession(id, title) {
  histLog('正在打开…');
  try {
    const r = await remoteQuery({ cmd: 'open_session', sessionId: id }, 'session_data');
    newSession();
    const tip = { role: 'assistant', content: `（从电脑打开的会话：${title || ''}）` };
    state.cur.msgs.push(tip);
    for (const m of (r.messages || [])) {
      if (m.role === 'system' || m.role === 'tool') continue;
      if (typeof m.content !== 'string' || !m.content.trim()) continue;
      state.cur.msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
    }
    state.sessionId = id;
    persist(); renderCur(); switchTab('chat');
    toast('已打开电脑上的会话');
  } catch (e) { histLog('打开失败：' + e.message); }
}

/* ================= 语音 / 图片入口 ================= */
let pendingImage = null, micOn = false, rec = null, micListener = null;
function setMicOn(on) {
  const b = $('#micBtn');
  b.classList.toggle('on', on);
  b.classList.toggle('recording', on);
}
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:rgba(17,24,39,.9);color:#fff;padding:9px 14px;border-radius:10px;font-size:13px;z-index:99;max-width:82%;text-align:center;animation:fadeIn .2s ease both';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

/* 麦克风：优先用 Capacitor 原生语音插件（APK 内可用），否则回退 Web Speech（PWA/浏览器），
   都不行再提示。APK 需声明 RECORD_AUDIO 权限并安装 @capacitor-community/speech-recognition。 */
async function startVoice() {
  if (micOn) { stopVoice(); return; }
  const CapSR = window.Capacitor?.Plugins?.SpeechRecognition;
  if (CapSR) {
    try {
      const perm = await CapSR.requestPermissions();
      const ok = perm && (perm.speechRecognition === 'granted' || perm.microphone === 'granted' || perm.recognition === 'granted');
      if (!ok) { toast('需要先允许麦克风权限'); return; }
      micOn = true; setMicOn(true);
      try {
        micListener = await CapSR.addListener('partialResults', r => {
          if (r && r.value && r.value.length) { txt.value = r.value[0]; txt.dispatchEvent(new Event('input')); }
        });
      } catch {}
      const ret = await CapSR.start({ language: 'zh-CN', maxResults: 1, partialResults: true });
      if (ret && ret.value && ret.value.length) { txt.value = ret.value[0]; txt.dispatchEvent(new Event('input')); }
      micOn = false; setMicOn(false);
      if (micListener) { try { await micListener.remove(); } catch {} micListener = null; }
    } catch (e) {
      micOn = false; setMicOn(false);
      if (micListener) { try { await micListener.remove(); } catch {} micListener = null; }
      if (/permission|权限/i.test(e.message || '')) toast('麦克风权限被拒绝，去系统设置里允许');
      else toast('语音识别没启动：' + (e.message || '未知错误'));
    }
    return;
  }
  // 回退：Web Speech API（PWA / 桌面浏览器）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('当前环境不支持语音，打字也行'); return; }
  rec = new SR();
  rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
  rec.onresult = e => { let s = ''; for (const r of e.results) s += r[0].transcript; txt.value = s; txt.dispatchEvent(new Event('input')); };
  rec.onend = () => { micOn = false; setMicOn(false); };
  rec.onerror = e => { micOn = false; setMicOn(false); if (e.error === 'not-allowed') toast('麦克风权限被拒绝'); };
  micOn = true; setMicOn(true);
  try { rec.start(); } catch { micOn = false; setMicOn(false); }
}
function stopVoice() {
  try { if (window.Capacitor?.Plugins?.SpeechRecognition) window.Capacitor.Plugins.SpeechRecognition.stop(); } catch {}
  if (rec) try { rec.stop(); } catch {}
  micOn = false; setMicOn(false);
  if (micListener) { try { micListener.remove(); } catch {} micListener = null; }
}

$('#micBtn').onclick = startVoice;
$('#attBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    pendingImage = rd.result;
    const a = document.createElement('div');
    a.className = 'attach'; a.id = 'attachBar';
    a.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">附图：${esc(f.name)}</span><button class="x" id="attX" type="button">×</button>`;
    const c = document.querySelector('.composer');
    if (c) c.before(a);
    $('#attX').onclick = () => { pendingImage = null; a.remove(); };
  };
  rd.readAsDataURL(f);
  e.target.value = '';
};

/* ================= 绑定 ================= */
$('#send').onclick = () => { if (streaming) { streamStop && streamStop(); return; } send(); };
txt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').click(); } });
txt.addEventListener('input', () => {
  txt.style.height = 'auto';
  txt.style.height = Math.min(txt.scrollHeight, 112) + 'px';
  $('#send').classList.toggle('on', !!txt.value.trim());
});

document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.view));
$('#genIdeas').onclick = genIdeas;

$('#newBtn').onclick = () => {
  if (streaming) { toast('等这句说完再开新对话'); return; }
  if (!state.cur.msgs.length) { toast('这已经是新对话了'); return; }
  persist();
  newSession();
  msgs.innerHTML = '';
  $('#hi').textContent = greet();
  renderList();
  showEmpty();
  switchTab('chat');
  txt.focus();
  toast('已开新对话');
};

$('#saveBtn').onclick = async () => {
  const ip = $('#ipInput').value.trim();
  if (!ip) return;
  $('#scanLog').textContent = '正在连接 ' + ip + ' …';
  if (await probe(ip)) {
    state.ip = ip;
    localStorage.setItem('qz_ip', ip);
    setMode('lan'); fillModels();
    toast('已连上电脑（局域网）');
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
    setMode('remote'); fillModels();
    $('#scanLog').textContent = '已连上电脑（远程）。';
    setTimeout(() => switchTab('chat'), 600);
  } catch (e) { $('#scanLog').textContent = '连不上：' + e.message; }
};
$('#histBtn') && ($('#histBtn').onclick = loadPCHistory);
$('#nameSaveBtn').onclick = () => {
  const v = ($('#nameInput').value || '').trim().replace(/[。！？.!?，,、\s]/g, '').slice(0, 8);
  if (!v) { toast('先填个名字'); return; }
  localStorage.setItem('qz_name', v);
  localStorage.setItem('qz_asked_name', '1');
  document.querySelector('.hd-title').textContent = v;
  state.awaitName = false;
  renderList();
  toast('好，以后就叫「' + v + '」');
};

boot();
