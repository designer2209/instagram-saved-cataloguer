/* popup.js — settings + friendly controls + exports. */

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const DEFAULT_BASEURL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const batchN = () => Math.max(1, parseInt($('batch').value, 10) || 20);
const updateBatchLabels = () => document.querySelectorAll('.bn').forEach(el => el.textContent = batchN());

chrome.storage.local.get(['igq_baseurl', 'igq_apikey', 'igq_model', 'igq_batch'], (s) => {
  const base = s.igq_baseurl || DEFAULT_BASEURL;
  $('baseurl').value = base;
  $('key').value = s.igq_apikey || '';
  $('model').value = s.igq_model || DEFAULT_MODEL;
  $('batch').value = s.igq_batch || 20;
  const opt = [...$('provider').options].find(o => o.value === base);
  $('provider').value = opt ? base : '__custom__';
  updateBatchLabels();
});

$('provider').onchange = () => { if ($('provider').value !== '__custom__') $('baseurl').value = $('provider').value; };
$('batch').oninput = () => { updateBatchLabels(); chrome.storage.local.set({ igq_batch: batchN() }); };

$('save').onclick = () => {
  chrome.storage.local.set({
    igq_baseurl: ($('baseurl').value.trim() || DEFAULT_BASEURL),
    igq_apikey: $('key').value.trim(),
    igq_model: ($('model').value.trim() || DEFAULT_MODEL)
  }, () => setStatus('Saved on your device.'));
};

// Check settings goes straight through the service worker (no Instagram tab needed)
$('test').onclick = async () => {
  chrome.storage.local.set({
    igq_baseurl: ($('baseurl').value.trim() || DEFAULT_BASEURL),
    igq_apikey: $('key').value.trim(),
    igq_model: ($('model').value.trim() || DEFAULT_MODEL)
  });
  setStatus('Checking your settings…');
  const cfg = { baseUrl: ($('baseurl').value.trim() || DEFAULT_BASEURL), apiKey: $('key').value.trim(), model: ($('model').value.trim() || DEFAULT_MODEL) };
  if (!cfg.apiKey) { setStatus('Add your API key first.'); return; }
  chrome.runtime.sendMessage({ type: 'CALL_MODEL', baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, prompt: 'Reply with just the word OK.', imageB64: '', mime: '' }, (r) => {
    if (r && r.ok && r.data && r.data.text) setStatus('Your settings work. You are ready to go.');
    else setStatus('Settings problem: ' + ((r && r.data && r.data.error) || (r && r.error) || 'no response') + '\nCheck the provider, key, and model.');
  });
};

async function send(type, extra = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.instagram\.com\//.test(tab.url || '')) { setStatus('Open your Instagram Saved page first, then click this.'); return; }
  chrome.tabs.sendMessage(tab.id, { type, ...extra }, (r) => {
    if (chrome.runtime.lastError) setStatus('Reload the Instagram tab and try again.');
    else if (r && r.count !== undefined) setStatus(`Found ${r.count} posts.`);
  });
}

$('harvest').onclick = () => {
  const lim = parseInt($('findlimit').value, 10);
  setStatus('Looking through your saved posts…');
  send('CMD_HARVEST', (lim && lim > 0) ? { limit: lim } : {});
};
$('pauseFind').onclick = () => send('CMD_PAUSE');
$('test20').onclick  = async () => {
  const { igq_rows } = await chrome.storage.local.get('igq_rows');
  if (igq_rows && igq_rows.length && !confirm('This clears your current catalog and starts fresh from the top. Continue?')) return;
  setStatus(`Trying the first ${batchN()}…`); send('CMD_PROCESS', { limit: batchN(), restart: true });
};
$('next').onclick    = () => { setStatus(`Doing the next ${batchN()}…`); send('CMD_PROCESS', { limit: batchN() }); };
$('process').onclick = () => { setStatus('Doing the rest…'); send('CMD_PROCESS', {}); };
$('pause').onclick   = () => send('CMD_PAUSE');
$('retry').onclick   = () => { setStatus('Retrying the failed ones…'); send('CMD_RETRY'); };
$('reset').onclick   = () => { if (confirm('This deletes your whole catalog and starts over. Are you sure?')) send('CMD_RESET'); };

chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'STATUS') setStatus(msg.text); });

setInterval(async () => {
  const s = await chrome.storage.local.get(['igq_queue', 'igq_rows', 'igq_running']);
  if (s.igq_queue && s.igq_queue.length && s.igq_running) {
    setStatus(`${(s.igq_rows || []).length} of ${s.igq_queue.length} done (running).`);
  }
}, 2000);

function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

$('download').onclick = async () => {
  const { igq_rows: rows } = await chrome.storage.local.get('igq_rows');
  if (!rows || !rows.length) { setStatus('Nothing to download yet.'); return; }
  const cols = ['num', 'link', 'creator', 'creator_url', 'type', 'date', 'title', 'category', 'value', 'visual_description', 'caption', 'caption_useful', 'needs_review', 'thumbnail_url'];
  const labels = { num: '#' };
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const header = cols.map(c => esc(labels[c] || c)).join(',');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
  download('\uFEFF' + header + '\n' + body, 'instagram_saved_catalog.csv', 'text/csv;charset=utf-8;');
  setStatus(`Downloaded ${rows.length} posts as a spreadsheet.`);
};

$('downloadHtml').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const rows = all.igq_rows;
  if (!rows || !rows.length) { setStatus('Nothing to download yet.'); return; }
  const data = rows.map(r => ({
    num: r.num, thumb: all['igq_thumb_' + r.shortcode] || r.thumbnail_url || '',
    title: r.title || '(no title)', category: r.category || 'Other', value: r.value || '',
    type: r.type || '', description: r.visual_description || '', caption: r.caption || '', link: r.link || '',
    review: r.needs_review || ''
  }));
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html =
`<!doctype html><html><head><meta charset="utf-8"><title>Saved Posts Catalog</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#fafafa;color:#111}
 header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e5e5;padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:2}
 header input,header select{padding:8px;border:1px solid #ccc;border-radius:8px;font:14px system-ui}
 header input{flex:1;min-width:180px}
 label.chk{font-size:13px;color:#555;display:flex;gap:5px;align-items:center}
 #count{color:#777;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;padding:16px;align-items:start}
 .card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
 .card.rev{border-color:#f0b000;box-shadow:0 0 0 1px #f0b000}
 .card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#eee}
 .card .b{padding:10px 12px 12px}
 .num{color:#aaa;font-size:11px}
 .title{font-weight:600;margin:2px 0 6px}
 .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
 .tag{font-size:11px;padding:2px 8px;border-radius:20px;background:#eef;color:#334}
 .tag.val{background:#efe;color:#252}
 .tag.type{background:#f3f3f3;color:#555}
 .tag.rev{background:#fdecc8;color:#7a5b00}
 .desc{font-size:13px;color:#333}
 .cap{font-size:12px;color:#888;margin-top:6px;max-height:60px;overflow:auto;white-space:pre-wrap}
 a.link{display:inline-block;margin-top:8px;font-size:12px;color:#3897f0;text-decoration:none}
</style></head><body>
<header>
 <input id="q" placeholder="Search title, description, caption…">
 <select id="cat"><option value="">All categories</option></select>
 <label class="chk"><input type="checkbox" id="rev"> Needs a look only</label>
 <span id="count"></span>
</header>
<div class="grid" id="grid"></div>
<script>
const DATA=${json};
const grid=document.getElementById('grid'),q=document.getElementById('q'),cat=document.getElementById('cat'),rev=document.getElementById('rev'),count=document.getElementById('count');
[...new Set(DATA.map(d=>d.category))].sort().forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;cat.appendChild(o)});
function esc(s){return String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}
function render(){
 const t=q.value.toLowerCase(),c=cat.value,ro=rev.checked;
 const items=DATA.filter(d=>(!c||d.category===c)&&(!ro||d.review==='yes')&&(!t||(d.title+d.description+d.caption).toLowerCase().includes(t)));
 count.textContent=items.length+' / '+DATA.length+' posts';
 grid.innerHTML=items.map(d=>\`<div class="card\${d.review==='yes'?' rev':''}">\${d.thumb?\`<img loading="lazy" src="\${d.thumb}">\`:''}<div class="b"><div class="num">#\${d.num}</div><div class="title">\${esc(d.title)}</div><div class="tags"><span class="tag">\${esc(d.category)}</span>\${d.value?\`<span class="tag val">\${esc(d.value)}</span>\`:''}<span class="tag type">\${esc(d.type)}</span>\${d.review==='yes'?'<span class="tag rev">needs a look</span>':''}</div><div class="desc">\${esc(d.description)}</div>\${d.caption?\`<div class="cap">\${esc(d.caption)}</div>\`:''}<a class="link" href="\${d.link}" target="_blank">Open post ↗</a></div></div>\`).join('');
}
q.oninput=render;cat.onchange=render;rev.onchange=render;render();
</script></body></html>`;
  download(html, 'instagram_saved_catalog.html', 'text/html;charset=utf-8;');
  setStatus(`Made your visual page (${rows.length} posts).`);
};
