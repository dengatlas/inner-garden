'use strict';
const FLOMO_BACKUPS_KEY='innerGardenFlomoBackups';
async function flomoBackup(owner,state,reason,options={}) {
 const collections=(await chrome.storage.local.get(FLOMO_BACKUPS_KEY))[FLOMO_BACKUPS_KEY]||{};
 const key=owner||'local',items=collections[key]||[],id=options.id||flomoContract.id('backup');
 if(items.some(item=>item.id===id))return;
 const snapshot=flomoContract.clone({version:1,notes:state.notes,tags:state.tags});
 const entry={id,owner,reason,createdAt:options.legacy?null:new Date().toISOString(),manual:Boolean(options.manual),snapshot};
 let count=0;collections[key]=[entry,...items].filter(item=>item.manual||item.createdAt===null||++count<=30);
 await chrome.storage.local.set({[FLOMO_BACKUPS_KEY]:collections});
}
async function flomoArchiveLegacy(owner,state) {
 for(const [id,snapshot] of [['recovery',state.sync?.recovery],['import',state.importBackup],['copy',state.copyBackup]]) {
  if(snapshot)await flomoBackup(owner,snapshot,'历史修改前备份（'+id+'）',{id:'legacy-'+id,legacy:true});
 }
}
async function flomoHistoryHandle(owner,message) {
 const state=await flomoRead(owner);
 await flomoArchiveLegacy(owner,state);
 if(message.method==='backupCreate')await flomoBackup(owner,state,'手动备份',{manual:true});
 const collections=(await chrome.storage.local.get(FLOMO_BACKUPS_KEY))[FLOMO_BACKUPS_KEY]||{};
 const items=collections[owner||'local']||[];
 if(message.method==='backupList'||message.method==='backupCreate') {
  const summaries=items.map(({snapshot,...entry})=>({...entry,count:snapshot.notes.filter(n=>!n.purgedAt).length}));
  if(owner){const local=await flomoRead('');summaries.push({id:'original-local',owner:'',reason:'原本机记录（归档）',createdAt:null,count:local.notes.filter(n=>!n.purgedAt).length,archive:true});}
  return summaries;
 }
 const snapshot=message.id==='original-local'&&owner ? await flomoRead('') : items.find(item=>item.id===message.id)?.snapshot;
 if(!snapshot)throw new Error('这份备份已不存在，请刷新列表');
 const plan=flomoRestorePlan(state,snapshot,message.choices||{});
 if(message.method==='backupRead')return {version:1,notes:snapshot.notes,tags:snapshot.tags,expected:flomoContract.portable(state),sourceExpected:flomoContract.portable(snapshot),differences:plan.differences};
 if(message.method!=='backupRestore')throw new Error('未知备份操作');
 if(!flomoContract.equal(message.expected,flomoContract.portable(state)))throw new Error('笔记已变化，请重新预览后恢复');
 if(message.sourceExpected&&!flomoContract.equal(message.sourceExpected,flomoContract.portable(snapshot)))throw new Error('归档已变化，请重新预览后恢复');
 if(state.sync?.pending)throw new Error('请先重试上一次同步，再恢复备份');
 if(plan.differences.some(item=>!['local','remote','both'].includes(message.choices?.[item.id])))throw new Error('请逐条选择备份中不同的笔记');
 flomoContract.validate(flomoContract.portable(plan.next));
 await flomoBackup(owner,state,'恢复前');return flomoSave(owner,plan.next);
}
function flomoRestorePlan(state,snapshot,choices) {
 const differences=[];
 const incoming=flomoContract.portable(snapshot),next=flomoContract.clone(state);
 // Reconcile tag paths without replacing unrelated current tag metadata.
 next.tags=flomoContract.mergeImport({...next,notes:[]},{...incoming,notes:[]}).state.tags;
 for(const source of snapshot.notes) {
  if(source.purgedAt)continue;
  const mapped={...source,tagIds:source.tagIds.map(id=>flomoContract.ensureTag(next,flomoContract.tagPath(id,snapshot.tags))),inlineTagIds:(source.inlineTagIds||[]).map(id=>flomoContract.ensureTag(next,flomoContract.tagPath(id,snapshot.tags)))};
  const index=next.notes.findIndex(note=>note.id===source.id),existing=next.notes[index];
  if(existing?.purgedAt)continue;
  if(!existing){next.notes.push(mapped);continue;}
  if(flomoContract.equal(flomoContract.portable({version:1,notes:[existing],tags:[]}).notes,flomoContract.portable({version:1,notes:[mapped],tags:[]}).notes))continue;
  differences.push({id:source.id,local:existing,remote:mapped});
  const choice=choices[source.id];
  if(choice==='remote')next.notes[index]=mapped;
  else if(choice==='both')next.notes.push({...mapped,id:flomoContract.id('restore')});

 }
 return {next,differences};
}
