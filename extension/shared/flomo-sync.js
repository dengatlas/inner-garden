(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./flomo') : root.InnerGardenFlomo);
  if (typeof module === 'object' && module.exports) module.exports=api; else root.InnerGardenFlomoSync=api;
})(typeof globalThis !== 'undefined' ? globalThis : this,function(F) {
  'use strict';
  const blank=()=>({version:1,notes:[],tags:[]});
  const INTERVAL_MS=720000;
  const find=(state,kind,id)=>state[kind].find(item=>item.id===id)||null;
  function replace(state,kind,id,value) {
    state[kind]=state[kind].filter(item=>item.id!==id);
    if(value) state[kind].push(F.clone(value));
  }
  function conflicts(state) {
    const saved=state.sync && state.sync.conflict;
    if(!saved || !saved.remote || !saved.remote.state) return [];
    const local=F.portable(state),remote=saved.remote.state;
    let details=saved.details||[];
    // Old CAS errors were library-wide, not proof of a content conflict.
    if(details.some(item=>item.kind==='library')) details=F.rebase(state.sync.base||blank(),local,remote).conflicts;
    return details.filter(item=>['notes','tags'].includes(item.kind)).map(item=>({
      kind:item.kind,id:item.id,local:find(local,item.kind,item.id),remote:find(remote,item.kind,item.id)
    })).filter(item=>!item.local?.purgedAt&&!item.remote?.purgedAt&&!F.equal(item.local,item.remote));
  }
  function status(state) {
    const metadata=state.sync||{},count=conflicts(state).length;
    return {dirty:Boolean(metadata.pending)||!F.equal(F.portable(state),metadata.base||blank()),conflict:count>0,conflictCount:count,
      lastSyncedAt:metadata.lastSyncedAt||'',error:metadata.lastError||''};
  }
  function merge(current,remote,base) {
    const local=F.portable(current),aliases=new Map(),pins=new Set();
    // Two offline devices may create the same new tag with different IDs.
    // Reconcile that identity before comparing notes or validating hierarchy.
    for(const tag of local.tags) {
      if(base.tags.some(item=>item.id===tag.id)||remote.state.tags.some(item=>item.id===tag.id))continue;
      const peer=remote.state.tags.find(item=>!base.tags.some(old=>old.id===item.id)&&F.tagPath(item.id,remote.state.tags).toLowerCase()===F.tagPath(tag.id,local.tags).toLowerCase());
      if(peer){aliases.set(tag.id,peer);if(tag.pinned||peer.pinned)pins.add(peer.id);}
    }
    if(aliases.size){
      local.tags=local.tags.map(tag=>aliases.has(tag.id)?F.clone(aliases.get(tag.id)):{...tag,parentId:aliases.get(tag.parentId)?.id||tag.parentId});
      for(const note of local.notes)for(const key of ['tagIds','inlineTagIds'])note[key]=[...new Set(note[key].map(id=>aliases.get(id)?.id||id))];
    }
    const merged=F.rebase(base,local,remote.state),details=new Map();
    for(const tag of merged.state.tags)if(pins.has(tag.id))tag.pinned=true;
    for(const item of [...merged.conflicts,...conflicts(current)]) {
      if(!['notes','tags'].includes(item.kind)) continue;
      const entry={kind:item.kind,id:item.id,local:find(local,item.kind,item.id),remote:find(remote.state,item.kind,item.id)};
      if(entry.local?.purgedAt||entry.remote?.purgedAt||F.equal(entry.local,entry.remote)) continue;
      details.set(entry.kind+':'+entry.id,entry);
      replace(merged.state,entry.kind,entry.id,entry.local);
    }
    const masked=()=>{
      const result=F.clone(merged.state);
      for(const item of details.values()) replace(result,item.kind,item.id,item.remote);
      return result;
    };
    let upload=masked();
    try {F.validate(merged.state);F.validate(upload);} catch(error) {
      // Cross-record tag dependencies cannot be resolved as unrelated writes.
      // Keep the local hierarchy, defer differing tags and affected notes, and
      // still exchange independent notes. Never persist an invalid tag graph.
      const ids=new Set([...local.tags,...remote.state.tags].map(t=>t.id));
      const changedTags=new Set([...ids].filter(id=>!F.equal(find(local,'tags',id),find(remote.state,'tags',id))));
      for(const kind of ['tags','notes']) for(const id of new Set([...local[kind],...remote.state[kind]].map(x=>x.id))) {
        const l=find(local,kind,id),r=find(remote.state,kind,id);
        const affected=kind==='tags'?changedTags.has(id):[...(l?.tagIds||[]),...(r?.tagIds||[])].some(tag=>changedTags.has(tag));
        if(affected&&!F.equal(l,r)) {const entry={kind,id,local:l,remote:r};details.set(kind+':'+id,entry);replace(merged.state,kind,id,l);}
      }
      upload=masked();F.validate(merged.state);F.validate(upload);
    }
    const next=F.applyPortable(current,merged.state);
    next.sync={...current.sync,base:F.clone(remote.state),revision:remote.revision,pending:null,
      conflict:details.size?{remote:F.clone(remote),details:[...details.values()]}:null};
    return {next,upload};
  }
  function validRemote(remote) {
    F.validate(remote.state);
    if(!Number.isSafeInteger(remote.revision)||remote.revision<0) throw new Error('同步版本无效');
  }
  async function deliver(adapter,pending) {
    const response=await adapter.request('push',pending);
    if(response.opId!==pending.opId||!['accepted','conflict'].includes(response.status)) throw new Error('服务器尚未确认上传，请重试');
    validRemote(response);
    await adapter.mutate(current=>{
      if(current.sync?.pending?.opId!==pending.opId) throw new Error('本机同步队列发生变化，请重新同步');
      return merge(current,response,response.status==='accepted'?pending.state:(current.sync.base||blank())).next;
    });
    return response;
  }
  // Network never holds the local write lock. Persist immutable requests before I/O.
  async function sync(adapter) {
    const initial=await adapter.read(),before=F.portable(initial);
    if(initial.sync?.pending) await deliver(adapter,initial.sync.pending);
    let remote=await adapter.request('pull',{});validRemote(remote);
    const previous=new Map(before.notes.map(note=>[note.id,note]));
    const received=remote.state.notes.filter(note=>!F.equal(note,previous.get(note.id))).length;
    for(let attempt=0;attempt<3;attempt++) {
      let pending;
      await adapter.mutate(current=>{
        const result=merge(current,remote,current.sync?.base||blank());
        pending=F.equal(result.upload,remote.state)?null:{opId:F.id('sync'),baseRevision:remote.revision,state:result.upload};
        result.next.sync.pending=pending;return result.next;
      });
      if(!pending) break;
      const response=await deliver(adapter,pending);
      if(response.status==='accepted') break;
      remote=response;
      if(attempt===2) throw new Error('云端仍在更新，请稍后重试；本机修改已保留');
    }
    await adapter.mutate(current=>{
      current.sync={...current.sync,lastSyncedAt:new Date().toISOString(),lastError:'',lastResult:{received,revision:current.sync.revision}};
      return current;
    });
    return {received,...status(await adapter.read())};
  }
  function resolve(state,selection) {
    const entries=conflicts(state);
    if(!entries.length) return state;
    // No legacy whole-library replacement. A single-item call stays compatible.
    if(typeof selection==='string') {
      if(entries.length!==1) throw new Error('请逐条选择需要处理的笔记或标签');
      selection={...entries[0],choice:selection};
    }
    const entry=entries.find(item=>item.kind===selection.kind&&item.id===selection.id);
    if(!entry) throw new Error('这条差异已变化，请重新查看');
    if(selection.expected&&!F.equal(selection.expected,{local:entry.local,remote:entry.remote})) throw new Error('内容已变化，请查看最新差异后再选择');
    if(!['local','remote','both'].includes(selection.choice)||(entry.kind==='tags'&&selection.choice==='both')) throw new Error('请选择这条记录的处理方式');
    if(state.sync.pending) throw new Error('请先重试上一次同步，再处理差异');
    const backup=F.clone(state);delete backup.sync;
    const visible=F.portable(state);
    if(selection.choice==='remote') {
      if(entry.kind==='tags'&&!entry.remote&&entry.local){
        const deleted=F.deleteTags(visible,[entry.id]);visible.tags=deleted.tags;visible.notes=deleted.notes;
      } else replace(visible,entry.kind,entry.id,entry.remote);
      if(entry.kind==='tags'&&entry.remote){
        let parent=entry.remote.parentId;const seen=new Set();
        while(parent&&!visible.tags.some(tag=>tag.id===parent)){
          if(seen.has(parent))throw new Error('关联标签存在循环，请重新同步');seen.add(parent);
          const ancestor=find(state.sync.conflict.remote.state,'tags',parent);
          if(!ancestor)throw new Error('关联标签已变化，请重新同步');visible.tags.push(F.clone(ancestor));parent=ancestor.parentId;
        }
      }
    }
    if(selection.choice==='both'&&entry.remote) {
      if(!entry.local) replace(visible,entry.kind,entry.id,entry.remote);
      else visible.notes.push({...F.clone(entry.remote),id:F.id('conflict')});
    }
    try {F.validate(visible);} catch(_) {throw new Error('这条记录涉及关联标签，请先处理关联标签后重试；原内容已保留');}
    const next=F.applyPortable(state,visible);
    const remaining=entries.filter(item=>item.kind!==entry.kind||item.id!==entry.id);
    next.sync={...state.sync,conflict:remaining.length?{...state.sync.conflict,details:remaining}:null,recovery:backup,lastError:''};
    return next;
  }
  return {sync,resolve,status,conflicts,INTERVAL_MS};
});
