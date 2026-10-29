// End-to-end check: loads the unpacked extension into headless Edge over CDP, opens
// test/page.html and walks through the spec's behaviours.
// Usage: node test/run.mjs [outDir]   (screenshots go to outDir, default ./test/out)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..');
const outDir = resolve(process.argv[2] || join(here, 'out'));
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- static server for the test page ----------
const server = createServer(async (req, res) => {
  try {
    res.end(await readFile(join(here, 'page.html')));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

// ---------- browser ----------
const profile = await mkdtemp(join(tmpdir(), 'ambient-test-'));
const port = 9300 + Math.floor(Math.random() * 500);
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--enable-unsafe-extension-debugging',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,900',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
]);

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else listeners.forEach((f) => f(msg));
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  check('extension loads', !!extId, extId);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== S) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable', {}, S);
  await send('Page.enable', {}, S);
  await send('Target.activateTarget', { targetId });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
  await send('Page.navigate', { url: pageUrl }, S);
  await sleep(1500);

  const ev = async (expr, gesture = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gesture }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, S);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const glow = () =>
    ev(`(() => {
      const els = document.querySelectorAll('[data-ambient-light]');
      const h = els[0];
      if (!h) return { count: 0 };
      const cs = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return { count: els.length, display: cs.display, opacity: +cs.opacity, pe: cs.pointerEvents,
        blend: cs.mixBlendMode, aria: h.getAttribute('aria-hidden'),
        left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    })()`);
  const rectOf = (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);

  // Nothing plays yet -> no layer at all.
  let g = await glow();
  check('no glow element before any video plays', g.count === 0);

  await ev(`document.getElementById('main').play()`, true);
  await sleep(900);
  g = await glow();
  let v = await rectOf('#main');
  check('glow shows within 1s of play', g.count === 1 && g.display === 'block' && Math.abs(g.opacity - 0.7) < 0.02, JSON.stringify(g));
  check('glow is sized to the video + 140px each side', g.width === v.width + 280 && g.height === v.height + 280 && g.left === v.left - 140 && g.top === v.top - 140, `video ${JSON.stringify(v)}`);
  check('glow ignores the pointer and is hidden from screen readers', g.pe === 'none' && g.aria === 'true');
  check('Glow style uses screen blending', g.blend === 'screen');
  await shot('1-playing');

  const hit = await ev(`(() => { const a = document.getElementById('near').getBoundingClientRect(); return document.elementFromPoint(a.left + 5, a.top + 5).id; })()`);
  check('link inside the glow area is still the hit target', hit === 'near', hit);

  // Scroll: layer follows on the next frame.
  await ev(`scrollBy(0, 120)`);
  await sleep(120);
  g = await glow();
  v = await rectOf('#main');
  check('glow follows the video on scroll', g.top === v.top - 140, `glow.top ${g.top}, video.top ${v.top}`);

  // Resize the player (theater / mini-player).
  await ev(`(() => { const m = document.getElementById('main'); m.style.width = '480px'; m.style.height = '270px'; })()`);
  await sleep(120);
  g = await glow();
  v = await rectOf('#main');
  check('glow follows a player resize', g.width === v.width + 280, `glow.width ${g.width}, video.width ${v.width}`);

  // Pause -> fade out, play -> back.
  await ev(`document.getElementById('main').pause()`);
  await sleep(150);
  g = await glow();
  const fadingOpacity = g.opacity;
  await sleep(500);
  g = await glow();
  check('pause fades the glow out', fadingOpacity > 0 && fadingOpacity < 0.7 && g.display === 'none', `mid-fade ${fadingOpacity.toFixed(2)}, then display ${g.display}`);
  await ev(`document.getElementById('main').play()`, true);
  await sleep(600);
  g = await glow();
  check('play fades it back in', g.display === 'block' && g.opacity > 0.65);

  // Fullscreen.
  await ev(`document.getElementById('main').requestFullscreen().then(() => true, (e) => e.message)`, true);
  await sleep(600);
  const fs = await ev(`!!document.fullscreenElement`);
  g = await glow();
  check('glow hides in fullscreen', fs && g.display === 'none', `fullscreen=${fs} display=${g.display}`);
  await ev(`document.exitFullscreen()`);
  await sleep(700);
  g = await glow();
  check('glow returns after leaving fullscreen', g.display === 'block');

  // Video filling >= 97% of the window counts as fullscreen too.
  await ev(`(() => { const m = document.getElementById('main'); Object.assign(m.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 5 }); })()`);
  await sleep(600);
  g = await glow();
  check('glow hides when the video fills the window', g.display === 'none');
  await ev(`(() => { const m = document.getElementById('main'); m.style.cssText = ''; m.pause(); })()`);

  // Hover preview (muted, inside a link) and a tiny video must not glow.
  await ev(`document.getElementById('preview').play(); document.getElementById('tiny').play()`, true);
  await sleep(1000);
  g = await glow();
  check('hover-preview and tiny videos do not glow', g.display === 'none', JSON.stringify(g));
  await ev(`document.getElementById('preview').pause(); document.getElementById('tiny').pause()`);

  // Letterboxed video: glow fits the picture (640x360 inside 640x480).
  await ev(`document.getElementById('boxed').scrollIntoView({ block: 'center' })`);
  await ev(`document.getElementById('boxed').play()`, true);
  await sleep(900);
  g = await glow();
  v = await rectOf('#boxed');
  check('letterboxed video: glow fits the picture, not the box', g.width === 640 + 280 && g.height === 360 + 280 && g.top === v.top + 60 - 140, JSON.stringify({ g, v }));
  await shot('2-letterboxed');

  // Settings from the popup apply live.
  const { targetId: popupTarget } = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
  const { sessionId: P } = await send('Target.attachToTarget', { targetId: popupTarget, flatten: true });
  await sleep(600);
  const pev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, P)).result.value;
  const popupState = await pev(`({ enabled: document.getElementById('enabled').checked, intensity: document.getElementById('intensity-out').textContent, site: document.getElementById('site-name').textContent, siteDisabled: document.getElementById('site').disabled })`);
  check('popup shows defaults', popupState.enabled && popupState.intensity === '70%', JSON.stringify(popupState));
  check("site toggle disabled on a page extensions can't run on", popupState.siteDisabled, `(popup tab itself) "${popupState.site}"`);
  await send('Emulation.setDeviceMetricsOverride', { width: 290, height: 480, deviceScaleFactor: 2, mobile: false }, P);
  const { data: popupPng } = await send('Page.captureScreenshot', { format: 'png' }, P);
  await writeFile(join(outDir, '4-popup.png'), Buffer.from(popupPng, 'base64'));

  const setSettings = (s) => pev(`chrome.storage.sync.set({ settings: Object.assign(ambientNormalize(), ${JSON.stringify(s)}) }).then(() => true)`);
  await setSettings({ style: 'solid', size: 80, intensity: 100 });
  await send('Target.activateTarget', { targetId });
  await sleep(400);
  g = await glow();
  check('style/size/intensity change live in the open tab', g.blend === 'normal' && g.width === 640 + 160 && g.opacity > 0.98, JSON.stringify(g));
  await shot('3-solid');

  await setSettings({ disabledSites: ['127.0.0.1'] });
  await sleep(700);
  g = await glow();
  check('per-site switch turns it off without reload', g.display === 'none');
  await setSettings({});
  await sleep(700);
  g = await glow();
  check('turning the site back on restores it', g.display === 'block');
  await setSettings({ enabled: false });
  await sleep(700);
  g = await glow();
  check('master switch turns it off without reload', g.display === 'none');
  await setSettings({});
  await sleep(700);

  check('no errors in the page console', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('test run', false, e.stack);
} finally {
  // On Windows the spawned msedge.exe hands off to a separate browser process, so killing
  // `edge` alone leaks the browser. Ask it to quit over CDP, then make sure.
  await Promise.race([send('Browser.close').catch(() => {}), sleep(2000)]);
  try { ws.close(); } catch {}
  edge.kill();
  server.close();
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {} // files still locked while the browser shuts down
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${outDir}`);
  process.exit(failed ? 1 : 0);
}
