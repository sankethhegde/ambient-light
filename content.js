// Ambient Light content script.
// Draws one fixed glow layer around the main playing video. The layer holds a tiny
// canvas that is fed video frames ~15 times a second and stretched + blurred by CSS.
// A clip-path hole keeps the video picture itself untouched, and the whole thing
// sleeps when nothing has played for 3 seconds.
(() => {
  if (window.top !== window || window.__ambientLight) return;
  window.__ambientLight = true;

  const MIN_W = 160;
  const MIN_H = 90;
  const DRAW_INTERVAL = 1000 / 15;
  const SCAN_INTERVAL = 500;
  const IDLE_SLEEP = 3000;
  const FADE_MS = 400;
  const FULL_WINDOW = 0.97;
  const CANVAS_W = 48;

  let settings = ambientNormalize();
  const site = location.protocol === 'file:' ? 'local files' : ambientSiteKey(location.hostname);
  const activeHere = () => settings.enabled && !settings.disabledSites.includes(site);

  // ---------- glow layer (created lazily, one element in the page) ----------
  let host = null;
  let canvas = null;
  let ctx = null;
  let shown = false;
  let hideTimer = 0;

  function ensureLayer() {
    if (host) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      return;
    }
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('role', 'presentation');
    host.dataset.ambientLight = '';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      canvas { position: absolute; display: block; pointer-events: none; }
    `;
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = 27;
    ctx = canvas.getContext('2d', { alpha: false });
    root.append(style, canvas);

    setImportant(host, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '0px',
      height: '0px',
      margin: '0',
      padding: '0',
      border: '0',
      display: 'none',
      opacity: '0',
      'pointer-events': 'none',
      'user-select': 'none',
      'z-index': '2147483647',
      contain: 'strict',
      overflow: 'hidden',
      transition: `opacity ${FADE_MS}ms ease`,
      'will-change': 'opacity',
    });
    applyLook();
    document.documentElement.appendChild(host);
  }

  function setImportant(el, props) {
    for (const k in props) el.style.setProperty(k, props[k], 'important');
  }

  function applyLook() {
    if (!host) return;
    setImportant(host, { 'mix-blend-mode': settings.style === 'solid' ? 'normal' : 'screen' });
    setImportant(canvas, { filter: `blur(${settings.blur}px) saturate(1.6)` });
    if (shown) setImportant(host, { opacity: String(settings.intensity / 100) });
    lastGeom = ''; // size-dependent mask must be rebuilt
  }

  function show() {
    ensureLayer();
    clearTimeout(hideTimer);
    if (shown) return;
    shown = true;
    setImportant(host, { display: 'block' });
    void host.offsetWidth; // commit display before the opacity transition starts
    setImportant(host, { opacity: String(settings.intensity / 100) });
  }

  function hide(immediate) {
    if (!host || !shown) return;
    shown = false;
    setImportant(host, { opacity: '0' });
    clearTimeout(hideTimer);
    const off = () => setImportant(host, { display: 'none' });
    if (immediate) off();
    else hideTimer = setTimeout(off, FADE_MS + 50);
  }

  // ---------- geometry ----------
  let lastGeom = '';

  // The rectangle the picture actually occupies inside the <video> box.
  function pictureRect(video, r) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const fit = fitCache.get(video) || 'contain';
    if (!vw || !vh || fit === 'fill' || fit === 'cover') return r;
    let scale;
    if (fit === 'none') scale = 1;
    else if (fit === 'scale-down') scale = Math.min(1, r.width / vw, r.height / vh);
    else scale = Math.min(r.width / vw, r.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    return {
      left: r.left + (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      width: w,
      height: h,
    };
  }

  function place(video, r) {
    const p = pictureRect(video, r);
    const S = settings.size;
    const W = Math.round(p.width + 2 * S);
    const H = Math.round(p.height + 2 * S);
    const L = Math.round(p.left - S);
    const T = Math.round(p.top - S);
    const geom = `${L},${T},${W},${H}`;
    if (geom === lastGeom) return;
    const sizeChanged = !lastGeom || lastGeom.split(',').slice(2).join() !== `${W},${H}`;
    lastGeom = geom;

    host.style.setProperty('transform', `translate(${L}px, ${T}px)`, 'important');
    if (!sizeChanged) return;

    setImportant(host, { width: `${W}px`, height: `${H}px` });

    // Canvas sits over the picture, stretched past it by half the glow size;
    // the blur spreads it into the rest of the layer.
    const ext = S * 0.5;
    setImportant(canvas, {
      left: `${S - ext}px`,
      top: `${S - ext}px`,
      width: `${W - 2 * (S - ext)}px`,
      height: `${H - 2 * (S - ext)}px`,
    });
    const ch = Math.max(8, Math.min(64, Math.round((CANVAS_W * p.height) / Math.max(1, p.width))));
    if (canvas.height !== ch) canvas.height = ch;

    // Hole over the picture (even-odd: outer rect minus inner rect). 1px overlap avoids a seam.
    const a = S - 1;
    const bx = W - S + 1;
    const by = H - S + 1;
    host.style.setProperty(
      'clip-path',
      `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ` +
        `${a}px ${a}px, ${a}px ${by}px, ${bx}px ${by}px, ${bx}px ${a}px, ${a}px ${a}px)`,
      'important'
    );

    // Soft outer edge so the layer never ends in a hard line.
    const f = Math.round(S * 0.75);
    const mask =
      `linear-gradient(to right, transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent), ` +
      `linear-gradient(to bottom, transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent)`;
    host.style.setProperty('-webkit-mask-image', mask, 'important');
    host.style.setProperty('-webkit-mask-composite', 'source-in', 'important');
    host.style.setProperty('mask-composite', 'intersect', 'important');
  }

  // ---------- video choice ----------
  const known = new Set(); // videos seen through events, incl. ones in open shadow roots
  const fitCache = new WeakMap();
  let current = null;

  function isFullscreen(r) {
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    return r.width >= innerWidth * FULL_WINDOW && r.height >= innerHeight * FULL_WINDOW;
  }

  function visibleArea(r) {
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function isPlaying(v) {
    return v.isConnected && !v.paused && !v.ended && v.readyState >= 2;
  }

  // Hover previews (YouTube home, Netflix rows, …) play muted inside a link card.
  // A real player is not wrapped in a link.
  function isPreview(v) {
    return v.muted && !!v.closest('a[href]');
  }

  function pickVideo() {
    for (const v of document.querySelectorAll('video')) known.add(v);
    let best = null;
    let bestArea = 0;
    for (const v of known) {
      if (!v.isConnected) {
        known.delete(v);
        continue;
      }
      if (!isPlaying(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      const area = visibleArea(r);
      if (!area || area <= bestArea) continue;
      if (getComputedStyle(v).visibility === 'hidden' || isPreview(v)) continue;
      best = v;
      bestArea = area;
    }
    if (best) fitCache.set(best, getComputedStyle(best).objectFit);
    return best;
  }

  // ---------- loop ----------
  let raf = 0;
  let lastScan = -Infinity;
  let lastDraw = -Infinity;
  let lastSeen = 0;

  function wake() {
    if (raf || !activeHere()) return;
    lastScan = -Infinity;
    lastSeen = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function sleep() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    current = null;
    hide();
  }

  function tick(now) {
    raf = 0;
    if (!activeHere()) return sleep();

    if (now - lastScan >= SCAN_INTERVAL || (current && !isPlaying(current))) {
      lastScan = now;
      const next = pickVideo();
      if (next !== current) {
        current = next;
        lastDraw = -Infinity;
      }
    }

    let visible = false;
    if (current && isPlaying(current)) {
      lastSeen = now;
      const r = current.getBoundingClientRect();
      if (r.width >= MIN_W && r.height >= MIN_H && visibleArea(r) && !isFullscreen(r)) {
        visible = true;
        ensureLayer();
        place(current, r);
        if (now - lastDraw >= DRAW_INTERVAL) {
          lastDraw = now;
          try {
            ctx.drawImage(current, 0, 0, canvas.width, canvas.height);
          } catch {
            // Not decodable yet; keep the previous frame.
          }
        }
      }
    }

    if (visible) show();
    else hide();

    if (!current && now - lastSeen >= IDLE_SLEEP) return sleep();
    raf = requestAnimationFrame(tick);
  }

  // Media events don't bubble, but capture-phase listeners on the document still see them.
  const onPlay = (e) => {
    if (e.target instanceof HTMLVideoElement) known.add(e.target);
    lastScan = -Infinity;
    wake();
  };
  const onStop = () => {
    lastScan = -Infinity;
  };
  document.addEventListener('play', onPlay, true);
  document.addEventListener('playing', onPlay, true);
  document.addEventListener('pause', onStop, true);
  document.addEventListener('ended', onStop, true);
  // Frames can stall during the fullscreen transition, so don't wait for the loop.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) hide(true);
    onStop();
  }, true);

  // ---------- settings ----------
  function onSettings(next) {
    const look = next.style !== settings.style || next.blur !== settings.blur ||
      next.size !== settings.size || next.intensity !== settings.intensity;
    settings = next;
    if (look) applyLook();
    if (activeHere()) wake();
    else sleep();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) onSettings(ambientNormalize(changes.settings.newValue));
  });

  // Live preview from the popup while a slider is dragged (saved to storage on release).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ambient-preview') onSettings(ambientNormalize(msg.settings));
  });

  chrome.storage.sync.get('settings').then(
    (res) => onSettings(ambientNormalize(res.settings)),
    () => onSettings(ambientNormalize())
  );
})();
