/* background.js — service worker. Cross-origin fetches + provider-agnostic model calls. */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'FETCH_TEXT') {
        const res = await fetch(msg.url, { credentials: 'include' });
        sendResponse({ ok: true, text: await res.text(), finalUrl: res.url, statusCode: res.status });

      } else if (msg.type === 'FETCH_IMAGE_B64') {
        const res = await fetch(msg.url, { credentials: 'include' });
        const buf = await res.arrayBuffer();
        sendResponse({ ok: true, b64: arrayBufferToBase64(buf), mime: res.headers.get('content-type') || 'image/jpeg' });

      } else if (msg.type === 'CALL_MODEL') {
        sendResponse({ ok: true, data: await callModel(msg) });

      } else {
        sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function join(base, path) { return base.replace(/\/+$/, '') + path; }

async function callModel({ baseUrl, apiKey, model, prompt, imageB64, mime }) {
  const content = [{ type: 'text', text: prompt }];
  if (imageB64) content.push({ type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${imageB64}` } });
  const res = await fetch(join(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.2 })
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  const j = await res.json();
  const c = j?.choices?.[0]?.message?.content;
  const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(x => x.text || '').join('') : '');
  return { text };
}
