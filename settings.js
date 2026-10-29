// Shared by the content script and the popup. Settings live in chrome.storage.sync
// under one key so a single onChanged event carries everything.
var AMBIENT_DEFAULTS = {
  enabled: true,
  intensity: 70, // %   10–100
  blur: 60, // px  20–120
  size: 140, // px  40–300
  style: 'glow', // 'glow' | 'solid'
  disabledSites: [], // hostnames without a leading "www."
};

function ambientSiteKey(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function ambientNormalize(stored) {
  const s = Object.assign({}, AMBIENT_DEFAULTS, stored || {});
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  s.intensity = clamp(s.intensity, 10, 100, AMBIENT_DEFAULTS.intensity);
  s.blur = clamp(s.blur, 20, 120, AMBIENT_DEFAULTS.blur);
  s.size = clamp(s.size, 40, 300, AMBIENT_DEFAULTS.size);
  s.style = s.style === 'solid' ? 'solid' : 'glow';
  s.enabled = s.enabled !== false;
  s.disabledSites = Array.isArray(s.disabledSites) ? s.disabledSites : [];
  return s;
}
