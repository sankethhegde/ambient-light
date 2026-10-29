const $ = (id) => document.getElementById(id);

let settings = ambientNormalize();
let site = ''; // '' when the extension can't run on the current tab
let tabId = null;

const UNITS = { intensity: '%', blur: ' px', size: ' px' };
const STYLE_HINTS = {
  glow: 'Glow lightens the page. Best on dark sites.',
  solid: 'Solid paints the colour, so it shows on light pages too.',
};

function save() {
  chrome.storage.sync.set({ settings });
}

function render() {
  $('enabled').checked = settings.enabled;
  $('controls').classList.toggle('off', !settings.enabled);
  $('site').checked = !!site && !settings.disabledSites.includes(site);
  $('site').disabled = !site;
  for (const k of Object.keys(UNITS)) {
    $(k).value = settings[k];
    $(`${k}-out`).textContent = settings[k] + UNITS[k];
  }
  $('style').value = settings.style;
  $('style-hint').textContent = STYLE_HINTS[settings.style];
}

// Pages where content scripts are not allowed to run.
function siteFor(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!/^(https?|file):$/.test(u.protocol)) return '';
  if (u.hostname === 'chromewebstore.google.com') return '';
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return '';
  if (u.hostname === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons')) return '';
  return u.protocol === 'file:' ? 'local files' : ambientSiteKey(u.hostname);
}

$('enabled').addEventListener('change', (e) => {
  settings.enabled = e.target.checked;
  render();
  save();
});

$('site').addEventListener('change', (e) => {
  const list = settings.disabledSites.filter((h) => h !== site);
  if (!e.target.checked) list.push(site);
  settings.disabledSites = list;
  save();
});

// chrome.storage.sync allows only ~2 writes a second, so while a slider is being
// dragged the current tab gets a live preview message; the value is saved on release.
for (const k of Object.keys(UNITS)) {
  $(k).addEventListener('input', (e) => {
    settings[k] = +e.target.value;
    $(`${k}-out`).textContent = settings[k] + UNITS[k];
    preview();
  });
  $(k).addEventListener('change', save);
}

function preview() {
  if (tabId == null || !site) return;
  chrome.tabs.sendMessage(tabId, { type: 'ambient-preview', settings }).catch(() => {});
}

$('style').addEventListener('change', (e) => {
  settings.style = e.target.value;
  render();
  save();
});

(async () => {
  const [stored, tabs] = await Promise.all([
    chrome.storage.sync.get('settings'),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  settings = ambientNormalize(stored.settings);
  tabId = tabs[0] ? tabs[0].id : null;
  site = siteFor(tabs[0] && tabs[0].url);
  $('site-name').textContent = site || "Extensions can't run on this page.";
  render();
})();
