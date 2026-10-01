(function initWorkspaceSyncContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TabOutWorkspaceSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function workspaceSyncFactory() {
  'use strict';

  const SCHEMA_VERSION = 3;
  const ENTITY_TYPES = Object.freeze({
    EVENT: 'calendar_event',
    WEEK_PLAN_ITEM: 'week_plan_item',
    DAILY_LOG_FIELD: 'daily_log_field',
  });
  const EVENT_COLORS = Object.freeze(['yellow', 'pink', 'blue', 'purple', 'white']);
  const DAILY_LOG_FIELDS = Object.freeze([
    'inspiration',
    'plan',
    'action',
    'creation',
    'generated',
    'generatedSourceSignature',
  ]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function createId(prefix = 'id') {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.randomUUID) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function getIsoWeekId(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) return '';
    const dayNumber = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
    const weekYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const weekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${weekYear}-W${pad2(weekNumber)}`;
  }

  function getWeekStart(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) return '';
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function shiftDate(dateKey, days) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function createEmptyWorkspace(dateKey = new Date().toISOString().slice(0, 10)) {
    const weekStart = getWeekStart(dateKey);
    return {
      version: SCHEMA_VERSION,
      activeWeekId: getIsoWeekId(weekStart),
      activeWeekStartKey: weekStart,
      selectedWeekStartKey: weekStart,
      planner: {},
      events: [],
      weekPlanItems: [],
      weekPlans: {},
      logs: {},
      dailyDraft: {
        dateKey,
        inspiration: '',
        plan: '',
        action: '',
        creation: '',
      },
    };
  }

  function normalizeWorkspace(value, dateKey = new Date().toISOString().slice(0, 10)) {
    const fallback = createEmptyWorkspace(dateKey);
    if (!value || typeof value !== 'object') return fallback;
    const source = clone(value);
    const workspace = { ...fallback, ...source, version: SCHEMA_VERSION };
    workspace.activeWeekStartKey ||= fallback.activeWeekStartKey;
    workspace.selectedWeekStartKey ||= workspace.activeWeekStartKey;
    workspace.activeWeekId ||= getIsoWeekId(workspace.activeWeekStartKey);
    workspace.planner = source.planner && typeof source.planner === 'object' ? source.planner : {};
    workspace.events = Array.isArray(source.events) ? source.events.filter(item => item && item.dateKey).map(item => {
      const startMinute = Math.max(0, Number(item.startMinute) || 0);
      const requestedEnd = item.endMinute == null ? NaN : Number(item.endMinute);
      // Focus records keep their recorded minute, even when both labels are the same.
      // Midnight fragments may be shorter than the ordinary 15-minute block.
      const minDuration = String(item.id || '').startsWith('focus-session-') ? 0
        : startMinute === 0 || requestedEnd === 1440 ? 1 : 15;
      return {
        ...item,
        id: item.id || createId('event'),
        weekId: item.weekId || getIsoWeekId(item.dateKey),
        startMinute,
        endMinute: Math.max(startMinute + minDuration, Number.isFinite(requestedEnd) ? requestedEnd : 15),
        title: String(item.title || firstLine(item.content) || '记录'),
        content: String(item.content || ''),
        color: normalizeEventColor(item.color),
      };
    }) : [];
    workspace.weekPlans = source.weekPlans && typeof source.weekPlans === 'object' ? source.weekPlans : {};
    workspace.weekPlanItems = Array.isArray(source.weekPlanItems) ? source.weekPlanItems : [];
    workspace.logs = source.logs && typeof source.logs === 'object' ? source.logs : {};
    workspace.dailyDraft = source.dailyDraft && typeof source.dailyDraft === 'object'
      ? source.dailyDraft
      : fallback.dailyDraft;

    const eventIds = new Set(workspace.events.map(item => item.id));
    for (const [key, rawContent] of Object.entries(workspace.planner)) {
      const content = String(rawContent || '').trim();
      const [eventDateKey, hourText] = key.split('|');
      const hour = Number(hourText);
      const id = `legacy-${eventDateKey}-${hourText}`;
      if (!content || !/^\d{4}-\d{2}-\d{2}$/.test(eventDateKey) || !Number.isFinite(hour) || eventIds.has(id)) continue;
      workspace.events.push({
        id,
        dateKey: eventDateKey,
        weekId: getIsoWeekId(eventDateKey),
        startMinute: hour * 60,
        endMinute: Math.min((hour + 1) * 60, 24 * 60),
        title: firstLine(content) || '记录',
        content,
        color: 'yellow',
      });
      eventIds.add(id);
    }

    if (!workspace.weekPlanItems.length) {
      const draftDateKey = workspace.dailyDraft.dateKey || dateKey;
      const scratch = String(workspace.dailyDraft.scratch || (workspace.logs[draftDateKey] && workspace.logs[draftDateKey].scratch) || '').trim();
      if (scratch) {
        workspace.weekPlanItems = scratch.split('\n').map(line => line.trim()).filter(Boolean).map((text, order) => ({
          id: `legacy-plan-${draftDateKey}-${order}`,
          text,
          completed: false,
          createdAt: '',
          completedAt: '',
          order,
        }));
      }
    }

    const selectedWeekId = getIsoWeekId(workspace.selectedWeekStartKey);
    if (selectedWeekId && workspace.weekPlanItems.length) {
      workspace.weekPlans[selectedWeekId] = {
        id: selectedWeekId,
        weekId: selectedWeekId,
        weekStart: workspace.selectedWeekStartKey,
        weekEnd: shiftDate(workspace.selectedWeekStartKey, 6),
        summary: '',
        closedAt: '',
        updatedAt: '',
        ...(workspace.weekPlans[selectedWeekId] || {}),
        items: workspace.weekPlanItems,
      };
    }
    return workspace;
  }

  function firstLine(value) {
    const line = String(value || '').split('\n').find(entry => entry.trim());
    return line ? line.trim() : '';
  }

  function normalizeEventColor(value) {
    const color = String(value || '').trim().toLowerCase();
    return EVENT_COLORS.includes(color) ? color : 'yellow';
  }

  function entityKey(type, id) {
    return `${type}::${id}`;
  }

  function buildEntity(type, id, payload) {
    return { type, id: String(id), payload: clone(payload) };
  }

  function workspaceToEntityMap(workspace) {
    const source = workspace && typeof workspace === 'object' ? workspace : createEmptyWorkspace();
    const entities = {};

    for (const event of Array.isArray(source.events) ? source.events : []) {
      if (!event || !event.id || !event.dateKey) continue;
      const payload = {
        id: event.id,
        dateKey: event.dateKey,
        weekId: event.weekId || getIsoWeekId(event.dateKey),
        startMinute: Number(event.startMinute) || 0,
        endMinute: event.endMinute != null && Number.isFinite(Number(event.endMinute)) ? Number(event.endMinute) : 15,
        title: String(event.title || ''),
        content: String(event.content || ''),
        color: normalizeEventColor(event.color),
      };
      const entity = buildEntity(ENTITY_TYPES.EVENT, event.id, payload);
      entities[entityKey(entity.type, entity.id)] = entity;
    }

    const plans = source.weekPlans && typeof source.weekPlans === 'object'
      ? clone(source.weekPlans)
      : {};
    const selectedWeekId = getIsoWeekId(source.selectedWeekStartKey || source.activeWeekStartKey);
    if (selectedWeekId && Array.isArray(source.weekPlanItems)) {
      plans[selectedWeekId] = {
        ...(plans[selectedWeekId] || {}),
        weekId: selectedWeekId,
        weekStart: source.selectedWeekStartKey || source.activeWeekStartKey,
        items: source.weekPlanItems,
      };
    }

    for (const [weekId, plan] of Object.entries(plans)) {
      for (const item of Array.isArray(plan && plan.items) ? plan.items : []) {
        if (!item || !item.id || !String(item.text || '').trim()) continue;
        const payload = {
          id: item.id,
          weekId,
          weekStart: plan.weekStart || '',
          text: String(item.text).trim(),
          completed: Boolean(item.completed),
          createdAt: item.createdAt || '',
          completedAt: item.completedAt || '',
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
        };
        const entity = buildEntity(ENTITY_TYPES.WEEK_PLAN_ITEM, item.id, payload);
        entities[entityKey(entity.type, entity.id)] = entity;
      }
    }

    for (const [dateKey, log] of Object.entries(source.logs || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !log || typeof log !== 'object') continue;
      for (const field of DAILY_LOG_FIELDS) {
        if (log[field] === undefined || log[field] === null || String(log[field]) === '') continue;
        const id = `${dateKey}|${field}`;
        const entity = buildEntity(ENTITY_TYPES.DAILY_LOG_FIELD, id, {
          dateKey,
          field,
          value: String(log[field]),
        });
        entities[entityKey(entity.type, entity.id)] = entity;
      }
    }

    return entities;
  }

  function ensureWeekPlan(workspace, payload) {
    workspace.weekPlans ||= {};
    const weekId = payload.weekId || getIsoWeekId(payload.weekStart);
    const weekStart = payload.weekStart || (workspace.weekPlans[weekId] && workspace.weekPlans[weekId].weekStart) || '';
    workspace.weekPlans[weekId] ||= {
      id: weekId,
      weekId,
      weekStart,
      weekEnd: weekStart ? shiftDate(weekStart, 6) : '',
      items: [],
      summary: '',
      closedAt: '',
      updatedAt: '',
    };
    workspace.weekPlans[weekId].items ||= [];
    return workspace.weekPlans[weekId];
  }

  function applyEntityChange(workspaceInput, change) {
    const workspace = clone(workspaceInput || createEmptyWorkspace());
    const type = (change && change.entityType) || (change && change.type);
    const id = (change && change.entityId) || (change && change.id);
    const payload = clone((change && change.payload) || {});
    const deleted = Boolean((change && change.deletedAt) || (change && change.action === 'delete'));
    if (!type || !id) return workspace;

    if (type === ENTITY_TYPES.EVENT) {
      workspace.events ||= [];
      const index = workspace.events.findIndex(event => event.id === id);
      if (deleted) {
        if (index >= 0) workspace.events.splice(index, 1);
      } else if (index >= 0) {
        workspace.events[index] = payload;
      } else {
        workspace.events.push(payload);
      }
      return workspace;
    }

    if (type === ENTITY_TYPES.WEEK_PLAN_ITEM) {
      const plan = ensureWeekPlan(workspace, payload);
      const index = plan.items.findIndex(item => item.id === id);
      if (deleted) {
        if (index >= 0) plan.items.splice(index, 1);
      } else if (index >= 0) {
        plan.items[index] = payload;
      } else {
        plan.items.push(payload);
      }
      plan.items.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const selectedWeekId = getIsoWeekId(workspace.selectedWeekStartKey || workspace.activeWeekStartKey);
      if (selectedWeekId === plan.weekId) workspace.weekPlanItems = clone(plan.items);
      return workspace;
    }

    if (type === ENTITY_TYPES.DAILY_LOG_FIELD) {
      const separator = String(id).indexOf('|');
      const dateKey = payload.dateKey || String(id).slice(0, separator);
      const field = payload.field || String(id).slice(separator + 1);
      if (!dateKey || !field) return workspace;
      workspace.logs ||= {};
      workspace.logs[dateKey] ||= {};
      if (deleted) delete workspace.logs[dateKey][field];
      else workspace.logs[dateKey][field] = String(payload.value || '');
      if (!Object.keys(workspace.logs[dateKey]).length) delete workspace.logs[dateKey];
      if (workspace.dailyDraft && workspace.dailyDraft.dateKey === dateKey && DAILY_LOG_FIELDS.slice(0, 4).includes(field)) {
        workspace.dailyDraft[field] = deleted ? '' : String(payload.value || '');
      }
    }
    return workspace;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function entitiesEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  // Keep edits made after a sync started, including deletions, over its remote result.
  function rebaseWorkspace(base, local, remote) {
    const before = workspaceToEntityMap(base);
    const after = workspaceToEntityMap(local);
    let merged = clone(remote);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (entitiesEqual(before[key], after[key])) continue;
      const entity = after[key] || before[key];
      merged = applyEntityChange(merged, {
        entityType: entity.type, entityId: entity.id,
        action: after[key] ? 'upsert' : 'delete', payload: entity.payload,
      });
    }
    for (const key of ['activeWeekId', 'activeWeekStartKey', 'selectedWeekStartKey', 'planner']) {
      if (local[key] !== undefined) merged[key] = clone(local[key]);
    }
    const selectedWeekId = getIsoWeekId(merged.selectedWeekStartKey || merged.activeWeekStartKey);
    merged.weekPlanItems = clone(merged.weekPlans?.[selectedWeekId]?.items || []);
    if (local.dailyDraft?.dateKey) {
      const dateKey = local.dailyDraft.dateKey;
      merged.dailyDraft = { dateKey };
      for (const field of DAILY_LOG_FIELDS.slice(0, 4)) merged.dailyDraft[field] = merged.logs?.[dateKey]?.[field] || '';
    }
    return merged;
  }

  return {
    SCHEMA_VERSION,
    ENTITY_TYPES,
    EVENT_COLORS,
    DAILY_LOG_FIELDS,
    clone,
    createId,
    createEmptyWorkspace,
    normalizeWorkspace,
    normalizeEventColor,
    getIsoWeekId,
    getWeekStart,
    shiftDate,
    entityKey,
    workspaceToEntityMap,
    applyEntityChange,
    stableStringify,
    entitiesEqual,
    rebaseWorkspace,
  };
});
