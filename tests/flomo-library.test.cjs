'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {workerHarness}=require('./worker-harness.cjs');
const F=require('../shared/flomo');
const {splitText}=require('../shared/flomo-transport');
async function ready(initial={}) {
 const h=workerHarness(initial,{enabled:false});await h.request({method:'initialize'});
 h.context.fixtureOwner='uid:a';
 vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:true,accountId:fixtureOwner});backgroundSyncClient.ensureAccessToken=async()=> 'synthetic';",h.context);
 h.flomo=async(method,data={})=>{const result=await h.message({channel:'inner-garden-flomo-request',owner:'uid:a',method,...data});if(!result.ok)throw Error(result.error);return result.result;};return h;
}
test('legacy account cache wins over a stale local or undefined selection without importing unassigned data',async()=>{
 const cache=F.empty();cache.notes.push({id:'known',body:'account',tagIds:[],inlineTagIds:[],createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',pinned:false,deletedAt:null});
 const h=await ready({'innerGardenFlomo:uid:a':cache,innerGardenFlomoSelection:{accountId:'uid:a',owner:'undefined'},'innerGardenFlomo:undefined':{...F.empty(),draft:{body:'keep unassigned'}}});
 const status=await h.flomo('status');assert.equal(status.protocolVersion,2);assert.equal(status.selectedOwner,'uid:a');assert.equal(status.activated,true);assert.equal(status.noteCount,1);
 assert.equal(h.data['innerGardenFlomo:undefined'].draft.body,'keep unassigned');assert.equal(h.data['innerGardenFlomo:uid:a'].draft,null);
 await assert.rejects(h.flomo('read',{owner:'undefined'}),/笔记库标识/);
});
test('pause preserves visible account cache, skips manual transmission and resume never imports the archive again',async()=>{
 const h=await ready();await h.flomo('account',{copy:true});await h.flomo('save',{note:{body:'account before pause'}});
 h.data['innerGardenFlomo:local']||=F.empty();h.data['innerGardenFlomo:local'].notes.push({id:'late',body:'archive only',tagIds:[],inlineTagIds:[],createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',pinned:false,deletedAt:null});
 await h.flomo('pause');let status=await h.flomo('status');assert.equal(status.syncEnabled,false);assert.equal(status.selectedOwner,'uid:a');
 await h.flomo('save',{note:{body:'offline while paused'}});await assert.rejects(h.flomo('sync'),/已暂停/);
 vm.runInContext("backgroundSyncClient.sync=async()=>({state:backgroundSyncClient.getPublicState()});flomoSync=async()=>{throw Error('paused must not transmit')};",h.context);
 assert.equal((await h.request({method:'sync',reason:'manual'})).value.scopes.flomo,undefined);
 await h.flomo('account',{copy:true});status=await h.flomo('status');assert.equal(status.syncEnabled,true);assert.equal((await h.flomo('read')).notes.length,2);assert.ok(!h.data['innerGardenFlomo:uid:a'].notes.some(note=>note.id==='late'));
 await assert.rejects(h.flomo('save',{owner:'',note:{body:'must not enter archive'}}),/归档|账号笔记/);
});
test('old page requests cannot write while status remains available for a compatibility handshake',async()=>{
 const h=await ready();const before=JSON.stringify(h.data);
 const result=await h.message({channel:'inner-garden-flomo-request',protocolVersion:1,method:'save',owner:'',note:{body:'must not save'}});
 assert.equal(result.ok,false);assert.match(result.error,/版本|重新加载/);assert.equal(JSON.stringify(h.data),before);
 assert.equal((await h.flomo('status',{protocolVersion:1})).protocolVersion,2);
});
test('first enable survives a transient refresh failure without reverting to a local empty library',async()=>{
 const h=await ready();vm.runInContext("backgroundSyncClient.ensureAccessToken=async()=>{throw Error('refresh 503')};",h.context);
 await h.flomo('account',{copy:true});await assert.rejects(h.flomo('sync'),/refresh 503/);
 const status=await h.flomo('status');assert.equal(status.syncEnabled,true);assert.equal(status.selectedOwner,'uid:a');assert.equal((await h.flomo('read')).sync.lastError,'refresh 503');
});
test('flomo retries preserve wire bytes after a worker restart and resume previously staged legacy uploads',async()=>{
 const key='innerGardenFlomo:uid:a',stamp='2026-11-01T00:00:00Z';
 const blank={version:1,notes:[],tags:[]};
 const note={id:'retry',body:'字🍃'.repeat(6000),tagIds:[],createdAt:stamp,updatedAt:stamp};
 const local={...blank,notes:[note]};
 const upload=F.portable(local),parts=splitText(JSON.stringify(upload));
 assert.ok(parts.length>1);
 const storageRoundTrip=value=>JSON.parse(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item));

 for(const legacy of [false,true]){
  const staged=new Map();
  let remote={revision:0,state:blank},attempts=0,legacyRejections=0,commitId;
  const opId='sync-legacy-test';
  const pending={opId,baseRevision:0,state:upload};
  if(legacy)staged.set(opId+':0',parts[0]);
  const fetch=async(url,request)=>{
   const body=JSON.parse(request.body);
   const reply=(json,status=200)=>({ok:status===200,status,json:async()=>json});
   if(url.endsWith('/pull'))return reply(remote);
   if(url.endsWith('/push-part')){
    if(!legacy&&body.index===1&&attempts++===0)throw Error('network interrupted');
    const key=body.opId+':'+body.index;
    if(staged.has(key)&&staged.get(key)!==body.content){
     legacyRejections++;
     return reply({message:'同步未完成：Operation ID reused'},400);
    }
    staged.set(key,body.content);
    return reply({accepted:true,index:body.index});
   }
   assert.ok(url.endsWith('/push'));
   assert.equal(body.baseRevision,remote.revision);
   commitId=body.opId;
   const chunks=Array.from({length:body.uploadParts},(_,index)=>staged.get(commitId+':'+index));
   assert.ok(chunks.every(chunk=>typeof chunk==='string'));
   remote={revision:1,state:F.validate(JSON.parse(chunks.join('')))};
   return reply({...remote,opId:commitId,status:'accepted'});
  };
  let h=await ready({[key]:local});
  if(legacy)h.data[key].sync={base:blank,revision:0,pending,lastError:'同步未完成：Operation ID reused'};
  else {
   h.context.fetch=fetch;
   await assert.rejects(h.flomo('sync'),/network interrupted/);
  }
  const original=h.data[key].sync.pending;
  h=await ready(storageRoundTrip(h.data));
  h.context.fetch=fetch;
  await h.flomo('sync');
  assert.equal(commitId,original.opId);
  assert.equal(legacyRejections,legacy?1:0);
  assert.deepEqual(remote.state,upload);
  assert.equal(h.data[key].sync.pending,null);
  assert.equal(h.data[key].sync.lastError,'');
 }
});
test('independent focus and flomo flags survive every unified manual-sync combination',async()=>{
 for(const focusEnabled of [false,true])for(const flomoEnabled of [false,true]){
  const h=await ready({'innerGardenFlomo:uid:a':F.empty(),innerGardenFlomoSyncAccounts:{'uid:a':flomoEnabled}});
  vm.runInContext(`focusRead=async()=>({syncAccounts:{'uid:a':${focusEnabled}}});focusWorkspace=async()=>({...backgroundWorkspace,focusSessions:[]});backgroundSyncClient.sync=async()=>({state:{...backgroundSyncClient.getPublicState(),focusQueued:0},summary:{}});flomoSync=async()=>{globalThis.flomoSent=true};`,h.context);
  const scopes=(await h.request({method:'sync',reason:'manual'})).value.scopes;
  assert.equal(Boolean(scopes.focus),focusEnabled);assert.equal(Boolean(scopes.flomo),flomoEnabled);assert.equal(Boolean(h.context.flomoSent),flomoEnabled);
 }
});
test('pending focus records do not mark calendar and daily logs as still pending',async()=>{
 const h=await ready();vm.runInContext("focusRead=async()=>({syncAccounts:{'uid:a':true}});focusWorkspace=async()=>({...backgroundWorkspace,focusSessions:[]});backgroundSyncClient.sync=async()=>({state:{...backgroundSyncClient.getPublicState(),queued:2,focusQueued:2},summary:{}});",h.context);
 const scopes=(await h.request({method:'sync',reason:'manual'})).value.scopes;
 assert.equal(scopes.workspace.dirty,false);assert.equal(scopes.focus.dirty,true);
});
