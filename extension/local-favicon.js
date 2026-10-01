(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InnerGardenLocalFavicon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function markup(domain) {
    const text = String(domain || '').replace(/^www\./, '').toLowerCase();
    const letter = (text.match(/[a-z0-9]/)?.[0] || '·').toUpperCase();
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    return `<svg class="chip-favicon local-favicon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect width="16" height="16" rx="4" fill="hsl(${hue} 24% 91%)"/><text x="8" y="11.5" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="600" fill="hsl(${hue} 28% 32%)">${letter}</text></svg>`;
  }
  return { markup };
});
