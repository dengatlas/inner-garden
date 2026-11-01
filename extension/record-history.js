(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.InnerGardenRecordHistory = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const labels = { dateKey: '日期', startMinute: '开始时间', endMinute: '结束时间', title: '标题', color: '颜色', content: '正文', value: '日课内容', deleted: '状态' };
  const colors = { white: '白色', yellow: '黄色', pink: '粉色', blue: '蓝色', purple: '紫色' };
  const fields = { inspiration: '灵感 · 审视', plan: '工作 · 清单', action: '记录 · 行动', creation: '日课 · 创作', generated: '每日汇总稿', generatedSourceSignature: '汇总来源' };
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const minute = value => value == null ? '—' : `${String(Math.floor(Number(value) / 60)).padStart(2, '0')}:${String(Number(value) % 60).padStart(2, '0')}`;
  const payload = record => record?.payload || {};
  const stamp = record => record?.clientModifiedAt || record?.serverReceivedAt || record?.updatedAt || '';
  function time(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  }
  function valueFor(record, key) {
    if (key === 'deleted') return record?.deletedAt ? '已删除' : record ? '保留中' : '暂无云端记录';
    const value = payload(record)[key];
    if (key === 'startMinute' || key === 'endMinute') return minute(value);
    if (key === 'color') return colors[value] || value || '—';
    return String(value ?? '');
  }
  function metadata(current, previous, entityType) {
    const keys = entityType === 'calendar_event' ? ['dateKey', 'startMinute', 'endMinute', 'title', 'color', 'deleted'] : ['dateKey', 'deleted'];
    return keys.map(key => ({ key, label: labels[key], current: valueFor(current, key), previous: valueFor(previous, key) })).filter(row => row.current !== row.previous);
  }
  function lineDiff(currentText, previousText) {
    const current = String(currentText || '').split('\n'), previous = String(previousText || '').split('\n');
    if (current.length * previous.length > 160000) return { current: current.map(text => ({ text, changed: true })), previous: previous.map(text => ({ text, changed: true })), bounded: true };
    const table = Array.from({ length: previous.length + 1 }, () => new Uint32Array(current.length + 1));
    for (let i = previous.length - 1; i >= 0; i--) for (let j = current.length - 1; j >= 0; j--) table[i][j] = previous[i] === current[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    const a = current.map(text => ({ text, changed: true })), b = previous.map(text => ({ text, changed: true }));
    let i = 0, j = 0;
    while (i < previous.length && j < current.length) {
      if (previous[i] === current[j]) { b[i++].changed = false; a[j++].changed = false; }
      else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++;
    }
    return { current: a, previous: b, bounded: false };
  }
  function summary(current, previous, entityType) {
    if (!current) return '暂无云端记录';
    if (current.deletedAt) return '已删除';
    const changes = metadata(current, previous, entityType);
    if (changes.some(row => row.key === 'dateKey')) return `日期由 ${valueFor(previous, 'dateKey') || '未记录'} 改为 ${valueFor(current, 'dateKey')}`;
    if (changes.length) return changes.map(row => `修改${row.label}`).join('、');
    return valueFor(current, entityType === 'calendar_event' ? 'content' : 'value') !== valueFor(previous, entityType === 'calendar_event' ? 'content' : 'value') ? '修改正文' : '内容相同';
  }
  function recordTitle(type, id, record) {
    return type === 'calendar_event' ? payload(record).title || '时间块' : `${String(id || '').split('|')[0]} ${fields[String(id || '').split('|')[1]] || '日课'}`;
  }
  function copyText(type, record) {
    const p = payload(record);
    return type === 'calendar_event' ? `${p.dateKey || ''} ${minute(p.startMinute)}–${minute(p.endMinute)}\n${p.title || ''}\n${p.content || ''}` : String(p.value || '');
  }
  function isStale(error) { return Number(error?.status || error?.statusCode) === 409 || /VERSION_CONFLICT|HISTORY_STALE|版本.*变化|版本.*更新/.test(`${error?.code || ''} ${error?.message || ''}`); }
  function isCursorStale(error) { return error?.code === 'HISTORY_CURSOR_STALE'; }
  function errorMessage(error) {
    if (Number(error?.status || error?.statusCode) === 404) return '云端版本功能尚未开放，当前本机记录不受影响。';
    return error?.message || '读取历史失败，请重试';
  }

  let active = null;
  function close() {
    if (!active) return;
    const state = active; active = null;
    state.dialog.close(); state.dialog.remove();
    document.removeEventListener('keydown', state.keydown, true);
    if (state.accountListener) chrome.runtime.onMessage.removeListener(state.accountListener);
    if (state.trigger?.isConnected) state.trigger.focus({ preventScroll: true });
    state.options.onClose?.();
  }
  function accountIsCurrent(state) {
    return state.owner === (state.options.client.getPublicState().accountId || 'local');
  }
  function ensureCurrent(state) {
    if (!accountIsCurrent(state)) throw new Error('账号已切换，请关闭后重新打开历史');
  }
  async function open(options) {
    close();
    const dialog = document.createElement('dialog');
    dialog.id = 'recordHistoryDialog'; dialog.className = 'record-history-dialog';
    dialog.setAttribute('aria-labelledby', 'recordHistoryHeading');
    const state = active = { dialog, options, owner: options.client.getPublicState().accountId || 'local', trigger: document.activeElement, data: null, selected: 0, full: false, loading: false, busy: false, mode: options.entityId ? 'record' : 'day', message: '', items: [], nextCursor: null, request: 0 };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      state.accountListener = message => {
        if (active === state && ['tab-out-workspace-update', 'tab-out-workspace-status'].includes(message?.channel) && !accountIsCurrent(state)) render(state);
      };
      chrome.runtime.onMessage.addListener(state.accountListener);
    }
    state.keydown = event => { if (active === state && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!state.busy) close(); } };
    document.addEventListener('keydown', state.keydown, true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!state.busy) close(); });
    dialog.addEventListener('click', event => { const button = event.target.closest('[data-rh-op]'); if (button && !button.disabled) act(state, button.dataset.rhOp, button.dataset.index).catch(error => { state.message = error.message || '操作未完成，请重试'; state.busy = false; render(state); }); });
    document.body.append(dialog); render(state); dialog.showModal();
    await load(state);
  }
  async function load(state, more = false) {
    const request = ++state.request;
    state.loading = true; state.message = ''; render(state);
    try {
      ensureCurrent(state);
      const data = state.mode === 'day' ? await state.options.client.historyChanges({ dateKey: state.options.dateKey, ...(more ? { cursor: state.nextCursor } : {}) }) : await state.options.client.history({ entityType: state.options.entityType, entityId: state.options.entityId });
      if (active !== state || request !== state.request) return;
      ensureCurrent(state);
      state.data = data;
      if (state.mode === 'day') { state.items = more ? [...state.items, ...(data.items || [])] : data.items || []; state.nextCursor = data.nextCursor || null; }
      else state.selected = Math.min(state.selected, (data.versions || []).length);
      if (data.cached) state.message = '当前显示本机缓存；联网后可刷新云端历史。';
    } catch (error) {
      if (active === state && request === state.request) {
        if (state.mode === 'day' && more && isCursorStale(error) && accountIsCurrent(state)) {
          state.data = null; state.items = []; state.nextCursor = null;
          await load(state);
          if (active === state && accountIsCurrent(state)) { state.message = state.message || '当天记录刚有变化，已刷新列表。'; render(state); }
        } else state.message = errorMessage(error);
      }
    }
    finally { if (active === state && request === state.request) { state.loading = false; render(state); } }
  }
  function render(state) {
    if (active !== state) return;
    if (!accountIsCurrent(state)) {
      state.data = null; state.items = []; state.nextCursor = null;
      state.options.localEntity = null; state.options.localDraft = null;
      state.message = '账号已切换，请关闭后重新打开历史';
      state.dialog.innerHTML = `<header class="record-history-header"><h2 id="recordHistoryHeading">账号已切换</h2><button type="button" data-rh-op="close">关闭</button></header><p class="record-history-empty" role="status">${state.message}</p>`;
      return;
    }
    const options = state.options, data = state.data;
    const current = options.localEntity || data?.current;
    const heading = state.mode === 'day' ? `${options.dateKey} 当天变更` : recordTitle(options.entityType, options.entityId, current || data?.versions?.[0]);
    const status = state.message || (state.loading ? '正在读取云端历史…' : state.owner === 'local' ? '登录后可查看账号的云端历史' : '所有时间按上海时区显示');
    let body;
    if (state.mode === 'day') {
      body = `<div class="record-history-day-list">${state.items.length ? state.items.map((item, index) => `<button type="button" class="record-history-day-item" data-rh-op="record" data-index="${index}"><strong>${escape(recordTitle(item.entityType, item.entityId, item.current || item.versions?.[0]))}</strong><span>${escape(time(item.changedAt || stamp(item.current)))} · ${escape(item.current?.deletedAt ? '已删除，可查看旧版' : summary(item.current, item.versions?.[0], item.entityType))}</span><small>${escape((item.affectedDateKeys || []).join(' / '))}</small></button>`).join('') : `<p class="record-history-empty">${state.loading ? '正在读取…' : '这一天暂无可查的云端变更。未同步的本机内容不在这里。'}</p>`}${state.nextCursor ? '<button type="button" data-rh-op="more">加载更多</button>' : ''}</div>`;
    } else if (!data) body = '<div class="record-history-empty">从这里查看修改前的内容，浏览不会修改当前记录。</div>';
    else {
      const snapshots = [data.current, ...(data.versions || [])];
      const chosen = state.selected < 0 ? options.localDraft : snapshots[state.selected];
      const rows = metadata(current, chosen, options.entityType);
      const textKey = options.entityType === 'calendar_event' ? 'content' : 'value';
      const diff = lineDiff(valueFor(current, textKey), valueFor(chosen, textKey));
      const section = (title, lines, side) => `<section class="record-history-text"><h3>${title}</h3><div>${lines.filter(line => state.full || line.changed).map(line => `<p class="${line.changed ? `is-${side}` : ''}">${line.changed ? `<span class="record-history-line-label">${side === 'current' ? '当前新增' : '旧版独有'}</span>` : ''}<span>${escape(line.text) || '&nbsp;'}</span></p>`).join('') || '<p class="record-history-no-change">正文没有变化</p>'}</div></section>`;
      body = `<div class="record-history-layout"><nav class="record-history-versions" aria-label="选择版本">${snapshots.map((item, index) => `<button type="button" data-rh-op="select" data-index="${index}" aria-pressed="${index === state.selected}"><strong>${index === 0 ? '当前云端版本' : index === 1 ? '上一个版本' : '更早版本'}</strong><span>${escape(time(stamp(item)))}</span><small>${escape(item?.deviceId ? `来源设备 · ${item.deviceId.slice(-8)}` : '来源设备未记录')}${item?.deletedAt ? ' · 已删除' : ''}</small></button>`).join('')}${options.localDraft ? `<button type="button" data-rh-op="select" data-index="-1" aria-pressed="${state.selected < 0}"><strong>恢复前的本机草稿</strong><span>${escape(time(stamp(options.localDraft)))}</span><small>仅当前浏览器，可查看和复制</small></button>` : ''}</nav><div class="record-history-comparison">${options.localEntity ? '<p class="record-history-local-note">比较包含当前本机内容；本机修改不一定已同步。查看不会提交编辑，恢复前会另存本机草稿。</p>' : ''}<div class="record-history-comparison-head"><strong>${state.selected ? '与旧版比较' : '当前版本'}</strong><button type="button" data-rh-op="toggle">${state.full ? '只看变化' : '查看全文'}</button></div>${rows.length ? `<dl class="record-history-metadata">${rows.map(row => `<div><dt>${escape(row.label)}</dt><dd><span>当前</span>${escape(row.current || '空')}</dd><dd><span>旧版</span>${escape(row.previous || '空')}</dd></div>`).join('')}</dl>` : ''}${section(options.localEntity ? '当前本机内容' : '当前内容', diff.current, 'current')}${section(state.selected < 0 ? '恢复前的本机草稿' : state.selected ? '当时内容' : '当前云端内容', diff.previous, 'previous')}${diff.bounded ? '<p>长文按全文比较，避免界面停顿。</p>' : ''}${!data.versions?.length ? '<p class="record-history-empty">暂无更早版本；从未保存或上传的文字无法从云端追溯。</p>' : ''}</div></div>`;
    }
    const chosen = state.mode === 'record' ? data?.versions?.[state.selected - 1] : null;
    const restoreDisabled = !chosen?.historyId || state.busy || state.loading || state.owner === 'local' || navigator.onLine === false || !accountIsCurrent(state);
    state.dialog.innerHTML = `<header class="record-history-header"><div><p>记录版本 · 上海时间</p><h2 id="recordHistoryHeading">${escape(heading)}</h2></div><button type="button" data-rh-op="close" aria-label="关闭版本历史" ${state.busy ? 'disabled' : ''}>关闭</button></header><div class="record-history-status" role="status" aria-live="polite">${escape(status)} <button type="button" data-rh-op="retry" ${state.loading || state.busy ? 'disabled' : ''}>${state.loading ? '读取中' : '刷新 / 重试'}</button></div>${body}<footer class="record-history-actions">${options.fromDay && state.mode === 'record' ? '<button type="button" data-rh-op="back">返回当天变更</button>' : '<span>查看与复制不会修改记录</span>'}${state.mode === 'record' ? `<button type="button" data-rh-op="copy" ${!data || state.busy ? 'disabled' : ''}>复制内容</button><button type="button" class="record-history-restore" data-rh-op="restore" ${restoreDisabled ? 'disabled' : ''}>${state.busy ? '正在恢复…' : '恢复此版本'}</button>` : ''}</footer>`;
  }
  async function act(state, op, index) {
    if (active !== state || state.busy) return;
    if (op === 'close') return close();
    ensureCurrent(state);
    if (op === 'retry' || op === 'more') return load(state, op === 'more');
    if (op === 'toggle') { state.full = !state.full; return render(state); }
    if (op === 'select') { state.selected = Number(index); return render(state); }
    if (op === 'record') {
      const item = state.items[Number(index)];
      state.options = { ...state.options, entityType: item.entityType, entityId: item.entityId, localEntity: null, localDraft: null, fromDay: true };
      state.mode = 'record'; state.data = null; state.selected = 1; return load(state);
    }
    if (op === 'back') { state.mode = 'day'; state.data = null; return load(state); }
    ensureCurrent(state);
    const data = state.data;
    const chosen = state.selected < 0 ? state.options.localDraft : state.selected ? data?.versions?.[state.selected - 1] : data?.current;
    if (op === 'copy') { await navigator.clipboard.writeText(copyText(state.options.entityType, chosen)); state.message = '已复制所选版本'; return render(state); }
    if (op !== 'restore' || !chosen?.historyId) return;
    if (navigator.onLine === false) throw new Error('请联网后恢复，当前编辑仍保留在本机');
    if (!window.confirm('恢复这个版本？当前内容会保留为历史；本机未同步的编辑会保留为草稿。')) return;
    state.busy = true; render(state);
    try {
      state.options.onBeforeRestore?.(state.options);
      const result = await state.options.client.restoreHistory({ entityType: state.options.entityType, entityId: state.options.entityId, historyId: chosen.historyId, expectedVersion: Number(data.current?.version || 0) });
      if (active !== state) return;
      ensureCurrent(state);
      await state.options.onRestored?.(result, state.options);
      close();
    } catch (error) {
      if (active !== state) return;
      state.busy = false;
      if (isStale(error)) { state.options.localEntity = null; await load(state); state.message = '这条记录刚有更新，已刷新比较；请核对后重新选择恢复。'; }
      else state.message = error.message || '恢复未完成，当前内容仍保留';
      render(state);
    }
  }
  return { open, close, metadata, lineDiff, summary, copyText, isStale };
});
