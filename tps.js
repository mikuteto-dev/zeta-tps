(() => {
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  let current = null;
  const norm = (s) => s.replace(/[\s*]/g, '');
  const estimateTokens = (s) => {
    const ascii = s.match(/[\x00-\x7f]/g)?.length ?? 0;
    return Math.round(s.length - ascii + ascii / 4);
  };

  const collectText = (v, out) => {
    if (Array.isArray(v)) v.forEach((x) => collectText(x, out));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (/request/i.test(k)) continue;
        if (k === 'text' && typeof x === 'string') out.push(x);
        else collectText(x, out);
      }
    return out;
  };

  const onEvent = (e, raw) => {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const t = collectText(ev, []).join('\n');
    if (!norm(t)) return;
    e.text = norm(t).startsWith(norm(e.text)) ? t : e.text + t;
    const tokens = estimateTokens(e.text);
    if (tokens <= e.tokens) return;
    const now = performance.now();
    if (e.first === null) {
      e.first = now;
      e.tokFirst = tokens;
    }
    e.last = now;
    e.tokens = tokens;
    current = e;
    schedule();
  };

  const read = async (body, t0) => {
    const e = { t0, path: location.pathname, text: '', tokens: 0, tokFirst: 0, first: null, last: 0 };
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      const lines = (buf + value).split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) if (line.startsWith('data:')) onEvent(e, line.slice(5));
    }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const t0 = performance.now();
    const res = await origFetch.apply(this, args);
    if (res.body && (res.headers.get('content-type') || '').includes('text/event-stream')) read(res.clone().body, t0);
    return res;
  };

  const node = document.createElement('div');
  node.style.cssText =
    'position:absolute;bottom:100%;z-index:1;padding:2px 8px;border-radius:12px;font-size:12px;line-height:16px;' +
    'color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none';

  const fmt = (ms) => (ms / 1000).toFixed(1);

  const composer = () => {
    const input = [...document.querySelectorAll('textarea')].filter((t) => t.offsetParent).pop();
    let box = input;
    while (box && box !== document.body && getComputedStyle(box).backgroundColor === TRANSPARENT) box = box.parentElement;
    return box && box !== document.body ? box : null;
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  };

  function apply() {
    queued = false;
    const e = current;
    if (!e) return;
    node.hidden = e.path !== location.pathname;
    const span = e.last - e.first;
    const rate = span > 0 ? (((e.tokens - e.tokFirst) / span) * 1000).toFixed(1) : '–';
    const text = [`${rate} tok/s`, `TTFT ${fmt(e.first - e.t0)} s`, `${e.tokens} tok`, `${fmt(e.last - e.t0)} s`].join(' · ');
    if (node.textContent !== text) node.textContent = text;
    const box = composer();
    if (!box) return;
    const s = getComputedStyle(box);
    node.style.left = `${box.offsetLeft}px`;
    node.style.background = s.backgroundColor;
    node.style.boxShadow = s.boxShadow;
    if (node.parentElement !== box.parentElement) box.parentElement.append(node);
  }

  new MutationObserver(() => current && schedule()).observe(document, { childList: true, subtree: true, characterData: true });
})();
