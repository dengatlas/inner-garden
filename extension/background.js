/**
 * background.js — Service Worker for tabs, workspace and flomo
 *
 * Chrome's event-driven background worker for Inner Garden.
 * Owns serialized workspace/account writes, flomo and toolbar tab counts.
 *
 * Tab counts are read directly from chrome.tabs; cloud sync is separate.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

importScripts('config.js');
if (globalThis.TAB_OUT_LOAD_LOCAL_CONFIG) importScripts('config.local.js');
importScripts('config-finalize.js');
importScripts('shared/device-migration.js', 'shared/workspace-sync.js', 'shared/sync-client.js', 'workspace-background.js');
importScripts('shared/flomo-prompt-seed.js', 'shared/flomo.js', 'shared/flomo-sync.js', 'shared/flomo-transport.js', 'flomo-background.js');

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'inner-garden-public-config') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const config = {};
  for (const key of ['enabled', 'environmentId', 'storageNamespace', 'defaultUsername', 'authBaseUrl', 'apiBaseUrl', 'flomoApiBaseUrl', 'pollIntervalMs']) {
    config[key] = globalThis.TAB_OUT_SYNC_CONFIG[key];
  }
  respond({ ok: true, config });
});

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
