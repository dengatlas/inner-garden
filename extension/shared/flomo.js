(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InnerGardenFlomo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const normalizeBody = value => String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n');
  const dateKey = value => new Date(new Date(value).getTime() + 28800000).toISOString().slice(0, 10);
  function tagPath(id, tags) {
    const parts = [], seen = new Set(); let tag = tags.find(t => t.id === id);
    while (tag && !seen.has(tag.id)) { parts.unshift(tag.name); seen.add(tag.id); tag = tags.find(t => t.id === tag.parentId); }
    return parts.join('/');
  }
function pinnedTree(tags,collapsed=new Set(),query='') {
 const byId=new Map(tags.map(t=>[t.id,t])),include=new Set(),q=query.trim().toLocaleLowerCase();
 function ancestors(id){let current=byId.get(id);const seen=new Set();while(current&&!seen.has(current.id)){seen.add(current.id);include.add(current.id);current=byId.get(current.parentId);}}
 for(const t of tags)if(t.pinned){ancestors(t.id);const descendants=new Set([t.id]);let added=true;while(added){added=false;for(const child of tags)if(descendants.has(child.parentId)&&!descendants.has(child.id)){descendants.add(child.id);added=true;}}descendants.forEach(id=>include.add(id));}
 if(q){const matched=[...include].filter(id=>tagPath(id,tags).toLocaleLowerCase().includes(q));include.clear();matched.forEach(ancestors);}
 const rows=[];const visit=(parent,depth,seen)=>{for(const tag of tags.filter(t=>t.parentId===parent&&include.has(t.id))){if(seen.has(tag.id))continue;const next=new Set([...seen,tag.id]);const hasChildren=tags.some(t=>t.parentId===tag.id&&include.has(t.id));rows.push({...tag,path:tagPath(tag.id,tags),depth,indent:depth*26,hasChildren,collapsed:collapsed.has(tag.id)});if(!collapsed.has(tag.id)||q)visit(tag.id,depth+1,next);}};
 visit('',0,new Set());return rows;
}

  function ensureTag(state, path) {
    let parentId = '';
    for (const name of path.split('/')) {
      if (!name || /[\s#]/.test(name)) throw new Error('标签路径无效');
      let tag = state.tags.find(t => t.parentId === parentId && t.name.toLowerCase() === name.toLowerCase());
      if (!tag) { const stamp = new Date().toISOString(); tag = { id: id('tag'), name, parentId, pinned: false, createdAt: stamp, updatedAt: stamp }; state.tags.push(tag); }
      parentId = tag.id;
    }
    return parentId;
  }
  function hashtags(body) { return [...new Set(Array.from(body.matchAll(/#([^\s#，。！？；：、,!?;:()（）\[\]【】{}<>“”「」"'`]+)/gu), m => m[1].replace(/[.]+$/, '')).filter(p => p && p.split('/').every(Boolean)))]; }
  function seed(state) {
    if (state.defaultTagsVersion) return state;
    const original = new Set(state.tags.map(t=>t.id));
    [...Array.from({length:12}, (_,i) => String(i+1).padStart(2,'0')+'月'), '2026年','清单/复盘','清单/规划','日志/日课','日志/审视','日志/记录'].forEach(path => ensureTag(state, path));
    const mapping = new Map(state.tags.filter(t=>!original.has(t.id)).map(t=>[t.id,'default-'+Array.from(tagPath(t.id,state.tags)).map(c=>c.codePointAt(0).toString(16)).join('-')]));
    state.tags.forEach(t=>{ if(mapping.has(t.id)){t.id=mapping.get(t.id);t.createdAt=t.updatedAt='2026-01-01T00:00:00.000Z';} t.parentId=mapping.get(t.parentId)||t.parentId; });
    state.defaultTagsVersion = 1; return state;
  }
  // Compute the complete result before committing: no partial hierarchy changes on failure.
  function deleteTags(state, ids) {
    const next=clone(state), selected=new Set(ids || []), byId=new Map(next.tags.map(t=>[t.id,t]));
    if(!selected.size || [...selected].some(id=>!byId.has(id))) throw new Error('请选择仍然存在的标签');
    const stamp=new Date().toISOString();
    next.tags=next.tags.filter(t=>!selected.has(t.id));
    for(const tag of next.tags){let parent=tag.parentId;const seen=new Set();while(selected.has(parent)){if(seen.has(parent))throw new Error('标签层级异常');seen.add(parent);parent=byId.get(parent).parentId;}if(parent!==tag.parentId){tag.parentId=parent;tag.updatedAt=stamp;}}
    const paths=new Set();for(const tag of next.tags){const path=tagPath(tag.id,next.tags).toLowerCase();if(paths.has(path))throw new Error('下级标签提升后会重名，请先改名或调整选择');paths.add(path);}
    for(const note of next.notes){const affected=(note.tagIds||[]).some(id=>selected.has(id))||(note.inlineTagIds||[]).some(id=>selected.has(id));note.tagIds=(note.tagIds||[]).filter(id=>!selected.has(id));note.inlineTagIds=(note.inlineTagIds||[]).filter(id=>!selected.has(id));if(affected)note.updatedAt=stamp;}
    if(next.draft){next.draft.tagIds=(next.draft.tagIds||[]).filter(id=>!selected.has(id));if(next.draft.edit)next.draft.edit.tagIds=(next.draft.edit.tagIds||[]).filter(id=>!selected.has(id));}
    return next;
  }
  function empty() { return seed({ version:1, notes:[], tags:[], draft:null }); }
  function portable(state) {
    return { version:1, notes:state.notes.map(source => { const n=source.purgedAt ? tombstone(source) : source; return ({ ...(n.purgedAt ? {purgedAt:n.purgedAt} : {}), id:n.id, body:normalizeBody(n.body), tagIds:[...n.tagIds], inlineTagIds:[...(n.inlineTagIds || [])], createdAt:n.createdAt, updatedAt:n.updatedAt, pinned:Boolean(n.pinned), deletedAt:n.deletedAt || null, attachmentCount:Math.max((n.images || []).length, n.attachmentCount || 0) }); }), tags:state.tags.map(t => ({ id:t.id, name:t.name, parentId:t.parentId || '', pinned:Boolean(t.pinned), createdAt:t.createdAt, updatedAt:t.updatedAt })) };
  }
  function validate(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.notes) || !Array.isArray(raw.tags)) throw new Error('不是受支持的 flomo 数据');
    if (raw.notes.length > 10000 || raw.tags.length > 3000) throw new Error('单次最多 10000 条笔记和 3000 个标签');
    const ids = new Set(), tags = new Map();
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,150}$/.test(value);
    for (const tag of raw.tags) {
      if (!validId(tag.id) || tags.has(tag.id) || typeof tag.name !== 'string' || !tag.name.trim() || /[\/#\r\n]/.test(tag.name) || tag.name.length > 150 || typeof tag.parentId !== 'string') throw new Error('标签格式或 ID 无效');
      tags.set(tag.id, tag);
    }
    const paths = new Set();
    for (const tag of raw.tags) {
      const seen = new Set(); let cursor = tag;
      while (cursor) {
        if (seen.has(cursor.id) || seen.size > 30) throw new Error('标签层级循环或过深');
        seen.add(cursor.id);
        if (cursor.parentId && !tags.has(cursor.parentId)) throw new Error('缺少上级标签');
        cursor = tags.get(cursor.parentId);
      }
      const path = tagPath(tag.id, raw.tags).toLowerCase();
      if (paths.has(path)) throw new Error('存在重复标签路径'); paths.add(path);
    }
    for (const note of raw.notes) {
      if (!validId(note.id) || ids.has(note.id) || typeof note.body !== 'string' || note.body.length > 200000 || !Array.isArray(note.tagIds) || note.tagIds.some(t => !tags.has(t)) || !Number.isFinite(Date.parse(note.createdAt)) || !Number.isFinite(Date.parse(note.updatedAt)) || (note.deletedAt && !Number.isFinite(Date.parse(note.deletedAt)))) throw new Error('笔记格式、日期或标签引用无效');
      if (note.purgedAt && (!note.deletedAt || !Number.isFinite(Date.parse(note.purgedAt)))) throw new Error('永久删除标记无效');
      ids.add(note.id);
    }
    const value = portable(raw);
    if (JSON.stringify(value).length > 1500000) throw new Error('文本库超过本次传输上限，请按标签或时间分批导出');
    return value;
  }
  function select(state, filters = {}) {
    if (filters.start && filters.end && filters.start > filters.end) throw new Error('开始日期不能晚于结束日期');
    const path = filters.tagId ? tagPath(filters.tagId, state.tags) : '';
    const notes = state.notes.filter(n => !n.purgedAt && (filters.trash ? true : !n.deletedAt)).filter(n => !path || n.tagIds.some(t => { const p = tagPath(t, state.tags); return p === path || p.startsWith(path+'/'); })).filter(n => (!filters.start || dateKey(n.createdAt) >= filters.start) && (!filters.end || dateKey(n.createdAt) <= filters.end));
    return portable({notes, tags:state.tags});
  }
  function exportText(state, filters, format) {
    const data = select(state, filters);
    const envelope = { format:'inner-garden-flomo', version:1, exportedAt:new Date().toISOString(), scope:filters || {}, ...data };
    if (format === 'json') return JSON.stringify(envelope, null, 2);
    // Explicit length-framed bodies preserve arbitrary Markdown (including our delimiters).
    return '# flomo 笔记\n\n<!-- inner-garden-flomo:1 -->\n' + data.notes.map(n => {
      const meta = {...n, body:undefined, tags:n.tagIds.map(t=>tagPath(t,data.tags))};
      return `\n## ${dateKey(n.createdAt)}\n\n${meta.tags.map(t=>'#'+t).join(' ')}\n\n<!-- flomo-note:${JSON.stringify(meta)} length:${n.body.length} -->\n${n.body}\n<!-- /flomo-note -->\n`;
    }).join('');
  }
  function parse(text, filename = '') {
    text = normalizeBody(text).replace(/^\uFEFF/, '');
    if (text.length > 4000000) throw new Error('文件过大，请分批导入');
    if (/\.json$/i.test(filename) || text.trim().startsWith('{')) { const raw = JSON.parse(text); if (raw.format !== 'inner-garden-flomo') throw new Error('请选择 flomo JSON 导出文件'); return validate(raw); }
    const state = {version:1,notes:[],tags:[]};
    if (text.includes('<!-- inner-garden-flomo:1 -->')) {
      let cursor = 0; const pattern = /<!-- flomo-note:(.+) length:(\d+) -->\n/g; let match;
      while ((match = pattern.exec(text))) {
        const meta = JSON.parse(match[1]), length = Number(match[2]), start = pattern.lastIndex;
        const body = text.slice(start,start+length);
        if (!text.slice(start+length).startsWith('\n<!-- /flomo-note -->')) throw new Error('Markdown 记录边界已改变，请作为普通文本导入');
        const tagIds = (meta.tags || []).map(p=>ensureTag(state,p));
        state.notes.push({...meta,body,tagIds,inlineTagIds:hashtags(body).map(p=>ensureTag(state,p))});
        cursor = start+length; pattern.lastIndex = cursor;
      }
      if (!state.notes.length) throw new Error('文件中没有可导入的笔记');
    } else {
      if (!text.trim()) throw new Error('文件是空的');
      const stamp = new Date().toISOString(), tagIds = hashtags(text).map(p=>ensureTag(state,p));
      state.notes.push({id:id('memo'),body:text,tagIds,inlineTagIds:tagIds,createdAt:stamp,updatedAt:stamp,pinned:false,deletedAt:null});
    }
    return validate(state);
  }
  function mergeImport(current, incoming) {
    incoming = validate(incoming); const next = clone(current), mapping = new Map();
    incoming.tags.forEach(t => { const path=tagPath(t.id,incoming.tags), existing=next.tags.find(item=>tagPath(item.id,next.tags).toLocaleLowerCase()===path.toLocaleLowerCase()); const targetId=ensureTag(next,path); mapping.set(t.id,targetId); const target=next.tags.find(item=>item.id===targetId); if(!existing){target.createdAt=t.createdAt;target.updatedAt=t.updatedAt;} if(t.pinned)target.pinned=true; });
    let added = 0, duplicates = 0, conflicts = 0;
    for (const item of incoming.notes) {
      const note = {...item, tagIds:item.tagIds.map(t=>mapping.get(t)), inlineTagIds:(item.inlineTagIds||[]).map(t=>mapping.get(t)).filter(Boolean),images:[]};
      const existing = next.notes.find(n=>n.id===note.id);
      if (existing && (existing.purgedAt || note.purgedAt)) { next.notes[next.notes.indexOf(existing)]=tombstone(existing.purgedAt ? existing : note); duplicates++; continue; }
      if (existing && existing.body===note.body && existing.createdAt===note.createdAt && Boolean(existing.deletedAt)!==Boolean(note.deletedAt)) { if(note.deletedAt) next.notes[next.notes.indexOf(existing)]={...existing,deletedAt:note.deletedAt,updatedAt:note.updatedAt}; duplicates++; continue; }
      const equivalent = n => n.body===note.body && n.createdAt===note.createdAt && (n.deletedAt||null)===(note.deletedAt||null) && Boolean(n.pinned)===Boolean(note.pinned) && JSON.stringify([...n.tagIds].sort())===JSON.stringify([...note.tagIds].sort());
      if (next.notes.some(equivalent)) { duplicates++; continue; }
      if (existing) { note.id=id('import'); conflicts++; }
      next.notes.push(note); added++;
    }
    return {state:scrubPurged(next),added,duplicates,conflicts};
  }
  const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  function rebase(base, local, remote) {
    const result = {version:1,notes:[],tags:[]}, conflicts=[];
    for (const kind of ['notes','tags']) {
      const b=new Map(base[kind].map(x=>[x.id,x])), l=new Map(local[kind].map(x=>[x.id,x])), r=new Map(remote[kind].map(x=>[x.id,x]));
      for (const key of new Set([...b.keys(),...l.keys(),...r.keys()])) {
        let value;
        const deleted=kind==='notes' && [l.get(key),r.get(key),b.get(key)].filter(x=>x && x.purgedAt).sort((a,b)=>a.purgedAt.localeCompare(b.purgedAt))[0];
        if (deleted) value=tombstone(deleted);
        else if (equal(l.get(key),b.get(key))) value=r.get(key);
        else if (equal(r.get(key),b.get(key)) || equal(l.get(key),r.get(key))) value=l.get(key);
        else { conflicts.push({kind,id:key,local:l.get(key)||null,remote:r.get(key)||null}); value=l.get(key); }
        if (value) result[kind].push(value);
      }
    }
    if (!conflicts.length) { try { validate(result); } catch(error) { conflicts.push({kind:'library',message:error.message}); } }
    return {state:result, conflicts};
  }
  function tombstone(note) {
    return {id:note.id,body:'',tagIds:[],inlineTagIds:[],images:[],createdAt:note.createdAt,updatedAt:note.purgedAt,pinned:false,deletedAt:note.deletedAt || note.purgedAt,purgedAt:note.purgedAt,attachmentCount:0};
  }
  function scrubPurged(state) {
    const gone=new Map(state.notes.filter(n=>n.purgedAt).map(n=>[n.id,tombstone(n)]));
    if (!gone.size) return state;
    // Scrub stored recovery/conflict snapshots as well as the visible library.
    // Pending requests are immutable; finish their delivery before applying deletion.
    function visit(value) {
      if (!value || typeof value!=='object') return;
      if (value.draft && gone.has(value.draft.noteId || value.draft.id)) value.draft=null;
      if (value.draft && value.draft.edit && gone.has(value.draft.edit.id)) value.draft.edit=null;
      if (Array.isArray(value.notes)) value.notes=value.notes.map(n=>gone.has(n.id)?clone(gone.get(n.id)):n);
      for (const [key,child] of Object.entries(value)) if(key!=='pending') { if(child && !Array.isArray(child) && gone.has(child.id)) value[key]=clone(gone.get(child.id)); else visit(child); }
    }
    visit(state);return state;
  }
  function purge(current, ids) {
    const targets=new Set(Array.isArray(ids)?ids:[]);
    if (!targets.size || [...targets].some(id=>!current.notes.some(n=>n.id===id && n.deletedAt && !n.purgedAt))) throw new Error('只能彻底删除回收站中的笔记');
    if(current.sync && current.sync.pending) throw new Error('请先完成上一次同步，再彻底删除');
    const state=clone(current),stamp=new Date().toISOString();
    state.notes=state.notes.map(n=>targets.has(n.id)?tombstone({...n,purgedAt:stamp}):n);
    return scrubPurged(state);
  }
  function applyPortable(current, portableState) {
    const state=clone(current),gone=new Map(current.notes.filter(n=>n.purgedAt).map(n=>[n.id,n])); portableState.notes.filter(n=>n.purgedAt).forEach(n=>gone.set(n.id,n));
    state.notes=portableState.notes.map(n=>gone.has(n.id)?tombstone(gone.get(n.id)):({...n,images:(current.notes.find(x=>x.id===n.id)||{}).images||[]})); for(const [id,n] of gone) if(!state.notes.some(x=>x.id===id)) state.notes.push(tombstone(n)); state.tags=clone(portableState.tags);return scrubPurged(state);
  }
  return {deleteTags,pinnedTree,clone,id,normalizeBody,dateKey,tagPath,ensureTag,hashtags,seed,empty,portable,validate,select,exportText,parse,mergeImport,rebase,applyPortable,purge,equal};
});
