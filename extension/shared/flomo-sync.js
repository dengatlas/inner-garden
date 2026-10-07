(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./flomo') : root.InnerGardenFlomo);
  if (typeof module === 'object' && module.exports) module.exports=api; else root.InnerGardenFlomoSync=api;
})(typeof globalThis !== 'undefined' ? globalThis : this,function(F) {
  'use strict';
  const blank = () => ({version:1,notes:[],tags:[]});
  const INTERVAL_MS = 720000;
  function status(state) {
    const metadata=state.sync || {};
    return { dirty:Boolean(metadata.pending) || !F.equal(F.portable(state),metadata.base || blank()),
      conflict:Boolean(metadata.conflict), lastSyncedAt:metadata.lastSyncedAt || '', error:metadata.lastError || '' };
  }
  // mutate is one serialized local transaction. Network never holds the local write lock.
  async function sync(adapter) {
    let state=await adapter.read();
    const before=F.portable(state);
    if (state.sync && state.sync.conflict) throw new Error('有待处理的同步冲突，请先保留两份或选择版本');
    if (state.sync && state.sync.pending) await deliver(adapter,state.sync.pending);
    const remote=await adapter.request('pull',{});
    F.validate(remote.state);
    if (!Number.isSafeInteger(remote.revision) || remote.revision < 0) throw new Error('同步版本无效');
    const previousNotes=new Map(before.notes.map(note=>[note.id,note]));
    const received=remote.state.notes.filter(note=>!F.equal(note,previousNotes.get(note.id))).length;
    let pending, conflict=false;
    await adapter.mutate(current=>{
      const metadata=current.sync || {base:blank(),revision:0};
      const merged=F.rebase(metadata.base || blank(),F.portable(current),remote.state);
      if (merged.conflicts.length) {
        current.sync={...metadata,conflict:{remote,details:merged.conflicts},pending:null}; conflict=true; return current;
      }
      const next=F.applyPortable(current,merged.state);
      pending=F.equal(merged.state,remote.state) ? null : {opId:F.id('sync'),baseRevision:remote.revision,state:merged.state};
      next.sync={...metadata,base:remote.state,revision:remote.revision,pending,conflict:null};return next;
    });
    if (conflict) throw new Error('两端修改有冲突，两个版本均已保留');
    if (pending) await deliver(adapter,pending);
    await adapter.mutate(current=>{ current.sync={...current.sync,lastSyncedAt:new Date().toISOString(),lastError:'',lastResult:{received,revision:current.sync.revision}};return current; });
    return {received,...status(await adapter.read())};
  }
  async function deliver(adapter,pending) {
    const response=await adapter.request('push',pending);
    if (response.opId!==pending.opId || !['accepted','conflict'].includes(response.status)) throw new Error('服务器尚未确认上传，请重试');
    F.validate(response.state);
    let conflict=false;
    await adapter.mutate(current=>{
      if (!current.sync || !current.sync.pending || current.sync.pending.opId!==pending.opId) throw new Error('本机同步队列发生变化，请重新同步');
      if (response.status==='conflict') {
        current.sync={...current.sync,pending:null,conflict:{remote:response,details:[{kind:'library',message:'云端在提交期间发生变化'}]}};conflict=true;return current;
      }
      // Preserve edits made after the immutable request was saved, including deletions.
      const merged=F.rebase(pending.state,F.portable(current),response.state);
      if (merged.conflicts.length) { current.sync.conflict={remote:response,details:merged.conflicts};conflict=true; }
      else current=F.applyPortable(current,merged.state);
      current.sync={...current.sync,base:response.state,revision:response.revision,pending:null};return current;
    });
    if (conflict) throw new Error('两端修改有冲突，两个版本均已保留');
  }
  function resolve(state,choice) {
    const conflict=state.sync && state.sync.conflict;
    if (!conflict) return state;
    const remote=conflict.remote;
    // Preserve a full local recovery copy before every explicit resolution.
    const backup={...F.clone(state),sync:undefined};
    if (choice==='both') state=F.mergeImport(state,remote.state).state;
    else if (choice==='remote') state=F.applyPortable(state,remote.state);
    else if (choice!=='local') throw new Error('请选择冲突处理方式');
    state.sync={base:remote.state,revision:remote.revision,pending:null,conflict:null,recovery:backup};return F.applyPortable(state,F.portable(state));
  }
  return {sync,resolve,status,INTERVAL_MS};
});
