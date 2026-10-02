/* 轻舟手机版 v1.21
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

// 当前版本号（手机版）。更新日志手机版 / 电脑版分开记，App 内「版本与更新」各自展示。
const APP_VERSION = '1.25.0';
const PHONE_CHANGELOG = [
  { v: '1.25.0', date: '2026-10-01', items: [
    '对话内实时预览（Artifacts 式：HTML / 代码 / 图表可直接看效果）',
    '智能选择卡片（特定场景一键决策，不用逐字打字）',
    '版本更新信息展示（手机版与电脑版分开记录）',
    '全新应用图标（Muse 风格 AI 角色）'
  ] },
  { v: '1.24.1', date: '2026-09-30', items: [
    '远程 / 局域网模式图片视频生成兜底（电脑没生成时手机侧走云模型）',
    '浏览器遥控面板、原生推送、停止生成'
  ] }
];
const PC_CHANGELOG = [
  { v: '1.24.0', date: '2026-09-28', items: [
    '本地模型统一调度（含轻量模型自动优化）',
    '屏幕 OCR：截图 + 免费视觉模型读字',
    '图片 / 视频生成子系统',
    '远程操作：在外面也能指挥电脑'
  ] },
  { v: '1.23.0', date: '2026-09-22', items: [
    '技能系统：内置技能包、连接性 / 安全增强',
    '云端代理 agnes-proxy 接入'
  ] }
];
// 代理根地址（去掉 chat 后缀）：图片/视频/轮询都走这里，密钥由代理保管
const CLOUD_API = CLOUD.url.replace(/\/v1\/chat\/completions$/, '');
const GEN = { imageModel: 'agnes-image-2.5-flash', videoModel: 'agnes-video-2.5-flash' };

/* ================= 自定义模型（手动接入，Key 只存本机） ================= */
const CUSTOM_KEY = 'qz_custom_models';
function allCustom() {
  try { const a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function saveCustom(a) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(a)); } catch {} }
const MODEL_PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-latest' },
  { name: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B' },
  { name: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' }
];
// 当前云端走哪个：内置 agnes 模型名，或 custom:<id>
function activeCloud() {
  const m = state.cloudModel || CLOUD.model;
  if (String(m).indexOf('custom:') === 0) {
    const c = allCustom().find(x => x.id === m.slice(7));
    if (c) return { url: String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions', key: c.key || '', model: c.model, name: c.name };
  }
  return { url: CLOUD.url, key: CLOUD.key, model: m, name: m };
}
async function testCustom(c) {
  const url = String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (c.key || '') },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(j?.error?.message || j?.message || ('HTTP ' + r.status)).slice(0, 160));
  return '连通 · ' + (j?.model || c.model);
}

/* ================= 形象 / 头像 ================= */
const AVA_KEY = 'qz_avatar';
const DEFAULT_AVA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
  + '<circle cx="32" cy="32" r="32" fill="#1d4ed8"/>'
  + '<circle cx="23" cy="26" r="4.6" fill="#fff"/><circle cx="41" cy="26" r="4.6" fill="#fff"/>'
  + '<circle cx="23.6" cy="26.6" r="2" fill="#1d4ed8"/><circle cx="41.6" cy="26.6" r="2" fill="#1d4ed8"/>'
  + '<path d="M22 39q10 8 20 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>'
  + '</svg>');
const AVA_STYLES = {
  soft3d: 'soft 3D Pixar-style, smooth clay material, studio lighting',
  anime: 'Japanese anime style, clean lineart, soft cel shading',
  pixel: 'pixel art, 32-bit retro game style',
  line: 'minimal flat line art, geometric shapes, thin strokes, white background',
  ink: 'Chinese ink wash painting, minimal brush strokes, rice paper texture'
};
function getAvatar() { return localStorage.getItem(AVA_KEY) || DEFAULT_AVA; }
function setAvatar(u) {
  try { if (u) localStorage.setItem(AVA_KEY, u); else localStorage.removeItem(AVA_KEY); } catch {}
  renderAvatar();
}
function renderAvatar() {
  const u = getAvatar();
  const a = $('#hdAva'), p = $('#avaPreview'), e = $('#emptyAva');
  if (a) a.src = u;
  if (p) p.src = u;
  if (e) e.src = u;
}
function avaPrompt(style) {
  const s = AVA_STYLES[style] || AVA_STYLES.soft3d;
  return `a cute friendly AI assistant mascot character, ${s}, square avatar portrait, centered composition, big expressive eyes, gentle smile, plain simple background, high quality, no text, no watermark`;
}
async function genAvatar(style) {
  const url = await createImage(avaPrompt(style));
  setAvatar(url);
  return url;
}
// 上传的图统一裁成 256×256 方图并压成 jpeg，免得 localStorage 被撑爆
function pickAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const S = 256, side = Math.min(img.width, img.height);
        const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
        const g = cv.getContext('2d');
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('这张图读不了'));
      img.src = rd.result;
    };
    rd.onerror = () => reject(new Error('文件读不了'));
    rd.readAsDataURL(file);
  });
}

/* ================= 实时状态 + 活动记录（学 Muse 那个会动的小人） ================= */
let idleStat = '';
function setStatus(t) {
  const e = $('#statText'); if (!e) return;
  e.textContent = t || idleStat;
  if (t) e.classList.add('busy'); else e.classList.remove('busy');
}
const ACTS = [];
function pushAct(text, ok) {
  ACTS.unshift({ t: Date.now(), text, ok });
  if (ACTS.length > 60) ACTS.pop();
  renderActs();
}
function renderActs() {
  const box = $('#actList'); if (!box) return;
  if (!ACTS.length) { box.innerHTML = '<div class="histempty">还没有活动记录</div>'; return; }
  box.innerHTML = ACTS.slice(0, 40).map(a => {
    const d = new Date(a.t);
    const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return `<div class="actrow"><span class="ai">${a.ok === false ? '⚠️' : '✅'}</span>`
      + `<span class="at">${esc(a.text)}</span><span class="ah">${hh}</span></div>`;
  }).join('');
}

// 云端图片生成：返回图片 URL
async function createImage(prompt) {
  const r = await fetch(CLOUD_API + '/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key },
    body: JSON.stringify({ model: GEN.imageModel, prompt, n: 1 })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('图片生成失败（' + r.status + '）' + (j?.error?.message || ''));
  const url = j?.data?.[0]?.url;
  if (!url) throw new Error('图片生成未返回地址');
  return url;
}

// 云端视频生成：异步任务，轮询直到完成，返回视频 URL
async function createVideo(prompt, onStatus) {
  const model = GEN.videoModel;
  const r = await fetch(CLOUD_API + '/v1/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key },
    body: JSON.stringify({ model, prompt, mode: 'text', seconds: '5', aspect_ratio: '16:9' })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('视频任务创建失败（' + r.status + '）' + (j?.error?.message || ''));
  const vid = j?.video_id || j?.task_id || j?.id;
  if (!vid) throw new Error('视频任务未返回 ID');
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 4000));
    const pr = await fetch(CLOUD_API + '/agnesapi?video_id=' + encodeURIComponent(vid) + '&model_name=' + encodeURIComponent(model), {
      headers: { Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key }
    });
    const pj = await pr.json().catch(() => null);
    const st = pj?.status;
    if (onStatus) onStatus(pj?.progress || 0, st);
    if (st === 'completed') {
      const url = pj?.metadata?.url;
      if (!url) throw new Error('视频完成但未返回地址');
      return url;
    }
    if (st === 'failed') throw new Error('视频生成失败：' + (pj?.error?.message || pj?.message || '未知'));
  }
  throw new Error('视频生成超时（超过 4 分钟）');
}

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
  idleStat = statRate ? `${statLabel} · ${statRate}` : statLabel;
  if (t && !t.classList.contains('busy')) t.textContent = idleStat;
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
  renderVersion();

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
  renderNameEntry();
  maybeOnboard();
  // 起名不再自动弹大气泡——欢迎区有「起名入口卡」，用户点了才问
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
      const c = m.content || '';
      if (c.startsWith('[media:image]')) {
        const url = c.slice('[media:image]'.length);
        const el = addMsg('ai', '');
        el.querySelector('.bub').innerHTML = `<img class="media" src="${esc(url)}" alt="生成图片">`;
        addActions(el);
      } else if (c.startsWith('[media:video]')) {
        const url = c.slice('[media:video]'.length);
        const el = addMsg('ai', '');
        el.querySelector('.bub').innerHTML = `<video class="media" src="${esc(url)}" controls></video>`;
        addActions(el);
      } else {
        const el = addMsg('ai', '');
        el.querySelector('.bub').innerHTML = md(m.content || '');
        if (m.artifact) renderArtifactCard(el, m.artifact);
        if (m.options) renderOptionsCard(el, m.options);
        addActions(el);
      }
    }
  }
  scrollBottom();
}

/* ================= 起名（欢迎区入口触发，不再大气泡霸屏） ================= */
function askName(force) {
  if (!force && (localStorage.getItem('qz_asked_name') === '1' || localStorage.getItem('qz_name'))) return;
  showMsgs();
  const cur = localStorage.getItem('qz_name');
  const msg = cur
    ? `想让我改叫啥？说一个，我马上换。`
    : `我还没名字呢，你给起一个呗？两三个字顺口就行。`;
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
    say('太长啦，两到四个字顺口。再想一个？');
    state.awaitName = true; return false;
  }
  localStorage.setItem('qz_name', n);
  document.querySelector('.hd-title').textContent = n;
  const ok = `成，以后我就叫「${n}」了。\n想改随时说声「改个名字」。`;
  say(ok); renderList(); renderNameEntry(); state.awaitName = false; return true;
}
// 欢迎区的起名入口卡：未命名时显示
function renderNameEntry() {
  const card = $('#nameEntry');
  if (!card) return;
  const named = !!localStorage.getItem('qz_name');
  card.hidden = named;
  if (!named) card.textContent = '✍️ 还没名字 · 点一下给 TA 起一个';
}

/* ================= 首屏示例 + 灵感 ================= */
function renderList() {
  const named = !!localStorage.getItem('qz_name');
  const ex = [
    named
      ? { t: `换个名字`, s: `现在是「${name()}」`, act: 'name' }
      : { t: `连上电脑`, s: '局域网或远程都行', act: 'connect' },
    { t: '查商品现价比价', s: '联网查 · 当场出结果', q: '帮我联网查一下这个商品现在的价格：' },
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
      if (it.act === 'connect') { switchTab('connect'); return; }
      switchTab('chat');
      txt.value = it.q; txt.dispatchEvent(new Event('input')); send();
    };
    box.appendChild(b);
  }
}

/* 灵感图标：AI 生成的软 3D 套图（idea-*.png），动态建议按 cat 映射到同一套 */
const IDEA_ICONS = {
  price: './icons/idea-price.png',
  edit: './icons/idea-edit.png',
  search: './icons/idea-search.png',
  pc: './icons/idea-pc.png'
};
const DEFAULT_IDEAS = [
  { t: '盯价格 / 比价', s: '把商品链接发我，当场查现价比价', cat: 'price', q: '帮我联网查一下这个商品现在的价格：' },
  { t: '改文案 / 润色', s: '贴一段文字，我帮你改专业或口语', cat: 'edit', q: '把下面这段话改得更专业：\n' },
  { t: '联网搜最新', s: '问时事、查资料、比价格', cat: 'search', q: '帮我联网搜一下最新的：' },
  { t: '连电脑干活', s: '远程让电脑跑任务、读本地文件', cat: 'pc', q: '帮我在电脑上查一下：' }
];
function ideaIcon(it, i) {
  if (it && typeof it.icon === 'string' && /\.png\s*$/i.test(it.icon)) return it.icon;
  if (it && it.cat && IDEA_ICONS[it.cat]) return IDEA_ICONS[it.cat];
  return Object.values(IDEA_ICONS)[(i || 0) % 4];
}
function renderIdeas(list) {
  const box = $('#ideaList'); if (!box) return;
  const arr = list || DEFAULT_IDEAS;
  box.innerHTML = '';
  arr.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'idea';
    b.innerHTML = `<div class="ico"><img src="${ideaIcon(it, i)}" alt="" loading="lazy"></div><div><div class="it">${esc(it.t)}</div><div class="is">${esc(it.s || '')}</div></div>`;
    b.onclick = () => {
      switchTab('chat');
      const q = it.q || it.t;
      txt.value = q; txt.dispatchEvent(new Event('input')); send();
    };
    box.appendChild(b);
  });
}
async function genIdeas() {
  const box = $('#ideaList');
  box.innerHTML = '<p class="tip">正在让 AI 帮你想想能帮你做什么…</p>';
  const prompt = '你是轻舟（用户的私人手机助手）。请给 4 条"轻舟能帮普通用户做的事"的具体建议。'
    + '每条返回 JSON：{"t":"简短标题(不超过12个字)","s":"为什么值得做(一句话)","cat":"从 price/edit/search/pc 四选一","q":"用户点这条时应自动发出的示例问句"}。'
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
function chatRemote(text, onDelta, onSync, image, model, regenerate, onStep) {
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
      else if (t === 'tool_start') { if (onStep) onStep(payload.name || '工具', 'run', payload.preview || ''); }
      else if (t === 'tool_result') { if (onStep) onStep(payload.name || '工具', 'done', payload.summary || '', payload.ok); }
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
  // 正在等起名：只有"短且不像一句话"的输入才当名字（修"一根筋"：问句/长句/带图走正常聊天）
  if (state.awaitName && text && !pendingImage) {
    const looksLikeName = text.length <= 8 && !/[。！？?！!，,、]/.test(text);
    if (looksLikeName) { showMsgs(); addMsg('me', text); clearAttach(); setName(text); return; }
    state.awaitName = false;   // 用户没在起名，问什么答什么
  }
  if (text && /^(改|换)(个|一下)?名字$|^重命名$|^换个名字吧?$/.test(text)) {
    showMsgs(); addMsg('me', text); clearAttach(); setTimeout(() => askName(true), 150); return;
  }
  showMsgs();
  addMsg('me', text || '（图片）');
  pushUser(text || '（发了一张图片）');
  lastUserText = text;
  await runChat(text, img, false);
}
async function runChat(text, img, isRegen) {
  streaming = true; setBusy(true); startRate(); setStatus('在想…');
  let stopped = false;
  const ctl = new AbortController();
  let remoteStopFn = null;
  streamStop = () => { stopped = true; try { ctl.abort(); } catch {} if (remoteStopFn) remoteStopFn(); };
  const el = addMsg('ai', '', { thinking: true });
  const bub = el.querySelector('.bub');
  let acc = '';
  const paint = () => { bub.innerHTML = md(acc); scrollBottom(); };
  try {
    // 带图轮：电脑上的本地模型基本是纯文本，图片统一交给云端视觉模型识别（三种模式都通）
    if (img) {
      if (state.mode !== 'cloud') toast('图片由云端模型识别（电脑模型暂不支持看图）');
      acc = await chatCloud(sanitizeHistory(state.cur.msgs), ctl.signal, img);
      paint(); pushAI(acc); persist();
    } else if (state.mode === 'cloud') {
      acc = await chatCloud(sanitizeHistory(state.cur.msgs), ctl.signal);
      const g = takeGenMark(acc);
      if (g && g.prompt) {
        acc = g.clean; paint(); pushAI(acc); persist();
        await genAndShow(g.type, g.prompt);   // 模型说了要生成，这里真的去做
      } else {
        paint(); pushAI(acc); persist();
      }
    } else if (state.mode === 'lan') {
      await chatLan(text, d => { acc += d; tickRate(d.length); paint(); }, img, ctl.signal, isRegen);
      if (!acc && !stopped) acc = '(没有回复)';
      const gl = takeGenMark(acc);
      // 兜底：电脑没真生成（回复里没 [media:...]）却带了生成标记，手机端自己走云模型补上
      if (gl && gl.prompt && !stopped && !/\[media:(image|video)\]/.test(acc)) {
        acc = gl.clean; paint(); pushAI(acc); persist();
        await genAndShow(gl.type, gl.prompt);
      } else { paint(); if (acc) { pushAI(acc); persist(); } }
    } else {
      // 流程卡：电脑端每执行一个工具，就在 AI 消息下方实时显示"工具名 + 执行中/结果摘要"
      let stepCard = null;
      const onStep = (name, st, summary, ok) => {
        if (!stepCard || !stepCard.isConnected) {
          stepCard = document.createElement('div');
          stepCard.className = 'stepcard';
          el.after(stepCard);
        }
        let row = stepCard.querySelector(`[data-n="${CSS.escape(name)}"]`);
        if (!row) {
          row = document.createElement('div');
          row.className = 'step';
          row.dataset.n = name;
          row.innerHTML = `<span class="si">⚙️</span><span class="sn">${esc(name)}</span><span class="ss">执行中…</span>`;
          stepCard.appendChild(row);
        }
        const si = row.querySelector('.si'), ss = row.querySelector('.ss');
        if (st === 'run') {
          row.classList.add('running'); si.textContent = '⚙️'; ss.textContent = summary ? `执行中 · ${summary}` : '执行中…';
          setStatus(`正在用「${name}」…`);
          // 电脑在动浏览器 → 自动把画面推给手机看（用户能实时盯着，也能随手接管）
          if (/^browser_/.test(String(name)) && state.mode === 'remote' && !window.__vpAuto) {
            window.__vpAuto = 1; vpOpen();
          }
        } else {
          row.classList.remove('running'); si.textContent = ok === false ? '⚠️' : '✅';
          ss.textContent = ok === false ? `失败 · ${summary || '出错了'}` : (summary || '完成');
          setStatus('');
          pushAct(name + (ok === false ? ' 失败' : ' 完成') + (summary ? '：' + summary : ''), ok);
        }
      };
      const r = chatRemote(text,
        d => { acc += d; tickRate(d.length); paint(); },
        full => { acc = full; paint(); },
        img, state.model, isRegen, onStep);
      remoteStopFn = r.stop;
      await r.promise;
      if (!acc && !stopped) acc = '(电脑没有回复)';
      const g = takeGenMark(acc);
      // 兜底：电脑没真生成却带了生成标记，手机端自己走云模型补上（双保险，不依赖电脑工具链）
      if (g && g.prompt && !stopped && !/\[media:(image|video)\]/.test(acc)) {
        acc = g.clean; paint(); pushAI(acc); persist();
        await genAndShow(g.type, g.prompt);
      } else {
        paint();
        if (acc && !r.ctl.errored && !stopped) { pushAI(acc); persist(); }
      }
    }
  } catch (e) {
    if (stopped) { if (!acc) { acc = '(已停止)'; paint(); } }
    else { acc = '出错：' + e.message; paint(); }
  }
  stopRate(); setStatus('');
  // 解析结构化标记：把 [options:...] 选择卡片 / [artifact:...] 预览从正文里抠出来，
  // 转成结构化卡片，避免历史里留一堆机器标记。
  if (!stopped) {
    const am = [...(state.cur.msgs || [])].reverse().find(x => x.role === 'assistant' && !/^\[media:/.test(x.content || ''));
    const art = takeArtifactMark(acc), om = takeOptionsMark(acc);
    if (am) {
      if (art) { acc = art.clean; am.content = acc; am.artifact = art; }
      if (om) { acc = om.clean; am.content = acc; am.options = om.data; }
    }
    if (art || om) { bub.innerHTML = md(acc); persist(); }
    if (art) renderArtifactCard(el, art);
    if (om) renderOptionsCard(el, om.data);
  }
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
    + `7. 接到多步骤的活，先用一行说清"我打算分几步"，再逐步给结果——让人知道进展到哪了，而不是闷头憋大招。\n`
    + `8. 用户让你做就直接做，别反复确认；只有涉及花钱、发消息、删东西这类才先问一句。\n`
    + `9. 被问"你能干嘛/帮我做点什么"，结合上下文举 2-3 个具体例子，别只说"我什么都能做"。\n\n`
    + `要生成图片/视频时（用户说"画一张…""生成一段…视频"）：\n`
    + `- 不要自己描述画面或说"我画不了"，直接输出一行指令，系统会真的去生成并把图/视频贴出来：\n`
    + `  图片：[[生成图片]]一句话描述画面（越具体越好，可中英混排）\n`
    + `  视频：[[生成视频]]一句话描述画面\n`
    + `- 指令独占一行，前后可以有一句自然的说明（比如"好，我画一个——"），但不要假装已经画好了。`;
}
/* 长对话压缩：超过 24 条或 12000 字时，早期消息压成"每轮一行"的摘要，保留最近 12 条完整。
   摘要放最前（user 角色，满足"首条必须是 user"），模型仍知道之前聊过什么，token 却稳得住。 */
function compressHistory(hist, maxMsgs = 24, maxChars = 12000) {
  const total = hist.reduce((n, m) => n + String(m.content || '').length, 0);
  if (hist.length <= maxMsgs && total <= maxChars) return hist;
  const keep = 12;
  const early = hist.slice(0, hist.length - keep);
  if (early.length < 3) return hist;   // 太少不值得压
  const digest = early
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${String(m.content).replace(/\s+/g, ' ').slice(0, 60)}`)
    .join('\n')
    .slice(0, 3000);
  const summary = {
    role: 'user',
    content: `（此前对话摘要，共 ${early.length} 条，已省略细节）\n${digest}\n（摘要结束，以下为最近对话）`
  };
  return [summary, ...hist.slice(-keep)];
}

async function chatCloud(messages, signal, image) {
  let hist = sanitizeHistory(messages);
  if (!hist.length) return '(没有可发送的内容)';
  hist = compressHistory(hist);   // 长对话自动压缩，防 token 爆炸
  // 带图：把最后一条 user 消息转成 OpenAI vision 多模态格式（实测 agnes-2.0-flash 支持）
  if (image) {
    const last = hist[hist.length - 1];
    if (last && last.role === 'user') {
      const t = (last.content && !/发了一张图片/.test(last.content)) ? last.content : '请看这张图片，结合我的问题回答。';
      last.content = [
        { type: 'text', text: t },
        { type: 'image_url', image_url: { url: image } }
      ];
    }
  }
  // 云端可能被切成了手动接入的自定义模型（Base URL / Key / 模型名都换掉）
  const cf = activeCloud();
  let r;
  try {
    r = await fetch(cf.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cf.key, apikey: cf.key },
      body: JSON.stringify({ model: cf.model, messages: [{ role: 'system', content: sysPrompt() }, ...hist] }),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上「' + cf.name + '」（' + (e.message || '网络错误') + '）');
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) {
    const detail = j?.error?.message || j?.message || '';
    throw new Error('「' + cf.name + '」没响应（' + r.status + '）' + (detail ? '：' + String(detail).slice(0, 140) : ''));
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
    const cs = allCustom();
    const customOpts = cs.map(c => `<option value="custom:${c.id}">我的 · ${esc(c.name)}（${esc(c.model)}）</option>`).join('');
    sel.innerHTML = CLOUD_MODELS.map(m => `<option value="${m}">云端 · ${m}</option>`).join('') + customOpts;
    cur = state.cloudModel || CLOUD.model;
    $('#modelTip').textContent = cs.length
      ? '云端模型 + 你手动接入的模型，切换后下一句生效。'
      : '默认用轻舟云端模型。点「手动接入」可以接你自己的（DeepSeek / 通义 / Kimi / 本地等）。';
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
  const sp = document.createElement('button');
  sp.type = 'button'; sp.textContent = '朗读'; sp.dataset.speak = '0';
  sp.onclick = () => toggleSpeak(sp, el.querySelector('.bub').innerText);
  const rg = document.createElement('button');
  rg.type = 'button'; rg.textContent = '重新生成';
  rg.onclick = () => { stopSpeak(); regenerate(el); };
  bar.appendChild(cp); bar.appendChild(sp); bar.appendChild(rg);
  el.appendChild(bar);
}

/* ================= TTS 朗读（APK 用原生插件，网页用 speechSynthesis） ================= */
let speakBtn = null;
function cleanForTTS(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '，代码略，')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\|/g, '，').replace(/[#*_>~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '链接')
    .slice(0, 900);
}
async function toggleSpeak(btn, text) {
  if (btn.dataset.speak === '1') { stopSpeak(); return; }
  stopSpeak();
  const clean = cleanForTTS(text);
  if (!clean.trim()) { toast('这段没有可朗读的内容'); return; }
  const TTS = window.Capacitor?.Plugins?.TextToSpeech;
  try {
    if (TTS) {
      await TTS.speak({ text: clean, language: 'zh-CN', rate: 1.0, pitch: 1.0 });
    } else if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'zh-CN'; u.rate = 1.0;
      u.onend = () => resetSpeakBtn();
      u.onerror = () => resetSpeakBtn();
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else { toast('当前环境不支持朗读'); return; }
    speakBtn = btn; btn.dataset.speak = '1'; btn.textContent = '停止';
  } catch (e) { toast('朗读失败：' + (e.message || '未知')); }
}
function stopSpeak() {
  const TTS = window.Capacitor?.Plugins?.TextToSpeech;
  try { if (TTS) TTS.stop(); } catch {}
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch {}
  resetSpeakBtn();
}
function resetSpeakBtn() {
  if (speakBtn) { speakBtn.dataset.speak = '0'; speakBtn.textContent = '朗读'; speakBtn = null; }
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
    const row = document.createElement('div');
    row.className = 'histrow' + (state.cur && s.id === state.cur.id ? ' cur' : '');
    const b = document.createElement('button');
    b.className = 'histitem';
    b.innerHTML = `<span class="ht">${esc(s.title || '(空对话)')}</span><span class="hs">${(s.msgs || []).length} 条 · ${fmtTime(s.updatedAt)}</span>`;
    b.onclick = () => openLocalSession(s.id);
    const del = document.createElement('button');
    del.className = 'hdel'; del.type = 'button'; del.textContent = '删';
    del.setAttribute('aria-label', '删除这条对话');
    del.onclick = e => { e.stopPropagation(); delSession(s.id); };
    row.appendChild(b); row.appendChild(del);
    box.appendChild(row);
  }
}
function delSession(id) {
  const s = allSessions().find(x => x.id === id);
  if (!s) return;
  if (!confirm('删除「' + (s.title || '这条对话') + '」？删了找不回来。')) return;
  const all = allSessions().filter(x => x.id !== id);
  writeSessions(all);
  if (state.cur && state.cur.id === id) { newSession(); renderCur(); renderList(); }
  renderLocalHistory();
  toast('已删除');
}
function clearSessions() {
  const all = allSessions();
  if (!all.length) { toast('没有可清空的对话'); return; }
  if (!confirm('清空全部 ' + all.length + ' 条历史对话？删了找不回来。')) return;
  writeSessions([]);
  newSession(); renderCur(); renderList(); renderLocalHistory();
  toast('已全部清空');
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
function renderPCList(list) {
  histLog('');
  const box = $('#histList'); box.innerHTML = '';
  if (!list.length) { histLog('电脑上还没有会话。'); return; }
  for (const s of list.slice(0, 60)) {
    const b = document.createElement('button');
    b.className = 'histitem';
    b.innerHTML = `<span class="ht">${esc(s.title || '(无标题)')}</span><span class="hs">${s.count || (s.msgs || []).length || 0} 条 · ${fmtTime(s.updatedAt)}</span>`;
    b.onclick = () => openPCSession(s.id, s.title);
    box.appendChild(b);
  }
}
async function loadPCHistory() {
  if (state.mode === 'lan') {
    histLog('正在读取电脑上的会话…');
    try {
      const r = await fetch(`http://${state.ip}:${PORT}/api/sessions`, { cache: 'no-store' });
      const j = await r.json();
      renderPCList(j.sessions || []);
    } catch (e) { histLog('读取失败：' + e.message); }
    return;
  }
  if (state.mode !== 'remote') { histLog('先连上电脑（局域网或远程）才能读它的会话。'); return; }
  histLog('正在读取电脑上的会话…');
  try {
    const r = await remoteQuery({ cmd: 'list_sessions' }, 'sessions');
    renderPCList(r.list || []);
  } catch (e) { histLog('读取失败：' + e.message); }
}
async function openPCSession(id, title) {
  histLog('正在打开…');
  let messages = [];
  try {
    if (state.mode === 'lan') {
      const r = await fetch(`http://${state.ip}:${PORT}/api/sessions/get?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const j = await r.json();
      messages = (j.session && j.session.messages) || [];
    } else {
      const r = await remoteQuery({ cmd: 'open_session', sessionId: id }, 'session_data');
      messages = r.messages || [];
    }
    newSession();
    const tip = { role: 'assistant', content: `（从电脑打开的会话：${title || ''}）` };
    state.cur.msgs.push(tip);
    for (const m of messages) {
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
      // 前置检测：部分国产系统（vivo/OPPO 等）没有预装语音识别服务，权限过了也起不来
      try {
        const av = await CapSR.available();
        if (av && av.available === false) { micUnavailable(); return; }
      } catch {}
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
      const msg = e.message || '';
      if (/permission|权限/i.test(msg)) toast('麦克风权限被拒绝，去系统设置里允许');
      else if (/not available|service/i.test(msg)) micUnavailable();
      else toast('语音识别没启动：' + msg);
    }
    return;
  }
  // 回退：Web Speech API（PWA / 桌面浏览器）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micUnavailable(); return; }
  rec = new SR();
  rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
  rec.onresult = e => { let s = ''; for (const r of e.results) s += r[0].transcript; txt.value = s; txt.dispatchEvent(new Event('input')); };
  rec.onend = () => { micOn = false; setMicOn(false); };
  rec.onerror = e => { micOn = false; setMicOn(false); if (e.error === 'not-allowed') toast('麦克风权限被拒绝'); if (e.error === 'service-not-allowed') micUnavailable(); };
  micOn = true; setMicOn(true);
  try { rec.start(); } catch { micOn = false; setMicOn(false); }
}
// 这台设备没有可用的语音识别服务：给明确指引，别让用户看英文报错发懵
function micUnavailable() {
  toast('这台手机的系统没带语音识别服务（部分国产手机如此）。可以用输入法自带的语音键说话，或直接打字。');
}
function stopVoice() {
  try { if (window.Capacitor?.Plugins?.SpeechRecognition) window.Capacitor.Plugins.SpeechRecognition.stop(); } catch {}
  if (rec) try { rec.stop(); } catch {}
  micOn = false; setMicOn(false);
  if (micListener) { try { micListener.remove(); } catch {} micListener = null; }
}

$('#micBtn').onclick = startVoice;
$('#attBtn').onclick = () => $('#fileInput').click();
/* 生成图片/视频：手机上不再有按钮，全部由 AI 决定。
   云端模式让模型在回复里带 [[生成图片]] 标记，前端识别后走云模型执行。
   远程/局域网模式优先交给电脑的 ai_image / ai_video 工具（走在线模型）；
   若电脑没真生成（回复只带标记没带 [media:]），手机端兜底走云模型补上，双保险。 */
async function genAndShow(type, prompt) {
  showMsgs();
  const el = addMsg('ai', '', { thinking: true });
  const bub = el.querySelector('.bub');
  setStatus(type === 'image' ? '正在生成图片…' : '正在生成视频…');
  try {
    if (type === 'image') {
      const url = await createImage(prompt);
      state.cur.msgs.push({ role: 'assistant', content: '[media:image]' + url });
      bub.innerHTML = `<img class="media" src="${esc(url)}" alt="生成图片">`;
    } else {
      const url = await createVideo(prompt, (p, st) => {
        bub.innerHTML = `<span class="typing"><i></i><i></i><i></i></span> 生成中 ${p || 0}%${st ? '（' + st + '）' : ''}`;
      });
      state.cur.msgs.push({ role: 'assistant', content: '[media:video]' + url });
      bub.innerHTML = `<video class="media" src="${esc(url)}" controls></video>`;
    }
    pushAct((type === 'image' ? '生成图片' : '生成视频') + '：' + String(prompt).slice(0, 26));
    setStatus('');
    addActions(el); persist();
  } catch (e) {
    setStatus('');
    bub.textContent = '生成出错：' + e.message;
    addActions(el);
  }
}
// 从模型回复里抠出生成指令（模型说了才做，不靠猜）
function takeGenMark(s) {
  const m = String(s || '').match(/\[\[\s*(生成图片|生图|图片|生成视频|生视频|视频)\s*\]\s*([^\n]*)/);
  if (!m) return null;
  const isVideo = /视频/.test(m[1]);
  const prompt = (m[2] || '').trim();
  const clean = String(s).replace(m[0], '').trim();
  return { type: isVideo ? 'video' : 'image', prompt, clean };
}
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
$('#clearHist') && ($('#clearHist').onclick = clearSessions);
$('#nameSaveBtn').onclick = () => {
  const v = ($('#nameInput').value || '').trim().replace(/[。！？.!?，,、\s]/g, '').slice(0, 8);
  if (!v) { toast('先填个名字'); return; }
  localStorage.setItem('qz_name', v);
  localStorage.setItem('qz_asked_name', '1');
  document.querySelector('.hd-title').textContent = v;
  state.awaitName = false;
  renderList(); renderNameEntry();
  toast('好，以后就叫「' + v + '」');
};
$('#nameEntry').onclick = () => { switchTab('chat'); setTimeout(() => askName(true), 150); };

/* ================= 主动找我：推送订阅 + 轮询兜底 =================
   两条路都走，谁先用上算谁的：
   1) Web Push：浏览器 / 加到主屏幕后，App 关着也能收到（安卓 Chrome、iOS 16.4+ 支持）。
   2) 轮询：APK 内置的 WebView 里 Web Push 通常不可用，就靠每分钟查一次到期提醒，
      App 开着（含后台）时弹通知。 */
const PUSH = {
  vapid: 'BCUf47GTpILOh890wwy7L3IJAKA2u7SyEf0I-27W_NuQgQFPHUS1bZwT0DRPxEl5hsMcYj3wD31vdexPvFsILys',
  fn: 'https://wcnssyiqitugqfmcbdhe.functions.supabase.co/push-send'
};
function deviceId() {
  let id = localStorage.getItem('qz_device');
  if (!id) { id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('qz_device', id); }
  return id;
}
function b64urlToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function pushLog(s) { const e = $('#pushLog'); if (e) e.textContent = s || ''; }
function sbClient() {
  if (!window.supabase) throw new Error('云端组件没加载（网络不通）');
  return window.supabase.createClient(SB.url, SB.key, { auth: { persistSession: false } });
}

// 是不是装在原生 App 里（安卓 APK）？原生里 WebView 不支持 Web Push，得用原生通知
function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function LN() {
  return (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins.LocalNotifications : null;
}

// 统一"弹一条状态栏通知"：原生优先，浏览器兜底
async function notify(title, body) {
  const ln = LN();
  if (ln) {
    try {
      let perm = await ln.checkPermissions();
      if (perm.display !== 'granted') perm = await ln.requestPermissions();
      if (perm.display === 'granted') {
        await ln.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 100000),
            title: title || '轻舟',
            body: body || '',
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#1d4ed8',
            schedule: { at: new Date(Date.now() + 300) }
          }]
        });
        return true;
      }
    } catch (_) { /* 掉到下面的浏览器兜底 */ }
  }
  try {
    if (window.Notification && Notification.permission === 'granted') {
      new Notification(title || '轻舟', { body: body || '', icon: 'icons/onboard-cloud.png' });
      return true;
    }
  } catch (_) {}
  return false;
}

async function pushState() {
  if (isNative()) {
    const ln = LN();
    if (!ln) return 'unsupported';
    try {
      const p = await ln.checkPermissions();
      return p.display === 'granted' ? 'on' : 'off';
    } catch { return 'off'; }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // 有些内置浏览器不支持推送，但照样能用通知权限（退回本地轮询通知）
    return (window.Notification && Notification.permission === 'granted') ? 'on' : 'off';
  }
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return (window.Notification && Notification.permission === 'granted') ? 'on' : 'off';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return (window.Notification && Notification.permission === 'granted') ? 'on' : 'off';
  return Notification.permission === 'granted' ? 'on' : 'blocked';
}

async function enablePush() {
  pushLog('正在开启…');
  // ① 原生 App：申请系统通知权限（状态栏通知）
  if (isNative()) {
    const ln = LN();
    if (!ln) { pushLog('这个安装包没带通知组件，需要重新打个新版本。'); return false; }
    try {
      let perm = await ln.checkPermissions();
      if (perm.display !== 'granted') perm = await ln.requestPermissions();
      if (perm.display !== 'granted') { pushLog('你没允许通知权限，去系统设置里给轻舟打开通知。'); return false; }
      localStorage.setItem('qz_push', '1');
      pushLog('已开启系统通知。轻舟现在能主动提醒你（App 挂着就能收到）。');
      return true;
    } catch (e) { pushLog('开启失败：' + e.message); return false; }
  }
  // ② 浏览器：优先 Web Push（关掉 App 也能收到）
  try {
    const perm = (window.Notification && Notification.requestPermission) ? await Notification.requestPermission() : 'denied';
    if (perm !== 'granted') { pushLog('你没允许通知权限，推不了。'); return false; }
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToU8(PUSH.vapid) });
      }
      const j = sub.toJSON();
      const { error } = await sbClient().from('qz_push_subs').upsert({
        device: deviceId(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth
      }, { onConflict: 'endpoint' });
      if (error) throw new Error(error.message);
      localStorage.setItem('qz_push', '1');
      pushLog('已开启。App 关着也能收到。');
      return true;
    }
    localStorage.setItem('qz_push', '1');
    pushLog('已开启通知（这个浏览器不支持后台推送，App 开着时能收到提醒）。');
    return true;
  } catch (e) { pushLog('开启失败：' + e.message); return false; }
}

async function pushTest() {
  pushLog('正在发一条测试提醒…');
  // 先在本地弹一条（原生状态栏 / 浏览器通知都能看到），最直接
  const ok = await notify('轻舟在主动找你', '推送通了。到点我就会这样提醒你。');
  if (ok) pushLog('已发到系统通知栏，看看手机顶上有没有。');
  // 浏览器端再走一次云端 Web Push（关掉 App 也能收到的那条通道）
  if (!isNative()) {
    try {
      const r = await fetch(PUSH.fn, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '轻舟在主动找你', body: '推送通了。到点我就会这样提醒你。' })
      });
      const j = await r.json().catch(() => ({}));
      if (j && j.ok) pushLog(`已发出（送到 ${j.sent || 0} 台设备）`);
      else if (!ok) pushLog('发送失败：' + (j?.error || r.status));
    } catch (e) { if (!ok) pushLog('发送失败：' + e.message); }
  }
  if (!ok) pushLog('没能弹出通知：可能权限没开。');
}

// 轮询兜底：查到期的提醒，弹通知并标记已送（APK 里主要靠这个）
let _dueBusy = false;
async function checkDue() {
  if (_dueBusy) return;
  _dueBusy = true;
  try {
    const sb = sbClient();
    const { data, error } = await sb.from('qz_triggers')
      .select('id,title,body').eq('sent', false).lte('fire_at', new Date().toISOString()).limit(10);
    if (error || !data || !data.length) return;
    for (const t of data) {
      const ok = await notify(t.title, t.body);
      if (!ok) toast('⏰ ' + t.title + (t.body ? '：' + t.body : ''));
      await sb.from('qz_triggers').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', t.id);
    }
  } catch (_) { /* 云端连不上就算了，下次再试 */ } finally { _dueBusy = false; }
}

function renderPushBtn() {
  const b = $('#pushBtn'); if (!b) return;
  pushState().then(s => {
    if (s === 'unsupported') { b.textContent = '此浏览器不支持推送'; b.disabled = true; return; }
    b.textContent = s === 'on' ? '推送已开启' : s === 'blocked' ? '通知被系统拦了' : '开启推送提醒';
    b.classList.toggle('primary', s !== 'on');
  });
}
$('#pushBtn') && ($('#pushBtn').onclick = async () => { await enablePush(); renderPushBtn(); });
$('#pushTestBtn') && ($('#pushTestBtn').onclick = pushTest);
renderPushBtn();
// 注册 SW（轮询和推送都靠它）并启动轮询
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
setTimeout(checkDue, 3000);
setInterval(checkDue, 60000);

/* ================= 模型：手动接入 / 测试 / 删除 ================= */
function mlog(s) { const e = $('#modelLog'); if (e) e.textContent = s || ''; }
function fillPresets() {
  const sel = $('#cmPreset'); if (!sel) return;
  sel.innerHTML = '<option value="">选个模板自动填…</option>'
    + MODEL_PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
}
$('#cmPreset') && ($('#cmPreset').onchange = e => {
  const i = e.target.value; if (i === '') return;
  const p = MODEL_PRESETS[+i]; if (!p) return;
  $('#cmName').value = p.name; $('#cmBase').value = p.baseUrl; $('#cmModel').value = p.model; $('#cmKey').value = '';
  mlog(`已填入「${p.name}」的地址和模型名，只差 API Key。`);
});
$('#modelAddBtn') && ($('#modelAddBtn').onclick = () => { $('#modelForm').hidden = false; mlog(''); });
$('#cmCancelBtn') && ($('#cmCancelBtn').onclick = () => { $('#modelForm').hidden = true; mlog(''); });
$('#cmSaveBtn') && ($('#cmSaveBtn').onclick = async () => {
  const c = {
    id: 'm' + Date.now().toString(36),
    name: ($('#cmName').value || '').trim(),
    baseUrl: ($('#cmBase').value || '').trim(),
    key: ($('#cmKey').value || '').trim(),
    model: ($('#cmModel').value || '').trim()
  };
  if (!c.name || !c.baseUrl || !c.model) { mlog('名字、Base URL、模型名三项都得填。'); return; }
  const a = allCustom(); a.push(c); saveCustom(a);
  state.cloudModel = 'custom:' + c.id;
  localStorage.setItem('qz_cloud_model', state.cloudModel);
  fillModels(); $('#modelForm').hidden = true;
  mlog('正在测试连接…');
  try { mlog('已保存 · ' + await testCustom(c)); }
  catch (e) { mlog('已保存，但连不上：' + e.message); }
});
$('#modelTestBtn') && ($('#modelTestBtn').onclick = async () => {
  const m = String(state.cloudModel || CLOUD.model);
  if (m.indexOf('custom:') !== 0) {
    mlog('正在测试内置模型 ' + m + ' …');
    try {
      const r = await fetch(CLOUD.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.key, apikey: CLOUD.key },
        body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 })
      });
      const j = await r.json().catch(() => null);
      mlog(r.ok ? ('连通 · ' + (j?.model || m)) : ('失败：' + String(j?.error?.message || ('HTTP ' + r.status))));
    } catch (e) { mlog('失败：' + e.message); }
    return;
  }
  const c = allCustom().find(x => x.id === m.slice(7));
  if (!c) { mlog('没找到这个自定义模型。'); return; }
  mlog('正在测试「' + c.name + '」…');
  try { mlog(await testCustom(c)); } catch (e) { mlog('连不上：' + e.message); }
});
$('#modelDelBtn') && ($('#modelDelBtn').onclick = () => {
  const m = String(state.cloudModel || '');
  if (m.indexOf('custom:') !== 0) { mlog('当前是轻舟内置模型，删不了。'); return; }
  saveCustom(allCustom().filter(x => x.id !== m.slice(7)));
  state.cloudModel = ''; localStorage.setItem('qz_cloud_model', '');
  fillModels(); mlog('已删除，切回轻舟云端模型。');
});

/* ================= 形象：AI 生成 / 相册 / 还原 ================= */
function alog(s) { const e = $('#avaLog'); if (e) e.textContent = s || ''; }
$('#avaGenBtn') && ($('#avaGenBtn').onclick = async () => {
  const sel = $('#avaStyle');
  const style = sel ? sel.value : 'soft3d';
  const label = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].text : '卡通';
  alog('正在生成，大约十几秒…');
  setStatus('正在生成头像…');
  try {
    await genAvatar(style);
    setStatus('');
    pushAct('生成头像（' + label + '）');
    alog('头像换好了。');
    toast('新头像生成好了');
  } catch (e) {
    setStatus('');
    alog('生成失败：' + e.message);
    toast('头像生成失败');
  }
});
$('#avaPickBtn') && ($('#avaPickBtn').onclick = () => $('#avaFile').click());
$('#avaFile') && ($('#avaFile').onchange = async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    setAvatar(await pickAvatarFile(f));
    pushAct('更换头像（从相册）');
    alog('已换成你选的图。');
  } catch (err) { alog('失败：' + err.message); }
  e.target.value = '';
});
$('#avaResetBtn') && ($('#avaResetBtn').onclick = () => { setAvatar(null); alog('已还原成默认形象。'); });

/* ================= 活动记录面板 ================= */
$('#hdAva') && ($('#hdAva').onclick = () => {
  const p = $('#actPanel'); if (!p) return;
  p.hidden = !p.hidden;
  if (!p.hidden) renderActs();
});
$('#actClose') && ($('#actClose').onclick = () => { $('#actPanel').hidden = true; });
$('#actPanel') && $('#actPanel').addEventListener('click', e => { if (e.target.id === 'actPanel') $('#actPanel').hidden = true; });

/* ================= 电脑浏览器画面：看得见 + 点着操作（登录/验证码在这过） ================= */
let vpTimer = null;
function vpMsg(s) { const m = $('#vpMsg'); if (m) { m.textContent = s || ''; m.style.display = s ? 'block' : 'none'; } }
async function vpFetch() {
  if (state.mode !== 'remote') { vpMsg('只有「远程连上电脑」才能看电脑浏览器的画面。'); return; }
  try {
    const r = await remoteQuery({ cmd: 'browser_view' }, 'browser_view', 25000);
    if (!r.ok) { vpMsg(r.error || '取画面失败'); return; }
    const img = $('#vpImg');
    img.src = r.dataUrl;
    img.style.display = 'block';
    vpMsg('');
    $('#vpUrl').textContent = (r.title ? r.title + ' · ' : '') + (r.url || '（空白页）');
  } catch (e) { vpMsg('取画面失败：' + e.message); }
}
async function vpTouch(o) {
  if (state.mode !== 'remote') { toast('要先远程连上电脑'); return null; }
  try { return await remoteQuery({ cmd: 'browser_touch', ...o }, 'browser_touch', 20000); }
  catch (e) { toast('操作失败：' + e.message); return null; }
}
function vpOpen() {
  const p = $('#viewPanel'); if (!p) return;
  p.hidden = false;
  vpFetch();
  if (vpTimer) clearInterval(vpTimer);
  vpTimer = setInterval(vpFetch, 2500);
}
function vpShut() {
  const p = $('#viewPanel'); if (p) p.hidden = true;
  if (vpTimer) { clearInterval(vpTimer); vpTimer = null; }
}
$('#vpOpenBtn') && ($('#vpOpenBtn').onclick = vpOpen);
$('#vpClose') && ($('#vpClose').onclick = vpShut);
$('#vpRefresh') && ($('#vpRefresh').onclick = vpFetch);
$('#vpBack') && ($('#vpBack').onclick = async () => { await vpTouch({ action: 'back' }); setTimeout(vpFetch, 900); });
$('#vpSignIn') && ($('#vpSignIn').onclick = async () => {
  toast('正在打开京东登录页…');
  await vpTouch({ action: 'goto', text: 'https://passport.jd.com/new/login.aspx' });
  setTimeout(vpFetch, 1800);
});
$('#vpStage') && ($('#vpStage').onclick = async e => {
  if (state.mode !== 'remote') return;
  const img = $('#vpImg');
  if (!img || !img.src || img.style.display === 'none') return;
  const r = img.getBoundingClientRect();
  if (!r.width) return;
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  await vpTouch({ action: 'tap', x: +x.toFixed(4), y: +y.toFixed(4) });
  setTimeout(vpFetch, 700);
});
$('#vpType') && ($('#vpType').onclick = async () => {
  const t = $('#vpText').value;
  if (!t) { toast('先输入要打的内容'); return; }
  await vpTouch({ action: 'input', text: t });
  $('#vpText').value = '';
  setTimeout(vpFetch, 700);
});
$('#vpEnter') && ($('#vpEnter').onclick = async () => { await vpTouch({ action: 'key', text: 'Enter' }); setTimeout(vpFetch, 1200); });

renderAvatar(); fillPresets();
boot();

/* ================= 智能选择卡片 [options:JSON] ================= */
// 从回复里抠出选择卡片的 JSON（单行、括号配平，内容里有 ] 也不怕）
function extractJsonBlock(s, startIdx) {
  if (s[startIdx] !== '{') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return { end: i, json: s.slice(startIdx, i + 1) }; }
  }
  return null;
}
function takeOptionsMark(s) {
  const m = String(s || '').match(/\[options:\s*/);
  if (!m) return null;
  const idx = m.index + m[0].length;
  if (s[idx] !== '{') return null;
  const blk = extractJsonBlock(s, idx);
  if (!blk) return null;
  let data; try { data = JSON.parse(blk.json); } catch { return null; }
  if (!data || !Array.isArray(data.items) || !data.items.length) return null;
  const clean = (s.slice(0, m.index) + s.slice(blk.end + 1)).trim();
  return { data, clean };
}
function chooseOption(v) {
  const t = String(v || '').trim();
  if (!t || streaming) return;
  showMsgs();
  addMsg('me', t); pushUser(t); lastUserText = t;
  runChat(t, null, false);
}
function renderOptionsCard(el, data) {
  if (!el || el.querySelector('.optcard')) return;
  const wrap = document.createElement('div');
  wrap.className = 'optcard';
  let html = '';
  if (data.q) html += `<div class="optq">${esc(data.q)}</div>`;
  html += '<div class="optlist">';
  for (const it of data.items.slice(0, 8)) {
    const label = it.label || it.value || '';
    const desc = it.desc || '';
    const rec = it.rec || it.recommend ? ' recommend' : '';
    const val = it.value != null ? it.value : label;
    html += `<button type="button" class="optitem${rec}" data-v="${esc(val)}"><span class="ol">${esc(label)}</span>${desc ? `<span class="od">${esc(desc)}</span>` : ''}${rec ? '<span class="otag">推荐</span>' : ''}</button>`;
  }
  html += `<button type="button" class="optitem other" data-other="1"><span class="ol">其他</span><span class="od">我来打字说</span></button>`;
  html += '</div>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('.optitem').forEach(b => {
    b.onclick = () => {
      if (b.dataset.other) { txt.focus(); txt.scrollIntoView({ block: 'center' }); return; }
      wrap.querySelectorAll('.optitem').forEach(x => x.classList.add('done'));
      b.classList.add('chosen');
      chooseOption(b.dataset.v);
    };
  });
  el.appendChild(wrap);
}

/* ================= 对话内实时预览 [artifact:类型|标题]\n内容\n[/artifact] ================= */
function takeArtifactMark(s) {
  const m = String(s || '').match(/\[artifact:([a-z]+)\|([^\]\n]*)\]\n([\s\S]*?)\n\[\/artifact\]/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const title = m[2].trim();
  const content = m[3];
  const clean = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  return { type, title, content, clean };
}
function renderArtifactCard(el, art) {
  if (!el || el.querySelector('.artcard')) return;
  const wrap = document.createElement('div');
  wrap.className = 'artcard';
  const kind = ({ html: '网页', svg: '图形', code: '代码', md: '文档', text: '文本' })[art.type] || '内容';
  const title = art.title || (kind + '预览');
  wrap.innerHTML = `<div class="arth"><span class="arti">📄 ${esc(title)}</span><span class="artk">${kind}</span></div>
    <div class="artbar">
      <button type="button" class="artbtn preview">预览</button>
      <button type="button" class="artbtn code">代码</button>
    </div>`;
  wrap.querySelector('.preview').onclick = () => openArtifact(art, 'preview');
  wrap.querySelector('.code').onclick = () => openArtifact(art, 'code');
  el.appendChild(wrap);
}
function openArtifact(art, tab) {
  const ov = $('#artOverlay'); if (!ov) return;
  ov.hidden = false;
  const t = $('#artTitle'); if (t) t.textContent = art.title || '预览';
  const stage = $('#artStage'); if (!stage) return;
  const show = (which) => {
    stage.innerHTML = '';
    if (which === 'preview' && (art.type === 'html' || art.type === 'svg')) {
      const f = document.createElement('iframe');
      f.className = 'artframe';
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      f.srcdoc = art.content;
      stage.appendChild(f);
    } else if (which === 'preview' && art.type === 'md') {
      const d = document.createElement('div'); d.className = 'artmd'; d.innerHTML = md(art.content); stage.appendChild(d);
    } else {
      const pre = document.createElement('pre'); pre.className = 'artcode'; pre.textContent = art.content; stage.appendChild(pre);
    }
    ov.querySelectorAll('.arttab').forEach(x => x.classList.toggle('on', x.dataset.tab === which));
  };
  ov.querySelectorAll('.arttab').forEach(x => x.onclick = () => show(x.dataset.tab));
  show(tab || 'preview');
}

/* ================= 版本与更新（手机版 / 电脑版分开） ================= */
function renderVersion() {
  const now = $('#verNow'); if (now) now.textContent = APP_VERSION;
  const box = $('#verPhone'); if (box) {
    box.innerHTML = PHONE_CHANGELOG.map(c => `<div class="veritem"><div class="verh">手机版 v${c.v} <span class="verd">${c.date}</span></div><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  }
  const pc = $('#verPc'); if (pc) {
    pc.innerHTML = PC_CHANGELOG.map(c => `<div class="veritem"><div class="verh">电脑版 v${c.v} <span class="verd">${c.date}</span></div><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  }
}
$('#artClose') && ($('#artClose').onclick = () => { const o = $('#artOverlay'); if (o) o.hidden = true; });
