/* ================================================================
   Inner Garden · 美日心灵 — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Inner Garden · 美日心灵's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Inner Garden · 美日心灵's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Inner Garden · 美日心灵 new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Inner Garden · 美日心灵 tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
let toastHideTimer = null;

function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting(date = new Date()) {
  const hour = getShanghaiParts(date).hour;
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   FOCUS TIMER - local Pomodoro-style timer
   ---------------------------------------------------------------- */

const FOCUS_TIMER_STORAGE_KEY = 'focusTimer';
const FOCUS_TIMER_DURATIONS = {
  focus: 25 * 60 * 1000,
  break: 5 * 60 * 1000,
};
const DEFAULT_CUSTOM_FOCUS_MINUTES = 15;
const MIN_CUSTOM_FOCUS_MINUTES = 1;
const MAX_CUSTOM_FOCUS_MINUTES = 180;

let focusTimerState = {
  mode: 'focus',
  durationMs: FOCUS_TIMER_DURATIONS.focus,
  remainingMs: FOCUS_TIMER_DURATIONS.focus,
  isRunning: false,
  startedAt: null,
  customMinutes: DEFAULT_CUSTOM_FOCUS_MINUTES,
};
let focusTimerInterval = null;
let shanghaiClockInterval = null;
let lastShanghaiDateKey = null;

function updateShanghaiClockView() {
  const timeEl = document.getElementById('shanghaiTimeDisplay');
  const dateEl = document.getElementById('shanghaiDateDisplay');
  if (!timeEl && !dateEl) return;

  const now = new Date();
  const greetingEl = document.getElementById('greeting');
  const headerDateEl = document.getElementById('dateDisplay');
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const part = (parts, type) => (parts.find(p => p.type === type) || {}).value || '';
  const hour = part(timeParts, 'hour');
  const minute = part(timeParts, 'minute');
  const month = part(dateParts, 'month');
  const day = part(dateParts, 'day');
  const weekday = part(dateParts, 'weekday').toUpperCase();

  if (timeEl) timeEl.textContent = `${hour}:${minute}`;
  if (dateEl) dateEl.textContent = `${month}/${day} ${weekday}`;
  if (greetingEl) greetingEl.textContent = getGreeting(now);
  if (headerDateEl) headerDateEl.textContent = getDateDisplay(now);

  const todayKey = getShanghaiTodayKey();
  if (lastShanghaiDateKey && lastShanghaiDateKey !== todayKey) {
    if (!selectedDailyLogDateKey || selectedDailyLogDateKey === lastShanghaiDateKey) {
      selectedDailyLogDateKey = todayKey;
    }
    activateCurrentWeek();
    selectedWeekStartKey = getCurrentWeekStartKey();
    loadSelectedWeekPlanItems();
    getDailyDraft();
    renderWeekCalendar();
    renderWeekPlan();
    renderDailyLogPanel();
    renderDailyLogArchive();
    scheduleWeeklyWorkspaceSave();
  }
  lastShanghaiDateKey = todayKey;

  updateWeekTimeLine();
}

function initShanghaiClock() {
  updateShanghaiClockView();
  if (shanghaiClockInterval) clearInterval(shanghaiClockInterval);
  shanghaiClockInterval = setInterval(updateShanghaiClockView, 1000);
}

function getFocusDuration(mode) {
  return FOCUS_TIMER_DURATIONS[mode] || FOCUS_TIMER_DURATIONS.focus;
}

function normalizeFocusTimerState(saved) {
  const mode = saved && ['focus', 'break', 'custom'].includes(saved.mode) ? saved.mode : 'focus';
  const customMinutes = Number.isFinite(saved && saved.customMinutes)
    ? Math.min(Math.max(Math.round(saved.customMinutes), MIN_CUSTOM_FOCUS_MINUTES), MAX_CUSTOM_FOCUS_MINUTES)
    : DEFAULT_CUSTOM_FOCUS_MINUTES;
  const durationMs = mode === 'custom' ? customMinutes * 60 * 1000 : getFocusDuration(mode);
  const remainingMs = Number.isFinite(saved && saved.remainingMs)
    ? Math.min(Math.max(saved.remainingMs, 0), durationMs)
    : durationMs;

  return {
    mode,
    durationMs,
    remainingMs,
    isRunning: !!(saved && saved.isRunning),
    startedAt: Number.isFinite(saved && saved.startedAt) ? saved.startedAt : null,
    customMinutes,
  };
}

function getFocusRemainingMs(state = focusTimerState) {
  if (!state.isRunning || !state.startedAt) return state.remainingMs;
  return Math.max(0, state.remainingMs - (Date.now() - state.startedAt));
}

function formatFocusTime(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function saveFocusTimerState() {
  await chrome.storage.local.set({ [FOCUS_TIMER_STORAGE_KEY]: focusTimerState });
}

function updateFocusTimerView() {
  const root = document.getElementById('focusTimer');
  if (!root) return;

  const labelEl = document.getElementById('focusTimerLabel');
  const displayEl = document.getElementById('focusTimerDisplay');
  const statusEl = document.getElementById('focusTimerStatus');
  const progressEl = document.getElementById('focusProgressFill');
  const startPauseEl = document.getElementById('focusStartPause');
  const customInputEl = document.getElementById('focusCustomMinutes');
  const modeButtons = document.querySelectorAll('[data-action="set-focus-mode"]');
  const remainingMs = getFocusRemainingMs();
  const elapsedRatio = 1 - (remainingMs / focusTimerState.durationMs);
  const clampedRatio = Math.min(Math.max(elapsedRatio, 0), 1);

  root.classList.toggle('is-running', focusTimerState.isRunning);
  root.classList.toggle('is-break', focusTimerState.mode === 'break');

  if (labelEl) {
    labelEl.textContent =
      focusTimerState.mode === 'break' ? 'Short break' :
      focusTimerState.mode === 'custom' ? 'Custom session' :
      'Focus session';
  }
  if (displayEl) displayEl.textContent = formatFocusTime(remainingMs);
  if (statusEl) statusEl.textContent = focusTimerState.isRunning ? 'Running' : remainingMs < focusTimerState.durationMs ? 'Paused' : 'Ready';
  if (progressEl) progressEl.style.width = `${clampedRatio * 100}%`;
  if (startPauseEl) startPauseEl.textContent = focusTimerState.isRunning ? 'Pause' : 'Start';
  if (customInputEl && document.activeElement !== customInputEl) {
    customInputEl.value = focusTimerState.customMinutes || DEFAULT_CUSTOM_FOCUS_MINUTES;
  }
  root.style.setProperty('--focus-dial-empty', `${(1 - clampedRatio) * 360}deg`);
  root.style.setProperty('--focus-dial-angle', `${clampedRatio * -360}deg`);

  modeButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.focusMode === focusTimerState.mode);
  });
}

function scheduleFocusTimerTick() {
  if (focusTimerInterval) clearInterval(focusTimerInterval);
  focusTimerInterval = null;

  if (focusTimerState.isRunning) {
    focusTimerInterval = setInterval(handleFocusTimerTick, 1000);
  }
}

async function completeFocusTimer() {
  const finishedMode = focusTimerState.mode;
  const nextMode = finishedMode === 'break' ? 'focus' : 'break';
  const root = document.getElementById('focusTimer');

  focusTimerState = {
    mode: nextMode,
    durationMs: getFocusDuration(nextMode),
    remainingMs: getFocusDuration(nextMode),
    isRunning: false,
    startedAt: null,
    customMinutes: focusTimerState.customMinutes || DEFAULT_CUSTOM_FOCUS_MINUTES,
  };

  await saveFocusTimerState();
  scheduleFocusTimerTick();
  updateFocusTimerView();

  if (root) {
    const rect = root.getBoundingClientRect();
    shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  showToast(finishedMode === 'break' ? 'Break complete. Ready to focus.' : 'Focus session complete. Time for a break.');
}

async function handleFocusTimerTick() {
  if (!focusTimerState.isRunning) return;
  if (getFocusRemainingMs() <= 0) {
    await completeFocusTimer();
    return;
  }
  updateFocusTimerView();
}

async function initFocusTimer() {
  try {
    const stored = await chrome.storage.local.get(FOCUS_TIMER_STORAGE_KEY);
    focusTimerState = normalizeFocusTimerState(stored[FOCUS_TIMER_STORAGE_KEY]);

    if (focusTimerState.isRunning && getFocusRemainingMs() <= 0) {
      await completeFocusTimer();
      return;
    }
  } catch {
    focusTimerState = normalizeFocusTimerState(null);
  }

  updateFocusTimerView();
  scheduleFocusTimerTick();
}

async function setFocusTimerMode(mode) {
  if (!FOCUS_TIMER_DURATIONS[mode]) return;
  focusTimerState = {
    mode,
    durationMs: getFocusDuration(mode),
    remainingMs: getFocusDuration(mode),
    isRunning: false,
    startedAt: null,
    customMinutes: focusTimerState.customMinutes || DEFAULT_CUSTOM_FOCUS_MINUTES,
  };
  await saveFocusTimerState();
  scheduleFocusTimerTick();
  updateFocusTimerView();
}

async function toggleFocusTimer() {
  const remainingMs = getFocusRemainingMs();

  if (focusTimerState.isRunning) {
    focusTimerState = {
      ...focusTimerState,
      remainingMs,
      isRunning: false,
      startedAt: null,
    };
  } else {
    focusTimerState = {
      ...focusTimerState,
      remainingMs: remainingMs > 0 ? remainingMs : focusTimerState.durationMs,
      isRunning: true,
      startedAt: Date.now(),
    };
  }

  await saveFocusTimerState();
  scheduleFocusTimerTick();
  updateFocusTimerView();
}

async function resetFocusTimer() {
  const durationMs = focusTimerState.mode === 'custom'
    ? (focusTimerState.customMinutes || DEFAULT_CUSTOM_FOCUS_MINUTES) * 60 * 1000
    : getFocusDuration(focusTimerState.mode);

  focusTimerState = {
    mode: focusTimerState.mode,
    durationMs,
    remainingMs: durationMs,
    isRunning: false,
    startedAt: null,
    customMinutes: focusTimerState.customMinutes || DEFAULT_CUSTOM_FOCUS_MINUTES,
  };
  await saveFocusTimerState();
  scheduleFocusTimerTick();
  updateFocusTimerView();
}

async function setCustomFocusDuration() {
  const inputEl = document.getElementById('focusCustomMinutes');
  const rawMinutes = Number(inputEl && inputEl.value);
  const minutes = Number.isFinite(rawMinutes)
    ? Math.min(Math.max(Math.round(rawMinutes), MIN_CUSTOM_FOCUS_MINUTES), MAX_CUSTOM_FOCUS_MINUTES)
    : DEFAULT_CUSTOM_FOCUS_MINUTES;
  const durationMs = minutes * 60 * 1000;

  focusTimerState = {
    mode: 'custom',
    durationMs,
    remainingMs: durationMs,
    isRunning: false,
    startedAt: null,
    customMinutes: minutes,
  };

  await saveFocusTimerState();
  scheduleFocusTimerTick();
  updateFocusTimerView();
  showToast(`Custom timer set to ${minutes} min`);
}


/* ----------------------------------------------------------------
   WEEKLY PLANNER + DAILY LOG
   ---------------------------------------------------------------- */

const WEEKLY_WORKSPACE_STORAGE_KEY = 'weeklyWorkspace';
const WORKSPACE_BACKUPS_STORAGE_KEY = 'innerGardenWorkspaceBackups';
const WORKSPACE_SYNC_MODE_KEY = 'innerGardenWorkspaceSyncMode';
const WORKSPACE_EXPORT_VERSION = 1;
const WEEKLY_WORKSPACE_SCHEMA_VERSION = 3;
const PLANNER_START_HOUR = 0;
const PLANNER_EARLY_HOURS_END = 6;
const PLANNER_END_HOUR = 23;
const PLANNER_ROW_HEIGHT = 192;
const PLANNER_TIME_COLUMN_WIDTH = 128;
const PLANNER_MINUTE_STEP = 15;
const PLANNER_MIN_EVENT_MINUTES = 15;
const WEEKLY_WORKSPACE_UNDO_LIMIT = 50;
const DEFAULT_WEEK_EVENT_TITLE = '记录';
const WEEK_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_DAY_LABELS_CN = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const LOG_KEYS = [
  ['inspiration', '灵感-审视'],
  ['plan', '工作-清单'],
  ['action', '记录-行动'],
  ['creation', '日课-创作'],
];
const DAILY_LOG_DRAFT_KEYS = LOG_KEYS.map(([key]) => key);
const DAILY_LOG_FIELD_LABELS = {
  ...Object.fromEntries(LOG_KEYS),
  generated: '每日汇总稿',
};

let weeklyWorkspaceState = {
  version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
  activeWeekId: '',
  activeWeekStartKey: '',
  selectedWeekStartKey: '',
  planner: {},
  events: [],
  weekPlanItems: [],
  weekPlans: {},
  logs: {},
  dailyDraft: {},
};
let weeklyWorkspaceSaveTimer = null;
let workspaceInitialSnapshot = null;
let dailyLogGeneratedSyncTimer = null;
let pendingDailyLogGeneratedSync = null;
let selectedWeekStartKey = '';
let selectedArchiveYear = null;
let selectedWeekEventId = null;
let selectedDailyLogDateKey = '';
const WORKSPACE_TAB_STORAGE_KEY = 'innerGardenDesktopWorkspaceTab';
const WORKSPACE_TAB_IDS = { calendar: 'calendarPanel', daily: 'dailyPanel', flomo: 'flomoSection' };
let activeWorkspaceTab = 'calendar';
const workspaceTabScrollOffsets = { calendar: 0, daily: 0, flomo: 0 };

function switchWorkspaceTab(tab, { remember = true, restoreScroll = true, focusTab = false } = {}) {
  if (!Object.hasOwn(WORKSPACE_TAB_IDS, tab)) return;
  const bar = document.getElementById('workspaceTabBar');
  const anchor = document.getElementById('workspaceTabAnchor');
  const workspace = document.getElementById('weeklyWorkspace');
  if (!bar || !anchor || !workspace) return;
  const previousTab = activeWorkspaceTab;
  if (previousTab === tab && workspace.dataset.activeTab === tab) return;
  const barTop = anchor.getBoundingClientRect().top + window.scrollY;
  if (restoreScroll) workspaceTabScrollOffsets[previousTab] = Math.max(0, window.scrollY - barTop);
  activeWorkspaceTab = tab;
  workspace.dataset.activeTab = tab;
  for (const [name, panelId] of Object.entries(WORKSPACE_TAB_IDS)) {
    document.getElementById(panelId).hidden = name !== tab;
    const button = bar.querySelector(`[data-workspace-tab="${name}"]`);
    button.setAttribute('aria-selected', String(name === tab));
    button.tabIndex = name === tab ? 0 : -1;
  }
  if (remember) {
    try { localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, tab); } catch (_) { /* preference is optional */ }
  }
  if (focusTab) bar.querySelector(`[data-workspace-tab="${tab}"]`)?.focus();
  if (tab === 'calendar') requestAnimationFrame(() => renderWeekCalendar());
  if (restoreScroll) requestAnimationFrame(() => window.scrollTo(0, barTop + workspaceTabScrollOffsets[tab]));
}

function initWorkspaceTabs() {
  const bar = document.getElementById('workspaceTabBar');
  if (!bar) return;
  let remembered = 'calendar';
  try { remembered = localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY) || 'calendar'; } catch (_) { /* use calendar */ }
  if (!Object.hasOwn(WORKSPACE_TAB_IDS, remembered)) remembered = 'calendar';
  switchWorkspaceTab(remembered, { remember: false, restoreScroll: false });
  bar.addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-tab]');
    if (button) switchWorkspaceTab(button.dataset.workspaceTab);
  });
  bar.addEventListener('keydown', event => {
    const button = event.target.closest('[data-workspace-tab]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const names = Object.keys(WORKSPACE_TAB_IDS);
    const index = names.indexOf(button.dataset.workspaceTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
    switchWorkspaceTab(names[next], { focusTab: true });
  });
}
let pendingWorkspaceImportScope = 'all';
let pendingWorkspaceImportReview = null;
let workspaceSyncMode = 'auto';
let plannerEarlyHoursExpanded = false;
let resizingWeekEvent = null;
let draggingWeekEvent = null;
let draggingWeekPlanUndoSnapshot = null;
let weekPlanDropCommitted = false;
let editingWeekPlanItemId = null;
let editingWeekPlanOriginalText = '';
let weeklyWorkspaceUndoStack = [];
let allowEditableUndoAfterDailyClear = false;
let workspaceSyncClient = null;
let workspaceSyncPollTimer = null;
let workspaceSyncFailureCount = 0;
let workspaceSyncStatus = 'local';
let workspaceSyncDetail = '';
let workspaceSyncErrorType = '';
let workspaceAccountView = 'login';
let workspaceAccountKind = 'email';
let workspaceAccountLoginMethod = 'password';
let workspacePasswordChangeMethod = 'current';
let workspaceAccountVerification = null;
let workspaceAccountProfile = null;
let workspaceAccountProfileLoading = false;
let workspaceAccountCaptcha = null;
let workspaceAccountPendingVerification = null;
let workspaceAccountVerificationResendAt = 0;
let workspaceAccountVerificationCooldownTimer = null;
const WORKSPACE_ACCOUNT_VERIFICATION_COOLDOWN_MS = 60000;
const WORKSPACE_SYNC_DEFAULT_POLL_MS = 720000;

function getShanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => (parts.find(p => p.type === type) || {}).value || '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    weekday: part('weekday'),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function shortDateFromKey(dateKey) {
  const [, month, day] = dateKey.split('-');
  return `${month}/${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function snapMinutes(value) {
  return Math.round(value / PLANNER_MINUTE_STEP) * PLANNER_MINUTE_STEP;
}

function formatPlannerTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function formatPlannerRange(event) {
  return `${formatPlannerTime(event.startMinute)}-${formatPlannerTime(event.endMinute)}`;
}

function getPlannerDisplayStartMinute() {
  return (plannerEarlyHoursExpanded ? PLANNER_START_HOUR : PLANNER_EARLY_HOURS_END) * 60;
}

function getPlannerDisplayEndMinute() {
  return (PLANNER_END_HOUR + 1) * 60;
}

function getWeekEventTitle(content) {
  return (content || '').split('\n').find(line => line.trim())?.trim() || DEFAULT_WEEK_EVENT_TITLE;
}

function getWeekEventContentPreview(content) {
  return (content || '')
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

const WEEK_EVENT_SUMMARY_RESERVED_HEIGHT = 30;
const WEEK_EVENT_SUMMARY_LINE_HEIGHT = 12.5;

function getWeekEventSummaryLineCount(eventHeight) {
  return Math.max(
    0,
    Math.floor((eventHeight - WEEK_EVENT_SUMMARY_RESERVED_HEIGHT) / WEEK_EVENT_SUMMARY_LINE_HEIGHT)
  );
}

function updateWeekEventSummarySpace(eventEl) {
  const main = eventEl.querySelector('.week-event-main');
  const header = eventEl.querySelector('.week-event-header');
  if (!main?.clientHeight || !header) return;
  const style = getComputedStyle(main);
  const available = main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - header.offsetHeight - 5;
  const lines = Math.max(0, Math.floor(available / WEEK_EVENT_SUMMARY_LINE_HEIGHT));
  eventEl.style.setProperty('--week-event-summary-lines', lines);
  eventEl.classList.toggle('has-no-summary-space', lines === 0);
}

// Recalculate after wrapping, font loading, tab switches or viewport changes.
const weekEventSummaryObserver = new ResizeObserver(entries => {
  for (const { target } of entries) updateWeekEventSummarySpace(target.closest('.week-event'));
});

function normalizeWeekEvent(event) {
  const displayStart = PLANNER_START_HOUR * 60;
  const displayEnd = getPlannerDisplayEndMinute();
  const focusBlock = String(event.id || '').startsWith('focus-session-');
  const startMinute = focusBlock
    ? clamp(Number(event.startMinute) || 0, displayStart, displayEnd - 1)
    : clamp(snapMinutes(Number(event.startMinute)), displayStart, displayEnd - PLANNER_MIN_EVENT_MINUTES);
  const endMinute = focusBlock
    ? clamp(Number(event.endMinute) || 0, startMinute, displayEnd)
    : clamp(snapMinutes(Number(event.endMinute)), startMinute + PLANNER_MIN_EVENT_MINUTES, displayEnd);
  const content = String(event.content || '');
  const rawTitle = String(event.title || '').trim();

  return {
    id: event.id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dateKey: event.dateKey,
    weekId: event.weekId || getWeekIdFromDateKey(event.dateKey),
    startMinute,
    endMinute,
    title: rawTitle && rawTitle !== 'Untitled' ? rawTitle : getWeekEventTitle(content),
    content,
    ...(event.color ? { color: event.color } : {}),
  };
}

function normalizeWeekEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter(event => event && event.dateKey)
    .map(event => normalizeWeekEvent(event));
}

function normalizeWeekPlanItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && String(item.text || '').trim())
    .map((item, index) => ({
      id: item.id || `week-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: String(item.text || '').trim(),
      completed: Boolean(item.completed),
      createdAt: item.createdAt || new Date().toISOString(),
      completedAt: item.completedAt || '',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    }))
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.order !== b.order) return a.order - b.order;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
}

function migrateScratchToWeekPlanItems(logs = {}, draft = {}) {
  if (weeklyWorkspaceState.weekPlanItems.length) return false;
  const todayLog = logs[getShanghaiTodayKey()] || {};
  const scratchText = String(draft.scratch || todayLog.scratch || '').trim();
  if (!scratchText) return false;

  weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems(
    scratchText.split('\n').map(line => ({ text: line.trim(), completed: false }))
  );
  return weeklyWorkspaceState.weekPlanItems.length > 0;
}

function migratePlannerEntriesToEvents() {
  const existingIds = new Set(weeklyWorkspaceState.events.map(event => event.id));
  for (const [key, value] of Object.entries(weeklyWorkspaceState.planner || {})) {
    const content = String(value || '').trim();
    if (!content) continue;

    const [dateKey, hourText] = key.split('|');
    const hour = Number(hourText);
    if (!dateKey || !Number.isFinite(hour)) continue;

    const id = `legacy-${dateKey}-${hour}`;
    if (existingIds.has(id)) continue;

    weeklyWorkspaceState.events.push(normalizeWeekEvent({
      id,
      dateKey,
      startMinute: hour * 60,
      endMinute: Math.min((hour + 1) * 60, getPlannerDisplayEndMinute()),
      title: getWeekEventTitle(content),
      content,
    }));
    existingIds.add(id);
  }
}

function getShanghaiTodayKey() {
  const parts = getShanghaiParts();
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getWeekDatesForDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const todayUtcMs = Date.UTC(year, month - 1, day);
  const todayUtc = new Date(todayUtcMs);
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7;
  const mondayMs = todayUtcMs - mondayOffset * 86400000;

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(mondayMs + index * 86400000);
    return {
      key: dateKeyFromUtcDate(date),
      dayName: WEEK_DAY_NAMES[index],
      label: `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}`,
    };
  });
}

function shiftDateKey(dateKey, dayOffset) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return dateKeyFromUtcDate(new Date(Date.UTC(year, month - 1, day + dayOffset)));
}

function getWeekStartKeyFromDateKey(dateKey) {
  return getWeekDatesForDateKey(dateKey)[0].key;
}

function getCurrentWeekStartKey() {
  return getWeekStartKeyFromDateKey(getShanghaiTodayKey());
}

function getSelectedWeekStartKey() {
  return selectedWeekStartKey || getCurrentWeekStartKey();
}

function getSelectedWeekDates() {
  return getWeekDatesForDateKey(getSelectedWeekStartKey());
}

function getWeekIdFromDateKey(dateKey) {
  const weekInfo = getIsoWeekInfoFromDateKey(dateKey);
  return `${weekInfo.year}-W${String(weekInfo.weekNumber).padStart(2, '0')}`;
}

function getCurrentWeekId() {
  return getWeekIdFromDateKey(getCurrentWeekStartKey());
}

function normalizeWeekPlanRecord(plan = {}, weekStartKey = getCurrentWeekStartKey()) {
  const weekDates = getWeekDatesForDateKey(weekStartKey);
  const weekId = getWeekIdFromDateKey(weekStartKey);
  return {
    id: plan.id || weekId,
    weekId,
    weekStart: weekDates[0].key,
    weekEnd: weekDates[6].key,
    items: normalizeWeekPlanItems(plan.items || []),
    summary: String(plan.summary || ''),
    closedAt: plan.closedAt || '',
    updatedAt: plan.updatedAt || '',
  };
}

function normalizeWeekPlans(weekPlans = {}) {
  if (!weekPlans || typeof weekPlans !== 'object') return {};
  return Object.values(weekPlans).reduce((plans, plan) => {
    if (!plan || typeof plan !== 'object') return plans;
    const weekStart = plan.weekStart || getCurrentWeekStartKey();
    const normalized = normalizeWeekPlanRecord(plan, weekStart);
    plans[normalized.weekId] = normalized;
    return plans;
  }, {});
}

function ensureWeekPlanForStart(weekStartKey = getSelectedWeekStartKey()) {
  const weekId = getWeekIdFromDateKey(weekStartKey);
  const existing = weeklyWorkspaceState.weekPlans?.[weekId];
  const normalized = normalizeWeekPlanRecord(existing || {}, weekStartKey);
  weeklyWorkspaceState.weekPlans = {
    ...(weeklyWorkspaceState.weekPlans || {}),
    [weekId]: normalized,
  };
  return normalized;
}

function syncSelectedWeekPlanItems() {
  if (!selectedWeekStartKey) return;
  weeklyWorkspaceState.selectedWeekStartKey = selectedWeekStartKey;
  const plan = ensureWeekPlanForStart(selectedWeekStartKey);
  plan.items = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  plan.updatedAt = new Date().toISOString();
  weeklyWorkspaceState.weekPlanItems = plan.items;
}

function loadSelectedWeekPlanItems() {
  weeklyWorkspaceState.selectedWeekStartKey = getSelectedWeekStartKey();
  const plan = ensureWeekPlanForStart(getSelectedWeekStartKey());
  weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems(plan.items);
}

function getWeekPlanItemsForDate(dateKey) {
  const weekId = getWeekIdFromDateKey(getWeekStartKeyFromDateKey(dateKey));
  return normalizeWeekPlanItems(weeklyWorkspaceState.weekPlans?.[weekId]?.items || []);
}

function closeInactiveActiveWeek() {
  const currentWeekId = getCurrentWeekId();
  if (!weeklyWorkspaceState.activeWeekId || weeklyWorkspaceState.activeWeekId === currentWeekId) return false;

  const previousPlan = weeklyWorkspaceState.weekPlans?.[weeklyWorkspaceState.activeWeekId];
  if (previousPlan && !previousPlan.closedAt) {
    previousPlan.closedAt = new Date().toISOString();
    previousPlan.updatedAt = previousPlan.closedAt;
  }
  return true;
}

function activateCurrentWeek() {
  syncSelectedWeekPlanItems();
  const currentWeekStart = getCurrentWeekStartKey();
  const currentWeekId = getWeekIdFromDateKey(currentWeekStart);
  const changed = closeInactiveActiveWeek();

  weeklyWorkspaceState.activeWeekId = currentWeekId;
  weeklyWorkspaceState.activeWeekStartKey = currentWeekStart;
  ensureWeekPlanForStart(currentWeekStart);
  return changed;
}

function selectWeekStart(weekStartKey, shouldPersist = false) {
  const previousDateKey = getSelectedDailyLogDateKey();
  const weekdayOffset = getWeekDatesForDateKey(previousDateKey)
    .findIndex(day => day.key === previousDateKey);
  syncSelectedWeekPlanItems();
  selectedWeekStartKey = getWeekStartKeyFromDateKey(weekStartKey);
  selectedArchiveYear = getIsoWeekInfoFromDateKey(selectedWeekStartKey).year;
  weeklyWorkspaceState.selectedWeekStartKey = selectedWeekStartKey;
  selectedWeekEventId = null;
  loadSelectedWeekPlanItems();
  if (getWeekStartKeyFromDateKey(previousDateKey) !== selectedWeekStartKey) {
    selectDailyLogDate(shiftDateKey(selectedWeekStartKey, Math.max(0, weekdayOffset)));
  }
  renderWeekCalendar();
  renderWeekPlan();
  renderDailyLogArchive();
  renderYearArchive();
  if (shouldPersist) scheduleWeeklyWorkspaceSave();
}

function getWeekRangeLabel(weekDates) {
  const weekInfo = getIsoWeekInfoFromDateKey(weekDates[0].key);
  return `${weekInfo.year} W${String(weekInfo.weekNumber).padStart(2, '0')} - ${shortDateFromKey(weekDates[0].key)} - ${shortDateFromKey(weekDates[6].key)}`;
}

function isSelectedWeekCurrent() {
  return getSelectedWeekStartKey() === getCurrentWeekStartKey();
}

function getIsoWeekInfoFromDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: weekYear, weekNumber };
}

function getCurrentDailyLog() {
  return getDailyLogForDate(getShanghaiTodayKey());
}

function getDailyLogForDate(dateKey) {
  if (!weeklyWorkspaceState.logs[dateKey]) {
    weeklyWorkspaceState.logs[dateKey] = {};
  }
  return weeklyWorkspaceState.logs[dateKey];
}

function normalizeDailyDraft(draft, logs = {}) {
  const todayKey = getShanghaiTodayKey();
  if (draft && typeof draft === 'object' && draft.dateKey === todayKey) {
    return {
      dateKey: todayKey,
      ...Object.fromEntries(DAILY_LOG_DRAFT_KEYS.map(key => [key, draft[key] || ''])),
    };
  }

  const todayLog = logs[todayKey] || {};
  return {
    dateKey: todayKey,
    ...Object.fromEntries(DAILY_LOG_DRAFT_KEYS.map(key => [key, todayLog[key] || ''])),
  };
}

function getDailyDraft() {
  weeklyWorkspaceState.dailyDraft = normalizeDailyDraft(weeklyWorkspaceState.dailyDraft, weeklyWorkspaceState.logs);
  return weeklyWorkspaceState.dailyDraft;
}

function getSelectedDailyLogDateKey() {
  return /^\d{4}-\d{2}-\d{2}$/.test(selectedDailyLogDateKey)
    ? selectedDailyLogDateKey
    : getShanghaiTodayKey();
}

function getDailyLogSourceForDate(dateKey) {
  const log = weeklyWorkspaceState.logs?.[dateKey] || {};
  if (dateKey !== getShanghaiTodayKey()) return log;

  const draft = getDailyDraft();
  return {
    ...log,
    ...Object.fromEntries(DAILY_LOG_DRAFT_KEYS.map(key => [key, draft[key] || ''])),
  };
}

function getDailyLogDateMode(dateKey) {
  const todayKey = getShanghaiTodayKey();
  if (dateKey < todayKey) return 'supplement';
  if (dateKey > todayKey) return 'plan';
  return 'draft';
}

function hasDailyLogSourceContent(dateKey) {
  const source = getDailyLogSourceForDate(dateKey);
  return DAILY_LOG_DRAFT_KEYS.some(key => String(source[key] || '').trim()) ||
    weeklyWorkspaceState.events.some(event => event.dateKey === dateKey);
}

function getDailyLogSourceSignature(dateKey) {
  const source = getDailyLogSourceForDate(dateKey);
  const events = weeklyWorkspaceState.events
    .filter(event => event.dateKey === dateKey && !event.isDraft)
    .map(event => ({
      id: event.id,
      startMinute: event.startMinute,
      endMinute: event.endMinute,
      title: event.title || '',
      content: event.content || '',
    }))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id));

  return JSON.stringify({
    events,
    fields: Object.fromEntries(DAILY_LOG_DRAFT_KEYS.map(key => [key, source[key] || ''])),
  });
}

function isDailyLogStale(dateKey) {
  const log = weeklyWorkspaceState.logs?.[dateKey];
  if (!(log?.generated || '').trim()) return false;
  if (!log.generatedSourceSignature) {
    return log.generated.trim() !== generateDailyLogText(dateKey).trim();
  }
  return log.generatedSourceSignature !== getDailyLogSourceSignature(dateKey);
}

function selectDailyLogDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return;
  const previousDateKey = getSelectedDailyLogDateKey();
  let capturedChange = false;
  document.querySelectorAll('[data-log-key][data-log-date-key]').forEach(textarea => {
    if (textarea.dataset.logDateKey !== previousDateKey) return;
    const fieldKey = textarea.dataset.logKey;
    if (!DAILY_LOG_DRAFT_KEYS.includes(fieldKey)) return;
    if (getDailyLogFieldValue(fieldKey, previousDateKey) === textarea.value) return;
    setDailyLogFieldValue(fieldKey, textarea.value, previousDateKey);
    capturedChange = true;
  });
  flushDailyLogGeneratedSectionSync();
  selectedDailyLogDateKey = dateKey;
  document.querySelectorAll('.week-day-head[data-log-date-key]').forEach(dayButton => {
    const selected = dayButton.dataset.logDateKey === dateKey;
    dayButton.classList.toggle('is-selected', selected);
    if (selected) dayButton.setAttribute('aria-current', 'date');
    else dayButton.removeAttribute('aria-current');
  });
  closeDailyLogClearConfirm();
  closeDailyLogRegenerateConfirm();
  renderDailyLogPanel();
  renderDailyLogArchive();
  if (capturedChange) scheduleWeeklyWorkspaceSave();
}

function openWorkspaceDailyLogDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return;
  if (dateKey !== getSelectedDailyLogDateKey()) selectDailyLogDate(dateKey);
  const weekStartKey = getWeekStartKeyFromDateKey(dateKey);
  if (weekStartKey !== getSelectedWeekStartKey()) selectWeekStart(weekStartKey, true);
  switchWorkspaceTab('daily', { focusTab: true });
}

function scheduleWeeklyWorkspaceSave() {
  if (weeklyWorkspaceSaveTimer) clearTimeout(weeklyWorkspaceSaveTimer);
  weeklyWorkspaceSaveTimer = setTimeout(() => {
    persistWeeklyWorkspaceState();
  }, 350);
}

async function persistWeeklyWorkspaceState() {
  if (!workspaceSyncClient) return;
  const persisted = getPersistedWeeklyWorkspaceState();
  await workspaceSyncClient.captureWorkspace(persisted);
  scheduleWorkspaceAutoSync();
}

function flushWeeklyWorkspaceSave() {
  if (weeklyWorkspaceSaveTimer) {
    clearTimeout(weeklyWorkspaceSaveTimer);
    weeklyWorkspaceSaveTimer = null;
  }
  return persistWeeklyWorkspaceState();
}

function getPersistedWeeklyWorkspaceState() {
  syncSelectedWeekPlanItems();
  return {
    ...weeklyWorkspaceState,
    version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
    selectedWeekStartKey: getSelectedWeekStartKey(),
    weekPlanItems: normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems),
    weekPlans: normalizeWeekPlans(weeklyWorkspaceState.weekPlans),
    events: weeklyWorkspaceState.events
      .filter(event => !event.isDraft)
      .map(({ isDraft, ...event }) => ({
        ...event,
        weekId: getWeekIdFromDateKey(event.dateKey),
      })),
  };
}

function getWorkspaceForExport(scope = 'all', dateKey = getSelectedDailyLogDateKey()) {
  const workspace = getPersistedWeeklyWorkspaceState();
  if (scope === 'all') return workspace;
  const weekStartKey = getWeekStartKeyFromDateKey(dateKey);
  const dateKeys = scope === 'day'
    ? new Set([dateKey])
    : new Set(getWeekDatesForDateKey(weekStartKey).map(day => day.key));
  const weekId = getWeekIdFromDateKey(weekStartKey);
  const logs = Object.fromEntries(Object.entries(workspace.logs || {}).filter(([key]) => dateKeys.has(key)));
  const weekPlans = scope === 'week' && workspace.weekPlans?.[weekId]
    ? { [weekId]: clonePlainObject(workspace.weekPlans[weekId]) }
    : {};
  const scoped = {
    version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
    activeWeekId: weekId,
    activeWeekStartKey: weekStartKey,
    selectedWeekStartKey: weekStartKey,
    planner: {},
    events: (workspace.events || []).filter(event => dateKeys.has(event.dateKey)),
    weekPlanItems: scope === 'week' ? normalizeWeekPlanItems(weekPlans[weekId]?.items || []) : [],
    weekPlans,
    logs,
    dailyDraft: dateKeys.has(workspace.dailyDraft?.dateKey)
      ? clonePlainObject(workspace.dailyDraft)
      : { dateKey, inspiration: '', plan: '', action: '', creation: '' },
  };
  return scoped;
}

function getWorkspaceExportPayload(scope = 'all', dateKey = getSelectedDailyLogDateKey()) {
  const weekStartKey = getWeekStartKeyFromDateKey(dateKey);
  return {
    app: 'tab-out',
    type: WEEKLY_WORKSPACE_STORAGE_KEY,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    dateKey: scope === 'day' ? dateKey : undefined,
    weekStartKey: scope === 'week' ? weekStartKey : undefined,
    weekEndKey: scope === 'week' ? shiftDateKey(weekStartKey, 6) : undefined,
    weeklyWorkspace: getWorkspaceForExport(scope, dateKey),
  };
}

function getImportedWorkspacePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.weeklyWorkspace || payload.data || payload;
}

function normalizeWorkspaceImport(workspace) {
  if (!workspace || typeof workspace !== 'object') return null;

  const logs = workspace.logs && typeof workspace.logs === 'object' ? workspace.logs : {};
  const activeWeekStartKey = workspace.activeWeekStartKey || getCurrentWeekStartKey();
  const activeWeekId = workspace.activeWeekId || getWeekIdFromDateKey(activeWeekStartKey);
  const selectedWeekStartKey = workspace.selectedWeekStartKey || activeWeekStartKey;
  const selectedWeekId = getWeekIdFromDateKey(selectedWeekStartKey);
  const weekPlans = normalizeWeekPlans(workspace.weekPlans || {});
  let weekPlanItems = normalizeWeekPlanItems(workspace.weekPlanItems || []);
  if (!weekPlanItems.length) {
    const todayLog = logs[getShanghaiTodayKey()] || {};
    const scratchText = String(workspace.dailyDraft?.scratch || todayLog.scratch || '').trim();
    weekPlanItems = normalizeWeekPlanItems(
      scratchText.split('\n').map(line => ({ text: line.trim(), completed: false }))
    );
  }
  if (weekPlanItems.length) {
    const selectedPlan = weekPlans[selectedWeekId] || normalizeWeekPlanRecord({}, selectedWeekStartKey);
    weekPlans[selectedWeekId] = {
      ...selectedPlan,
      items: mergeWeekPlanItems(selectedPlan.items, weekPlanItems),
    };
  }
  return {
    version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
    activeWeekId,
    activeWeekStartKey,
    selectedWeekStartKey,
    planner: workspace.planner && typeof workspace.planner === 'object' ? workspace.planner : {},
    events: normalizeWeekEvents(workspace.events || []),
    weekPlanItems,
    weekPlans,
    logs,
    dailyDraft: normalizeDailyDraft(workspace.dailyDraft, logs),
  };
}

function getWeekEventSignature(event) {
  return [
    event.dateKey,
    event.startMinute,
    event.endMinute,
    event.title || '',
    event.content || '',
  ].join('|');
}

function mergeWeekEvents(currentEvents, importedEvents) {
  const merged = normalizeWeekEvents(currentEvents || []);
  const indexById = new Map();
  const signatures = new Set();

  merged.forEach((event, index) => {
    if (event.id) indexById.set(event.id, index);
    signatures.add(getWeekEventSignature(event));
  });

  normalizeWeekEvents(importedEvents || []).forEach(event => {
    if (event.id && indexById.has(event.id)) {
      const index = indexById.get(event.id);
      merged[index] = event;
      signatures.add(getWeekEventSignature(event));
      return;
    }

    const signature = getWeekEventSignature(event);
    if (signatures.has(signature)) return;

    merged.push(event);
    if (event.id) indexById.set(event.id, merged.length - 1);
    signatures.add(signature);
  });

  return merged;
}

function mergeWeekPlanItems(currentItems, importedItems) {
  const merged = normalizeWeekPlanItems(currentItems || []);
  const indexById = new Map(merged.map((item, index) => [item.id, index]));
  const signatures = new Set(merged.map(item => `${item.text}|${item.completed}`));

  normalizeWeekPlanItems(importedItems || []).forEach(item => {
    if (item.id && indexById.has(item.id)) {
      merged[indexById.get(item.id)] = item;
      signatures.add(`${item.text}|${item.completed}`);
      return;
    }

    const signature = `${item.text}|${item.completed}`;
    if (signatures.has(signature)) return;

    indexById.set(item.id, merged.length);
    signatures.add(signature);
    merged.push(item);
  });

  return normalizeWeekPlanItems(merged);
}

function mergeWeekPlans(currentPlans, importedPlans) {
  const merged = normalizeWeekPlans(currentPlans || {});
  const imported = normalizeWeekPlans(importedPlans || {});

  Object.entries(imported).forEach(([weekId, importedPlan]) => {
    const existingPlan = merged[weekId];
    if (!existingPlan) {
      merged[weekId] = importedPlan;
      return;
    }

    merged[weekId] = {
      ...existingPlan,
      ...importedPlan,
      items: mergeWeekPlanItems(existingPlan.items, importedPlan.items),
      summary: importedPlan.summary || existingPlan.summary || '',
      closedAt: importedPlan.closedAt || existingPlan.closedAt || '',
      updatedAt: importedPlan.updatedAt || existingPlan.updatedAt || '',
    };
  });

  return normalizeWeekPlans(merged);
}

function hasDailyDraftContent(draft) {
  if (!draft || typeof draft !== 'object') return false;
  return DAILY_LOG_DRAFT_KEYS.some(key => String(draft[key] || '').trim());
}

function mergeWorkspaceImport(currentWorkspace, importedWorkspace) {
  const current = normalizeWorkspaceImport(currentWorkspace) || {
    version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
    activeWeekId: getCurrentWeekId(),
    activeWeekStartKey: getCurrentWeekStartKey(),
    selectedWeekStartKey: getCurrentWeekStartKey(),
    planner: {},
    events: [],
    weekPlanItems: [],
    weekPlans: {},
    logs: {},
    dailyDraft: normalizeDailyDraft(),
  };
  const imported = normalizeWorkspaceImport(importedWorkspace);
  if (!imported) return null;

  const logs = { ...current.logs };
  Object.entries(imported.logs).forEach(([dateKey, log]) => {
    if (!dateKey || !log || typeof log !== 'object') return;
    logs[dateKey] = { ...(logs[dateKey] || {}), ...log };
  });

  return {
    version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
    activeWeekId: current.activeWeekId || imported.activeWeekId || getCurrentWeekId(),
    activeWeekStartKey: current.activeWeekStartKey || imported.activeWeekStartKey || getCurrentWeekStartKey(),
    selectedWeekStartKey: current.selectedWeekStartKey || imported.selectedWeekStartKey || getCurrentWeekStartKey(),
    planner: { ...current.planner, ...imported.planner },
    events: mergeWeekEvents(current.events, imported.events),
    weekPlanItems: mergeWeekPlanItems(current.weekPlanItems, imported.weekPlanItems),
    weekPlans: mergeWeekPlans(current.weekPlans, imported.weekPlans),
    logs,
    dailyDraft: hasDailyDraftContent(imported.dailyDraft) ? imported.dailyDraft : current.dailyDraft,
  };
}

function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function getWeeklyWorkspaceUndoSnapshot() {
  syncSelectedWeekPlanItems();
  return {
    events: weeklyWorkspaceState.events.map(event => ({ ...event })),
    weekPlanItems: weeklyWorkspaceState.weekPlanItems.map(item => ({ ...item })),
    weekPlans: clonePlainObject(weeklyWorkspaceState.weekPlans),
    logs: clonePlainObject(weeklyWorkspaceState.logs),
    dailyDraft: clonePlainObject(weeklyWorkspaceState.dailyDraft),
    selectedWeekStartKey,
    selectedWeekEventId,
    selectedDailyLogDateKey,
  };
}

function pushWeeklyWorkspaceUndoSnapshot(snapshot) {
  if (!snapshot) return;
  weeklyWorkspaceUndoStack.push(snapshot);
  if (weeklyWorkspaceUndoStack.length > WEEKLY_WORKSPACE_UNDO_LIMIT) {
    weeklyWorkspaceUndoStack.shift();
  }
}

function areWeekEventSnapshotsEqual(snapshot) {
  if (!snapshot) return true;
  return JSON.stringify(snapshot.events) === JSON.stringify(weeklyWorkspaceState.events);
}

function restoreWeeklyWorkspaceSnapshot(snapshot) {
  weeklyWorkspaceState.events = snapshot.events.map(event => ({ ...event }));
  if (snapshot.weekPlans) weeklyWorkspaceState.weekPlans = normalizeWeekPlans(snapshot.weekPlans);
  if (snapshot.selectedWeekStartKey) selectedWeekStartKey = snapshot.selectedWeekStartKey;
  if (snapshot.weekPlanItems) weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems(snapshot.weekPlanItems);
  if (snapshot.logs) weeklyWorkspaceState.logs = clonePlainObject(snapshot.logs);
  if (snapshot.dailyDraft) weeklyWorkspaceState.dailyDraft = normalizeDailyDraft(snapshot.dailyDraft, weeklyWorkspaceState.logs);
  selectedWeekEventId = snapshot.selectedWeekEventId;
  if (snapshot.selectedDailyLogDateKey) selectedDailyLogDateKey = snapshot.selectedDailyLogDateKey;
  syncSelectedWeekPlanItems();

  const overlay = document.getElementById('weekEntryEditor');
  if (overlay?.classList.contains('visible')) {
    overlay.classList.remove('visible');
    document.body.classList.remove('week-editor-open');
  }

  scheduleWeeklyWorkspaceSave();
  renderWeekCalendar();
  renderWeekPlan();
  renderDailyLogPanel();
  renderDailyLogArchive();
}

function undoWeeklyWorkspaceChange() {
  const snapshot = weeklyWorkspaceUndoStack.pop();
  if (!snapshot) {
    showToast('Nothing to undo');
    allowEditableUndoAfterDailyClear = false;
    return false;
  }

  restoreWeeklyWorkspaceSnapshot(snapshot);
  allowEditableUndoAfterDailyClear = false;
  showToast('Undone');
  return true;
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.matches('input, textarea, select')
  );
}

function cleanupDraftWeekEvents(exceptEventId = null) {
  const before = weeklyWorkspaceState.events.length;
  weeklyWorkspaceState.events = weeklyWorkspaceState.events.filter(event => {
    return !event.isDraft || event.id === exceptEventId;
  });
  if (before !== weeklyWorkspaceState.events.length && selectedWeekEventId) {
    const selectedStillExists = weeklyWorkspaceState.events.some(event => event.id === selectedWeekEventId);
    if (!selectedStillExists) selectedWeekEventId = null;
  }
  return before !== weeklyWorkspaceState.events.length;
}

function commitWeekEvent(event) {
  if (!event || !event.isDraft) return;
  event.isDraft = false;
  scheduleWeeklyWorkspaceSave();
}

function renderWeekCalendar() {
  const calendarEl = document.getElementById('weekCalendar');
  const rangeEl = document.getElementById('weekRangeLabel');
  if (!calendarEl) return;
  weekEventSummaryObserver.disconnect();
  calendarEl.classList.toggle('has-early-hours', plannerEarlyHoursExpanded);
  calendarEl.style.setProperty('--planner-row-height', `${PLANNER_ROW_HEIGHT}px`);
  calendarEl.style.setProperty('--planner-day-height', `${(PLANNER_END_HOUR - PLANNER_EARLY_HOURS_END + 1) * PLANNER_ROW_HEIGHT}px`);
  const previousBodyEl = calendarEl.querySelector('.week-grid-body');
  const previousScrollTop = previousBodyEl ? previousBodyEl.scrollTop : null;

  const weekDates = getSelectedWeekDates();
  const todayKey = getShanghaiTodayKey();
  const visibleStartHour = plannerEarlyHoursExpanded ? PLANNER_START_HOUR : PLANNER_EARLY_HOURS_END;
  calendarEl.style.setProperty('--planner-grid-height', `${(PLANNER_END_HOUR - visibleStartHour + 1) * PLANNER_ROW_HEIGHT}px`);
  const earlyEventCount = weeklyWorkspaceState.events.filter(event => (
    weekDates.some(day => day.key === event.dateKey) &&
    event.startMinute < PLANNER_EARLY_HOURS_END * 60 &&
    weekEventVisualEnd(event) > PLANNER_START_HOUR * 60
  )).length;
  if (rangeEl) {
    rangeEl.textContent = `${getWeekRangeLabel(weekDates)} Shanghai`;
  }

  const headerHtml = `
    <div class="week-grid-head">
      <div class="week-time-head"></div>
      ${weekDates.map(day => `
        <button class="week-day-head ${day.key === todayKey ? 'is-today' : ''} ${day.key === getSelectedDailyLogDateKey() ? 'is-selected' : ''}" type="button" data-action="open-workspace-daily-log-date" data-log-date-key="${day.key}" aria-label="打开 ${day.key} 日课" ${day.key === getSelectedDailyLogDateKey() ? 'aria-current="date"' : ''}>
          <span class="week-day-name">${day.dayName}</span>
          <span class="week-day-date">${day.label}</span>
        </button>`).join('')}
    </div>`;

  const earlyHoursToggleHtml = `
    <button class="early-hours-toggle${plannerEarlyHoursExpanded ? ' is-expanded' : ''}" type="button" data-action="toggle-early-hours" aria-expanded="${plannerEarlyHoursExpanded}" aria-controls="weekGridBody">
      <span class="early-hours-time">00:00–${pad2(PLANNER_EARLY_HOURS_END)}:00</span>
      <span class="early-hours-toggle-copy">
        <span class="early-hours-rule" aria-hidden="true"></span>
        <span>${plannerEarlyHoursExpanded ? 'Hide early hours' : 'Show early hours'}</span>
        ${earlyEventCount ? `<span class="early-hours-count">${earlyEventCount} block${earlyEventCount === 1 ? '' : 's'}</span>` : ''}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="early-hours-rule" aria-hidden="true"></span>
      </span>
    </button>`;

  const rowsHtml = Array.from({ length: PLANNER_END_HOUR - visibleStartHour + 1 }, (_, index) => {
    const hour = visibleStartHour + index;
    const cells = weekDates.map(day => {
      return `
        <div class="week-hour-cell ${day.key === todayKey ? 'is-today' : ''}" data-day-key="${day.key}" data-hour="${hour}"></div>`;
    }).join('');

    return `
      <div class="week-grid-row" data-hour="${hour}">
        <div class="week-time-cell">${pad2(hour)}:00</div>
        ${cells}
      </div>`;
  }).join('');

  calendarEl.innerHTML = `
    ${headerHtml}
    ${earlyHoursToggleHtml}
    <div class="week-grid-body" id="weekGridBody">
      ${rowsHtml}
      <div class="week-time-end">24:00</div>
      <div class="week-events-layer" id="weekEventsLayer">
        ${renderWeekEvents(weekDates)}
      </div>
      <div class="current-time-line" id="currentTimeLine" style="display:none"></div>
    </div>`;
  const bodyEl = document.getElementById('weekGridBody');
  if (bodyEl) {
    if (previousScrollTop !== null) bodyEl.scrollTop = previousScrollTop;
    const scrollbarWidth = `${bodyEl.offsetWidth - bodyEl.clientWidth}px`;
    calendarEl.style.setProperty('--week-scrollbar-width', scrollbarWidth);
    calendarEl.closest('.weekly-workspace')?.style.setProperty('--week-scrollbar-width', scrollbarWidth);
  }
  calendarEl.querySelectorAll('.week-event').forEach(eventEl => {
    updateWeekEventSummarySpace(eventEl);
    weekEventSummaryObserver.observe(eventEl.querySelector('.week-event-header'));
  });
  updateWeekTimeLine();
  renderYearArchive();
}

function togglePlannerEarlyHours() {
  const bodyEl = document.getElementById('weekGridBody');
  const previousStartMinute = getPlannerDisplayStartMinute();
  const anchorMinute = previousStartMinute + ((bodyEl?.scrollTop || 0) / PLANNER_ROW_HEIGHT) * 60;

  plannerEarlyHoursExpanded = !plannerEarlyHoursExpanded;
  renderWeekCalendar();

  const nextBodyEl = document.getElementById('weekGridBody');
  if (nextBodyEl) {
    nextBodyEl.scrollTop = plannerEarlyHoursExpanded
      ? 0
      : Math.max(0, ((anchorMinute - getPlannerDisplayStartMinute()) / 60) * PLANNER_ROW_HEIGHT);
  }
}

function weekEventsOverlap(a, b) {
  return a.startMinute < weekEventVisualEnd(b) && b.startMinute < weekEventVisualEnd(a);
}

function weekEventVisualEnd(event) {
  return String(event.id || '').startsWith('focus-session-')
    ? Math.max(event.endMinute, event.startMinute + Math.ceil(28 / PLANNER_ROW_HEIGHT * 60))
    : event.endMinute;
}

function getWeekEventLayoutMap(events) {
  const layout = new Map();
  const eventsByDate = new Map();

  for (const event of events) {
    if (!eventsByDate.has(event.dateKey)) eventsByDate.set(event.dateKey, []);
    eventsByDate.get(event.dateKey).push(event);
  }

  for (const dayEvents of eventsByDate.values()) {
    const overlapIds = new Set();
    for (const event of dayEvents) {
      if (dayEvents.some(other => other.id !== event.id && weekEventsOverlap(event, other))) {
        overlapIds.add(event.id);
      }
    }

    let activeColumns = [];
    const sorted = [...dayEvents].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
    for (const event of sorted) {
      if (!overlapIds.has(event.id)) {
        layout.set(event.id, { column: 0, columns: 1 });
        continue;
      }

      activeColumns = activeColumns.filter(item => item.endMinute > event.startMinute);
      const usedColumns = new Set(activeColumns.map(item => item.column));
      const column = usedColumns.has(0) && !usedColumns.has(1) ? 1 : 0;
      activeColumns.push({ endMinute: weekEventVisualEnd(event), column });
      layout.set(event.id, { column, columns: 2 });
    }
  }

  return layout;
}

function renderWeekEvents(weekDates) {
  const displayStart = getPlannerDisplayStartMinute();
  const displayEnd = getPlannerDisplayEndMinute();
  const dayIndexByKey = new Map(weekDates.map((day, index) => [day.key, index]));
  const visibleEvents = weeklyWorkspaceState.events
    .filter(event => dayIndexByKey.has(event.dateKey))
    .filter(event => weekEventVisualEnd(event) > displayStart && event.startMinute < displayEnd)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const layoutById = getWeekEventLayoutMap(visibleEvents);

  return visibleEvents
    .map(event => {
      const dayIndex = dayIndexByKey.get(event.dateKey);
      const layout = layoutById.get(event.id) || { column: 0, columns: 1 };
      const top = ((Math.max(event.startMinute, displayStart) - displayStart) / 60) * PLANNER_ROW_HEIGHT;
      const height = Math.max(
        28,
        ((Math.min(event.endMinute, displayEnd) - Math.max(event.startMinute, displayStart)) / 60) * PLANNER_ROW_HEIGHT - 4
      );
      const selectedClass = event.id === selectedWeekEventId ? 'is-selected' : '';
      const draftClass = event.isDraft ? 'is-draft' : '';
      const summaryLineCount = getWeekEventSummaryLineCount(height);
      const summarySpaceClass = summaryLineCount ? '' : 'has-no-summary-space';
      const contentPreview = getWeekEventContentPreview(event.content);
      const contentPreviewHtml = contentPreview
        ? `<div class="week-event-summary">${escapeHtml(contentPreview)}</div>`
        : '';

      return `
        <article class="week-event event-color-${['yellow', 'pink', 'blue', 'purple', 'white'].includes(event.color) ? event.color : 'yellow'} ${selectedClass} ${draftClass} ${summarySpaceClass}" data-action="select-week-event" data-event-id="${escapeAttr(event.id)}" style="--day-index:${dayIndex}; --event-col:${layout.column}; --event-cols:${layout.columns}; --week-event-summary-lines:${summaryLineCount}; top:${top + 2}px; height:${height}px;" tabindex="0" aria-label="${escapeAttr(event.title)} ${formatPlannerRange(event)}">
          <div class="week-resize-handle top" data-event-id="${escapeAttr(event.id)}" data-edge="top"></div>
          <button class="week-event-delete" data-action="delete-week-event" data-event-id="${escapeAttr(event.id)}" title="Delete" aria-label="Delete ${escapeAttr(event.title || DEFAULT_WEEK_EVENT_TITLE)}"></button>
          <div class="week-event-main">
            <div class="week-event-header">
              <div class="week-event-time">${formatPlannerRange(event)}</div>
              <div class="week-event-title">${escapeHtml(event.title || DEFAULT_WEEK_EVENT_TITLE)}</div>
            </div>
            ${contentPreviewHtml}
          </div>
          <button class="week-event-expand" data-action="open-week-entry-editor" data-event-id="${escapeAttr(event.id)}" title="Expand editor" aria-label="Expand ${escapeAttr(event.title || DEFAULT_WEEK_EVENT_TITLE)}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
          <div class="week-resize-handle bottom" data-event-id="${escapeAttr(event.id)}" data-edge="bottom"></div>
        </article>`;
    }).join('');
}

function renderWeekPlan(renderEditor = true, normalizeState = true) {
  const listEl = document.getElementById('weekPlanList');
  if (!listEl) return;

  const items = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  if (normalizeState) weeklyWorkspaceState.weekPlanItems = items;
  if (!items.length) {
    listEl.innerHTML = '<div class="week-plan-empty">这一周重要的事情会显示在这里。点击展开开始编辑。</div>';
    if (renderEditor) renderWeekPlanEditorList();
    renderYearArchive();
    return;
  }

  const visibleItems = items.slice(0, 4);
  const hiddenCount = items.length - visibleItems.length;
  listEl.innerHTML = `
    ${visibleItems.map(item => `
    <div class="week-plan-item${item.completed ? ' is-completed' : ''}" data-action="toggle-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}">
      <button class="week-plan-toggle" type="button" data-action="toggle-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}" aria-pressed="${item.completed ? 'true' : 'false'}" aria-label="Toggle ${escapeAttr(item.text)}"></button>
      <button class="week-plan-text" type="button" data-action="toggle-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}">${escapeHtml(item.text)}</button>
    </div>
    `).join('')}
    ${hiddenCount > 0 ? `<button class="week-plan-more" type="button" data-action="open-week-plan-editor">还有 ${hiddenCount} 条，展开查看</button>` : ''}
  `;
  if (renderEditor) renderWeekPlanEditorList();
  renderYearArchive();
}

function ensureWeekPlanEditor() {
  let overlay = document.getElementById('weekPlanEditor');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'weekPlanEditor';
  overlay.className = 'week-editor-overlay';
  overlay.innerHTML = `
    <div class="week-editor-panel week-plan-editor-panel" role="dialog" aria-modal="true" aria-labelledby="weekPlanEditorTitle">
      <div class="week-editor-topbar">
        <div>
          <div class="week-editor-kicker">Weekly tips</div>
          <h3 id="weekPlanEditorTitle">周计划</h3>
        </div>
        <div class="week-editor-actions">
          <button class="week-editor-copy" data-action="copy-week-plan" title="Copy week plan" aria-label="Copy week plan">Copy</button>
          <button class="week-editor-close" data-action="close-week-plan-editor" title="Close editor" aria-label="Close editor">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="week-editor-fields">
        <form class="week-plan-form week-plan-editor-form" id="weekPlanEditorForm">
          <input id="weekPlanEditorInput" type="text" aria-label="Add 周计划 item" placeholder="这一周重要的、想办的事情..." autocomplete="off">
          <button class="focus-btn" type="submit">Add</button>
        </form>
        <div class="week-plan-editor-list" id="weekPlanEditorList" aria-label="Edit 周计划 list"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const editorList = overlay.querySelector('#weekPlanEditorList');
  editorList?.addEventListener('dragstart', handleWeekPlanDragStart);
  editorList?.addEventListener('dragover', handleWeekPlanDragOver);
  editorList?.addEventListener('drop', handleWeekPlanDrop);
  editorList?.addEventListener('dragend', handleWeekPlanDragEnd);
  return overlay;
}

function getWeekPlanEditorItemMarkup(item, isEditing = false) {
  return `
    <div class="week-plan-editor-item${item.completed ? ' is-completed' : ''}${isEditing ? ' is-editing' : ''}" draggable="${isEditing ? 'false' : 'true'}" data-action="toggle-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}">
      <span class="week-plan-drag-handle" aria-hidden="true">⋮⋮</span>
      <button class="week-plan-toggle" type="button" data-action="toggle-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}" aria-pressed="${item.completed ? 'true' : 'false'}" aria-label="Toggle ${escapeAttr(item.text)}"></button>
      <div class="week-plan-edit-area">
        <button class="week-plan-item-summary" type="button" data-action="edit-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}" aria-expanded="${isEditing ? 'true' : 'false'}" title="点击展开编辑">${escapeHtml(item.text)}</button>
        <textarea class="week-plan-item-input" rows="1" data-week-plan-id="${escapeAttr(item.id)}" aria-label="Edit 周计划 item">${escapeHtml(item.text)}</textarea>
        <div class="week-plan-edit-tools">
          <span>Enter 完成 · Esc 取消</span>
          <div class="week-plan-edit-actions">
            <button class="week-plan-edit-cancel" type="button" data-action="cancel-week-plan-item-edit" data-week-plan-id="${escapeAttr(item.id)}">取消</button>
            <button class="week-plan-edit-done" type="button" data-action="finish-week-plan-item-edit" data-week-plan-id="${escapeAttr(item.id)}">完成</button>
          </div>
        </div>
      </div>
      <button class="week-plan-delete" type="button" data-action="delete-week-plan-item" data-week-plan-id="${escapeAttr(item.id)}" title="Delete" aria-label="Delete ${escapeAttr(item.text)}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 4v6m4-6v6m4-10-.7 12.1A2 2 0 0 1 13.3 21h-2.6a2 2 0 0 1-2-1.9L8 7" />
        </svg>
      </button>
    </div>
  `;
}

function renderWeekPlanEditorList() {
  const listEl = document.getElementById('weekPlanEditorList');
  if (!listEl) return;

  const items = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  weeklyWorkspaceState.weekPlanItems = items;
  if (editingWeekPlanItemId && !items.some(item => item.id === editingWeekPlanItemId)) {
    editingWeekPlanItemId = null;
    editingWeekPlanOriginalText = '';
  }

  if (!items.length) {
    listEl.innerHTML = '<div class="week-plan-empty">还没有清单。先添加一条这一周想完成的事。</div>';
    return;
  }

  listEl.innerHTML = items
    .map(item => getWeekPlanEditorItemMarkup(item, item.id === editingWeekPlanItemId))
    .join('');

  const activeInput = listEl.querySelector('.week-plan-editor-item.is-editing .week-plan-item-input');
  if (activeInput) resizeWeekPlanItemInput(activeInput);
}

function resizeWeekPlanItemInput(input) {
  if (!input?.matches('.week-plan-item-input')) return;
  input.style.height = '0px';
  const height = Math.min(Math.max(input.scrollHeight, 58), 180);
  input.style.height = `${height}px`;
  input.classList.toggle('is-scrollable', input.scrollHeight > height);
}

function finishWeekPlanItemEdit(itemId = editingWeekPlanItemId, cancel = false) {
  if (!itemId || itemId !== editingWeekPlanItemId) return;

  const item = weeklyWorkspaceState.weekPlanItems.find(planItem => planItem.id === itemId);
  if (cancel && item) {
    item.text = editingWeekPlanOriginalText;
    syncSelectedWeekPlanItems();
    renderWeekPlan(false, false);
    scheduleWeeklyWorkspaceSave();
  }

  const itemEl = document.querySelector(`.week-plan-editor-item[data-week-plan-id="${CSS.escape(itemId)}"]`);
  const input = itemEl?.querySelector('.week-plan-item-input');
  const summary = itemEl?.querySelector('.week-plan-item-summary');
  if (input) {
    input.value = item?.text || '';
    input.style.height = '';
    input.classList.remove('is-scrollable');
    input.blur();
  }
  if (summary) {
    summary.textContent = item?.text || '';
    summary.setAttribute('aria-expanded', 'false');
  }
  itemEl?.classList.remove('is-editing');
  itemEl?.setAttribute('draggable', 'true');
  editingWeekPlanItemId = null;
  editingWeekPlanOriginalText = '';
}

function startWeekPlanItemEdit(itemId) {
  const item = weeklyWorkspaceState.weekPlanItems.find(planItem => planItem.id === itemId);
  const itemEl = document.querySelector(`.week-plan-editor-item[data-week-plan-id="${CSS.escape(itemId)}"]`);
  if (!item || !itemEl) return;

  if (editingWeekPlanItemId && editingWeekPlanItemId !== itemId) {
    finishWeekPlanItemEdit(editingWeekPlanItemId);
  }

  editingWeekPlanItemId = itemId;
  editingWeekPlanOriginalText = item.text;
  itemEl.classList.add('is-editing');
  itemEl.setAttribute('draggable', 'false');
  itemEl.querySelector('.week-plan-item-summary')?.setAttribute('aria-expanded', 'true');

  const input = itemEl.querySelector('.week-plan-item-input');
  if (!input) return;
  resizeWeekPlanItemInput(input);
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  itemEl.scrollIntoView({ block: 'nearest' });
}

function openWeekPlanEditor() {
  const overlay = ensureWeekPlanEditor();
  renderWeekPlanEditorList();
  overlay.classList.add('visible');
  document.body.classList.add('week-editor-open');
  requestAnimationFrame(() => overlay.querySelector('#weekPlanEditorInput')?.focus({ preventScroll: true }));
}

function closeWeekPlanEditor() {
  const overlay = document.getElementById('weekPlanEditor');
  if (!overlay) return;
  finishWeekPlanItemEdit();
  overlay.classList.remove('visible');
  document.body.classList.remove('week-editor-open');
}

function getNextWeekPlanOrder() {
  return weeklyWorkspaceState.weekPlanItems.reduce((maxOrder, item) => {
    const order = Number(item.order);
    return Number.isFinite(order) ? Math.max(maxOrder, order) : maxOrder;
  }, -1) + 1;
}

function reindexWeekPlanItems() {
  weeklyWorkspaceState.weekPlanItems.forEach((item, index) => {
    item.order = index;
  });
}

function handleWeekPlanDragStart(e) {
  if (e.target.closest('input, textarea, button')) {
    e.preventDefault();
    return;
  }

  const itemEl = e.target.closest('.week-plan-editor-item');
  if (!itemEl) return;
  draggingWeekPlanUndoSnapshot = getWeeklyWorkspaceUndoSnapshot();
  weekPlanDropCommitted = false;
  itemEl.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', itemEl.dataset.weekPlanId || '');
}

function handleWeekPlanDragOver(e) {
  const listEl = e.currentTarget;
  const draggingEl = listEl.querySelector('.week-plan-editor-item.is-dragging');
  if (!draggingEl) return;

  const targetEl = e.target.closest('.week-plan-editor-item');
  if (!targetEl || targetEl === draggingEl) return;

  e.preventDefault();
  const rect = targetEl.getBoundingClientRect();
  const insertAfter = e.clientY > rect.top + rect.height / 2;
  listEl.insertBefore(draggingEl, insertAfter ? targetEl.nextSibling : targetEl);
}

async function commitWeekPlanDomOrder(listEl) {
  if (!listEl) return false;
  const ids = [...listEl.querySelectorAll('.week-plan-editor-item')]
    .map(itemEl => itemEl.dataset.weekPlanId)
    .filter(Boolean);
  const byId = new Map(weeklyWorkspaceState.weekPlanItems.map(item => [item.id, item]));
  const reordered = ids.map(id => byId.get(id)).filter(Boolean);
  if (reordered.length !== weeklyWorkspaceState.weekPlanItems.length) return false;

  const currentIds = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems).map(item => item.id);
  if (ids.join('|') === currentIds.join('|')) return false;

  pushWeeklyWorkspaceUndoSnapshot(draggingWeekPlanUndoSnapshot || getWeeklyWorkspaceUndoSnapshot());
  weeklyWorkspaceState.weekPlanItems = reordered;
  reindexWeekPlanItems();
  syncSelectedWeekPlanItems();
  renderWeekPlan();
  await flushWeeklyWorkspaceSave();
  return true;
}

async function handleWeekPlanDrop(e) {
  const listEl = e.currentTarget;
  if (!listEl.querySelector('.week-plan-editor-item.is-dragging')) return;

  e.preventDefault();
  weekPlanDropCommitted = await commitWeekPlanDomOrder(listEl);
}

async function handleWeekPlanDragEnd(e) {
  e.currentTarget.querySelector('.week-plan-editor-item.is-dragging')?.classList.remove('is-dragging');
  if (!weekPlanDropCommitted) {
    await commitWeekPlanDomOrder(e.currentTarget);
  }
  draggingWeekPlanUndoSnapshot = null;
  weekPlanDropCommitted = false;
}

function getWeekPlanCopyText() {
  const items = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  if (!items.length) return '';

  return [
    '周计划',
    '',
    ...items.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`),
  ].join('\n');
}

async function copyWeekPlan() {
  const text = getWeekPlanCopyText();
  if (!text.trim()) {
    showToast('Nothing to copy');
    return;
  }
  await copyTextToClipboard(text, 'Week plan copied');
}

function renderDailyLogPanel() {
  const dateKey = getSelectedDailyLogDateKey();
  const log = weeklyWorkspaceState.logs?.[dateKey] || {};
  const mode = getDailyLogDateMode(dateKey);

  document.querySelectorAll('[data-log-key]').forEach(textarea => {
    const fieldKey = textarea.dataset.logKey;
    textarea.value = getDailyLogFieldValue(fieldKey, dateKey);
    textarea.dataset.logDateKey = dateKey;
    if (!textarea.dataset.defaultPlaceholder) textarea.dataset.defaultPlaceholder = textarea.placeholder;
    textarea.placeholder = mode === 'plan'
      ? `Add ${DAILY_LOG_FIELD_LABELS[fieldKey]} for this day...`
      : mode === 'supplement'
        ? `Add ${DAILY_LOG_FIELD_LABELS[fieldKey]} retrospectively...`
        : textarea.dataset.defaultPlaceholder;
  });

  const outputEl = document.getElementById('dailyLogOutput');
  if (outputEl) {
    outputEl.value = log.generated || '';
    outputEl.dataset.logDateKey = dateKey;
    outputEl.placeholder = mode === 'plan'
      ? 'Generated daily plan will appear here.'
      : 'Generated daily log will appear here.';
  }

  renderDailyLogPanelMeta(dateKey);

  const downloadButton = document.querySelector('[data-action="download-daily-log"]');
  if (downloadButton) downloadButton.title = `Download ${dateKey}`;

  const panelEl = document.querySelector('.daily-log-panel');
  if (panelEl) panelEl.dataset.logMode = mode;
  const panelTitleEl = panelEl?.querySelector('.section-header h2');
  if (panelTitleEl) panelTitleEl.textContent = mode === 'plan' ? 'Daily plan' : 'Daily log';
}

function renderDailyLogArchive() {
  const archiveEl = document.getElementById('dailyLogArchive');
  if (!archiveEl) return;

  const weekDates = getSelectedWeekDates();
  const weekInfo = getIsoWeekInfoFromDateKey(weekDates[0].key);
  const weekPlanItems = getWeekPlanItemsForDate(weekDates[0].key);
  const downloadWeekButton = document.querySelector('[data-action="download-weekly-log"]');
  if (downloadWeekButton) downloadWeekButton.title = `Download ${getWeekIdFromDateKey(weekDates[0].key)}`;
  const weekPlanPreview = weekPlanItems.length
    ? weekPlanItems.map(item => `${item.completed ? '✓' : '□'} ${item.text}`).join('\n')
    : 'No plan yet';
  archiveEl.innerHTML = `
    <div class="daily-log-archive-label" aria-label="${weekInfo.year} week ${weekInfo.weekNumber}">
      <div class="daily-log-archive-week-header">
        <div>
          <div class="daily-log-archive-year">周计划</div>
          <div class="daily-log-archive-week">${weekInfo.year} W${String(weekInfo.weekNumber).padStart(2, '0')}</div>
        </div>
        <div class="daily-log-archive-week-actions">
          <button class="log-copy-btn" type="button" data-action="copy-week-plan" title="Copy week plan" aria-label="Copy week plan">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 4h7a4 4 0 0 1 4 4v7M4 16V8a4 4 0 0 1 4-4h5" />
            </svg>
          </button>
          <button class="log-expand-btn" type="button" data-action="open-week-plan-editor" title="Expand week plan" aria-label="Expand week plan">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
      </div>
      <textarea class="daily-log-archive-week-plan" aria-label="Week plan summary" readonly>${escapeHtml(weekPlanPreview)}</textarea>
    </div>
    ${weekDates.map(day => {
      const dateKey = day.key;
      const log = weeklyWorkspaceState.logs?.[dateKey] || {};
      const hasLog = (log.generated || '').trim();
      const hasSource = hasDailyLogSourceContent(dateKey);
      const isSelected = dateKey === getSelectedDailyLogDateKey();
      const stale = isDailyLogStale(dateKey);
      const mode = getDailyLogDateMode(dateKey);
      const emptyClass = hasLog ? '' : ' is-empty';
      const selectedClass = isSelected ? ' is-selected' : '';
      const staleClass = stale ? ' is-stale' : '';
      const stateLabel = stale ? 'Update available' : hasLog ? 'Generated' : hasSource ? 'Ready' : mode;
      const actions = hasLog ? `
        <div class="daily-log-card-actions">
          <button class="log-copy-btn" type="button" data-action="copy-daily-log-field" data-log-editor-key="generated" data-log-date-key="${escapeAttr(dateKey)}" title="Copy log" aria-label="Copy ${escapeAttr(dateKey)} log">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 4h7a4 4 0 0 1 4 4v7M4 16V8a4 4 0 0 1 4-4h5" />
            </svg>
          </button>
          <button class="log-expand-btn" type="button" data-action="open-daily-log-editor" data-log-editor-key="generated" data-log-date-key="${escapeAttr(dateKey)}" title="Expand log" aria-label="Expand ${escapeAttr(dateKey)} log">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>` : '';
      return `
        <article class="daily-log-card${emptyClass}${selectedClass}${staleClass}" data-action="select-daily-log-date" data-log-date-key="${escapeAttr(dateKey)}" role="button" tabindex="0" aria-pressed="${isSelected}" aria-label="Open ${escapeAttr(dateKey)} daily ${mode}">
          <div class="daily-log-card-header">
            <div>
              <div class="daily-log-card-day">${escapeHtml(day.dayName)}</div>
              <div class="daily-log-card-date">${escapeHtml(day.label)}</div>
              <div class="daily-log-card-state">${escapeHtml(stateLabel)}</div>
            </div>
            ${actions}
          </div>
        </article>`;
    }).join('')}`;
}

function hasDailyLogContent(log) {
  if (!log || typeof log !== 'object') return false;
  return Boolean((log.generated || '').trim() || DAILY_LOG_DRAFT_KEYS.some(key => String(log[key] || '').trim()));
}

function getWeekArchiveStats(weekStartKey) {
  const weekDates = getWeekDatesForDateKey(weekStartKey);
  const dateKeys = new Set(weekDates.map(day => day.key));
  const weekId = getWeekIdFromDateKey(weekStartKey);
  const planItems = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlans?.[weekId]?.items || []);
  const doneItems = planItems.filter(item => item.completed).length;
  const logsCount = weekDates.filter(day => hasDailyLogContent(weeklyWorkspaceState.logs?.[day.key])).length;
  const events = weeklyWorkspaceState.events.filter(event => dateKeys.has(event.dateKey));

  return {
    weekId,
    weekDates,
    planItems,
    doneItems,
    logsCount,
    eventsCount: events.length,
  };
}

function getWeekArchiveStartKeysForYear(year) {
  const firstWeekStart = getWeekStartKeyFromDateKey(`${year}-01-04`);
  const weekCount = getIsoWeekInfoFromDateKey(`${year}-12-28`).weekNumber;
  return Array.from({ length: weekCount }, (_, index) => shiftDateKey(firstWeekStart, index * 7)).reverse();
}

function getWeekArchiveYears() {
  const years = new Set([
    getIsoWeekInfoFromDateKey(getCurrentWeekStartKey()).year,
    getIsoWeekInfoFromDateKey(getSelectedWeekStartKey()).year,
  ]);
  Object.values(weeklyWorkspaceState.weekPlans || {}).forEach(plan => {
    if (plan?.weekStart && (plan.items?.length || String(plan.summary || '').trim())) {
      years.add(getIsoWeekInfoFromDateKey(plan.weekStart).year);
    }
  });
  weeklyWorkspaceState.events.forEach(event => {
    if (event.dateKey) years.add(getIsoWeekInfoFromDateKey(event.dateKey).year);
  });
  Object.entries(weeklyWorkspaceState.logs || {}).forEach(([dateKey, log]) => {
    if (hasDailyLogContent(log)) years.add(getIsoWeekInfoFromDateKey(dateKey).year);
  });
  return [...years].sort((a, b) => b - a);
}

function renderYearArchive() {
  const yearEl = document.getElementById('yearArchive');
  if (!yearEl) return;
  const previousYear = Number(yearEl.dataset.archiveYear);
  const previousScrollTop = yearEl.querySelector('.year-archive-list')?.scrollTop || 0;

  const years = getWeekArchiveYears();
  const selectedYear = years.includes(selectedArchiveYear)
    ? selectedArchiveYear
    : getIsoWeekInfoFromDateKey(getSelectedWeekStartKey()).year;
  selectedArchiveYear = selectedYear;
  const weekStarts = getWeekArchiveStartKeysForYear(selectedYear);
  const rows = weekStarts.map(weekStart => getWeekArchiveStats(weekStart));
  const totalLogs = rows.reduce((total, row) => total + row.logsCount, 0);
  const totalEvents = rows.reduce((total, row) => total + row.eventsCount, 0);
  const totalDone = rows.reduce((total, row) => total + row.doneItems, 0);

  yearEl.dataset.archiveYear = String(selectedYear);
  yearEl.innerHTML = `
    <div class="year-archive-header">
      <div class="year-archive-heading">
        <div class="year-archive-kicker">Year archive</div>
        <div class="year-archive-tabs" role="tablist" aria-label="归档年份">
          ${years.map(year => `<button class="year-archive-tab${year === selectedYear ? ' is-selected' : ''}" type="button" role="tab" aria-selected="${year === selectedYear}" data-action="select-archive-year" data-archive-year="${year}">${year}</button>`).join('')}
        </div>
      </div>
      <div class="year-archive-stats">${totalLogs} logs &middot; ${totalEvents} blocks &middot; ${totalDone} done</div>
    </div>
    <div class="year-archive-list">
      ${rows.map(row => {
        const isSelected = row.weekDates[0].key === getSelectedWeekStartKey();
        return `
          <button class="year-archive-row${isSelected ? ' is-selected' : ''}" type="button" data-action="select-week" data-week-start-key="${escapeAttr(row.weekDates[0].key)}">
            <span class="year-archive-week">${escapeHtml(row.weekId)}</span>
            <span class="year-archive-range">${escapeHtml(shortDateFromKey(row.weekDates[0].key))} - ${escapeHtml(shortDateFromKey(row.weekDates[6].key))}</span>
            <span class="year-archive-meta">${row.doneItems}/${row.planItems.length} plan &middot; ${row.logsCount}/7 logs &middot; ${row.eventsCount} blocks</span>
          </button>`;
      }).join('')}
    </div>`;
  if (previousYear === selectedYear) {
    yearEl.querySelector('.year-archive-list').scrollTop = previousScrollTop;
  }
}

async function initWeeklyWorkspace() {
  let storedDailyDraft = {};
  let needsWorkspaceMigration = false;
  try {
    const stored = await chrome.storage.local.get(WEEKLY_WORKSPACE_STORAGE_KEY);
    const storedWorkspace = stored[WEEKLY_WORKSPACE_STORAGE_KEY] || {};
    storedDailyDraft = storedWorkspace.dailyDraft || {};
    needsWorkspaceMigration = storedWorkspace.version !== WEEKLY_WORKSPACE_SCHEMA_VERSION;
    weeklyWorkspaceState = normalizeWorkspaceImport(storedWorkspace) || {
      version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
      activeWeekId: getCurrentWeekId(),
      activeWeekStartKey: getCurrentWeekStartKey(),
      selectedWeekStartKey: getCurrentWeekStartKey(),
      planner: {},
      events: [],
      weekPlanItems: [],
      weekPlans: {},
      logs: {},
      dailyDraft: normalizeDailyDraft(),
    };
  } catch (error) {
    throw new Error('本机工作区读取失败，已停止同步以保护原有数据。请重新打开页面。', { cause: error });
  }

  selectedWeekStartKey = weeklyWorkspaceState.selectedWeekStartKey || weeklyWorkspaceState.activeWeekStartKey || getCurrentWeekStartKey();
  workspaceInitialSnapshot = clonePlainObject(weeklyWorkspaceState);
  weeklyWorkspaceState.selectedWeekStartKey = selectedWeekStartKey;
  loadSelectedWeekPlanItems();
  const todayKey = getShanghaiTodayKey();
  const todayWeekday = getWeekDatesForDateKey(todayKey).findIndex(day => day.key === todayKey);
  selectedDailyLogDateKey = getWeekStartKeyFromDateKey(todayKey) === selectedWeekStartKey
    ? todayKey : shiftDateKey(selectedWeekStartKey, Math.max(0, todayWeekday));
  const migratedWeekPlan = migrateScratchToWeekPlanItems(weeklyWorkspaceState.logs, storedDailyDraft);
  if (migratedWeekPlan) syncSelectedWeekPlanItems();
  migratePlannerEntriesToEvents();
  const activatedNewWeek = activateCurrentWeek();
  if (needsWorkspaceMigration || migratedWeekPlan || activatedNewWeek) scheduleWeeklyWorkspaceSave();
  renderWeekCalendar();
  renderWeekPlan();
  renderDailyLogPanel();
  renderDailyLogArchive();
  renderYearArchive();
}

/* ----------------------------------------------------------------
   OPTIONAL MULTI-DEVICE SYNC
   ---------------------------------------------------------------- */

function getWorkspaceSyncConfig() {
  return globalThis.TAB_OUT_SYNC_CONFIG || { enabled: false };
}

async function ensureWorkspaceSyncHostPermission(interactive = false) {
  const config = getWorkspaceSyncConfig();
  const origins = [...new Set([config.authBaseUrl, config.apiBaseUrl]
    .filter(Boolean)
    .map(value => `${new URL(value).origin}/*`))];
  if (!origins.length || !chrome.permissions) return true;
  if (await chrome.permissions.contains({ origins })) return true;
  if (!interactive) return false;
  return chrome.permissions.request({ origins });
}

async function initWorkspaceSync() {
  if (!globalThis.TabOutSyncClient || !globalThis.TabOutWorkspaceSync) {
    renderWorkspaceSyncStatus({ status: 'error', detail: 'Sync modules did not load' });
    return;
  }
  const syncPreference = await chrome.storage.local.get(WORKSPACE_SYNC_MODE_KEY);
  workspaceSyncMode = syncPreference[WORKSPACE_SYNC_MODE_KEY] === 'manual' ? 'manual' : 'auto';
  workspaceSyncClient = new globalThis.TabOutWorkspaceBrowserClient({
    config: getWorkspaceSyncConfig(),
    onStatus: renderWorkspaceSyncStatus,
    getWorkspace: getPersistedWeeklyWorkspaceState,
    applyWorkspace: applySyncedWorkspace,
    baseline: workspaceInitialSnapshot,
  });
  await workspaceSyncClient.initialize(getPersistedWeeklyWorkspaceState());
  await flushWeeklyWorkspaceSave();
  renderWorkspaceSyncStatus({ status: 'ready', ...workspaceSyncClient.getPublicState() });

  window.addEventListener('online', () => {
    if (document.visibilityState === 'visible' && workspaceSyncMode === 'auto') performWorkspaceSync(true, 'automatic');
  });
  window.addEventListener('offline', () => renderWorkspaceSyncStatus({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (shouldSyncWorkspaceOnResume()) performWorkspaceSync(true, 'automatic');
      if (document.getElementById('workspaceSyncDialog')?.open && workspaceSyncClient?.getPublicState().loggedIn) {
        loadWorkspaceAccountProfile({ force: true });
      }
    }
  });
  startWorkspaceSyncPolling();
  if (workspaceSyncMode === 'auto' && workspaceSyncClient.getPublicState().loggedIn) performWorkspaceSync(true, 'automatic');
}

function startWorkspaceSyncPolling() {
  if (workspaceSyncPollTimer) clearTimeout(workspaceSyncPollTimer);
  if (workspaceSyncMode !== 'auto') return;
  scheduleNextWorkspaceSyncPoll(getWorkspaceSyncPollDelay());
}

function getWorkspaceSyncPollDelay() {
  return WORKSPACE_SYNC_DEFAULT_POLL_MS;
}

function scheduleNextWorkspaceSyncPoll(delay) {
  if (workspaceSyncPollTimer) clearTimeout(workspaceSyncPollTimer);
  workspaceSyncPollTimer = setTimeout(async () => {
    workspaceSyncPollTimer = null;
    if (document.visibilityState === 'visible' && workspaceSyncClient?.getPublicState().loggedIn) {
      await performWorkspaceSync(true, 'automatic');
    }
    if (!workspaceSyncPollTimer) scheduleNextWorkspaceSyncPoll(getWorkspaceSyncPollDelay());
  }, delay);
}

function scheduleWorkspaceAutoSync() {
  if (!workspaceSyncClient?.getPublicState().loggedIn || !workspaceSyncClient.enabled) return;
  renderWorkspaceSyncStatus({ status: navigator.onLine ? 'pending' : 'offline' });
}

async function setWorkspaceSyncMode(mode) {
  workspaceSyncMode = mode === 'manual' ? 'manual' : 'auto';
  await chrome.storage.local.set({ [WORKSPACE_SYNC_MODE_KEY]: workspaceSyncMode });
  startWorkspaceSyncPolling();
  renderWorkspaceSyncDialog();
  showToast(workspaceSyncMode === 'auto' ? '已开启自动同步' : '已切换为手动同步');
}

function shouldSyncWorkspaceOnResume() {
  if (workspaceSyncMode !== 'auto') return false;
  const state = workspaceSyncClient?.getPublicState() || {};
  if (!state.loggedIn) return false;
  const lastSuccessfulSync = Date.parse(state.lastSyncedAt || '');
  if (!Number.isFinite(lastSuccessfulSync)) return true;
  const interval = WORKSPACE_SYNC_DEFAULT_POLL_MS;
  return Date.now() - lastSuccessfulSync >= interval;
}

async function performWorkspaceSync(silent = false, reason = silent ? 'automatic' : 'manual') {
  if (!workspaceSyncClient) return false;
  const state = workspaceSyncClient.getPublicState();
  if (!state.configured) {
    if (!silent) openWorkspaceSyncDialog();
    return false;
  }
  if (!state.loggedIn) {
    if (!silent) openWorkspaceSyncDialog();
    return false;
  }
  if (!await ensureWorkspaceSyncHostPermission(!silent)) {
    workspaceSyncFailureCount = Math.min(workspaceSyncFailureCount + 1, 8);
    renderWorkspaceSyncStatus({ status: 'error', detail: '请允许插件访问已配置的云同步域名' });
    if (!silent) showToast('需要先允许插件访问 CloudBase 域名，才能继续同步', 4500);
    return false;
  }

  const syncButton = document.querySelector('[data-action="sync-workspace-now"]');
  if (!silent && syncButton) {
    syncButton.disabled = true;
    syncButton.textContent = '同步中…';
  }
  try {
    flushDailyLogGeneratedSectionSync();
    await flushWeeklyWorkspaceSave();
    const result = await workspaceSyncClient.sync(reason);
    if (result?.skipped) return true;
    if (!silent) {
      const summary = result.summary || {};
      const message = result.state.conflicts
        ? `同步完成 · 有 ${result.state.conflicts} 项冲突需要确认`
        : `同步完成 · 已上传 ${summary.uploaded || 0} 项 · 已接收 ${summary.downloaded || 0} 项 · 待同步 ${result.state.queued || 0} 项`;
      showToast(message, 4500);
    }
    workspaceSyncFailureCount = 0;
    if (document.getElementById('workspaceSyncDialog')?.open) {
      renderWorkspaceSyncDialog();
      renderWorkspaceSyncStatus({ status: result.state.conflicts ? 'conflict' : 'synced' });
    }
    return true;
  } catch (error) {
    workspaceSyncFailureCount = Math.min(workspaceSyncFailureCount + 1, 8);
    const syncErrorDetail = /[\u3400-\u9fff]/u.test(String(error.message || ''))
      ? error.message
      : '暂时无法连接云同步服务，请稍后重试';
    renderWorkspaceSyncStatus({
      status: navigator.onLine ? 'error' : 'offline',
      errorType: error.syncErrorType || '',
      detail: syncErrorDetail,
    });
    if (!silent) showToast(`同步失败：${syncErrorDetail}`, 5000);
    return false;
  } finally {
    if (!silent && syncButton) {
      syncButton.disabled = false;
      syncButton.textContent = '立即同步';
    }
    startWorkspaceSyncPolling();
  }
}

function getWorkspaceSyncErrorFeedback(error) {
  const type = error?.syncErrorType || '';
  const message = String(error?.message || '登录失败');
  const code = String(error?.authErrorCode || '');
  const localChineseMessage = /[\u3400-\u9fff]/u.test(message) ? message : '';
  const diagnostic = `错误码 ${code || 'UNAVAILABLE'} · 插件 ID ${chrome.runtime.id} · 环境 ${getWorkspaceSyncConfig().environmentId || '未配置'}`;
  if (code === 'ORIGIN_NOT_ALLOWED') {
    return {
      type: 'permission',
      label: '来源未授权',
      title: '当前插件来源尚未获准登录',
      detail: `账号服务尚未开放此版本，请联系维护者。你的本机内容已保留。${diagnostic}`,
    };
  }
  if (/未允许访问账号服务域名/.test(message)) {
    return {
      type: 'permission',
      label: '域名权限未授予',
      title: '插件还不能访问账号服务',
      detail: `请重新点击登录并在 Chrome 提示中允许访问 CloudBase 域名。${diagnostic}`,
    };
  }
  if (code === 'password_not_set') {
    return {
      type: 'credentials',
      label: '未设置密码',
      title: '请使用手机验证码登录',
      detail: '这个手机号账号没有设置密码，请切换到“手机验证码登录”。',
    };
  }
  const accountDetails = {
    captcha_required: '操作较频繁，请先完成图形验证。',
    captcha_invalid: '图形验证码已失效，请刷新后重试。',
    invalid_verification_code: '验证码不正确，请重新输入。',
    verification_code_expired: '验证码已过期，请重新获取。',
    weak_password: '密码强度不足，请按提示设置复杂密码。',
    invalid_password: '当前密码不正确，请重新输入。',
    permission_denied: '安全验证码不正确或已过期，请重新获取。',
    user_not_found: '没有找到对应账号，请检查联系方式。',
    username_already_exists: '这个用户名已被使用，请换一个。',
    email_already_exists: '这个邮箱已绑定其他账号。',
    phone_number_already_exists: '这个手机号已绑定其他账号。',
    TOO_MANY_ATTEMPTS: '登录尝试过多，请稍后再试。',
    TOO_MANY_VERIFICATION_REQUESTS: '验证码发送过于频繁，请稍后再试。',
    TOO_MANY_SENSITIVE_REQUESTS: '修改密码尝试过多，请稍后再试。',
    RATE_LIMITED: '操作过于频繁，请稍后再试。',
    NOT_FOUND: '云端账号接口尚未部署新版。请先更新 tab-out-sync 云函数，再重新加载扩展。',
    METHOD_NOT_ALLOWED: '云端账号接口版本过旧，暂不支持这项操作。',
    INVALID_REQUEST: '填写内容不符合账号服务要求，请检查后重试。',
    invalid_argument: '验证方式或填写内容不正确，请检查后重试。',
    invalid_phone_number: '请输入有效的中国大陆手机号。',
    invalid_email: '请输入有效的邮箱地址。',
  };
  const feedback = {
    credentials: {
      label: '密码有误',
      title: '账号或密码不正确',
      detail: '请检查手机号、邮箱或用户名与密码，然后重试。',
    },
    connection: {
      label: '连接异常',
      title: '暂时无法连接账号服务',
      detail: '请检查网络，以及 CloudBase 的安全来源和认证路由配置。',
    },
    server: {
      label: '服务异常',
      title: '账号服务暂时不可用',
      detail: '请稍等片刻后重试，你的本地数据不会受到影响。',
    },
    permission: {
      label: '权限不足',
      title: '账号服务拒绝了这次请求',
      detail: '请检查 CloudBase 的安全来源、登录方式和接口权限。',
    },
    configuration: {
      label: '配置未完成',
      title: '当前登录方式尚未启用',
      detail: '请在 CloudBase 身份认证中启用密码、邮箱或手机号登录。',
    },
    account: {
      label: '账号异常',
      title: '账号操作未完成',
      detail: accountDetails[code] || localChineseMessage || '请检查填写内容、验证码或账号状态后重试。',
    },
  };
  if (feedback[type]) return { type, ...feedback[type], detail: `${feedback[type].detail}${code ? ` ${diagnostic}` : ''}` };
  if (/username or password/i.test(message)) return { type: 'credentials', ...feedback.credentials };
  if (/failed to fetch|networkerror|load failed/i.test(message)) return { type: 'connection', ...feedback.connection };
  if (/\b5\d\d\b|server|gateway/i.test(message)) return { type: 'server', ...feedback.server };
  return { type: 'account', label: '账号异常', title: '账号操作未完成', detail: accountDetails[code] || localChineseMessage || '请检查填写内容、验证码或账号状态后重试。' };
}

function setSyncLoginFeedback(status, title, detail, typeLabel) {
  const feedback = document.getElementById('syncLoginFeedback');
  if (!feedback) return;
  feedback.dataset.status = status;
  feedback.replaceChildren();
  const heading = document.createElement('strong');
  heading.className = 'sync-login-feedback-title';
  heading.textContent = title;
  const description = document.createElement('span');
  description.className = 'sync-login-feedback-detail';
  description.textContent = detail;
  const label = document.createElement('span');
  label.className = 'sync-login-feedback-type';
  label.textContent = typeLabel;
  feedback.append(heading, description, label);
}

async function applySyncedWorkspace(workspace) {
  const normalized = normalizeWorkspaceImport(workspace);
  if (!normalized) return;
  weeklyWorkspaceState = normalized;
  selectedWeekStartKey = normalized.selectedWeekStartKey || getCurrentWeekStartKey();
  weeklyWorkspaceState.selectedWeekStartKey = selectedWeekStartKey;
  loadSelectedWeekPlanItems();
  renderWeekCalendar();
  renderWeekPlan();
  renderDailyLogPanel();
  renderDailyLogArchive();
  renderYearArchive();
}

async function activateWorkspaceAccount(accountId) {
  await flushWeeklyWorkspaceSave();
  await workspaceSyncClient.switchAccount(accountId);
  await workspaceSyncClient.initialize(getPersistedWeeklyWorkspaceState());
  workspaceAccountView = 'account';
  workspaceAccountProfile = null;
  workspaceAccountVerification = null;
  renderWorkspaceSyncDialog();
  renderWorkspaceSyncStatus({ status: 'ready', ...workspaceSyncClient.getPublicState() });
  await performWorkspaceSync(false);
}

async function activateNewlySignedInAccount() {
  await workspaceSyncClient.initialize(getPersistedWeeklyWorkspaceState());
}

function renderWorkspaceSyncStatus(update = {}) {
  workspaceSyncStatus = update.status || workspaceSyncStatus;
  if (Object.hasOwn(update, 'detail')) workspaceSyncDetail = update.detail || '';
  if (Object.hasOwn(update, 'errorType')) workspaceSyncErrorType = update.errorType || '';
  if (update.status && update.status !== 'error' && update.status !== 'offline') {
    workspaceSyncDetail = '';
    workspaceSyncErrorType = '';
  }
  const toolbar = document.getElementById('workspaceSyncToolbar');
  const label = document.getElementById('syncStatusLabel');
  const detail = document.getElementById('syncStatusDetail');
  const queue = document.getElementById('syncQueueCount');
  const indicator = document.getElementById('syncActionIndicator');
  const accountButton = toolbar?.querySelector('.sync-toolbar-actions [data-action="open-sync-panel"]');
  if (!toolbar || !label || !detail) return;

  const state = workspaceSyncClient?.getPublicState() || update;
  const configured = state.configured ?? Boolean(getWorkspaceSyncConfig().apiBaseUrl);
  const loggedIn = state.loggedIn ?? false;
  const username = state.username || 'Inner Garden · 美日心灵 账号';
  const signedIn = formatWorkspaceSyncTimestamp(state.signedInAt, '时间未知');
  const lastSynced = formatWorkspaceSyncTimestamp(state.lastSyncedAt, '尚未同步');
  let status = workspaceSyncStatus;
  let labelText = '仅保存在本机';
  let detailText = '你的计划数据安全地保存在这台电脑上';

  if (!configured) {
    status = 'local';
    detailText = '账号服务尚未配置，本机编辑照常保存';
  } else if (status === 'signing-in') {
    labelText = '正在登录';
    detailText = '正在安全验证你的账号';
  } else if (status === 'error') {
    labelText = '同步已暂停';
    detailText = workspaceSyncDetail || '请打开账号中心查看连接状态';
  } else if (!loggedIn) {
    status = 'local';
    labelText = '可开启云同步';
    detailText = '登录后，可在你的设备之间同步计划与日课';
  } else if (status === 'syncing') {
    labelText = '正在同步';
    detailText = '正在安全合并本机与云端的更改';
  } else if (status === 'offline') {
    labelText = '当前离线';
    detailText = `${state.queued || 0} 项更改已安全保留在本机，联网后会继续同步`;
  } else if ((state.conflicts || 0) > 0 || status === 'conflict') {
    status = 'conflict';
    labelText = '需要确认';
    detailText = `${state.conflicts || 0} 项编辑冲突已完整保留，请选择要采用的版本`;
  } else {
    status = state.lastSyncedAt ? 'synced' : 'ready';
    labelText = state.queued ? '等待同步' : state.lastSyncedAt ? '已同步' : '尚未同步';
    detailText = state.queued ? '本机更改会在下次同步时上传' : `最近同步：${lastSynced}`;
  }

  if (loggedIn) {
    labelText = `已登录 · ${username}`;
    if (status === 'syncing') {
      detailText = `登录于 ${signedIn} · 正在同步 · 待同步 ${state.queued || 0} 项`;
    } else if (status === 'error') {
      detailText = `登录于 ${signedIn} · 最近成功同步 ${lastSynced} · ${workspaceSyncDetail || '同步失败'}`;
    } else if (status === 'offline') {
      detailText = `登录于 ${signedIn} · 当前离线 · 最近成功同步 ${lastSynced} · 待同步 ${state.queued || 0} 项`;
    } else if (status === 'conflict') {
      detailText = `登录于 ${signedIn} · 最近成功同步 ${lastSynced} · ${state.conflicts || 0} 项冲突待确认`;
    } else {
      detailText = `登录于 ${signedIn} · 最近成功同步 ${lastSynced} · 待同步 ${state.queued || 0} 项`;
    }
  }

  toolbar.dataset.status = status;
  label.textContent = labelText;
  detail.textContent = detailText;
  if (queue) queue.textContent = state.queued ? `待同步 ${state.queued} 项` : '';
  if (accountButton) {
    accountButton.textContent = '账号';
    accountButton.classList.toggle('is-signed-in', loggedIn);
    accountButton.title = loggedIn ? `当前账号：${username}` : '登录或注册 Inner Garden · 美日心灵 账号';
  }
  if (indicator) {
    let indicatorStatus = 'idle';
    let indicatorText = '尚未开始同步';
    let indicatorSymbol = '•';
    if (loggedIn && status === 'syncing') {
      indicatorStatus = 'syncing';
      indicatorText = '正在同步';
      indicatorSymbol = '↻';
    } else if (loggedIn && status === 'error') {
      indicatorStatus = 'error';
      indicatorText = workspaceSyncDetail || '同步失败';
      indicatorSymbol = '!';
    } else if (loggedIn && status === 'offline') {
      indicatorStatus = 'offline';
      indicatorText = '当前离线';
      indicatorSymbol = '!';
    } else if (loggedIn && status === 'conflict') {
      indicatorStatus = 'conflict';
      indicatorText = '同步完成，但有冲突需要确认';
      indicatorSymbol = '!';
    } else if (loggedIn && state.lastSyncedAt) {
      indicatorStatus = 'synced';
      indicatorText = `同步完成 · ${lastSynced}`;
      indicatorSymbol = '✓';
    } else if (loggedIn) {
      indicatorStatus = 'ready';
      indicatorText = '已登录 · 尚未开始同步';
    }
    indicator.dataset.status = indicatorStatus;
    indicator.textContent = indicatorSymbol;
    indicator.setAttribute('aria-label', indicatorText);
    indicator.title = indicatorText;
  }

  const loginFeedback = document.getElementById('syncLoginFeedback');
  const loginButton = document.querySelector('#workspaceSyncLoginForm button[type="submit"]');
  if (loginFeedback) {
    if (status === 'signing-in') {
      setSyncLoginFeedback('busy', '正在验证账号', '正在通过 CloudBase 安全登录…', '请稍候');
    } else if (status === 'error') {
      const feedback = getWorkspaceSyncErrorFeedback({
        syncErrorType: workspaceSyncErrorType,
        message: workspaceSyncDetail || detailText,
      });
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    }
  }
  if (loginButton) {
    loginButton.disabled = status === 'signing-in';
    loginButton.textContent = status === 'signing-in' ? '正在登录…' : '登录并同步';
  }

  const dialogStatus = document.getElementById('syncDialogConnectionStatus');
  if (dialogStatus) {
    dialogStatus.dataset.status = status;
    dialogStatus.textContent = `${labelText} · ${detailText}`;
  }
}

function formatWorkspaceSyncTimestamp(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString([], {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function openWorkspaceSyncDialog() {
  const dialog = document.getElementById('workspaceSyncDialog');
  if (!dialog) return;
  workspaceAccountView = workspaceSyncClient?.getPublicState().loggedIn ? 'account' : 'login';
  workspaceAccountLoginMethod = 'password';
  workspacePasswordChangeMethod = 'current';
  workspaceAccountProfile = null;
  workspaceAccountCaptcha = null;
  workspaceAccountPendingVerification = null;
  renderWorkspaceSyncDialog();
  if (!dialog.open) dialog.showModal();
}

function renderSyncPasswordField(id, name, autocomplete, label, required = true) {
  return `
    <label class="sync-field" for="${id}">
      <span>${label}</span>
      <span class="sync-password-field">
        <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" ${required ? 'required' : ''} minlength="8" maxlength="64">
        <button class="sync-password-toggle" type="button" data-action="toggle-sync-password" data-password-target="${id}" aria-label="显示密码" aria-pressed="false" title="显示密码">
          <svg class="sync-password-eye sync-password-eye-show" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>
          <svg class="sync-password-eye sync-password-eye-hide" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16"></path><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.3 3.1M6.1 7.2C3.8 9 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.5M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>
        </button>
      </span>
    </label>`;
}

function renderAccountKindSelector(view) {
  return `
    <div class="sync-auth-methods" role="group" aria-label="选择验证方式">
      <button class="sync-auth-method${workspaceAccountKind === 'email' ? ' is-active' : ''}" type="button" data-action="select-account-kind" data-kind="email" data-view="${view}" aria-pressed="${workspaceAccountKind === 'email'}">邮箱${view === 'register' ? '注册' : '验证'}</button>
      <button class="sync-auth-method${workspaceAccountKind === 'phone' ? ' is-active' : ''}" type="button" data-action="select-account-kind" data-kind="phone" data-view="${view}" aria-pressed="${workspaceAccountKind === 'phone'}">手机号${view === 'register' ? '注册' : '验证'}</button>
    </div>`;
}

function renderAccountContactField(view) {
  const email = workspaceAccountKind === 'email';
  return `
    <label class="sync-field" for="workspaceAccountContact">
      <span>${email ? '邮箱地址' : '手机号码'}</span>
      <input id="workspaceAccountContact" name="contact" type="${email ? 'email' : 'tel'}" autocomplete="${email ? 'email' : 'tel'}" inputmode="${email ? 'email' : 'tel'}" placeholder="${email ? 'name@example.com' : '中国大陆手机号'}" required>
    </label>
    <label class="sync-field" for="workspaceAccountCode">
      <span>验证码</span>
      <span class="sync-code-row">
        <input id="workspaceAccountCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" required>
        ${renderWorkspaceVerificationButton(view)}
      </span>
    </label>`;
}

function getWorkspaceVerificationCooldownSeconds() {
  return Math.max(0, Math.ceil((workspaceAccountVerificationResendAt - Date.now()) / 1000));
}

function renderWorkspaceVerificationButton(view, baseDisabled = false) {
  const cooldownSeconds = getWorkspaceVerificationCooldownSeconds();
  const disabled = baseDisabled || cooldownSeconds > 0;
  return `<button class="sync-button subtle" type="button" data-action="send-account-verification" data-view="${view}" data-base-disabled="${baseDisabled}" ${disabled ? 'disabled' : ''}>${cooldownSeconds > 0 ? `${cooldownSeconds} 秒后重新获取` : '获取验证码'}</button>`;
}

function updateWorkspaceVerificationCooldown() {
  const cooldownSeconds = getWorkspaceVerificationCooldownSeconds();
  document.querySelectorAll('[data-action="send-account-verification"]').forEach(actionEl => {
    actionEl.disabled = cooldownSeconds > 0;
    if (actionEl.dataset.baseDisabled === 'true') actionEl.disabled = true;
    actionEl.textContent = cooldownSeconds > 0 ? `${cooldownSeconds} 秒后重新获取` : '重新获取';
  });
  if (cooldownSeconds === 0 && workspaceAccountVerificationCooldownTimer) {
    clearInterval(workspaceAccountVerificationCooldownTimer);
    workspaceAccountVerificationCooldownTimer = null;
  }
}

function startWorkspaceVerificationCooldown() {
  workspaceAccountVerificationResendAt = Date.now() + WORKSPACE_ACCOUNT_VERIFICATION_COOLDOWN_MS;
  if (workspaceAccountVerificationCooldownTimer) clearInterval(workspaceAccountVerificationCooldownTimer);
  updateWorkspaceVerificationCooldown();
  workspaceAccountVerificationCooldownTimer = setInterval(updateWorkspaceVerificationCooldown, 1000);
}

function renderAccountCaptcha() {
  if (!workspaceAccountCaptcha) return '';
  const source = String(workspaceAccountCaptcha.image || '');
  const image = source.startsWith('data:')
    ? source
    : source.trim().startsWith('<svg')
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      : `data:image/png;base64,${source}`;
  return `
    <div class="sync-captcha-box" role="group" aria-label="图形验证码">
      <img class="sync-captcha-image" src="${escapeAttr(image)}" alt="图形验证码">
      <label class="sync-field" for="workspaceAccountCaptchaKey"><span>请输入图中字符</span><input id="workspaceAccountCaptchaKey" name="captchaKey" type="text" autocomplete="off" required></label>
      <button class="sync-button subtle" type="button" data-action="refresh-account-captcha">换一张</button>
      <button class="sync-button" type="button" data-action="verify-account-captcha">验证并发送</button>
    </div>`;
}

function renderAccountFeedback(title, detail, label = '安全提示', status = 'info') {
  return `<div class="sync-login-feedback" id="syncLoginFeedback" data-status="${status}" role="alert" aria-live="assertive" aria-atomic="true"><strong class="sync-login-feedback-title">${escapeHtml(title)}</strong><span class="sync-login-feedback-detail">${escapeHtml(detail)}</span><span class="sync-login-feedback-type">${escapeHtml(label)}</span></div>`;
}

function renderRecoveryAccount(backView = 'login') {
  return `
    <div class="sync-dialog-content">
      <button class="sync-back-link" type="button" data-action="select-account-view" data-view="${backView}">← ${backView === 'account' ? '返回账号中心' : '返回登录'}</button>
      <div class="sync-auth-intro"><strong>重新设置密码</strong><span>验证已绑定的邮箱或手机号后，即可设置新密码。</span></div>
      ${renderAccountKindSelector('recover')}
      <form class="sync-login-form" id="workspaceSyncRecoverForm" method="post" autocomplete="on">
        <input type="hidden" name="kind" value="${workspaceAccountKind}">
        ${renderAccountContactField('recover')}
        ${renderSyncPasswordField('workspaceAccountNewPassword', 'password', 'new-password', '新密码')}
        ${renderSyncPasswordField('workspaceAccountConfirmPassword', 'confirmPassword', 'new-password', '再次输入新密码')}
        <p class="sync-field-help">密码需为 8–64 位，并同时包含大写字母、小写字母、数字和特殊字符。</p>
        ${renderAccountCaptcha()}
        ${renderAccountFeedback('先验证你的身份', '获取并填写验证码后，设置一个只由你掌握的新密码。')}
        <button class="sync-button" type="submit">重设密码并登录</button>
      </form>
    </div>`;
}

function renderSavedAccountChoices(state) {
  const accounts = (state.savedAccounts || []).filter(account => !account.active);
  if (!accounts.length) return '';
  return `
    <div class="sync-saved-accounts" aria-label="本机保存的账号">
      <div class="sync-section-title"><strong>切换账号</strong><span>只保存 10 天会话，不保存密码</span></div>
      ${accounts.map(account => `
        <div class="sync-saved-account">
          <div><strong>${escapeHtml(account.username || 'Inner Garden · 美日心灵 账号')}</strong><span>UID：${escapeHtml(account.userId || String(account.accountId || '').replace(/^uid:/, ''))}</span><span>${account.usable ? `免密登录至 ${escapeHtml(formatWorkspaceSyncTimestamp(account.trustedUntil, '会话到期'))}` : '会话已过期，需要重新登录'}</span></div>
          <button class="sync-button subtle" type="button" data-action="switch-workspace-account" data-account-id="${escapeAttr(account.accountId)}" ${account.usable ? '' : 'disabled'}>${account.usable ? '切换' : '已过期'}</button>
        </div>`).join('')}
    </div>`;
}

function renderLoggedOutAccount() {
  const suggestedUsername = workspaceSyncClient?.getPublicState().lastUsername || getWorkspaceSyncConfig().defaultUsername || '';
  const loginFeedback = workspaceSyncStatus === 'error'
    ? getWorkspaceSyncErrorFeedback({ syncErrorType: workspaceSyncErrorType, message: workspaceSyncDetail })
    : { title: '账号只负责跨设备同步', detail: '不登录也能完整使用 Inner Garden · 美日心灵；密码和验证码不会保存在本机。', label: '本地优先' };
  const tabs = `
    <div class="sync-auth-tabs" role="tablist" aria-label="账号操作">
      <button class="sync-auth-tab${workspaceAccountView === 'login' ? ' is-active' : ''}" type="button" role="tab" aria-selected="${workspaceAccountView === 'login'}" data-action="select-account-view" data-view="login">登录</button>
      <button class="sync-auth-tab${workspaceAccountView === 'register' ? ' is-active' : ''}" type="button" role="tab" aria-selected="${workspaceAccountView === 'register'}" data-action="select-account-view" data-view="register">注册</button>
    </div>`;

  if (workspaceAccountView === 'recover') {
    return renderRecoveryAccount();
  }

  if (workspaceAccountView === 'register') {
    const emailRegistration = workspaceAccountKind === 'email';
    return `
      <div class="sync-dialog-content">
        ${tabs}
        <div class="sync-auth-intro"><strong>创建你的 Inner Garden · 美日心灵 账号</strong><span>${emailRegistration ? '邮箱注册必须设置密码，用户名可以留空。' : '手机号注册只需验证码；用户名和密码都可以留空。'}</span></div>
        ${renderAccountKindSelector('register')}
        <form class="sync-login-form" id="workspaceSyncRegisterForm" method="post" autocomplete="on">
          <input type="hidden" name="kind" value="${workspaceAccountKind}">
          <label class="sync-field" for="workspaceAccountUsername"><span>用户名（选填）</span><input id="workspaceAccountUsername" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="48" placeholder="留空也可以注册"></label>
          ${renderAccountContactField('register')}
          ${renderSyncPasswordField('workspaceAccountRegisterPassword', 'password', 'new-password', emailRegistration ? '密码（必填）' : '密码（选填）', emailRegistration)}
          ${renderSyncPasswordField('workspaceAccountRegisterConfirmPassword', 'confirmPassword', 'new-password', emailRegistration ? '再次输入密码（必填）' : '再次输入密码（选填）', emailRegistration)}
          <p class="sync-field-help">${emailRegistration ? '邮箱注册必须设置密码。' : '手机号注册可以不设置密码；以后可直接使用手机号和验证码登录。'} 若设置密码，需为 8–64 位，并同时包含大写字母、小写字母、数字和特殊字符。</p>
          ${renderAccountCaptcha()}
          ${renderAccountFeedback('你的隐私边界不会改变', '浏览器标签页、稍后处理和专注记录始终只保存在当前设备。')}
          <button class="sync-button" type="submit">注册并开始同步</button>
        </form>
      </div>`;
  }

  const loginMethodSelector = `
    <div class="sync-auth-methods" role="group" aria-label="选择登录方式">
      <button class="sync-auth-method${workspaceAccountLoginMethod === 'password' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="password" aria-pressed="${workspaceAccountLoginMethod === 'password'}">密码登录</button>
      <button class="sync-auth-method${workspaceAccountLoginMethod === 'phone-code' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="phone-code" aria-pressed="${workspaceAccountLoginMethod === 'phone-code'}">手机验证码登录</button>
      <button class="sync-auth-method${workspaceAccountLoginMethod === 'phone-device' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="phone-device" aria-pressed="${workspaceAccountLoginMethod === 'phone-device'}">手机微信授权</button>
    </div>`;
  const loginForm = workspaceAccountLoginMethod === 'phone-device' ? renderDeviceLoginPanel() : workspaceAccountLoginMethod === 'phone-code'
    ? `
      <form class="sync-login-form" id="workspaceSyncCodeLoginForm" method="post" autocomplete="on">
        <input type="hidden" name="kind" value="phone">
        ${renderAccountContactField('login-code')}
        ${renderAccountCaptcha()}
        ${renderAccountFeedback('无需密码', '验证已注册手机号后即可登录；验证码不会保存在本机。')}
        <button class="sync-button" type="submit">验证码登录并同步</button>
      </form>`
    : `
      <form class="sync-login-form" id="workspaceSyncLoginForm" method="post" autocomplete="on">
        <label class="sync-field" for="workspaceSyncUsername"><span>手机号、邮箱或用户名</span><input id="workspaceSyncUsername" name="identifier" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeAttr(suggestedUsername)}" required maxlength="128"></label>
        ${renderSyncPasswordField('workspaceSyncPassword', 'password', 'current-password', '密码')}
        <button class="sync-inline-action" type="button" data-action="select-account-view" data-view="recover">忘记密码？</button>
        ${renderAccountFeedback(loginFeedback.title, loginFeedback.detail, loginFeedback.label, workspaceSyncStatus === 'error' ? 'error' : 'info')}
        <button class="sync-button" type="submit">登录并同步</button>
      </form>`;
  return `
    <div class="sync-dialog-content">
      ${tabs}
      ${renderSavedAccountChoices(workspaceSyncClient?.getPublicState() || {})}
      <div class="sync-auth-intro"><strong>欢迎回来</strong><span>手机上的微信账号请选择“手机微信授权”；也可使用账号密码或已注册手机号登录。同昵称可能属于不同账号。</span></div>
      ${loginMethodSelector}
      ${loginForm}
    </div>`;
}

function getAccountProfileValue(profile, keys) {
  for (const key of keys) {
    const value = profile?.[key];
    if (value) return String(value);
  }
  return '';
}

function maskAccountContact(value, kind) {
  if (!value) return '尚未绑定';
  if (kind === 'email') {
    const [name, domain] = value.split('@');
    if (!domain) return value;
    return `${name.slice(0, 2)}${name.length > 2 ? '***' : '*'}@${domain}`;
  }
  const digits = value.replace(/\s/g, '');
  return digits.length > 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : value;
}

async function loadWorkspaceAccountProfile({ force = false } = {}) {
  if (workspaceAccountProfileLoading || !workspaceSyncClient?.getPublicState().loggedIn) return;
  if (!force && workspaceAccountProfile && !workspaceAccountProfile.loadError) return;
  workspaceAccountProfileLoading = true;
  try {
    workspaceAccountProfile = await workspaceSyncClient.getAccountProfile();
  } catch (error) {
    const feedback = getWorkspaceSyncErrorFeedback(error);
    workspaceAccountProfile = { loadError: true, loadErrorDetail: feedback.detail };
  } finally {
    workspaceAccountProfileLoading = false;
    if (document.getElementById('workspaceSyncDialog')?.open && ['account', 'change-password'].includes(workspaceAccountView)) renderWorkspaceSyncDialog();
  }
}

function renderSignedInAccount(state) {
  if (workspaceAccountView === 'recover') return renderRecoveryAccount('account');

  if (workspaceAccountView === 'switch-account') {
    const savedAccounts = renderSavedAccountChoices(state);
    return `
      <div class="sync-dialog-content">
        <button class="sync-back-link" type="button" data-action="select-account-view" data-view="account">← 返回账号中心</button>
        <div class="sync-auth-intro"><strong>切换账号</strong><span>只显示这台设备上曾经安全登录过的账号。有效会话可以直接切换，不会自动填写或保存密码。</span></div>
        ${savedAccounts || renderAccountFeedback('还没有其他账号', '可以先添加一个账号；成功登录后，本机会保存最长 10 天的受限会话。', '暂无账号')}
        <button class="sync-button" type="button" data-action="select-account-view" data-view="add-account">添加其他账号</button>
      </div>`;
  }

  if (workspaceAccountView === 'add-account') {
    const methodSelector = `
      <div class="sync-auth-methods" role="group" aria-label="选择登录方式">
        <button class="sync-auth-method${workspaceAccountLoginMethod === 'password' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="password" aria-pressed="${workspaceAccountLoginMethod === 'password'}">密码登录</button>
        <button class="sync-auth-method${workspaceAccountLoginMethod === 'phone-code' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="phone-code" aria-pressed="${workspaceAccountLoginMethod === 'phone-code'}">手机验证码登录</button>
        <button class="sync-auth-method${workspaceAccountLoginMethod === 'phone-device' ? ' is-active' : ''}" type="button" data-action="select-login-method" data-method="phone-device" aria-pressed="${workspaceAccountLoginMethod === 'phone-device'}">手机微信授权</button>
      </div>`;
    const addAccountForm = workspaceAccountLoginMethod === 'phone-device' ? renderDeviceLoginPanel() : workspaceAccountLoginMethod === 'phone-code'
      ? `
        <form class="sync-login-form" id="workspaceSyncAddCodeAccountForm" method="post" autocomplete="on">
          <input type="hidden" name="kind" value="phone">
          ${renderAccountContactField('login-code')}
          ${renderAccountCaptcha()}
          ${renderAccountFeedback('无需密码', '验证其他账号的手机号后即可添加并切换。', '安全登录')}
          <button class="sync-button" type="submit">验证码登录并添加</button>
        </form>`
      : `
        <form class="sync-login-form" id="workspaceSyncAddAccountForm" method="post" autocomplete="on">
          <label class="sync-field" for="workspaceSyncAddUsername"><span>手机号、邮箱或用户名</span><input id="workspaceSyncAddUsername" name="identifier" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="128"></label>
          ${renderSyncPasswordField('workspaceSyncAddPassword', 'password', 'current-password', '密码')}
          ${renderAccountFeedback('不会保存密码', '只保存由服务端签发的会话；10 天后或会话被撤销时需要重新验证。', '设备会话')}
          <button class="sync-button" type="submit">登录并添加</button>
        </form>`;
    return `
      <div class="sync-dialog-content">
        <button class="sync-back-link" type="button" data-action="select-account-view" data-view="account">← 返回账号中心</button>
        <div class="sync-auth-intro"><strong>添加其他账号</strong><span>可以使用账号密码或手机号验证码；每个账号使用独立的本地工作区与同步队列。</span></div>
        ${methodSelector}
        ${addAccountForm}
      </div>`;
  }

  if (workspaceAccountView === 'change-password') {
    const phone = getAccountProfileValue(workspaceAccountProfile, ['phone_number', 'phone', 'phoneNumber']);
    const methodSelector = `
      <div class="sync-auth-methods" role="group" aria-label="选择密码修改方式">
        <button class="sync-auth-method${workspacePasswordChangeMethod === 'current' ? ' is-active' : ''}" type="button" data-action="select-password-change-method" data-method="current" aria-pressed="${workspacePasswordChangeMethod === 'current'}">使用当前密码</button>
        <button class="sync-auth-method${workspacePasswordChangeMethod === 'phone-code' ? ' is-active' : ''}" type="button" data-action="select-password-change-method" data-method="phone-code" aria-pressed="${workspacePasswordChangeMethod === 'phone-code'}" ${phone ? '' : 'disabled'}>使用手机验证码</button>
      </div>`;
    const form = workspacePasswordChangeMethod === 'phone-code'
      ? `
        <form class="sync-login-form" id="workspaceSyncChangePasswordPhoneForm" method="post" autocomplete="on">
          <input type="hidden" name="kind" value="phone">
          <input type="hidden" name="contact" value="${escapeAttr(phone)}">
          <div class="sync-bound-contact"><span><small>验证码发送到</small><strong>手机 · ${escapeHtml(maskAccountContact(phone, 'phone'))}</strong></span>${renderWorkspaceVerificationButton('recover', !phone)}</div>
          ${renderAccountCaptcha()}
          <label class="sync-field" for="workspacePasswordResetCode"><span>手机验证码</span><input id="workspacePasswordResetCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="请输入 6 位验证码" required></label>
          ${renderSyncPasswordField('workspaceAccountResetPassword', 'password', 'new-password', '新密码')}
          ${renderSyncPasswordField('workspaceAccountResetPasswordConfirm', 'confirmPassword', 'new-password', '再次输入新密码')}
          <p class="sync-field-help">不需要原密码。验证码只会发送到当前账号已经绑定的手机号。</p>
          ${renderAccountFeedback(phone ? '手机验证后重设' : '当前账号尚未绑定手机号', phone ? '验证码和新密码只用于本次操作，不会写入本地存储。' : '请先返回账号中心绑定手机号。', phone ? '安全重设' : '暂不可用', phone ? 'info' : 'error')}
          <button class="sync-button" type="submit" ${phone ? '' : 'disabled'}>验证手机并重设密码</button>
        </form>`
      : `
        <form class="sync-login-form" id="workspaceSyncChangePasswordCurrentForm" method="post" autocomplete="on">
          ${renderSyncPasswordField('workspaceAccountOldPassword', 'oldPassword', 'current-password', '当前密码')}
          ${renderSyncPasswordField('workspaceAccountChangedPassword', 'password', 'new-password', '新密码')}
          ${renderSyncPasswordField('workspaceAccountChangedPasswordConfirm', 'confirmPassword', 'new-password', '再次输入新密码')}
          <p class="sync-field-help">不需要手机验证码。当前密码只用于换取一次性的安全授权，不会保存。</p>
          ${renderAccountFeedback('验证当前密码', '修改成功后，其他设备的旧登录会话将失效；本机会立即换取新的 10 天会话。', '安全修改')}
          <button class="sync-button" type="submit">验证当前密码并修改</button>
        </form>`;
    return `
      <div class="sync-dialog-content">
        <button class="sync-back-link" type="button" data-action="select-account-view" data-view="account">← 返回账号中心</button>
        <div class="sync-auth-intro"><strong>修改密码</strong><span>选择一种身份验证方式即可，不需要同时填写当前密码和手机验证码。</span></div>
        ${methodSelector}
        ${form}
      </div>`;
  }

  if (workspaceAccountView === 'bind') {
    return `
      <div class="sync-dialog-content">
        <button class="sync-back-link" type="button" data-action="select-account-view" data-view="account">← 返回账号中心</button>
        <div class="sync-auth-intro"><strong>绑定${workspaceAccountKind === 'email' ? '邮箱' : '手机号'}</strong><span>验证新的联系方式，并输入当前密码确认是你本人操作。</span></div>
        ${renderAccountKindSelector('bind')}
        <form class="sync-login-form" id="workspaceSyncBindForm" method="post" autocomplete="on">
          <input type="hidden" name="kind" value="${workspaceAccountKind}">
          ${renderAccountContactField('bind')}
          ${renderSyncPasswordField('workspaceAccountCurrentPassword', 'password', 'current-password', '当前密码')}
          ${renderAccountCaptcha()}
          ${renderAccountFeedback('双重确认更安全', '新联系方式需要验证码；当前密码仅用于本次身份确认，不会保存。')}
          <button class="sync-button" type="submit">确认绑定</button>
        </form>
      </div>`;
  }

  const conflicts = workspaceSyncClient.state?.conflicts || [];
  const signedIn = formatWorkspaceSyncTimestamp(state.signedInAt, '时间未知');
  const lastSynced = formatWorkspaceSyncTimestamp(state.lastSyncedAt, '尚未同步');
  const lastSummary = state.lastSyncSummary || {};
  const email = getAccountProfileValue(workspaceAccountProfile, ['email', 'email_address', 'emailAddress']);
  const phone = getAccountProfileValue(workspaceAccountProfile, ['phone_number', 'phone', 'phoneNumber']);
  const hasRecovery = Boolean(email || phone);
  const connectionStatus = workspaceSyncStatus === 'error' ? `账号已登录 · 日程同步失败：${workspaceSyncDetail || '请重试'}`
    : workspaceSyncStatus === 'offline' ? '账号已登录 · 当前离线，修改保存在本机'
    : workspaceSyncStatus === 'syncing' ? '账号已登录 · 正在同步日程'
    : state.lastSyncedAt
    ? `已同步 · 云端版本 ${state.cursor || 0} · 上传 ${lastSummary.uploaded || 0} 项 · 接收 ${lastSummary.downloaded || 0} 项 · 最近成功同步 ${lastSynced}`
    : '账号已连接，正在等待首次同步';
  return `
    <div class="sync-dialog-content">
      <div class="sync-account-row">
        <div><div class="sync-session-badge">已登录</div><div class="sync-account-name">${escapeHtml(state.username || 'Inner Garden · 美日心灵 账号')}</div><div class="sync-dialog-note">登录于 ${escapeHtml(signedIn)} · 最近成功同步 ${escapeHtml(lastSynced)}</div><div class="sync-dialog-note">待同步 ${state.queued} 项 · 冲突 ${state.conflicts} 项</div></div>
        <div class="sync-account-row-actions"><button class="sync-button subtle" type="button" data-action="sync-logout">退出当前账号</button><button class="sync-button subtle" type="button" data-action="select-account-view" data-view="switch-account">切换账号</button></div>
      </div>
      <div class="sync-account-uid"><span>账号 UID</span><code>${escapeHtml(state.userId || '暂未取得')}</code><p class="sync-field-help">两端 UID 相同，才是同一个账号。昵称、Chrome 账号与插件 ID 均不能代替它。</p></div>
      <div class="sync-account-identities" aria-label="已绑定的联系方式">
        <div class="sync-identity-card"><span>邮箱</span><strong>${escapeHtml(workspaceAccountProfileLoading ? '读取中…' : maskAccountContact(email, 'email'))}</strong><button type="button" data-action="start-account-bind" data-kind="email">${email ? '更换' : '绑定邮箱'}</button></div>
        <div class="sync-identity-card"><span>手机号</span><strong>${escapeHtml(workspaceAccountProfileLoading ? '读取中…' : maskAccountContact(phone, 'phone'))}</strong><button type="button" data-action="start-account-bind" data-kind="phone">${phone ? '更换' : '绑定手机'}</button></div>
      </div>
      ${hasRecovery || workspaceAccountProfileLoading || workspaceAccountProfile?.loadError ? '' : renderAccountFeedback('当前未绑定邮箱或手机号', '微信身份可以独立使用。桌面密码／短信登录需要属于这个 UID 的相应凭据；绑定联系方式的现有流程还要求当前密码。', '登录方式')}
      ${workspaceAccountProfile?.loadError ? `<p class="sync-dialog-note">${escapeHtml(workspaceAccountProfile.loadErrorDetail || '联系方式暂时读取失败，请稍后重试。')} <button class="sync-inline-action" type="button" data-action="refresh-account-profile">重新读取</button></p>` : ''}
      <div class="sync-account-actions">
        <button class="sync-button subtle" type="button" data-action="start-password-change">修改密码</button>
        <button class="sync-button subtle" type="button" data-action="select-account-view" data-view="add-account">添加其他账号</button>
      </div>
      <div class="sync-dialog-connection" id="syncDialogConnectionStatus" role="status" aria-live="polite">${escapeHtml(connectionStatus)}</div>
      <div class="sync-auth-methods" role="group" aria-label="同步方式">
        <button class="sync-auth-method${workspaceSyncMode === 'auto' ? ' is-active' : ''}" type="button" data-action="set-workspace-sync-mode" data-mode="auto" aria-pressed="${workspaceSyncMode === 'auto'}">自动同步</button>
        <button class="sync-auth-method${workspaceSyncMode === 'manual' ? ' is-active' : ''}" type="button" data-action="set-workspace-sync-mode" data-mode="manual" aria-pressed="${workspaceSyncMode === 'manual'}">手动同步</button>
      </div>
      <p class="sync-dialog-note">日程同步包含全部日期的日历、周计划和日课。自动模式在插件页面可见时约每 12 分钟检查；本地编辑立即保存。手动模式由“立即同步”触发，登录和切换账号也会尝试首次同步。flomo 需要单独开启与同步，图片和草稿留在本机。</p>
      <button class="sync-button" type="button" data-action="download-sync-backup">下载首次同步前的备份</button>
      ${conflicts.length ? `<div class="sync-conflict-list">${conflicts.map(conflict => `
        <div class="sync-conflict-card">
          <strong>${escapeHtml(conflict.entityType === 'daily_log_field' ? `${conflict.local?.dateKey || conflict.remote?.payload?.dateKey || ''} · ${DAILY_LOG_FIELD_LABELS[conflict.local?.field || conflict.remote?.payload?.field] || '日课字段'}` : conflict.entityType.replaceAll('_', ' '))}</strong>
          <div class="sync-dialog-note">两台设备编辑了同一项内容，两个版本都已保留。</div>
          ${conflict.entityType === 'daily_log_field' ? `<div class="sync-conflict-versions"><div><span>本机</span><pre>${escapeHtml(conflict.local?.value || '')}</pre></div><div><span>云端</span><pre>${escapeHtml(conflict.remote?.payload?.value || '')}</pre></div></div><textarea class="sync-conflict-manual" data-conflict-manual-id="${escapeAttr(conflict.id)}" placeholder="可在这里手动合并两个版本">${escapeHtml(conflict.local?.value || '')}</textarea>` : ''}
          <div class="sync-conflict-actions">
            <button class="sync-button" type="button" data-action="resolve-sync-conflict" data-conflict-id="${escapeAttr(conflict.id)}" data-resolution="local">采用本机版本</button>
            <button class="sync-button subtle" type="button" data-action="resolve-sync-conflict" data-conflict-id="${escapeAttr(conflict.id)}" data-resolution="remote">采用云端版本</button>
            ${conflict.entityType === 'daily_log_field' ? `<button class="sync-button subtle" type="button" data-action="resolve-sync-conflict-manual" data-conflict-id="${escapeAttr(conflict.id)}">采用手动合并</button>` : ''}
          </div>
        </div>`).join('')}</div>` : '<p class="sync-dialog-note sync-conflict-empty">没有冲突，各设备内容一致。</p>'}
    </div>`;
}

function renderWorkspaceSyncDialog() {
  const body = document.getElementById('syncDialogBody');
  if (!body) return;
  const state = workspaceSyncClient?.getPublicState() || {};
  if (state.configured === undefined) {
    body.innerHTML = `
      <div class="sync-dialog-content">
        <div class="sync-auth-intro"><strong>插件后台尚未连接</strong><span>暂时无法读取账号状态。</span></div>
        <p class="sync-dialog-note">${escapeHtml(workspaceSyncDetail || '请稍后重试。若持续无法连接，请在 Chrome 扩展管理页重新加载 Inner Garden，再新开标签页；若仍失败，请查看该插件的后台错误。')}</p>
      </div>`;
    return;
  }
  if (!state.configured) {
    body.innerHTML = `
      <div class="sync-dialog-content">
        <div class="sync-auth-intro"><strong>云同步尚未配置</strong><span>Inner Garden · 美日心灵 仍可在本机完整使用，不会影响你的计划数据。</span></div>
        <p class="sync-dialog-note">扩展已配置账号同步服务。请授予服务域名访问权限后登录；本机编辑无需登录。</p>
      </div>`;
    return;
  }
  if (!state.loggedIn) {
    body.innerHTML = renderLoggedOutAccount();
    return;
  }
  body.innerHTML = renderSignedInAccount(state);
  if (!workspaceAccountProfile && !workspaceAccountProfileLoading) loadWorkspaceAccountProfile();
}

function downloadFirstSyncBackup() {
  const backup = workspaceSyncClient?.state?.firstBackup;
  if (!backup) return showToast('当前没有可下载的同步备份');
  downloadWorkspaceExportFile({
    app: 'tab-out',
    type: WEEKLY_WORKSPACE_STORAGE_KEY,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    reason: 'before-first-sync',
    weeklyWorkspace: backup,
  });
}

function updateWeekTimeLine() {
  const lineEl = document.getElementById('currentTimeLine');
  const bodyEl = document.getElementById('weekGridBody');
  if (!lineEl || !bodyEl) return;

  const parts = getShanghaiParts();
  const visibleStartHour = getPlannerDisplayStartMinute() / 60;
  if (!isSelectedWeekCurrent() || parts.hour < visibleStartHour || parts.hour > PLANNER_END_HOUR) {
    lineEl.style.display = 'none';
    return;
  }

  const top = ((parts.hour - visibleStartHour) + parts.minute / 60) * PLANNER_ROW_HEIGHT;
  lineEl.style.top = `${top}px`;
  lineEl.dataset.time = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  lineEl.style.display = 'block';
}

function getWeekEvent(eventId) {
  return weeklyWorkspaceState.events.find(event => event.id === eventId) || null;
}

function getWeekEventLabel(event) {
  const day = getSelectedWeekDates().find(item => item.key === event.dateKey);
  const dayName = day ? day.dayName : event.dateKey;
  return `${dayName} ${shortDateFromKey(event.dateKey)} ${formatPlannerRange(event)}`;
}

function selectWeekEvent(eventId) {
  const removedDrafts = cleanupDraftWeekEvents(eventId);
  selectedWeekEventId = eventId;
  const event = getWeekEvent(eventId);
  if (event?.dateKey && event.dateKey !== getSelectedDailyLogDateKey()) selectDailyLogDate(event.dateKey);
  if (removedDrafts) renderWeekCalendar();
  document.querySelectorAll('.week-event').forEach(eventEl => {
    eventEl.classList.toggle('is-selected', eventEl.dataset.eventId === eventId);
  });
}

function deleteWeekEvent(eventId) {
  const index = weeklyWorkspaceState.events.findIndex(event => event.id === eventId);
  if (index === -1) return;
  const dateKey = weeklyWorkspaceState.events[index].dateKey;

  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  weeklyWorkspaceState.events.splice(index, 1);
  if (selectedWeekEventId === eventId) selectedWeekEventId = null;

  const overlay = document.getElementById('weekEntryEditor');
  const titleInput = overlay?.querySelector('#weekEventTitleInput');
  if (overlay?.classList.contains('visible') && titleInput?.dataset.eventId === eventId) {
    closeWeekEntryEditor();
  }

  scheduleWeeklyWorkspaceSave();
  renderWeekCalendar();
  refreshGeneratedLogStatusForDate(dateKey);
}

function closeWeekEventDeleteConfirm() {
  document.getElementById('weekEventDeleteConfirm')?.remove();
}

function requestDeleteWeekEvent(eventId) {
  const event = getWeekEvent(eventId);
  if (!event) return;
  closeWeekEventDeleteConfirm();

  const confirmEl = document.createElement('div');
  confirmEl.id = 'weekEventDeleteConfirm';
  confirmEl.className = 'daily-log-clear-confirm week-event-delete-confirm';
  confirmEl.setAttribute('role', 'dialog');
  confirmEl.setAttribute('aria-modal', 'true');
  confirmEl.innerHTML = `
    <div class="daily-log-clear-confirm-text">删除「${escapeHtml(event.title || DEFAULT_WEEK_EVENT_TITLE)}」？</div>
    <div class="daily-log-clear-confirm-actions">
      <button type="button" class="daily-log-confirm-btn" data-action="cancel-week-event-delete">取消</button>
      <button type="button" class="daily-log-confirm-btn danger" data-action="confirm-week-event-delete" data-event-id="${escapeAttr(event.id)}">删除</button>
    </div>`;
  document.body.appendChild(confirmEl);
  requestAnimationFrame(() => {
    confirmEl.querySelector('[data-action="confirm-week-event-delete"]')?.focus();
  });
}

function confirmDeleteWeekEvent(eventId) {
  closeWeekEventDeleteConfirm();
  deleteWeekEvent(eventId);
}

function createWeekEventAtMinute(dateKey, startMinute) {
  cleanupDraftWeekEvents();
  const displayEnd = getPlannerDisplayEndMinute();
  const snappedStart = clamp(
    snapMinutes(startMinute),
    getPlannerDisplayStartMinute(),
    displayEnd - PLANNER_MIN_EVENT_MINUTES
  );
  const endMinute = Math.min(snappedStart + PLANNER_MIN_EVENT_MINUTES, displayEnd);
  const event = normalizeWeekEvent({
    id: `event-${Date.now()}`,
    dateKey,
    startMinute: snappedStart,
    endMinute,
    title: DEFAULT_WEEK_EVENT_TITLE,
    content: '',
    color: 'white',
  });
  event.isDraft = true;

  weeklyWorkspaceState.events.push(event);
  selectedWeekEventId = event.id;
  renderWeekCalendar();
  return event;
}

function createWeekEventFromCellClick(cell, mouseEvent) {
  const hour = Number(cell.dataset.hour);
  if (!cell.dataset.dayKey || !Number.isFinite(hour)) return;

  const rect = cell.getBoundingClientRect();
  const minuteOffset = snapMinutes(((mouseEvent.clientY - rect.top) / rect.height) * 60);
  createWeekEventAtMinute(cell.dataset.dayKey, hour * 60 + minuteOffset);
}

function ensureWeekEntryEditor() {
  let overlay = document.getElementById('weekEntryEditor');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'weekEntryEditor';
  overlay.className = 'week-editor-overlay';
  overlay.innerHTML = `
    <div class="week-editor-panel" role="dialog" aria-modal="true" aria-labelledby="weekEditorTitle">
      <div class="week-editor-topbar">
        <div>
          <div class="week-editor-kicker">Week rhythm</div>
          <h3 id="weekEditorTitle">Expanded note</h3>
        </div>
        <div class="week-editor-actions">
          <button class="week-editor-delete" id="weekEditorDelete" data-action="delete-week-event" title="Delete" aria-label="Delete event">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 4v6m4-6v6m4-10-.7 12.1A2 2 0 0 1 13.3 21h-2.6a2 2 0 0 1-2-1.9L8 7" />
            </svg>
          </button>
          <button class="week-editor-close" data-action="close-week-entry-editor" title="Close editor" aria-label="Close editor">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="week-editor-fields">
        <input class="week-event-title-input" id="weekEventTitleInput" type="text" aria-label="Event title">
        <fieldset class="week-event-colors" aria-label="时间块颜色">
          <legend>时间块颜色</legend>

            <button type="button" class="week-event-color event-color-yellow" data-action="set-week-event-color" data-color="yellow" aria-label="黄色" aria-pressed="false"><span aria-hidden="true"></span>黄色</button>
            <button type="button" class="week-event-color event-color-pink" data-action="set-week-event-color" data-color="pink" aria-label="粉色" aria-pressed="false"><span aria-hidden="true"></span>粉色</button>
            <button type="button" class="week-event-color event-color-blue" data-action="set-week-event-color" data-color="blue" aria-label="蓝色" aria-pressed="false"><span aria-hidden="true"></span>蓝色</button>
            <button type="button" class="week-event-color event-color-purple" data-action="set-week-event-color" data-color="purple" aria-label="紫色" aria-pressed="false"><span aria-hidden="true"></span>紫色</button>
            <button type="button" class="week-event-color event-color-white" data-action="set-week-event-color" data-color="white" aria-label="白色" aria-pressed="false"><span aria-hidden="true"></span>白色</button>
        </fieldset>
        <textarea class="week-entry-expanded" id="weekEntryExpanded" aria-label="Expanded planner entry"></textarea>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function openWeekEntryEditor(eventId) {
  const event = getWeekEvent(eventId);
  if (!event) return;

  const overlay = ensureWeekEntryEditor();
  const titleEl = overlay.querySelector('#weekEditorTitle');
  const deleteButton = overlay.querySelector('#weekEditorDelete');
  const titleInput = overlay.querySelector('#weekEventTitleInput');
  const textarea = overlay.querySelector('#weekEntryExpanded');
  if (!textarea || !titleInput) return;

  selectWeekEvent(event.id);
  if (titleEl) titleEl.textContent = getWeekEventLabel(event);
  if (deleteButton) deleteButton.dataset.eventId = event.id;
  titleInput.dataset.eventId = event.id;
  titleInput.value = event.title || '';
  textarea.dataset.eventId = event.id;
  textarea.value = event.content || '';
  overlay.querySelectorAll('[data-action="set-week-event-color"]').forEach(button => {
    button.dataset.eventId = event.id;
    button.setAttribute('aria-pressed', String(button.dataset.color === (event.color || 'yellow')));
  });
  overlay.classList.add('visible');
  document.body.classList.add('week-editor-open');
  requestAnimationFrame(() => titleInput.focus({ preventScroll: true }));
}

function closeWeekEntryEditor() {
  const overlay = document.getElementById('weekEntryEditor');
  if (!overlay) return;
  const titleInput = overlay.querySelector('#weekEventTitleInput');
  const eventId = titleInput?.dataset.eventId;
  overlay.classList.remove('visible');
  document.body.classList.remove('week-editor-open');
  if (eventId && getWeekEvent(eventId)?.isDraft) {
    cleanupDraftWeekEvents();
    renderWeekCalendar();
  }
}

function getDailyLogFieldKeyFromTarget(target) {
  if (target.dataset.logKey) return target.dataset.logKey;
  if (target.id === 'dailyLogOutput') return 'generated';
  if (target.classList.contains('daily-log-expanded')) return target.dataset.logEditorKey;
  return '';
}

function getDailyLogFieldDateKeyFromTarget(target) {
  return target.dataset.logDateKey || getSelectedDailyLogDateKey();
}

function parseDailyLogGeneratedSections(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const timeBlockHeadingIndexes = [];

  lines.forEach((line, lineIndex) => {
    if (line === '## Time Blocks') timeBlockHeadingIndexes.push(lineIndex);
    const entry = LOG_KEYS.find(([, label]) => line === `## ${label}`);
    if (entry) headings.push({ key: entry[0], lineIndex });
  });

  const hasExpectedHeadings = headings.length === LOG_KEYS.length &&
    headings.every((heading, index) => heading.key === LOG_KEYS[index][0]) &&
    timeBlockHeadingIndexes.length === 1 &&
    timeBlockHeadingIndexes[0] < headings[0].lineIndex;
  if (!hasExpectedHeadings) {
    return { valid: false, fields: {}, timeBlocks: [], timeBlocksValid: false, structure: '' };
  }

  const timeBlockHeadingIndex = timeBlockHeadingIndexes[0];
  const timeBlockLines = lines.slice(timeBlockHeadingIndex + 1, headings[0].lineIndex);
  while (timeBlockLines[0]?.trim() === '') timeBlockLines.shift();
  while (timeBlockLines.at(-1)?.trim() === '') timeBlockLines.pop();

  const timeBlocks = [];
  let timeBlocksValid = true;
  const isEmptyTimeBlockSection = timeBlockLines.length === 1 &&
    /^--? No time blocks recorded\.$/.test(timeBlockLines[0]);
  if (!isEmptyTimeBlockSection) {
    let currentBlock = null;
    timeBlockLines.forEach(line => {
      const match = line.match(/^--?\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})\s+(.+)$/);
      if (match) {
        const startHour = Number(match[1]);
        const startMinutePart = Number(match[2]);
        const endHour = Number(match[3]);
        const endMinutePart = Number(match[4]);
        const startMinute = startHour * 60 + startMinutePart;
        const endMinute = endHour * 60 + endMinutePart;
        const title = match[5].trim();
        const hasValidTime = startHour < 24 && startMinutePart < 60 &&
          (endHour < 24 || (endHour === 24 && endMinutePart === 0)) && endMinutePart < 60 &&
          endMinute - startMinute >= PLANNER_MIN_EVENT_MINUTES && Boolean(title);
        if (!hasValidTime) {
          timeBlocksValid = false;
          return;
        }
        currentBlock = {
          startMinute,
          endMinute,
          title,
          contentLines: [],
        };
        timeBlocks.push(currentBlock);
        return;
      }

      if (!currentBlock) {
        if (line.trim()) timeBlocksValid = false;
        return;
      }
      currentBlock.contentLines.push(line.startsWith('  ') ? line.slice(2) : line);
    });
  }

  const normalizedTimeBlocks = timeBlocks.map(block => {
    const contentLines = [...block.contentLines];
    while (contentLines[0]?.trim() === '') contentLines.shift();
    while (contentLines.at(-1)?.trim() === '') contentLines.pop();
    return {
      startMinute: block.startMinute,
      endMinute: block.endMinute,
      title: block.title,
      content: contentLines.join('\n'),
    };
  });
  if (normalizedTimeBlocks.some((block, index) => (
    index > 0 && block.startMinute < normalizedTimeBlocks[index - 1].startMinute
  ))) {
    timeBlocksValid = false;
  }

  const fields = {};
  headings.forEach((heading, index) => {
    const nextLineIndex = headings[index + 1]?.lineIndex ?? lines.length;
    const valueLines = lines.slice(heading.lineIndex + 1, nextLineIndex);
    while (valueLines[0]?.trim() === '') valueLines.shift();
    while (valueLines.at(-1)?.trim() === '') valueLines.pop();
    const value = valueLines.join('\n');
    fields[heading.key] = value === '-' || value === '--' ? '' : value;
  });

  const sections = [
    {
      key: 'time-blocks',
      lineIndex: timeBlockHeadingIndex,
      nextLineIndex: headings[0].lineIndex,
    },
    ...headings.map((heading, index) => ({
      ...heading,
      nextLineIndex: headings[index + 1]?.lineIndex ?? lines.length,
    })),
  ];
  const structureLines = [...lines];
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    structureLines.splice(
      section.lineIndex + 1,
      section.nextLineIndex - section.lineIndex - 1,
      `[[tab-out-daily-log-field:${section.key}]]`
    );
  }

  return {
    valid: true,
    fields,
    timeBlocks: normalizedTimeBlocks,
    timeBlocksValid,
    structure: structureLines.join('\n'),
  };
}

function getDailyLogGeneratedSyncState(text, canonicalText) {
  const parsed = parseDailyLogGeneratedSections(text);
  const canonical = parseDailyLogGeneratedSections(canonicalText);
  const timeBlocksCompatible = parsed.timeBlocksValid && canonical.timeBlocksValid &&
    parsed.timeBlocks.length === canonical.timeBlocks.length;
  return {
    ...parsed,
    timeBlocksCompatible,
    hasUnlinkedChanges: !parsed.valid || !canonical.valid || !timeBlocksCompatible ||
      parsed.structure.trim() !== canonical.structure.trim(),
  };
}

function getDailyLogFieldValue(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  if (DAILY_LOG_DRAFT_KEYS.includes(fieldKey)) {
    if (dateKey === getShanghaiTodayKey()) return getDailyDraft()[fieldKey] || '';
    return weeklyWorkspaceState.logs?.[dateKey]?.[fieldKey] || '';
  }

  const log = getDailyLogForDate(dateKey);
  if (fieldKey === 'generated') return log.generated || '';
  return log[fieldKey] || '';
}

function setDailyLogFieldValue(fieldKey, value, dateKey = getSelectedDailyLogDateKey()) {
  if (DAILY_LOG_DRAFT_KEYS.includes(fieldKey)) {
    getDailyLogForDate(dateKey)[fieldKey] = value;
    if (dateKey === getShanghaiTodayKey()) getDailyDraft()[fieldKey] = value;
  } else if (fieldKey === 'generated') {
    const log = getDailyLogForDate(dateKey);
    log.generated = value;
  } else {
    return false;
  }

  if (dateKey === getSelectedDailyLogDateKey()) {
    const compactSelector = fieldKey === 'generated'
      ? '#dailyLogOutput'
      : `[data-log-key="${CSS.escape(fieldKey)}"]`;
    const compactEl = document.querySelector(compactSelector);
    if (compactEl && compactEl.value !== value) compactEl.value = value;
  }

  const expandedEl = document.querySelector('.daily-log-expanded');
  if (
    expandedEl?.dataset.logEditorKey === fieldKey &&
    getDailyLogFieldDateKeyFromTarget(expandedEl) === dateKey &&
    expandedEl.value !== value
  ) {
    expandedEl.value = value;
  }
  renderDailyLogPanelMeta(dateKey);
  renderDailyLogArchive();
  renderYearArchive();
  return true;
}

function setDailyLogEditorSyncStatus(state, message) {
  const statusEl = document.getElementById('dailyLogEditorSyncStatus');
  if (!statusEl) return;
  statusEl.dataset.state = state || '';
  statusEl.textContent = message || '';
}

function syncDailyLogGeneratedTimeBlocks(timeBlocks, dateKey) {
  const events = weeklyWorkspaceState.events
    .filter(event => event.dateKey === dateKey)
    .sort((a, b) => a.startMinute - b.startMinute);
  if (events.length !== timeBlocks.length) return { synced: false, changed: false };

  let changed = false;
  events.forEach((event, index) => {
    const timeBlock = timeBlocks[index];
    if (
      event.startMinute !== timeBlock.startMinute ||
      event.endMinute !== timeBlock.endMinute ||
      event.title !== timeBlock.title ||
      event.content !== timeBlock.content
    ) {
      event.startMinute = timeBlock.startMinute;
      event.endMinute = timeBlock.endMinute;
      event.title = timeBlock.title;
      event.content = timeBlock.content;
      changed = true;
    }
  });

  return { synced: true, changed };
}

function syncDailyLogGeneratedSections(text, dateKey) {
  const syncState = getDailyLogGeneratedSyncState(text, generateDailyLogText(dateKey));
  if (!syncState.valid) {
    setDailyLogEditorSyncStatus('warning', 'Section headings changed · edits are kept here but not synced');
    return syncState;
  }

  DAILY_LOG_DRAFT_KEYS.forEach(fieldKey => {
    const nextValue = syncState.fields[fieldKey] || '';
    if (getDailyLogFieldValue(fieldKey, dateKey) !== nextValue) {
      setDailyLogFieldValue(fieldKey, nextValue, dateKey);
    }
  });

  const timeBlockResult = syncState.timeBlocksCompatible
    ? syncDailyLogGeneratedTimeBlocks(syncState.timeBlocks, dateKey)
    : { synced: false, changed: false };
  if (!timeBlockResult.synced) syncState.hasUnlinkedChanges = true;
  if (timeBlockResult.changed) renderWeekCalendar();

  const log = getDailyLogForDate(dateKey);
  log.generated = text;
  log.generatedSourceSignature = getDailyLogSourceSignature(dateKey);
  renderDailyLogPanelMeta(dateKey);
  renderDailyLogArchive();
  renderYearArchive();
  scheduleWeeklyWorkspaceSave();
  setDailyLogEditorSyncStatus(
    syncState.hasUnlinkedChanges ? 'warning' : 'synced',
    syncState.hasUnlinkedChanges
      ? 'Sections synced · unmatched time-block or title edits remain only in this draft'
      : 'Synced to sections and time blocks'
  );
  return syncState;
}

function flushDailyLogGeneratedSectionSync() {
  if (dailyLogGeneratedSyncTimer) {
    clearTimeout(dailyLogGeneratedSyncTimer);
    dailyLogGeneratedSyncTimer = null;
  }
  if (!pendingDailyLogGeneratedSync) return null;

  const pending = pendingDailyLogGeneratedSync;
  pendingDailyLogGeneratedSync = null;
  return syncDailyLogGeneratedSections(pending.text, pending.dateKey);
}

function scheduleDailyLogGeneratedSectionSync(text, dateKey) {
  if (dailyLogGeneratedSyncTimer) clearTimeout(dailyLogGeneratedSyncTimer);
  pendingDailyLogGeneratedSync = { text, dateKey };
  setDailyLogEditorSyncStatus('syncing', 'Syncing to sections…');
  dailyLogGeneratedSyncTimer = setTimeout(() => {
    dailyLogGeneratedSyncTimer = null;
    flushDailyLogGeneratedSectionSync();
  }, 350);
}

function renderDailyLogPanelMeta(dateKey = getSelectedDailyLogDateKey()) {
  if (dateKey !== getSelectedDailyLogDateKey()) return;
  const log = weeklyWorkspaceState.logs?.[dateKey] || {};
  const mode = getDailyLogDateMode(dateKey);
  const stale = isDailyLogStale(dateKey);
  const dateEl = document.getElementById('dailyLogDateLabel');
  if (dateEl) {
    dateEl.textContent = `${dateKey} · ${stale ? 'update available' : mode}`;
    dateEl.title = stale ? 'Source content changed after generation' : '';
  }
  const generateButton = document.querySelector('[data-action="generate-daily-log"]');
  if (generateButton) {
    generateButton.textContent = `${(log.generated || '').trim() ? '重新生成每日汇总' : '生成每日汇总'} ${shortDateFromKey(dateKey)}`;
    generateButton.classList.toggle('is-stale', stale);
    generateButton.title = stale ? '原始内容已更新，可重新生成当天记录' : `生成 ${dateKey} 的记录`;
  }
}

function getDailyLogCompactElement(fieldKey) {
  const selector = fieldKey === 'generated'
      ? '#dailyLogOutput'
      : `[data-log-key="${CSS.escape(fieldKey)}"]`;
  return document.querySelector(selector);
}

function closeDailyLogClearConfirm() {
  document.getElementById('dailyLogClearConfirm')?.remove();
}

function closeDailyLogRegenerateConfirm() {
  document.getElementById('dailyLogRegenerateConfirm')?.remove();
}

function showDailyLogRegenerateConfirm(dateKey) {
  closeDailyLogRegenerateConfirm();

  const current = String(weeklyWorkspaceState.logs?.[dateKey]?.generated || '');
  const next = generateDailyLogText(dateKey);
  const currentLines = current.replace(/\r\n?/g, '\n').split('\n');
  const nextLines = next.replace(/\r\n?/g, '\n').split('\n');
  const changedLines = Math.max(currentLines.length, nextLines.length) - currentLines.filter((line, index) => line === nextLines[index]).length;
  let sourceSummary = '四栏日课与日程没有可识别的变化；差异来自汇总稿的手工结构。';
  try {
    const savedSource = JSON.parse(weeklyWorkspaceState.logs?.[dateKey]?.generatedSourceSignature || '{}');
    const currentSource = JSON.parse(getDailyLogSourceSignature(dateKey));
    const changedFields = DAILY_LOG_DRAFT_KEYS.filter(key => String(savedSource.fields?.[key] || '') !== String(currentSource.fields?.[key] || '')).map(key => DAILY_LOG_FIELD_LABELS[key]);
    const eventChanged = JSON.stringify(savedSource.events || []) !== JSON.stringify(currentSource.events || []);
    const parts = [];
    if (changedFields.length) parts.push(`四栏变化：${changedFields.join('、')}`);
    if (eventChanged) parts.push('日程时间块有变化');
    if (parts.length) sourceSummary = parts.join('；');
  } catch { /* Legacy snapshots may not have a readable source signature. */ }

  const confirmEl = document.createElement('div');
  confirmEl.id = 'dailyLogRegenerateConfirm';
  confirmEl.className = 'daily-log-clear-confirm';
  confirmEl.setAttribute('role', 'dialog');
  confirmEl.setAttribute('aria-modal', 'true');
  confirmEl.innerHTML = `
    <div class="daily-log-clear-confirm-text"><strong>${escapeHtml(dateKey)} 的每日汇总稿将被替换</strong><br>${escapeHtml(sourceSummary)}。新旧稿约有 ${changedLines} 行位置不同。此操作只按当前四栏日课和日程重新生成汇总稿；已经成功回写的原始记录不会被撤销。这不是账号同步失败。</div>
    <div class="daily-log-regenerate-preview"><div><span>当前保存稿</span><pre>${escapeHtml(current)}</pre></div><div><span>重新生成后</span><pre>${escapeHtml(next)}</pre></div></div>
    <div class="daily-log-clear-confirm-actions">
      <button type="button" class="daily-log-confirm-btn" data-action="cancel-daily-log-regenerate">取消</button>
      <button type="button" class="daily-log-confirm-btn" data-action="download-current-daily-summary" data-log-date-key="${escapeAttr(dateKey)}">下载当前稿</button>
      <button type="button" class="daily-log-confirm-btn danger" data-action="confirm-daily-log-regenerate" data-log-date-key="${escapeAttr(dateKey)}">备份旧稿并替换</button>
    </div>`;
  document.body.appendChild(confirmEl);
  requestAnimationFrame(() => {
    confirmEl.querySelector('[data-action="confirm-daily-log-regenerate"]')?.focus();
  });
}

function showDailyLogClearConfirm(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  closeDailyLogClearConfirm();

  const label = DAILY_LOG_FIELD_LABELS[fieldKey] || 'this field';
  const confirmEl = document.createElement('div');
  confirmEl.id = 'dailyLogClearConfirm';
  confirmEl.className = 'daily-log-clear-confirm';
  confirmEl.setAttribute('role', 'dialog');
  confirmEl.setAttribute('aria-modal', 'true');
  confirmEl.innerHTML = `
    <div class="daily-log-clear-confirm-text">清除「${escapeHtml(label)}」中的文字？</div>
    <div class="daily-log-clear-confirm-actions">
      <button type="button" class="daily-log-confirm-btn" data-action="cancel-daily-log-clear">取消</button>
      <button type="button" class="daily-log-confirm-btn danger" data-action="confirm-daily-log-clear" data-log-editor-key="${escapeAttr(fieldKey)}" data-log-date-key="${escapeAttr(dateKey)}">清除</button>
    </div>`;
  document.body.appendChild(confirmEl);
  requestAnimationFrame(() => {
    confirmEl.querySelector('[data-action="confirm-daily-log-clear"]')?.focus();
  });
}

function ensureDailyLogEditor() {
  let overlay = document.getElementById('dailyLogEditor');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'dailyLogEditor';
  overlay.className = 'week-editor-overlay';
  overlay.innerHTML = `
    <div class="week-editor-panel daily-log-editor-panel" role="dialog" aria-modal="true" aria-labelledby="dailyLogEditorTitle">
      <div class="week-editor-topbar">
        <div>
          <div class="week-editor-kicker">Daily log</div>
          <h3 id="dailyLogEditorTitle">Expanded note</h3>
        </div>
        <div class="week-editor-actions">
          <button class="log-copy-btn" id="dailyLogEditorCopy" data-action="copy-daily-log-field" title="Copy log" aria-label="Copy log">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 4h7a4 4 0 0 1 4 4v7M4 16V8a4 4 0 0 1 4-4h5" />
            </svg>
          </button>
          <button class="week-editor-close" data-action="close-daily-log-editor" title="Close editor" aria-label="Close editor">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="week-editor-fields">
        <div class="daily-log-editor-sync-status" id="dailyLogEditorSyncStatus" aria-live="polite"></div>
        <textarea class="week-entry-expanded daily-log-expanded" id="dailyLogExpanded" aria-label="Expanded daily log entry"></textarea>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function openDailyLogEditor(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  if (!DAILY_LOG_FIELD_LABELS[fieldKey]) return;

  const overlay = ensureDailyLogEditor();
  const titleEl = overlay.querySelector('#dailyLogEditorTitle');
  const kickerEl = overlay.querySelector('.week-editor-kicker');
  const panelEl = overlay.querySelector('.daily-log-editor-panel');
  const textarea = overlay.querySelector('#dailyLogExpanded');
  const copyButton = overlay.querySelector('#dailyLogEditorCopy');
  if (!textarea) return;

  if (kickerEl) kickerEl.textContent = getDailyLogDateMode(dateKey) === 'plan' ? 'Daily plan' : 'Daily log';
  if (titleEl) titleEl.textContent = `${dateKey} ${DAILY_LOG_FIELD_LABELS[fieldKey]}`;
  textarea.dataset.logEditorKey = fieldKey;
  textarea.dataset.logDateKey = dateKey;
  textarea.value = getDailyLogFieldValue(fieldKey, dateKey);
  textarea.readOnly = false;
  panelEl?.classList.toggle('is-generated', fieldKey === 'generated');
  if (fieldKey === 'generated') {
    const syncState = getDailyLogGeneratedSyncState(textarea.value, generateDailyLogText(dateKey));
    setDailyLogEditorSyncStatus(
      syncState.hasUnlinkedChanges ? 'warning' : '',
      syncState.hasUnlinkedChanges
        ? 'Some generated-log edits cannot be matched safely'
        : 'Edits in time blocks and the four standard sections sync automatically'
    );
  } else {
    setDailyLogEditorSyncStatus('', '');
  }
  if (copyButton) {
    copyButton.dataset.logEditorKey = fieldKey;
    copyButton.dataset.logDateKey = dateKey;
  }
  overlay.classList.add('visible');
  document.body.classList.add('week-editor-open');
  requestAnimationFrame(() => textarea.focus());
}

function closeDailyLogEditor() {
  const overlay = document.getElementById('dailyLogEditor');
  if (!overlay) return;
  const textarea = overlay.querySelector('.daily-log-expanded');
  if (textarea?.dataset.logEditorKey === 'generated') flushDailyLogGeneratedSectionSync();
  overlay.classList.remove('visible');
  document.body.classList.remove('week-editor-open');
}

function updateWeekEventColor(eventId, color) {
  if (!['yellow', 'pink', 'blue', 'purple', 'white'].includes(color)) return;
  const event = getWeekEvent(eventId);
  if (!event || (event.color === color && !event.isDraft)) return;
  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  event.color = color;
  commitWeekEvent(event);
  scheduleWeeklyWorkspaceSave();
  renderWeekCalendar();
  document.querySelectorAll('[data-action="set-week-event-color"]').forEach(button => {
    if (button.dataset.eventId === eventId) button.setAttribute('aria-pressed', String(button.dataset.color === color));
  });
}

function updateWeekEventTitle(target) {
  const event = getWeekEvent(target.dataset.eventId);
  if (!event) return;

  event.title = target.value.trim() || DEFAULT_WEEK_EVENT_TITLE;
  commitWeekEvent(event);
  const eventEl = document.querySelector(`.week-event[data-event-id="${CSS.escape(event.id)}"]`);
  if (eventEl) {
    const titleEl = eventEl.querySelector('.week-event-title');
    if (titleEl) titleEl.textContent = event.title;
  }
  if (!event.isDraft) scheduleWeeklyWorkspaceSave();
  refreshGeneratedLogStatusForDate(event.dateKey);
}

function updateExpandedWeekEntry(target) {
  const event = getWeekEvent(target.dataset.eventId);
  if (!event) return;

  event.content = target.value;
  commitWeekEvent(event);
  const eventEl = document.querySelector(`.week-event[data-event-id="${CSS.escape(event.id)}"]`);
  if (eventEl) {
    const eventMainEl = eventEl.querySelector('.week-event-main');
    const existingPreviewEl = eventEl.querySelector('.week-event-summary');
    const contentPreview = getWeekEventContentPreview(event.content);
    if (existingPreviewEl) {
      if (contentPreview) existingPreviewEl.textContent = contentPreview;
      else existingPreviewEl.remove();
    } else if (contentPreview && eventMainEl) {
      const previewEl = document.createElement('div');
      previewEl.className = 'week-event-summary';
      previewEl.textContent = contentPreview;
      eventMainEl.appendChild(previewEl);
    }
  }
  if (!event.isDraft) scheduleWeeklyWorkspaceSave();
  refreshGeneratedLogStatusForDate(event.dateKey);
}

function updateWeekEventElement(event) {
  const eventEl = document.querySelector(`.week-event[data-event-id="${CSS.escape(event.id)}"]`);
  if (!eventEl) return;

  const weekDates = getSelectedWeekDates();
  const dayIndex = weekDates.findIndex(day => day.key === event.dateKey);
  if (dayIndex >= 0) eventEl.style.setProperty('--day-index', dayIndex);

  const displayStart = getPlannerDisplayStartMinute();
  const displayEnd = getPlannerDisplayEndMinute();
  const top = ((Math.max(event.startMinute, displayStart) - displayStart) / 60) * PLANNER_ROW_HEIGHT;
  const height = Math.max(
    28,
    ((Math.min(event.endMinute, displayEnd) - Math.max(event.startMinute, displayStart)) / 60) * PLANNER_ROW_HEIGHT - 4
  );
  eventEl.style.top = `${top + 2}px`;
  eventEl.style.height = `${height}px`;
  const summaryLineCount = getWeekEventSummaryLineCount(height);
  eventEl.style.setProperty('--week-event-summary-lines', summaryLineCount);
  eventEl.classList.toggle('has-no-summary-space', summaryLineCount === 0);

  const timeEl = eventEl.querySelector('.week-event-time');
  if (timeEl) timeEl.textContent = formatPlannerRange(event);
  updateWeekEventSummarySpace(eventEl);
  eventEl.setAttribute('aria-label', `${event.title} ${formatPlannerRange(event)}`);

  const overlay = document.getElementById('weekEntryEditor');
  const titleEl = overlay?.querySelector('#weekEditorTitle');
  if (titleEl && overlay.classList.contains('visible') && selectedWeekEventId === event.id) {
    titleEl.textContent = getWeekEventLabel(event);
  }
}

function startWeekEventResize(handle, pointerEvent) {
  const event = getWeekEvent(handle.dataset.eventId);
  if (!event) return;

  pointerEvent.preventDefault();
  pointerEvent.stopPropagation();
  selectWeekEvent(event.id);
  handle.setPointerCapture?.(pointerEvent.pointerId);
  resizingWeekEvent = {
    eventId: event.id,
    edge: handle.dataset.edge,
    startY: pointerEvent.clientY,
    originalStart: event.startMinute,
    originalEnd: event.endMinute,
    undoSnapshot: getWeeklyWorkspaceUndoSnapshot(),
  };
  document.body.classList.add('week-event-resizing');
}

function moveWeekEventResize(pointerEvent) {
  if (!resizingWeekEvent) return;

  const event = getWeekEvent(resizingWeekEvent.eventId);
  if (!event) return;

  const deltaMinutes = snapMinutes((pointerEvent.clientY - resizingWeekEvent.startY) / PLANNER_ROW_HEIGHT * 60);
  const displayStart = getPlannerDisplayStartMinute();
  const displayEnd = getPlannerDisplayEndMinute();

  if (resizingWeekEvent.edge === 'top') {
    event.startMinute = clamp(
      resizingWeekEvent.originalStart + deltaMinutes,
      displayStart,
      event.endMinute - PLANNER_MIN_EVENT_MINUTES
    );
  } else {
    event.endMinute = clamp(
      resizingWeekEvent.originalEnd + deltaMinutes,
      event.startMinute + PLANNER_MIN_EVENT_MINUTES,
      displayEnd
    );
  }

  if (event.startMinute !== resizingWeekEvent.originalStart || event.endMinute !== resizingWeekEvent.originalEnd) {
    commitWeekEvent(event);
  }
  updateWeekEventElement(event);
  if (!event.isDraft) scheduleWeeklyWorkspaceSave();
}

function stopWeekEventResize() {
  if (!resizingWeekEvent) return;
  const event = getWeekEvent(resizingWeekEvent.eventId);
  if (!areWeekEventSnapshotsEqual(resizingWeekEvent.undoSnapshot)) {
    pushWeeklyWorkspaceUndoSnapshot(resizingWeekEvent.undoSnapshot);
    renderWeekCalendar();
    refreshGeneratedLogStatusForDate(event?.dateKey);
  }
  resizingWeekEvent = null;
  document.body.classList.remove('week-event-resizing');
}

function startWeekEventDrag(eventEl, pointerEvent) {
  const event = getWeekEvent(eventEl.dataset.eventId);
  const bodyEl = document.getElementById('weekGridBody');
  if (!event || !bodyEl) return;

  pointerEvent.preventDefault();
  selectWeekEvent(event.id);
  eventEl.setPointerCapture?.(pointerEvent.pointerId);
  const weekDates = getSelectedWeekDates();
  draggingWeekEvent = {
    eventId: event.id,
    startX: pointerEvent.clientX,
    startY: pointerEvent.clientY,
    originalStart: event.startMinute,
    originalEnd: event.endMinute,
    originalDayIndex: Math.max(0, weekDates.findIndex(day => day.key === event.dateKey)),
    dayWidth: (bodyEl.clientWidth - PLANNER_TIME_COLUMN_WIDTH) / 7,
    weekDates,
    undoSnapshot: getWeeklyWorkspaceUndoSnapshot(),
  };
  document.body.classList.add('week-event-dragging');
}

function moveWeekEventDrag(pointerEvent) {
  if (!draggingWeekEvent) return;

  const event = getWeekEvent(draggingWeekEvent.eventId);
  if (!event) return;

  const duration = draggingWeekEvent.originalEnd - draggingWeekEvent.originalStart;
  const deltaMinutes = snapMinutes((pointerEvent.clientY - draggingWeekEvent.startY) / PLANNER_ROW_HEIGHT * 60);
  const displayStart = getPlannerDisplayStartMinute();
  const displayEnd = getPlannerDisplayEndMinute();
  const nextStart = clamp(
    draggingWeekEvent.originalStart + deltaMinutes,
    displayStart,
    displayEnd - duration
  );
  const dayDelta = draggingWeekEvent.dayWidth > 0
    ? Math.round((pointerEvent.clientX - draggingWeekEvent.startX) / draggingWeekEvent.dayWidth)
    : 0;
  const nextDayIndex = clamp(draggingWeekEvent.originalDayIndex + dayDelta, 0, 6);

  event.dateKey = draggingWeekEvent.weekDates[nextDayIndex].key;
  event.weekId = getWeekIdFromDateKey(event.dateKey);
  event.startMinute = nextStart;
  event.endMinute = nextStart + duration;

  if (
    event.dateKey !== draggingWeekEvent.weekDates[draggingWeekEvent.originalDayIndex].key ||
    event.startMinute !== draggingWeekEvent.originalStart
  ) {
    commitWeekEvent(event);
  }
  updateWeekEventElement(event);
  if (!event.isDraft) scheduleWeeklyWorkspaceSave();
}

function stopWeekEventDrag() {
  if (!draggingWeekEvent) return;
  const event = getWeekEvent(draggingWeekEvent.eventId);
  const originalDateKey = draggingWeekEvent.weekDates[draggingWeekEvent.originalDayIndex]?.key;
  if (!areWeekEventSnapshotsEqual(draggingWeekEvent.undoSnapshot)) {
    pushWeeklyWorkspaceUndoSnapshot(draggingWeekEvent.undoSnapshot);
    renderWeekCalendar();
    refreshGeneratedLogStatusForDate(originalDateKey);
    if (event?.dateKey !== originalDateKey) refreshGeneratedLogStatusForDate(event?.dateKey);
  }
  draggingWeekEvent = null;
  document.body.classList.remove('week-event-dragging');
}

async function addWeekPlanItem(text) {
  const value = String(text || '').trim();
  if (!value) return;

  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems([
    ...weeklyWorkspaceState.weekPlanItems,
    {
      id: `week-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: value,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: '',
      order: getNextWeekPlanOrder(),
    },
  ]);
  syncSelectedWeekPlanItems();
  renderWeekPlan();
  await flushWeeklyWorkspaceSave();
}

async function toggleWeekPlanItem(itemId) {
  if (!weeklyWorkspaceState.weekPlanItems.some(item => item.id === itemId)) return;

  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  const item = weeklyWorkspaceState.weekPlanItems.find(planItem => planItem.id === itemId);
  item.completed = !item.completed;
  item.completedAt = item.completed ? new Date().toISOString() : '';
  if (item.completed) item.order = getNextWeekPlanOrder();
  weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  reindexWeekPlanItems();
  syncSelectedWeekPlanItems();
  renderWeekPlan();
  await flushWeeklyWorkspaceSave();
}

function updateWeekPlanItemText(input) {
  const itemId = input.dataset.weekPlanId;
  const item = weeklyWorkspaceState.weekPlanItems.find(planItem => planItem.id === itemId);
  if (!item) return;

  item.text = input.value.trimStart();
  resizeWeekPlanItemInput(input);
  syncSelectedWeekPlanItems();
  renderWeekPlan(false, false);
  scheduleWeeklyWorkspaceSave();
}

async function deleteWeekPlanItem(itemId) {
  const index = weeklyWorkspaceState.weekPlanItems.findIndex(item => item.id === itemId);
  if (index === -1) return;

  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  weeklyWorkspaceState.weekPlanItems.splice(index, 1);
  weeklyWorkspaceState.weekPlanItems = normalizeWeekPlanItems(weeklyWorkspaceState.weekPlanItems);
  reindexWeekPlanItems();
  syncSelectedWeekPlanItems();
  renderWeekPlan();
  await flushWeeklyWorkspaceSave();
}

function updateDailyLogEntry(target) {
  const fieldKey = getDailyLogFieldKeyFromTarget(target);
  const dateKey = getDailyLogFieldDateKeyFromTarget(target);
  if (!fieldKey) return;
  if (!setDailyLogFieldValue(fieldKey, target.value, dateKey)) return;
  if (fieldKey === 'generated') scheduleDailyLogGeneratedSectionSync(target.value, dateKey);
  allowEditableUndoAfterDailyClear = false;
  renderYearArchive();
  scheduleWeeklyWorkspaceSave();
}

function clearDailyLogField(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  if (!fieldKey || fieldKey === 'generated') return;
  const currentValue = getDailyLogFieldValue(fieldKey, dateKey);
  if (!currentValue.trim()) return;
  showDailyLogClearConfirm(fieldKey, dateKey);
}

function confirmDailyLogFieldClear(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  if (!fieldKey || fieldKey === 'generated') return;
  const currentValue = getDailyLogFieldValue(fieldKey, dateKey);
  if (!currentValue.trim()) {
    closeDailyLogClearConfirm();
    return;
  }
  pushWeeklyWorkspaceUndoSnapshot(getWeeklyWorkspaceUndoSnapshot());
  setDailyLogFieldValue(fieldKey, '', dateKey);
  flushWeeklyWorkspaceSave().catch(() => {});
  allowEditableUndoAfterDailyClear = true;
  closeDailyLogClearConfirm();
  getDailyLogCompactElement(fieldKey)?.focus();
  showToast('Cleared');
}

function generateDailyLogText(dateKey = getSelectedDailyLogDateKey()) {
  const sourceLog = getDailyLogSourceForDate(dateKey);
  const weekDates = getWeekDatesForDateKey(dateKey);
  const day = weekDates.find(item => item.key === dateKey);
  const documentType = getDailyLogDateMode(dateKey) === 'plan' ? 'Daily Plan' : 'Daily Log';
  const plannerLines = weeklyWorkspaceState.events
    .filter(event => event.dateKey === dateKey)
    .sort((a, b) => a.startMinute - b.startMinute)
    .map(event => {
      const content = (event.content || '').trim();
      return `-- ${formatPlannerRange(event)} ${event.title}${content ? `\n  ${content.replace(/\n/g, '\n  ')}` : ''}`;
    });

  return [
    `# ${documentType} - ${dateKey} ${day ? day.dayName : ''}`,
    '',
    '## Time Blocks',
    plannerLines.length ? plannerLines.join('\n') : '-- No time blocks recorded.',
    '',
    ...LOG_KEYS.flatMap(([key, label]) => [
      `## ${label}`,
      (sourceLog[key] || '').trim() || '--',
      '',
    ]),
  ].join('\n');
}

function generateWeeklyLogText(weekStartKey = getSelectedWeekStartKey()) {
  const weekDates = getWeekDatesForDateKey(weekStartKey);
  const weekId = getWeekIdFromDateKey(weekDates[0].key);
  const weekPlanItems = getWeekPlanItemsForDate(weekDates[0].key);
  const weekPlanLines = weekPlanItems.length
    ? weekPlanItems.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`)
    : ['- No week plan recorded.'];
  const dailyLogs = weekDates.map(day => (
    generateDailyLogText(day.key).replace(/^(#{1,2})(?= )/gm, '$1#')
  ));

  return [
    `# Weekly Log - ${weekId}`,
    '',
    `${weekDates[0].key} - ${weekDates[6].key}`,
    '',
    '## Week Plan',
    ...weekPlanLines,
    '',
    '---',
    '',
    dailyLogs.join('\n\n---\n\n'),
  ].join('\n');
}

function formatReadableDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} 分钟`;
  return `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}`;
}

function escapeMarkdownTableCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function hasReadableDailySource(dateKey) {
  const sourceLog = getDailyLogSourceForDate(dateKey);
  return LOG_KEYS.some(([key]) => String(sourceLog[key] || '').trim()) ||
    weeklyWorkspaceState.events.some(event => event.dateKey === dateKey);
}

function getReadableDailyMarkdown(day, dayIndex) {
  const sourceLog = getDailyLogSourceForDate(day.key);
  const events = weeklyWorkspaceState.events
    .filter(event => event.dateKey === day.key)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const fieldSections = LOG_KEYS
    .map(([key, label]) => [label, String(sourceLog[key] || '').trim()])
    .filter(([, value]) => value);

  if (!events.length && !fieldSections.length) return '';

  const lines = [
    `##### ${day.key.slice(5)} · ${WEEK_DAY_LABELS_CN[dayIndex]}`,
    '',
  ];

  if (events.length) {
    lines.push(
      '###### 时间线',
      '',
      '| 时间 | 时长 | 内容 |',
      '|---|---:|---|',
      ...events.map(event => {
        const duration = Math.max(0, event.endMinute - event.startMinute);
        const content = String(event.content || '').trim();
        const description = `**${event.title || DEFAULT_WEEK_EVENT_TITLE}**${content ? `<br>${content}` : ''}`;
        return `| ${formatPlannerTime(event.startMinute)}–${formatPlannerTime(event.endMinute)} | ${formatReadableDuration(duration)} | ${escapeMarkdownTableCell(description)} |`;
      }),
      ''
    );
  }

  fieldSections.forEach(([label, value]) => {
    lines.push(`###### ${label}`, '', value, '');
  });

  return lines.join('\n').trimEnd();
}

function getReadableWeekMarkdown(weekStartKey) {
  const weekDates = getWeekDatesForDateKey(weekStartKey);
  const weekId = getWeekIdFromDateKey(weekDates[0].key);
  const dateKeys = new Set(weekDates.map(day => day.key));
  const planItems = getWeekPlanItemsForDate(weekDates[0].key);
  const events = weeklyWorkspaceState.events.filter(event => dateKeys.has(event.dateKey));
  const readableDays = weekDates.filter(day => hasReadableDailySource(day.key));
  const totalMinutes = events.reduce(
    (total, event) => total + Math.max(0, event.endMinute - event.startMinute),
    0
  );
  const completedPlanItems = planItems.filter(item => item.completed).length;
  const dailySections = weekDates
    .map((day, index) => getReadableDailyMarkdown(day, index))
    .filter(Boolean);
  const lines = [
    `### ${weekId} 周日志`,
    '',
    `**${weekDates[0].key} ～ ${weekDates[6].key}**`,
    '',
    '#### 快速总览',
    '',
    '| 项目 | 值 |',
    '|---|---:|',
    `| 有内容的日期 | ${readableDays.length} 天 |`,
    `| 已记录时间块 | ${events.length} 个 |`,
    `| 时间块合计 | ${formatReadableDuration(totalMinutes)} |`,
    `| 计划完成 | ${completedPlanItems} / ${planItems.length} |`,
    '',
  ];

  if (planItems.length) {
    lines.push(
      '#### 本周计划',
      '',
      ...planItems.map(item => `- [${item.completed ? 'x' : ' '}] ${item.text}`),
      ''
    );
  }

  if (dailySections.length) {
    lines.push('#### 每日记录', '', dailySections.join('\n\n'));
  }

  return lines.join('\n').trimEnd();
}

function getReadableWorkspaceWeekStartKeys() {
  const weekStarts = new Set();

  Object.values(weeklyWorkspaceState.weekPlans || {}).forEach(plan => {
    if (plan?.weekStart) weekStarts.add(getWeekStartKeyFromDateKey(plan.weekStart));
  });
  weeklyWorkspaceState.events.forEach(event => {
    if (event.dateKey) weekStarts.add(getWeekStartKeyFromDateKey(event.dateKey));
  });
  Object.entries(weeklyWorkspaceState.logs || {}).forEach(([dateKey, log]) => {
    if (hasDailyLogContent(log)) weekStarts.add(getWeekStartKeyFromDateKey(dateKey));
  });

  return [...weekStarts]
    .filter(weekStartKey => {
      const weekDates = getWeekDatesForDateKey(weekStartKey);
      const dateKeys = new Set(weekDates.map(day => day.key));
      return getWeekPlanItemsForDate(weekStartKey).length ||
        weeklyWorkspaceState.events.some(event => dateKeys.has(event.dateKey)) ||
        weekDates.some(day => hasReadableDailySource(day.key));
    })
    .sort((a, b) => b.localeCompare(a));
}

function generateReadableWorkspaceMarkdownText() {
  const weekStartKeys = getReadableWorkspaceWeekStartKeys();
  const weekRows = weekStartKeys.map(weekStartKey => {
    const weekDates = getWeekDatesForDateKey(weekStartKey);
    const dateKeys = new Set(weekDates.map(day => day.key));
    const planItems = getWeekPlanItemsForDate(weekStartKey);
    const events = weeklyWorkspaceState.events.filter(event => dateKeys.has(event.dateKey));
    const readableDays = weekDates.filter(day => hasReadableDailySource(day.key)).length;
    return {
      year: getIsoWeekInfoFromDateKey(weekStartKey).year,
      weekId: getWeekIdFromDateKey(weekStartKey),
      weekStartKey,
      weekDates,
      planItems,
      completedPlanItems: planItems.filter(item => item.completed).length,
      events,
      readableDays,
    };
  });
  const totalDays = weekRows.reduce((total, row) => total + row.readableDays, 0);
  const totalEvents = weekRows.reduce((total, row) => total + row.events.length, 0);
  const totalPlanItems = weekRows.reduce((total, row) => total + row.planItems.length, 0);
  const completedPlanItems = weekRows.reduce((total, row) => total + row.completedPlanItems, 0);
  const yearSections = [];

  [...new Set(weekRows.map(row => row.year))].forEach(year => {
    const weeks = weekRows.filter(row => row.year === year);
    yearSections.push(
      `## ${year}`,
      '',
      weeks.map(row => getReadableWeekMarkdown(row.weekStartKey)).join('\n\n---\n\n')
    );
  });

  return [
    '---',
    'title: Inner Garden · 美日心灵 周日志阅读版',
    `exported_at: ${new Date().toISOString()}`,
    'type: weekly-review-archive',
    'tags:',
    '  - inner-garden',
    '  - weekly-review',
    '---',
    '',
    '# Inner Garden · 美日心灵 周日志阅读版',
    '',
    '> [!abstract] 阅读方式',
    '> 日志按年份和周排列。每周先看快速总览与计划完成情况，再按日期阅读时间线和四类原始记录。',
    '',
    '## 总览',
    '',
    '| 项目 | 值 |',
    '|---|---:|',
    `| 周数 | ${weekRows.length} 周 |`,
    `| 有内容的日期 | ${totalDays} 天 |`,
    `| 时间块 | ${totalEvents} 个 |`,
    `| 计划完成 | ${completedPlanItems} / ${totalPlanItems} |`,
    '',
    '## 周索引',
    '',
    '| 周 | 日期 | 计划 | 日志 | 时间块 |',
    '|---|---|---:|---:|---:|',
    ...weekRows.map(row => (
      `| ${row.weekId} | ${row.weekDates[0].key} ～ ${row.weekDates[6].key} | ${row.completedPlanItems} / ${row.planItems.length} | ${row.readableDays} / 7 | ${row.events.length} |`
    )),
    '',
    ...(yearSections.length ? yearSections : ['_尚无可导出的周计划、时间块或日志内容。_']),
  ].join('\n');
}

function refreshGeneratedLogStatusForDate(dateKey) {
  if (!dateKey) return;
  const log = weeklyWorkspaceState.logs?.[dateKey];
  if (!(log?.generated || '').trim()) return;

  renderDailyLogPanelMeta(dateKey);
  renderDailyLogArchive();
}

function downloadDailyLogFile(output, dateKey = getShanghaiTodayKey()) {
  const blob = new Blob([output], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileType = getDailyLogDateMode(dateKey) === 'plan' ? 'daily-plan' : 'daily-log';
  link.download = `inner-garden-${fileType}-${dateKey}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadWeeklyLogFile(output, weekStartKey = getSelectedWeekStartKey()) {
  const blob = new Blob([output], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inner-garden-weekly-log-${getWeekIdFromDateKey(weekStartKey)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadReadableWorkspaceMarkdownFile(output) {
  const blob = new Blob([`\uFEFF${output}`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inner-garden-logs-reading-${getShanghaiTodayKey()}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadWorkspaceExportFile(payload, filename = `inner-garden-workspace-${getShanghaiTodayKey()}.json`) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportWorkspace(scope = 'all') {
  flushDailyLogGeneratedSectionSync();
  const dateKey = getSelectedDailyLogDateKey();
  const weekStartKey = getWeekStartKeyFromDateKey(dateKey);
  const label = scope === 'day' ? '单日' : scope === 'week' ? '单周' : '全部';
  const suffix = scope === 'day' ? `day-${dateKey}` : scope === 'week' ? `week-${weekStartKey}` : `workspace-${getShanghaiTodayKey()}`;
  downloadWorkspaceExportFile(getWorkspaceExportPayload(scope, dateKey), `inner-garden-${suffix}.json`);
  showToast(`已导出${label} JSON`);
}

async function exportWorkspaceMarkdown() {
  flushDailyLogGeneratedSectionSync();
  syncSelectedWeekPlanItems();
  downloadReadableWorkspaceMarkdownFile(generateReadableWorkspaceMarkdownText());
  showToast('已导出全部 Markdown');
}

function openWorkspaceImportDialog(scope = 'all') {
  const input = document.getElementById('workspaceImportInput');
  if (!input) return;
  pendingWorkspaceImportScope = scope;
  input.value = '';
  input.click();
}

function getWorkspaceBackupOwner() {
  return workspaceSyncClient?.getPublicState?.().accountId || 'local';
}

async function getAllWorkspaceBackups() {
  const stored = await chrome.storage.local.get(WORKSPACE_BACKUPS_STORAGE_KEY);
  return Array.isArray(stored[WORKSPACE_BACKUPS_STORAGE_KEY]) ? stored[WORKSPACE_BACKUPS_STORAGE_KEY] : [];
}

async function getWorkspaceBackups() {
  const owner = getWorkspaceBackupOwner();
  return (await getAllWorkspaceBackups()).filter(item => (item.owner || 'local') === owner);
}

async function createWorkspaceBackup(reason = '手动备份', options = {}) {
  await flushWeeklyWorkspaceSave();
  const allBackups = await getAllWorkspaceBackups();
  const owner = getWorkspaceBackupOwner();
  const backups = allBackups.filter(item => (item.owner || 'local') === owner);
  const createdAt = new Date().toISOString();
  const backup = {
    id: globalThis.crypto?.randomUUID?.() || `backup-${Date.now()}`,
    createdAt,
    reason,
    owner,
    payload: getWorkspaceExportPayload('all'),
  };
  const manual = reason === '手动备份';
  const next = [backup, ...backups].filter((item, index, list) => {
    if (item.reason === '手动备份') return true;
    return list.slice(0, index + 1).filter(entry => entry.reason !== '手动备份').length <= 30;
  });
  await chrome.storage.local.set({ [WORKSPACE_BACKUPS_STORAGE_KEY]: [...allBackups.filter(item => (item.owner || 'local') !== owner), ...next] });
  if (!options.silent) showToast('工作区备份已创建');
  return backup;
}

function formatBackupTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

async function openWorkspaceBackups() {
  document.getElementById('workspaceBackupsDialog')?.remove();
  const backups = await getWorkspaceBackups();
  const dialog = document.createElement('div');
  dialog.id = 'workspaceBackupsDialog';
  dialog.className = 'workspace-backups-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = `
    <div class="workspace-backups-head"><strong>历史备份</strong><button type="button" data-action="close-workspace-backups" aria-label="关闭">×</button></div>
    <p>备份保存在这台电脑上，恢复前可先预览或下载 JSON。</p>
    <div class="workspace-backups-list">${backups.length ? backups.map(item => {
      const workspace = getImportedWorkspacePayload(item.payload) || {};
      return `<div class="workspace-backup-row"><div><strong>${escapeHtml(item.reason)}</strong><span>${escapeHtml(formatBackupTime(item.createdAt))} · 日程 ${(workspace.events || []).length} 条 · 日志 ${Object.keys(workspace.logs || {}).length} 天</span></div><div><button data-action="download-workspace-backup" data-backup-id="${escapeAttr(item.id)}">下载</button><button data-action="restore-workspace-backup" data-backup-id="${escapeAttr(item.id)}">合并恢复</button><button data-action="delete-workspace-backup" data-backup-id="${escapeAttr(item.id)}">删除</button></div></div>`;
    }).join('') : '<div class="workspace-backup-empty">还没有历史备份。</div>'}</div>`;
  document.body.appendChild(dialog);
}

async function findWorkspaceBackup(id) {
  return (await getWorkspaceBackups()).find(item => item.id === id) || null;
}

async function deleteWorkspaceBackup(id) {
  const backups = await getAllWorkspaceBackups();
  await chrome.storage.local.set({ [WORKSPACE_BACKUPS_STORAGE_KEY]: backups.filter(item => item.id !== id) });
  await openWorkspaceBackups();
}

async function importWorkspaceFile(file) {
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const fileScope = ['day', 'week', 'all'].includes(payload.scope) ? payload.scope : 'all';
    if (pendingWorkspaceImportScope !== 'all' && fileScope !== pendingWorkspaceImportScope) {
      throw new Error(`请选择“${pendingWorkspaceImportScope === 'day' ? '单日' : '单周'} JSON”导出的对应文件`);
    }
    const importedWorkspace = getImportedWorkspacePayload(payload);
    const currentWorkspace = getPersistedWeeklyWorkspaceState();
    const conflicts = collectWorkspaceImportConflicts(currentWorkspace, importedWorkspace);
    if (conflicts.length) {
      showWorkspaceImportReview(payload, conflicts);
      return;
    }
    await applyWorkspaceImport(payload, {});
  } catch (err) {
    console.warn('[tab-out] Workspace import failed:', err);
    showToast(err.message || '导入失败', 4500);
  }
}

function collectWorkspaceImportConflicts(currentValue, importedValue) {
  const current = normalizeWorkspaceImport(currentValue);
  const imported = normalizeWorkspaceImport(importedValue);
  if (!current || !imported) return [];
  const conflicts = [];
  const eventById = new Map((current.events || []).filter(item => item.id).map(item => [item.id, item]));
  (imported.events || []).forEach(item => {
    const local = eventById.get(item.id);
    if (local && JSON.stringify(local) !== JSON.stringify(item)) conflicts.push({ key: `event:${item.id}`, kind: 'event', label: `${item.dateKey} · ${item.title || '日程时间块'}`, local, incoming: item });
  });
  for (const [dateKey, log] of Object.entries(imported.logs || {})) {
    for (const field of [...DAILY_LOG_DRAFT_KEYS, 'generated']) {
      if (log[field] === undefined) continue;
      const local = current.logs?.[dateKey]?.[field];
      if (local !== undefined && String(local) !== String(log[field])) {
        conflicts.push({ key: `log:${dateKey}:${field}`, kind: 'text', dateKey, field, label: `${dateKey} · ${DAILY_LOG_FIELD_LABELS[field] || field}`, local: String(local || ''), incoming: String(log[field] || '') });
      }
    }
  }
  const localPlans = new Map();
  Object.values(current.weekPlans || {}).forEach(plan => (plan.items || []).forEach(item => localPlans.set(item.id, item)));
  Object.values(imported.weekPlans || {}).forEach(plan => (plan.items || []).forEach(item => {
    const local = localPlans.get(item.id);
    if (local && JSON.stringify(local) !== JSON.stringify(item)) conflicts.push({ key: `plan:${item.id}`, kind: 'plan', label: `周计划 · ${item.text}`, local, incoming: item });
  }));
  return conflicts;
}

function showWorkspaceImportReview(payload, conflicts) {
  document.getElementById('workspaceImportReview')?.remove();
  pendingWorkspaceImportReview = { payload, conflicts };
  const dialog = document.createElement('div');
  dialog.id = 'workspaceImportReview';
  dialog.className = 'workspace-import-review';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = `
    <div class="workspace-backups-head"><strong>确认导入差异</strong><button type="button" data-action="cancel-workspace-import-review" aria-label="关闭">×</button></div>
    <p>新记录会自动加入。以下 ${conflicts.length} 项与本机内容不同，请逐项选择。</p>
    <div class="workspace-import-conflicts">${conflicts.map((item, index) => `
      <section class="workspace-import-conflict" data-conflict-index="${index}">
        <strong>${escapeHtml(item.label)}</strong>
        <div class="workspace-import-versions"><label><input type="radio" name="import-${index}" value="local" checked> 保留本机</label><pre>${escapeHtml(typeof item.local === 'string' ? item.local : JSON.stringify(item.local, null, 2))}</pre></div>
        <div class="workspace-import-versions"><label><input type="radio" name="import-${index}" value="incoming"> 采用文件</label><pre>${escapeHtml(typeof item.incoming === 'string' ? item.incoming : JSON.stringify(item.incoming, null, 2))}</pre></div>
        ${item.kind === 'text' ? `<div class="workspace-import-versions"><label><input type="radio" name="import-${index}" value="manual"> 手动合并</label><textarea>${escapeHtml(item.local)}</textarea></div>` : ''}
      </section>`).join('')}</div>
    <div class="daily-log-clear-confirm-actions"><button class="daily-log-confirm-btn" data-action="cancel-workspace-import-review">取消</button><button class="daily-log-confirm-btn danger" data-action="apply-workspace-import-review">创建备份并导入</button></div>`;
  document.body.appendChild(dialog);
}

function prepareImportedWorkspace(payload, decisions) {
  const imported = normalizeWorkspaceImport(getImportedWorkspacePayload(payload));
  if (!imported) return null;
  const conflicts = pendingWorkspaceImportReview?.conflicts || [];
  conflicts.forEach((conflict, index) => {
    const decision = decisions[index] || 'local';
    if (conflict.kind === 'event' && decision === 'local') imported.events = imported.events.filter(item => item.id !== conflict.incoming.id);
    if (conflict.kind === 'plan' && decision === 'local') {
      Object.values(imported.weekPlans || {}).forEach(plan => { plan.items = (plan.items || []).filter(item => item.id !== conflict.incoming.id); });
      imported.weekPlanItems = (imported.weekPlanItems || []).filter(item => item.id !== conflict.incoming.id);
    }
    if (conflict.kind === 'text') {
      imported.logs[conflict.dateKey] ||= {};
      if (decision === 'local') delete imported.logs[conflict.dateKey][conflict.field];
      if (decision && typeof decision === 'object' && decision.manual !== undefined) imported.logs[conflict.dateKey][conflict.field] = decision.manual;
    }
  });
  return imported;
}

async function applyWorkspaceImport(payload, decisions) {
  const importedWorkspace = prepareImportedWorkspace(payload, decisions) || getImportedWorkspacePayload(payload);
  const mergedWorkspace = mergeWorkspaceImport(getPersistedWeeklyWorkspaceState(), importedWorkspace);
    if (!mergedWorkspace) throw new Error('Invalid workspace file');
    await createWorkspaceBackup('导入前自动备份', { silent: true });
    weeklyWorkspaceState = {
      version: WEEKLY_WORKSPACE_SCHEMA_VERSION,
      activeWeekId: mergedWorkspace.activeWeekId || getCurrentWeekId(),
      activeWeekStartKey: mergedWorkspace.activeWeekStartKey || getCurrentWeekStartKey(),
      selectedWeekStartKey: mergedWorkspace.selectedWeekStartKey || getCurrentWeekStartKey(),
      planner: mergedWorkspace.planner,
      events: normalizeWeekEvents(mergedWorkspace.events),
      weekPlanItems: normalizeWeekPlanItems(mergedWorkspace.weekPlanItems),
      weekPlans: normalizeWeekPlans(mergedWorkspace.weekPlans),
      logs: mergedWorkspace.logs,
      dailyDraft: normalizeDailyDraft(mergedWorkspace.dailyDraft, mergedWorkspace.logs),
    };
    selectedWeekEventId = null;
    weeklyWorkspaceUndoStack = [];
    selectedWeekStartKey = weeklyWorkspaceState.selectedWeekStartKey;
    loadSelectedWeekPlanItems();
    migratePlannerEntriesToEvents();
    activateCurrentWeek();
    selectedWeekStartKey = getCurrentWeekStartKey();
    weeklyWorkspaceState.selectedWeekStartKey = selectedWeekStartKey;
    loadSelectedWeekPlanItems();

    await flushWeeklyWorkspaceSave();
    renderWeekCalendar();
    renderWeekPlan();
    renderDailyLogPanel();
    renderDailyLogArchive();
    renderYearArchive();
    pendingWorkspaceImportReview = null;
    document.getElementById('workspaceImportReview')?.remove();
    showToast('数据已合并导入');
}

async function performDailyLogGeneration(dateKey = getSelectedDailyLogDateKey()) {
  const output = generateDailyLogText(dateKey);
  const log = getDailyLogForDate(dateKey);
  const source = getDailyLogSourceForDate(dateKey);
  DAILY_LOG_DRAFT_KEYS.forEach(key => { log[key] = source[key] || ''; });
  log.generated = output;
  log.generatedAt = new Date().toISOString();
  log.generatedSourceSignature = getDailyLogSourceSignature(dateKey);
  closeDailyLogRegenerateConfirm();
  renderDailyLogPanel();
  renderDailyLogArchive();
  renderYearArchive();
  const expandedEl = document.querySelector('.daily-log-expanded');
  if (
    expandedEl?.dataset.logEditorKey === 'generated' &&
    getDailyLogFieldDateKeyFromTarget(expandedEl) === dateKey
  ) {
    expandedEl.value = output;
    setDailyLogEditorSyncStatus('synced', 'Synced to sections');
  }
  scheduleWeeklyWorkspaceSave();
  showToast(`${getDailyLogDateMode(dateKey) === 'plan' ? 'Daily plan' : 'Daily log'} generated for ${dateKey}`);
  return true;
}

async function generateDailyLog() {
  const dateKey = getSelectedDailyLogDateKey();
  const pendingSyncState = flushDailyLogGeneratedSectionSync();
  const log = getDailyLogForDate(dateKey);

  if ((log.generated || '').trim()) {
    const canonicalText = generateDailyLogText(dateKey);
    let syncState = pendingSyncState || getDailyLogGeneratedSyncState(log.generated, canonicalText);
    const sourceUnchangedSinceGeneration = Boolean(log.generatedSourceSignature) &&
      log.generatedSourceSignature === getDailyLogSourceSignature(dateKey);

    if (!pendingSyncState && syncState.valid && sourceUnchangedSinceGeneration) {
      syncState = syncDailyLogGeneratedSections(log.generated, dateKey);
    }

    const legacyEditsCannotBeClassified = !log.generatedSourceSignature &&
      log.generated.trim() !== canonicalText.trim();
    if (syncState.hasUnlinkedChanges || legacyEditsCannotBeClassified) {
      showDailyLogRegenerateConfirm(dateKey);
      return false;
    }
  }

  return performDailyLogGeneration(dateKey);
}

async function downloadDailyLog() {
  const dateKey = getSelectedDailyLogDateKey();
  const saved = String(weeklyWorkspaceState.logs?.[dateKey]?.generated || '').trim();
  downloadDailyLogFile(saved || generateDailyLogText(dateKey), dateKey);
  showToast(`已导出 ${dateKey} 的单日 Markdown`);
}

async function downloadWeeklyLog() {
  const weekStartKey = getSelectedWeekStartKey();
  flushDailyLogGeneratedSectionSync();
  syncSelectedWeekPlanItems();
  downloadWeeklyLogFile(generateWeeklyLogText(weekStartKey), weekStartKey);
  showToast(`已导出 ${getWeekIdFromDateKey(weekStartKey)} 的单周 Markdown`);
}

async function copyDailyLog() {
  const outputEl = document.getElementById('dailyLogOutput');
  if (!outputEl) return;
  if (!outputEl.value.trim()) await generateDailyLog();
  await copyTextToClipboard(
    outputEl.value,
    `${getDailyLogDateMode(getSelectedDailyLogDateKey()) === 'plan' ? 'Daily plan' : 'Daily log'} copied`
  );
}

async function copyTextToClipboard(text, successMessage = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast('Copy failed');
  }
}

async function copyDailyLogField(fieldKey, dateKey = getSelectedDailyLogDateKey()) {
  const text = getDailyLogFieldValue(fieldKey, dateKey);
  if (!text.trim()) {
    showToast('Nothing to copy');
    return;
  }
  await copyTextToClipboard(text, 'Daily log copied');
}

/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Inner Garden · 美日心灵 pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const favicon = globalThis.InnerGardenLocalFavicon.markup(domain);
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${favicon}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const favicon = globalThis.InnerGardenLocalFavicon.markup(domain);
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${favicon}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const favicon = globalThis.InnerGardenLocalFavicon.markup(domain);
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          ${favicon}${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Inner Garden · 美日心灵 tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

function validateWorkspaceAccountPassword(password, confirmation) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 64 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error('密码需为 8–64 位，并同时包含大写字母、小写字母、数字和特殊字符');
  }
  if (value !== String(confirmation || '')) throw new Error('两次输入的密码不一致');
  return value;
}

function getWorkspaceVerificationRequest(form, view) {
  const kind = String(form.get('kind') || workspaceAccountKind);
  const value = String(form.get('contact') || '').trim();
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('请输入有效的邮箱地址');
  if (kind === 'phone' && !/^1\d{10}$/.test(value.replace(/^\+?86\s?/, '').replace(/\s/g, ''))) throw new Error('请输入有效的中国大陆手机号');
  return {
    kind,
    value,
    target: ['recover', 'login-code'].includes(view) ? 'USER' : 'ANY',
    authorized: view === 'bind',
    view,
  };
}

async function sendWorkspaceAccountVerification(request, captchaToken = '') {
  if (!await ensureWorkspaceSyncHostPermission(true)) throw new Error('未允许访问账号服务域名');
  const result = await workspaceSyncClient.sendVerification({ ...request, captchaToken });
  workspaceAccountVerification = {
    view: request.view,
    kind: request.kind,
    value: request.value,
    verificationId: result.verificationId,
    expiresAt: Date.now() + result.expiresIn * 1000,
  };
  startWorkspaceVerificationCooldown();
  workspaceAccountCaptcha = null;
  workspaceAccountPendingVerification = null;
  setSyncLoginFeedback('info', '验证码已发送', `请查看${request.kind === 'email' ? '邮箱' : '手机'}，验证码在 ${Math.ceil(result.expiresIn / 60)} 分钟内有效。`, '已发送');
}

async function beginWorkspaceAccountVerification(actionEl) {
  if (getWorkspaceVerificationCooldownSeconds() > 0) {
    updateWorkspaceVerificationCooldown();
    return;
  }
  const formEl = actionEl.closest('form');
  if (!formEl) return;
  const form = new FormData(formEl);
  const request = getWorkspaceVerificationRequest(form, actionEl.dataset.view);
  try {
    actionEl.disabled = true;
    actionEl.textContent = '发送中…';
    await sendWorkspaceAccountVerification(request);
    actionEl.textContent = '重新获取';
  } catch (error) {
    if (/captcha/i.test(String(error.authErrorCode || error.message))) {
      workspaceAccountPendingVerification = request;
      workspaceAccountCaptcha = await workspaceSyncClient.getCaptchaData();
      renderWorkspaceSyncDialog();
      setSyncLoginFeedback('error', '请先完成图形验证', '为保护账号安全，敏感输入已清空；完成图形验证后会继续发送验证码。', '安全验证');
      return;
    }
    const feedback = getWorkspaceSyncErrorFeedback(error);
    setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
  } finally {
    if (actionEl.isConnected) {
      if (actionEl.textContent === '发送中…') actionEl.textContent = '获取验证码';
      updateWorkspaceVerificationCooldown();
    }
  }
}

async function verifyWorkspaceAccountCode(form) {
  const kind = String(form.get('kind') || workspaceAccountKind);
  const value = String(form.get('contact') || '').trim();
  if (!workspaceAccountVerification
      || workspaceAccountVerification.kind !== kind
      || workspaceAccountVerification.value !== value
      || workspaceAccountVerification.expiresAt <= Date.now()) {
    throw new Error('请先为当前联系方式获取有效验证码');
  }
  const code = String(form.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码');
  return workspaceSyncClient.verifyVerification(workspaceAccountVerification.verificationId, code);
}

async function submitWorkspaceAccountForm(formEl, view) {
  const form = new FormData(formEl);
  if (!await ensureWorkspaceSyncHostPermission(true)) throw new Error('未允许访问账号服务域名');
  const verified = await verifyWorkspaceAccountCode(form);
  const preserveCurrentWhenMissing = workspaceSyncClient.getPublicState().savedAccounts.length === 0;
  if (view === 'login-code') {
    await workspaceSyncClient.loginWithVerification({
      kind: 'phone',
      value: form.get('contact'),
      verificationToken: verified.verificationToken,
    });
    await activateNewlySignedInAccount({ preserveCurrentWhenMissing });
    showToast('手机号验证成功，正在开启跨设备同步…', 4000);
  } else if (view === 'register') {
    const kind = String(form.get('kind') || workspaceAccountKind);
    const passwordInput = String(form.get('password') || '');
    const confirmationInput = String(form.get('confirmPassword') || '');
    const password = kind === 'email' || passwordInput || confirmationInput
      ? validateWorkspaceAccountPassword(passwordInput, confirmationInput)
      : '';
    await workspaceSyncClient.register({
      kind,
      value: form.get('contact'),
      username: form.get('username'),
      password,
      verificationToken: verified.verificationToken,
    });
    await activateNewlySignedInAccount({ preserveCurrentWhenMissing });
    showToast('注册成功，正在开启跨设备同步…', 4000);
  } else if (view === 'recover') {
    const password = validateWorkspaceAccountPassword(form.get('password'), form.get('confirmPassword'));
    await workspaceSyncClient.resetPassword({
      kind: form.get('kind'),
      value: form.get('contact'),
      password,
      verificationToken: verified.verificationToken,
    });
    await workspaceSyncClient.login(form.get('contact'), password);
    await activateNewlySignedInAccount({ preserveCurrentWhenMissing });
    showToast('密码已更新，并已安全登录', 4000);
  } else if (view === 'change-password-phone') {
    const password = validateWorkspaceAccountPassword(form.get('password'), form.get('confirmPassword'));
    const currentUsername = workspaceSyncClient.getPublicState().username;
    await workspaceSyncClient.resetPassword({
      kind: 'phone',
      value: form.get('contact'),
      password,
      verificationToken: verified.verificationToken,
    });
    await workspaceSyncClient.login(currentUsername, password);
    await activateNewlySignedInAccount({ preserveCurrentWhenMissing: true });
    showToast('手机验证成功，密码已重设', 4000);
  } else {
    await workspaceSyncClient.bindContact({
      kind: form.get('kind'),
      value: form.get('contact'),
      password: form.get('password'),
      verificationToken: verified.verificationToken,
    });
    workspaceAccountProfile = await workspaceSyncClient.getAccountProfile();
    workspaceAccountView = 'account';
    workspaceAccountVerification = null;
    renderWorkspaceSyncDialog();
    showToast(`${form.get('kind') === 'email' ? '邮箱' : '手机号'}绑定成功`);
    return;
  }
  workspaceAccountVerification = null;
  workspaceAccountProfile = null;
  document.getElementById('workspaceSyncDialog')?.close();
  await performWorkspaceSync(false);
}

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === 'open-sync-panel') {
    openWorkspaceSyncDialog();
    return;
  }

  if (action === 'close-sync-panel') {
    document.getElementById('workspaceSyncDialog')?.close();
    return;
  }

  if (action === 'select-account-view') {
    workspaceAccountView = actionEl.dataset.view;
    if (['login', 'add-account'].includes(workspaceAccountView) && workspaceAccountLoginMethod === 'phone-code') workspaceAccountKind = 'phone';
    workspaceAccountVerification = null;
    workspaceAccountCaptcha = null;
    workspaceAccountPendingVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'select-login-method') {
    workspaceAccountLoginMethod = ['phone-code', 'phone-device'].includes(actionEl.dataset.method) ? actionEl.dataset.method : 'password';
    if (workspaceAccountLoginMethod === 'phone-code') workspaceAccountKind = 'phone';
    workspaceAccountVerification = null;
    workspaceAccountCaptcha = null;
    workspaceAccountPendingVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'select-password-change-method') {
    workspacePasswordChangeMethod = actionEl.dataset.method === 'phone-code' ? 'phone-code' : 'current';
    workspaceAccountKind = workspacePasswordChangeMethod === 'phone-code' ? 'phone' : workspaceAccountKind;
    workspaceAccountVerification = null;
    workspaceAccountCaptcha = null;
    workspaceAccountPendingVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'select-account-kind') {
    workspaceAccountKind = actionEl.dataset.kind === 'phone' ? 'phone' : 'email';
    workspaceAccountView = actionEl.dataset.view || workspaceAccountView;
    workspaceAccountVerification = null;
    workspaceAccountCaptcha = null;
    workspaceAccountPendingVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'start-account-bind') {
    workspaceAccountKind = actionEl.dataset.kind === 'phone' ? 'phone' : 'email';
    workspaceAccountView = 'bind';
    workspaceAccountVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'start-password-change') {
    workspaceAccountView = 'change-password';
    workspacePasswordChangeMethod = 'current';
    workspaceAccountVerification = null;
    renderWorkspaceSyncDialog();
    return;
  }

  if (action === 'switch-workspace-account') {
    try {
      actionEl.disabled = true;
      actionEl.textContent = '切换中…';
      await activateWorkspaceAccount(actionEl.dataset.accountId);
      showToast(`已切换到 ${workspaceSyncClient.getPublicState().username}`, 4000);
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    } finally {
      if (actionEl.isConnected) {
        actionEl.disabled = false;
        actionEl.textContent = '切换';
      }
    }
    return;
  }

  if (action === 'send-account-verification') {
    await beginWorkspaceAccountVerification(actionEl);
    return;
  }

  if (action === 'refresh-account-profile') {
    await loadWorkspaceAccountProfile({ force: true });
    return;
  }

  if (action === 'refresh-account-captcha') {
    try {
      workspaceAccountCaptcha = await workspaceSyncClient.getCaptchaData();
      renderWorkspaceSyncDialog();
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    }
    return;
  }

  if (action === 'verify-account-captcha') {
    const key = document.getElementById('workspaceAccountCaptchaKey')?.value;
    try {
      const verified = await workspaceSyncClient.verifyCaptchaData(workspaceAccountCaptcha?.token, key);
      await sendWorkspaceAccountVerification(workspaceAccountPendingVerification, verified.captchaToken);
      document.querySelector('.sync-captcha-box')?.remove();
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    }
    return;
  }

  if (action === 'toggle-sync-password') {
    const passwordInput = document.getElementById(actionEl.dataset.passwordTarget || 'workspaceSyncPassword');
    if (!passwordInput) return;
    const showPassword = passwordInput.type === 'password';
    passwordInput.type = showPassword ? 'text' : 'password';
    actionEl.dataset.visible = String(showPassword);
    actionEl.setAttribute('aria-pressed', String(showPassword));
    actionEl.setAttribute('aria-label', showPassword ? '隐藏密码' : '显示密码');
    actionEl.title = showPassword ? '隐藏密码' : '显示密码';
    passwordInput.focus();
    return;
  }

  if (action === 'sync-workspace-now') {
    await flushWeeklyWorkspaceSave();
    await performWorkspaceSync(false);
    return;
  }

  if (action === 'sync-logout') {
    await workspaceSyncClient?.logout();
    workspaceAccountView = 'login';
    workspaceAccountLoginMethod = 'password';
    workspaceAccountProfile = null;
    workspaceAccountVerification = null;
    renderWorkspaceSyncDialog();
    showToast('已退出登录，本地计划仍可正常使用。');
    return;
  }

  if (action === 'download-sync-backup') {
    downloadFirstSyncBackup();
    return;
  }

  if (action === 'set-workspace-sync-mode') {
    await setWorkspaceSyncMode(actionEl.dataset.mode);
    return;
  }

  if (action === 'resolve-sync-conflict-manual') {
    const conflictId = actionEl.dataset.conflictId;
    const conflict = workspaceSyncClient.state?.conflicts?.find(item => item.id === conflictId);
    const value = document.querySelector(`[data-conflict-manual-id="${CSS.escape(conflictId)}"]`)?.value || '';
    if (conflict?.entityType === 'daily_log_field' && conflict.local?.dateKey && conflict.local?.field) {
      conflict.local.value = value;
      setDailyLogFieldValue(conflict.local.field, value, conflict.local.dateKey);
      await flushWeeklyWorkspaceSave();
      const workspace = await workspaceSyncClient.resolveConflict(conflictId, 'local', getPersistedWeeklyWorkspaceState());
      await applySyncedWorkspace(workspace);
      await performWorkspaceSync(true, 'conflict-resolution');
      renderWorkspaceSyncDialog();
    }
    return;
  }

  if (action === 'resolve-sync-conflict') {
    const workspace = await workspaceSyncClient.resolveConflict(
      actionEl.dataset.conflictId,
      actionEl.dataset.resolution,
      getPersistedWeeklyWorkspaceState()
    );
    if (actionEl.dataset.resolution === 'remote') await applySyncedWorkspace(workspace);
    renderWorkspaceSyncDialog();
    renderWorkspaceSyncStatus({ status: workspaceSyncClient.getPublicState().conflicts ? 'conflict' : 'pending' });
    if (actionEl.dataset.resolution === 'local') await performWorkspaceSync(true, 'conflict-resolution');
    return;
  }

  // ---- Focus timer controls ----
  if (action === 'set-focus-mode') {
    await setFocusTimerMode(actionEl.dataset.focusMode);
    return;
  }

  if (action === 'toggle-focus-timer') {
    await toggleFocusTimer();
    return;
  }

  if (action === 'reset-focus-timer') {
    await resetFocusTimer();
    return;
  }

  if (action === 'set-custom-focus-duration') {
    await setCustomFocusDuration();
    return;
  }

  if (action === 'scroll-to-focus-timer') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'show-prev-week') {
    selectWeekStart(shiftDateKey(getSelectedWeekStartKey(), -7), true);
    return;
  }

  if (action === 'show-current-week') {
    activateCurrentWeek();
    selectWeekStart(getCurrentWeekStartKey(), true);
    return;
  }

  if (action === 'show-next-week') {
    selectWeekStart(shiftDateKey(getSelectedWeekStartKey(), 7), true);
    return;
  }

  if (action === 'toggle-early-hours') {
    togglePlannerEarlyHours();
    return;
  }

  if (action === 'select-week') {
    selectWeekStart(actionEl.dataset.weekStartKey || getCurrentWeekStartKey(), true);
    return;
  }

  if (action === 'select-archive-year') {
    selectedArchiveYear = Number(actionEl.dataset.archiveYear);
    renderYearArchive();
    return;
  }

  if (action === 'select-daily-log-date') {
    selectDailyLogDate(actionEl.dataset.logDateKey);
    return;
  }

  if (action === 'open-workspace-daily-log-date') {
    openWorkspaceDailyLogDate(actionEl.dataset.logDateKey);
    return;
  }

  if (action === 'set-week-event-color') {
    updateWeekEventColor(actionEl.dataset.eventId, actionEl.dataset.color);
    return;
  }

  if (action === 'open-week-entry-editor') {
    e.stopPropagation();
    openWeekEntryEditor(actionEl.dataset.eventId);
    return;
  }

  if (action === 'open-daily-log-editor') {
    e.stopPropagation();
    const dateKey = actionEl.dataset.logDateKey || getSelectedDailyLogDateKey();
    openDailyLogEditor(actionEl.dataset.logEditorKey, dateKey);
    return;
  }

  if (action === 'open-week-plan-editor') {
    e.stopPropagation();
    openWeekPlanEditor();
    return;
  }

  if (action === 'close-week-plan-editor') {
    closeWeekPlanEditor();
    return;
  }

  if (action === 'copy-week-plan') {
    await copyWeekPlan();
    return;
  }

  if (action === 'edit-week-plan-item') {
    startWeekPlanItemEdit(actionEl.dataset.weekPlanId);
    return;
  }

  if (action === 'finish-week-plan-item-edit') {
    finishWeekPlanItemEdit(actionEl.dataset.weekPlanId);
    return;
  }

  if (action === 'cancel-week-plan-item-edit') {
    finishWeekPlanItemEdit(actionEl.dataset.weekPlanId, true);
    return;
  }

  if (action === 'toggle-week-plan-item') {
    if (e.target.closest('.week-plan-edit-area, .week-plan-delete, .week-plan-drag-handle')) return;
    await toggleWeekPlanItem(actionEl.dataset.weekPlanId);
    return;
  }

  if (action === 'delete-week-plan-item') {
    await deleteWeekPlanItem(actionEl.dataset.weekPlanId);
    return;
  }

  if (action === 'clear-daily-log-field') {
    clearDailyLogField(actionEl.dataset.logEditorKey, actionEl.dataset.logDateKey || getSelectedDailyLogDateKey());
    return;
  }

  if (action === 'confirm-daily-log-clear') {
    confirmDailyLogFieldClear(actionEl.dataset.logEditorKey, actionEl.dataset.logDateKey || getSelectedDailyLogDateKey());
    return;
  }

  if (action === 'cancel-daily-log-clear') {
    closeDailyLogClearConfirm();
    return;
  }

  if (action === 'confirm-daily-log-regenerate') {
    await createWorkspaceBackup('重新生成前自动备份', { silent: true });
    await performDailyLogGeneration(actionEl.dataset.logDateKey || getSelectedDailyLogDateKey());
    return;
  }

  if (action === 'download-current-daily-summary') {
    const dateKey = actionEl.dataset.logDateKey || getSelectedDailyLogDateKey();
    downloadDailyLogFile(String(weeklyWorkspaceState.logs?.[dateKey]?.generated || ''), dateKey);
    return;
  }

  if (action === 'cancel-daily-log-regenerate') {
    closeDailyLogRegenerateConfirm();
    return;
  }

  if (action === 'copy-daily-log-field') {
    await copyDailyLogField(actionEl.dataset.logEditorKey, actionEl.dataset.logDateKey || getSelectedDailyLogDateKey());
    return;
  }

  if (action === 'delete-week-event') {
    e.stopPropagation();
    requestDeleteWeekEvent(actionEl.dataset.eventId);
    return;
  }

  if (action === 'confirm-week-event-delete') {
    confirmDeleteWeekEvent(actionEl.dataset.eventId);
    return;
  }

  if (action === 'cancel-week-event-delete') {
    closeWeekEventDeleteConfirm();
    return;
  }

  if (action === 'select-week-event') {
    selectWeekEvent(actionEl.dataset.eventId);
    return;
  }

  if (action === 'close-week-entry-editor') {
    closeWeekEntryEditor();
    return;
  }

  if (action === 'close-daily-log-editor') {
    closeDailyLogEditor();
    return;
  }

  if (action === 'generate-daily-log') {
    await generateDailyLog();
    return;
  }

  if (action === 'download-daily-log') {
    await downloadDailyLog();
    return;
  }

  if (action === 'download-weekly-log') {
    await downloadWeeklyLog();
    return;
  }

  if (action === 'export-workspace') {
    await exportWorkspace('all');
    return;
  }

  if (action === 'export-workspace-day') {
    await exportWorkspace('day');
    return;
  }

  if (action === 'export-workspace-week') {
    await exportWorkspace('week');
    return;
  }

  if (action === 'export-workspace-markdown') {
    await exportWorkspaceMarkdown();
    return;
  }

  if (action === 'import-workspace') {
    openWorkspaceImportDialog('all');
    return;
  }

  if (action === 'import-workspace-day') {
    openWorkspaceImportDialog('day');
    return;
  }

  if (action === 'import-workspace-week') {
    openWorkspaceImportDialog('week');
    return;
  }

  if (action === 'create-workspace-backup') {
    const backup = await createWorkspaceBackup('手动备份', { silent: true });
    downloadWorkspaceExportFile(backup.payload, `inner-garden-backup-${backup.createdAt.slice(0, 10)}.json`);
    showToast('工作区备份已创建并下载');
    return;
  }

  if (action === 'open-workspace-backups') {
    await openWorkspaceBackups();
    return;
  }

  if (action === 'open-device-migration') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('migration.html') });
    return;
  }

  if (action === 'close-workspace-backups') {
    document.getElementById('workspaceBackupsDialog')?.remove();
    return;
  }

  if (action === 'download-workspace-backup') {
    const backup = await findWorkspaceBackup(actionEl.dataset.backupId);
    if (backup) downloadWorkspaceExportFile(backup.payload, `inner-garden-backup-${backup.createdAt.slice(0, 10)}.json`);
    return;
  }

  if (action === 'restore-workspace-backup') {
    const backup = await findWorkspaceBackup(actionEl.dataset.backupId);
    if (backup) {
      document.getElementById('workspaceBackupsDialog')?.remove();
      const imported = getImportedWorkspacePayload(backup.payload);
      const conflicts = collectWorkspaceImportConflicts(getPersistedWeeklyWorkspaceState(), imported);
      if (conflicts.length) showWorkspaceImportReview(backup.payload, conflicts);
      else await applyWorkspaceImport(backup.payload, {});
    }
    return;
  }

  if (action === 'delete-workspace-backup') {
    await deleteWorkspaceBackup(actionEl.dataset.backupId);
    return;
  }

  if (action === 'cancel-workspace-import-review') {
    pendingWorkspaceImportReview = null;
    document.getElementById('workspaceImportReview')?.remove();
    return;
  }

  if (action === 'apply-workspace-import-review') {
    if (!pendingWorkspaceImportReview) return;
    const decisions = {};
    document.querySelectorAll('.workspace-import-conflict').forEach(section => {
      const index = Number(section.dataset.conflictIndex);
      const value = section.querySelector('input[type="radio"]:checked')?.value || 'local';
      decisions[index] = value === 'manual' ? { manual: section.querySelector('textarea')?.value || '' } : value;
    });
    await applyWorkspaceImport(pendingWorkspaceImportReview.payload, decisions);
    return;
  }

  if (action === 'copy-daily-log') {
    await copyDailyLog();
    return;
  }

  // ---- Close duplicate Inner Garden · 美日心灵 tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Inner Garden · 美日心灵 tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'workspaceSyncLoginForm') {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      if (!await ensureWorkspaceSyncHostPermission(true)) throw new Error('未允许访问账号服务域名');
      const preserveCurrentWhenMissing = workspaceSyncClient.getPublicState().savedAccounts.length === 0;
      await workspaceSyncClient.login(form.get('identifier'), form.get('password'));
      await activateNewlySignedInAccount({ preserveCurrentWhenMissing });
      const username = workspaceSyncClient.getPublicState().username;
      workspaceAccountProfile = null;
      document.getElementById('workspaceSyncDialog')?.close();
      showToast(`已登录 ${username}，正在开始同步…`, 4000);
      await performWorkspaceSync(false);
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      renderWorkspaceSyncStatus({ status: 'error', errorType: feedback.type, detail: feedback.detail });
      const passwordInput = document.getElementById('workspaceSyncPassword');
      passwordInput?.focus();
      passwordInput?.select();
    }
    return;
  }
  if (e.target.id === 'workspaceSyncAddAccountForm') {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      if (!await ensureWorkspaceSyncHostPermission(true)) throw new Error('未允许访问账号服务域名');
      await flushWeeklyWorkspaceSave();
      await workspaceSyncClient.login(form.get('identifier'), form.get('password'));
      await activateNewlySignedInAccount();
      workspaceAccountView = 'account';
      workspaceAccountProfile = null;
      document.getElementById('workspaceSyncDialog')?.close();
      showToast(`已添加并切换到 ${workspaceSyncClient.getPublicState().username}`, 4000);
      await performWorkspaceSync(false);
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
      document.getElementById('workspaceSyncAddPassword')?.focus();
    }
    return;
  }
  if (e.target.id === 'workspaceSyncChangePasswordCurrentForm') {
    e.preventDefault();
    const form = new FormData(e.target);
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton?.textContent;
    try {
      const newPassword = validateWorkspaceAccountPassword(form.get('password'), form.get('confirmPassword'));
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = '正在修改…';
      }
      await workspaceSyncClient.changePassword({
        oldPassword: form.get('oldPassword'),
        newPassword,
      });
      workspaceAccountView = 'account';
      workspacePasswordChangeMethod = 'current';
      workspaceAccountProfile = null;
      renderWorkspaceSyncDialog();
      showToast('密码已修改；本机已换取新的 10 天登录会话', 4500);
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    } finally {
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
    return;
  }
  const accountForms = {
    workspaceSyncCodeLoginForm: 'login-code',
    workspaceSyncAddCodeAccountForm: 'login-code',
    workspaceSyncChangePasswordPhoneForm: 'change-password-phone',
    workspaceSyncRegisterForm: 'register',
    workspaceSyncRecoverForm: 'recover',
    workspaceSyncBindForm: 'bind',
  };
  if (accountForms[e.target.id]) {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton?.textContent;
    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = '正在处理…';
      }
      await submitWorkspaceAccountForm(e.target, accountForms[e.target.id]);
    } catch (error) {
      const feedback = getWorkspaceSyncErrorFeedback(error);
      setSyncLoginFeedback('error', feedback.title, feedback.detail, feedback.label);
    } finally {
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
    return;
  }
  if (e.target.id !== 'weekPlanEditorForm' && e.target.id !== 'weekPlanQuickForm') return;
  e.preventDefault();

  const input = e.target.querySelector('input');
  if (!input) return;
  await addWeekPlanItem(input.value);
  input.value = '';
  input.focus();
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('click', (e) => {
  if (e.target.id === 'weekEntryEditor') {
    closeWeekEntryEditor();
    return;
  }

  if (e.target.id === 'dailyLogEditor') {
    closeDailyLogEditor();
    return;
  }

  if (e.target.id === 'weekPlanEditor') {
    closeWeekPlanEditor();
    return;
  }

  if (e.target.closest('.week-event') || e.target.closest('[data-action]')) return;
  const cell = e.target.closest('.week-hour-cell');
  if (!cell) return;
  createWeekEventFromCellClick(cell, e);
});

document.addEventListener('dblclick', (e) => {
  const eventEl = e.target.closest('.week-event');
  if (!eventEl) return;
  openWeekEntryEditor(eventEl.dataset.eventId);
});

document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.week-resize-handle');
  if (handle) {
    startWeekEventResize(handle, e);
    return;
  }

  if (e.target.closest('.week-event-expand') || e.target.closest('.week-event-delete')) return;
  const eventEl = e.target.closest('.week-event');
  if (!eventEl) return;
  startWeekEventDrag(eventEl, e);
});

document.addEventListener('pointermove', (e) => {
  moveWeekEventResize(e);
  moveWeekEventDrag(e);
});

document.addEventListener('pointerup', () => {
  stopWeekEventResize();
  stopWeekEventDrag();
});

document.addEventListener('input', async (e) => {
  if (e.target.matches('.week-event-title-input')) {
    updateWeekEventTitle(e.target);
    return;
  }

  if (e.target.matches('.daily-log-expanded')) {
    updateDailyLogEntry(e.target);
    return;
  }

  if (e.target.matches('.week-entry-expanded')) {
    updateExpandedWeekEntry(e.target);
    return;
  }

  if (e.target.matches('.week-plan-item-input')) {
    updateWeekPlanItemText(e.target);
    return;
  }

  if (e.target.matches('[data-log-key]')) {
    updateDailyLogEntry(e.target);
    return;
  }

  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'workspaceImportInput') return;
  await importWorkspaceFile(e.target.files?.[0]);
  e.target.value = '';
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushDailyLogGeneratedSectionSync();
    flushWeeklyWorkspaceSave().catch(() => {});
  }
});

window.addEventListener('pagehide', () => {
  flushDailyLogGeneratedSectionSync();
  flushWeeklyWorkspaceSave().catch(() => {});
});

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', async (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.daily-log-card[data-log-date-key]')) {
    e.preventDefault();
    selectDailyLogDate(e.target.dataset.logDateKey);
    return;
  }

  if (e.target.matches('.week-plan-item-input') && !e.isComposing) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishWeekPlanItemEdit(e.target.dataset.weekPlanId);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishWeekPlanItemEdit(e.target.dataset.weekPlanId, true);
      return;
    }
  }

  const isUndoShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
  if (isUndoShortcut && (allowEditableUndoAfterDailyClear || !isEditableTarget(e.target))) {
    e.preventDefault();
    undoWeeklyWorkspaceChange();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('dailyLogRegenerateConfirm')) {
    closeDailyLogRegenerateConfirm();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('dailyLogClearConfirm')) {
    closeDailyLogClearConfirm();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('weekEventDeleteConfirm')) {
    closeWeekEventDeleteConfirm();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('weekEntryEditor')?.classList.contains('visible')) {
    closeWeekEntryEditor();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('dailyLogEditor')?.classList.contains('visible')) {
    closeDailyLogEditor();
    return;
  }

  if (e.key === 'Escape' && document.getElementById('weekPlanEditor')?.classList.contains('visible')) {
    closeWeekPlanEditor();
    return;
  }

  if (e.target.id !== 'focusCustomMinutes' || e.key !== 'Enter') return;
  e.preventDefault();
  await setCustomFocusDuration();
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
initShanghaiClock();
initFocusTimer();
initWorkspaceTabs();
initWeeklyWorkspace()
  .then(initWorkspaceSync)
  .catch(error => {
    console.warn('[tab-out] Workspace initialization failed:', error);
    renderWorkspaceSyncStatus({ status: 'error', detail: error.message });
  });
renderDashboard();
