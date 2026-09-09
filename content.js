/* content.js — harvest + provider-agnostic analysis.
 * v0.6: incremental (only-new) processing, Instagram-block auto-pause, background-run
 * keep-alive + done/stalled sounds, in-page status banner, thumbnail shrinking.
 * ========================== CALIBRATION ============================= */
const SEL = {
  postLinks:    'a[href*="/p/"], a[href*="/reel/"]',
  tileImg:      'img',
  carouselHint: 'svg[aria-label="Carousel"]',
  videoHint:    'svg[aria-label="Clip"], svg[aria-label="Video"], svg[aria-label="Reels"]'
};
const SCROLL_PAUSE = 3000;
const STALL_LIMIT  = 20;
const BASE_DELAY   = 6000;          // base gap between posts
const JITTER        = 3000;          // + up to this much random, to look less robotic to Instagram
const RETRY_BACKOFFS = [4000, 8000, 16000, 30000];
const THUMB_MAX = 240;               // shrink stored thumbnails to this width (keeps HTML small)
const CATEGORIES = [
  "AI & Claude tools", "Coding & Web dev", "Civic & current affairs",
  "Mental models & self-dev", "Finance", "Privacy & tech",
  "Design resources", "Memes & entertainment", "Learning resources"
];
const DEFAULT_BASEURL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL   = 'gemini-3.5-flash-lite';
/* =================================================================== */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sw = (type, payload = {}) => new Promise(res => chrome.runtime.sendMessage({ type, ...payload }, res));
const getState = () => chrome.storage.local.get(['igq_queue', 'igq_rows', 'igq_running']);
const setState = (obj) => chrome.storage.local.set(obj);
const isFail = (r) => /^\[(model error|parse error)\]/.test(r.visual_description || '');
const runningNow = async () => (await chrome.storage.local.get('igq_running')).igq_running;

function status(text) {
  chrome.runtime.sendMessage({ type: 'STATUS', text });
  updateBanner(text);
}
async function waitOrPause(ms) {
  const step = 500;
  for (let e = 0; e < ms; e += step) { if (!(await runningNow())) return false; await sleep(Math.min(step, ms - e)); }
  return await runningNow();
}
async function clearThumbs() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('igq_thumb_'));
  if (keys.length) await chrome.storage.local.remove(keys);
}
function parseJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (_) {} }
  return null;
}

/* ---------- sound + keep-awake (Web Audio; needs one click on the page) ---------- */
let audioCtx = null, keepNode = null;
function ensureAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
document.addEventListener('click', () => ensureAudio(), { once: false });
function startKeepAlive() {  // near-silent tone keeps Chrome from throttling this tab in the background
  const ctx = ensureAudio(); if (!ctx || keepNode) return;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  g.gain.value = 0.0008; osc.frequency.value = 440; osc.connect(g); g.connect(ctx.destination); osc.start();
  keepNode = { osc };
}
function stopKeepAlive() { if (keepNode) { try { keepNode.osc.stop(); } catch (_) {} keepNode = null; } }
function chime(seq) {
  const ctx = ensureAudio(); if (!ctx) return;
  const now = ctx.currentTime;
  seq.forEach(n => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = n.f; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, now + n.t);
    g.gain.exponentialRampToValueAtTime(0.25, now + n.t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.dur);
    o.start(now + n.t); o.stop(now + n.t + n.dur + 0.03);
  });
}
const playDone    = () => chime([{ f: 523, t: 0, dur: 0.16 }, { f: 659, t: 0.16, dur: 0.16 }, { f: 784, t: 0.32, dur: 0.28 }]); // cheerful, rising
const playStalled = () => chime([{ f: 320, t: 0, dur: 0.28 }, { f: 220, t: 0.32, dur: 0.45 }]); // low, falling = attention

/* ---------- in-page banner (progress you can see with the popup closed) ---------- */
function ensureBanner() {
  let b = document.getElementById('igq-banner');
  if (b) return b;
  b = document.createElement('div');
  b.id = 'igq-banner';
  b.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#111;color:#fff;padding:12px 14px;border-radius:12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:260px;cursor:pointer';
  b.title = 'Click once to enable sound and background running';
  b.addEventListener('click', () => ensureAudio());
  const x = document.createElement('span');
  x.textContent = '×'; x.style.cssText = 'float:right;margin-left:10px;opacity:.6';
  x.addEventListener('click', (e) => { e.stopPropagation(); b.remove(); });
  const t = document.createElement('span'); t.id = 'igq-banner-text';
  b.append(x, t);
  document.body.appendChild(b);
  return b;
}
function updateBanner(text) { const t = document.getElementById('igq-banner-text'); if (t) t.textContent = text; }

/* ---------- shrink a data-URL thumbnail (data URLs don't taint the canvas) ---------- */
function shrink(dataUrl) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, THUMB_MAX / (img.width || THUMB_MAX));
      const w = Math.round((img.width || THUMB_MAX) * scale), h = Math.round((img.height || THUMB_MAX) * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      try { c.getContext('2d').drawImage(img, 0, 0, w, h); res(c.toDataURL('image/jpeg', 0.7)); }
      catch (_) { res(dataUrl); }
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------- harvest (keeps existing results so re-runs only do NEW posts) ---------- */
async function harvest(opts = {}) {
  const limit = (opts.limit && opts.limit > 0) ? opts.limit : 0;
  await setState({ igq_running: true });
  ensureBanner();
  const found = new Map();
  const collect = () => {
    document.querySelectorAll(SEL.postLinks).forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/(p|reel)\/([^/]+)\//);
      if (!m) return;
      const sc = m[2]; if (found.has(sc)) return;
      const type = m[1] === 'reel' ? 'reel'
        : a.querySelector(SEL.carouselHint) ? 'carousel'
        : a.querySelector(SEL.videoHint) ? 'video' : 'post';
      const img = a.querySelector(SEL.tileImg);
      found.set(sc, { shortcode: sc, type, url: `https://www.instagram.com/${m[1]}/${sc}/`, thumb: img ? img.src : '' });
    });
  };
  status('Looking through your saved posts…');
  window.scrollTo(0, 0); await sleep(1500); collect();
  let stall = 0, paused = false;
  while (stall < STALL_LIMIT) {
    if (!(await runningNow())) { paused = true; break; }
    if (limit && found.size >= limit) break;
    const before = found.size;
    const links = document.querySelectorAll(SEL.postLinks);
    if (links.length) links[links.length - 1].scrollIntoView({ block: 'end' }); else window.scrollBy(0, 1200);
    await sleep(SCROLL_PAUSE);
    collect();
    stall = (found.size === before) ? stall + 1 : 0;
    status(`Found ${found.size} saved posts${limit ? ' of ' + limit : ''}${stall && !limit ? ' (waiting for more…)' : '…'}`);
  }
  await setState({ igq_running: false });
  let queue = [...found.values()];
  if (limit && queue.length > limit) queue = queue.slice(0, limit);
  const { igq_rows } = await chrome.storage.local.get('igq_rows');
  const doneSet = new Set((igq_rows || []).map(r => r.shortcode));
  const isNew = queue.filter(q => !doneSet.has(q.shortcode)).length;
  await setState({ igq_queue: queue });   // does NOT clear results
  status(`${paused ? 'Stopped finding. ' : ''}Have ${queue.length} saved posts. ${doneSet.size} already done, ${isNew} new to do.`);
  return queue.length;
}

/* ---------- per-post meta (with Instagram-block detection) ---------- */
async function fetchMeta(item) {
  let caption = '', creator = '', date = '', blocked = false;
  try {
    const res = await sw('FETCH_TEXT', { url: item.url });
    if (res && res.ok) {
      const finalUrl = res.finalUrl || '';
      const head = (res.text || '').slice(0, 4000);
      if (/\/accounts\/login|\/challenge|checkpoint_required/i.test(finalUrl) ||
          /checkpoint_required|please wait a few minutes|try again later|unusual activity/i.test(head)) {
        return { blocked: true };
      }
      const doc = new DOMParser().parseFromString(res.text, 'text/html');
      const og = doc.querySelector('meta[property="og:description"]')?.content || '';
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.content || '';
      const cap = og.match(/:\s*[\u201c"](.+)[\u201d"]\s*$/s);
      caption = cap ? cap[1] : og;
      const u1 = og.match(/-\s*([A-Za-z0-9._]+)\s+on\b/);
      const u2 = ogTitle.match(/@([A-Za-z0-9._]+)/);
      const u3 = ogTitle.match(/^([A-Za-z0-9._]+)\s+on\s+Instagram/i);
      creator = (u1 && u1[1]) || (u2 && u2[1]) || (u3 && u3[1]) || '';
      const dt = og.match(/on\s+(.+?):/);
      date = dt ? dt[1] : '';
    }
  } catch (_) {}
  return { caption, creator, date, blocked };
}

function buildPrompt(caption) {
  return [
    'You are cataloguing a saved Instagram post. Look at the image (cover / first slide) and use the caption only as supporting context.',
    '',
    'Return ONLY a JSON object with keys:',
    '- "title": short descriptive title (max 8 words), based on what you SEE. Do not invent.',
    `- "category": single best fit from: ${JSON.stringify(CATEGORIES)}. If none fits, "Other".`,
    '- "value": one of "reference", "news", "entertainment".',
    '- "visual_description": 1-2 sentences on what is visibly in the image. If unclear, say so.',
    '- "caption_useful": "adds-context" or "seo-only".',
    '- "needs_review": true if the image is unreadable/ambiguous, else false.',
    '',
    'Rules: NEVER guess the creator/brand/source. Describe only what you SEE. Output raw JSON, no markdown fences.',
    '',
    `Caption (raw, may be unreliable): """${(caption || '').slice(0, 1200)}"""`
  ].join('\n');
}

async function analyze(item, cfg) {
  const meta = await fetchMeta(item);
  if (meta.blocked) return { blocked: true };
  let imgB64 = '', mime = 'image/jpeg';
  if (item.thumb) {
    const ir = await sw('FETCH_IMAGE_B64', { url: item.thumb });
    if (ir && ir.ok) {
      imgB64 = ir.b64; mime = ir.mime;
      const small = await shrink(`data:${mime};base64,${imgB64}`);
      await chrome.storage.local.set({ ['igq_thumb_' + item.shortcode]: small });
    }
  }
  let a = { title: '', category: 'Other', value: '', visual_description: '', caption_useful: '', needs_review: true };
  for (let attempt = 0; attempt <= RETRY_BACKOFFS.length; attempt++) {
    const gr = await sw('CALL_MODEL', { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, prompt: buildPrompt(meta.caption), imageB64: imgB64, mime });
    if (gr && gr.ok && gr.data && gr.data.text) {
      const parsed = parseJson(gr.data.text);
      if (parsed) { a = parsed; break; }
      a.visual_description = '[parse error] ' + gr.data.text.slice(0, 200); break;
    }
    const err = (gr && gr.data && gr.data.error) || (gr && gr.error) || 'unknown';
    const transient = /(\b429\b|\b5\d\d\b|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED|rate limit)/i.test(String(err));
    if (transient && attempt < RETRY_BACKOFFS.length) {
      status(`Service busy, waiting ${RETRY_BACKOFFS[attempt] / 1000}s then trying again…`);
      if (!(await waitOrPause(RETRY_BACKOFFS[attempt]))) return { paused: true };
      continue;
    }
    a.visual_description = '[model error] ' + err; break;
  }
  return {
    num: 0, shortcode: item.shortcode, link: item.url,
    creator: meta.creator || '', creator_url: meta.creator ? `https://www.instagram.com/${meta.creator}/` : '',
    type: item.type, date: meta.date || '', title: a.title || '',
    category: a.category || 'Other', value: a.value || '',
    visual_description: a.visual_description || '', caption: meta.caption || '',
    caption_useful: a.caption_useful || '', needs_review: a.needs_review ? 'yes' : '',
    thumbnail_url: item.thumb || ''
  };
}

async function loadConfig() {
  const c = await chrome.storage.local.get(['igq_baseurl', 'igq_apikey', 'igq_model']);
  return { baseUrl: c.igq_baseurl || DEFAULT_BASEURL, apiKey: c.igq_apikey || '', model: c.igq_model || DEFAULT_MODEL };
}

/* ---------- process pending (not-yet-done) posts. opts = { limit, restart } ---------- */
async function process(opts = {}) {
  const cfg = await loadConfig();
  if (!cfg.apiKey) { status('Add your API key first (top of the popup).'); return; }
  if (opts.restart) { await clearThumbs(); await setState({ igq_rows: [] }); }
  let { igq_queue: queue, igq_rows: rows } = await getState();
  if (!queue || !queue.length) { status('First click "Find my saved posts".'); return; }
  rows = rows || [];
  const done = new Set(rows.map(r => r.shortcode));
  const pending = queue.filter(q => !done.has(q.shortcode));
  if (!pending.length) { playDone(); status(`Everything is already done. All ${queue.length} posts catalogued.`); return; }
  const batch = opts.limit ? pending.slice(0, opts.limit) : pending;

  await setState({ igq_running: true });
  ensureBanner(); startKeepAlive();
  let processed = 0, blocked = false, manualPause = false;
  for (const item of batch) {
    if (!(await runningNow())) { manualPause = true; break; }
    status(`Reading post ${done.size + processed + 1} of ${queue.length}…`);
    const row = await analyze(item, cfg);
    if (row && row.blocked) { blocked = true; break; }
    if (row && row.paused) { manualPause = true; break; }
    if (!(await runningNow())) { manualPause = true; break; }
    row.num = done.size + processed + 1;
    rows.push(row); processed++;
    await setState({ igq_rows: rows });
    if (!(await waitOrPause(BASE_DELAY + Math.floor(Math.random() * JITTER)))) { manualPause = true; break; }
  }
  stopKeepAlive();
  await setState({ igq_running: false });

  const total = new Set(rows.map(r => r.shortcode)).size;
  const left = queue.length - total;
  if (blocked) { playStalled(); status(`Instagram looks like it is limiting requests. Stop for a few hours, then continue. Your ${total} done posts are saved.`); return; }
  if (manualPause) { status(`Paused. ${total} of ${queue.length} done, ${left} to go. Use "Process the next" or "Process the rest".`); return; }
  if (left <= 0) { playDone(); status(`All done! ${queue.length} posts catalogued. Save your catalog below.`); }
  else { playDone(); status(`Batch finished. ${total} of ${queue.length} done, ${left} to go.`); }
}

async function retryFailed() {
  const cfg = await loadConfig();
  if (!cfg.apiKey) { status('Add your API key first.'); return; }
  let { igq_rows: rows } = await getState();
  if (!rows || !rows.length) { status('Nothing to retry yet.'); return; }
  const failed = rows.map((r, i) => ({ r, i })).filter(x => isFail(x.r));
  if (!failed.length) { status('No failed posts to retry.'); return; }
  await setState({ igq_running: true });
  ensureBanner(); startKeepAlive();
  let fixed = 0, blocked = false;
  for (let k = 0; k < failed.length; k++) {
    if (!(await runningNow())) break;
    const { r, i } = failed[k];
    status(`Retrying failed post ${k + 1} of ${failed.length}…`);
    const nr = await analyze({ shortcode: r.shortcode, url: r.link, thumb: r.thumbnail_url, type: r.type }, cfg);
    if (nr && nr.blocked) { blocked = true; break; }
    if (nr && nr.paused) break;
    nr.num = r.num; rows[i] = nr; if (!isFail(nr)) fixed++;
    await setState({ igq_rows: rows });
    if (!(await waitOrPause(BASE_DELAY + Math.floor(Math.random() * JITTER)))) break;
  }
  stopKeepAlive(); await setState({ igq_running: false });
  if (blocked) { playStalled(); status('Instagram may be limiting requests. Wait a few hours, then retry.'); return; }
  playDone(); status(`Retry finished. ${fixed} of ${failed.length} fixed.`);
}

/* ---------- quick settings check (one tiny call) ---------- */
async function testConnection() {
  const cfg = await loadConfig();
  if (!cfg.apiKey) { status('Add your API key first.'); return; }
  status('Checking your settings…');
  const gr = await sw('CALL_MODEL', { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, prompt: 'Reply with just the word OK.', imageB64: '', mime: '' });
  if (gr && gr.ok && gr.data && gr.data.text) status('Settings work. You are ready to go.');
  else status('Settings problem: ' + ((gr && gr.data && gr.data.error) || (gr && gr.error) || 'no response') + '\nCheck the provider, key, and model.');
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.type === 'CMD_HARVEST') { harvest({ limit: msg.limit }).then(n => sendResponse({ ok: true, count: n })); return true; }
  if (msg.type === 'CMD_PROCESS') { setState({ igq_running: true }).then(() => process({ limit: msg.limit, restart: msg.restart })); sendResponse({ ok: true }); return true; }
  if (msg.type === 'CMD_RETRY')   { setState({ igq_running: true }).then(() => retryFailed()); sendResponse({ ok: true }); return true; }
  if (msg.type === 'CMD_PAUSE')   { setState({ igq_running: false }).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === 'CMD_TEST')    { testConnection(); sendResponse({ ok: true }); return true; }
  if (msg.type === 'CMD_RESET')   { clearThumbs().then(() => chrome.storage.local.set({ igq_queue: [], igq_rows: [], igq_running: false })).then(() => { const b = document.getElementById('igq-banner'); if (b) b.remove(); sendResponse({ ok: true }); }); return true; }
});
