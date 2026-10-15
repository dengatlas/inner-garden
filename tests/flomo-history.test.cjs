'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {workerHarness}=require('./worker-harness.cjs');const F=require('../shared/flomo');
const note=(id,body)=>({id,body,images:['data:image/png;base64,AA=='],tagIds:[],inlineTagIds:[],createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',pinned:false,deletedAt:null});
async function setup(){const h=workerHarness({}, {enabled:false});await h.request({method:'initialize'});h.context.syntheticAccount='uid:a';vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:!!syntheticAccount,accountId:syntheticAccount});backgroundSyncClient.ensureAccessToken=async()=> 'synthetic';",h.context);h.data['innerGardenFlomo:local']={...F.empty(),notes:[note('original','original local')]};await h.message({channel:'inner-garden-flomo-request',method:'account',copy:true});const request=async(method,data={})=>{const r=await h.message({channel:'inner-garden-flomo-request',owner:'uid:a',method,...data});if(!r.ok)throw Error(r.error);return r.result;};return {h,request};}
test('archive preview never switches library or pauses enabled sync',async()=>{
 const {h,request}=await setup();await request('backupRead',{id:'original-local'});const status=await request('status');assert.equal(status.selectedOwner,'uid:a');assert.equal(status.syncEnabled,true);
 await request('local');vm.runInContext("backgroundSyncClient.sync=async()=>({state:backgroundSyncClient.getPublicState()});flomoSync=async()=>{globalThis.synced=true;};",h.context);await h.request({method:'sync'});assert.equal(h.context.synced,true);
});
test('backups keep device images, isolate accounts and cap only automatic history',async()=>{
 const {h,request}=await setup();await request('backupCreate');const initial=h.data.innerGardenFlomoBackups['uid:a'];const manual=initial.find(x=>x.manual);assert.ok(manual.snapshot.notes[0].images.length);assert.equal(manual.snapshot.sync,undefined);
 for(let i=0;i<33;i++)await vm.runInContext("flomoBackup('uid:a',flomoRead?{version:1,notes:[],tags:[]}:null,'automatic')",h.context);
 const entries=await request('backupList');assert.equal(entries.filter(x=>x.createdAt&&!x.manual).length,30);assert.ok(entries.some(x=>x.id===manual.id));
 assert.equal((await request('backupList',{owner:'uid:b'})).some(x=>x.id===manual.id),false);
});
test('restore previews enforce per-note choice, reject stale data and preserve unrelated notes',async()=>{
 const {h,request}=await setup();await request('backupCreate');const row=(await request('backupList')).find(x=>x.manual);
 h.data['innerGardenFlomo:uid:a'].notes[0].body='edited now';h.data['innerGardenFlomo:uid:a'].notes.push(note('new','unrelated'));
 const expected=F.portable(h.data['innerGardenFlomo:uid:a']);await assert.rejects(request('backupRestore',{id:row.id,expected}),/逐条选择/);
 const restored=await request('backupRestore',{id:row.id,expected,choices:{original:'remote'}});assert.equal(restored.notes.find(n=>n.id==='original').body,'original local');assert.ok(restored.notes.some(n=>n.id==='new'));assert.ok(restored.notes.find(n=>n.id==='original').images.length);
 await assert.rejects(request('backupRestore',{id:row.id,expected,choices:{original:'remote'}}),/笔记已变化/);assert.ok((await request('backupList')).some(x=>x.reason==='恢复前'));
});
test('returning to an enabled library never reimports the old local archive',async()=>{
 const {h,request}=await setup();h.data['innerGardenFlomo:local'].notes.push(note('late-original','archive edited'));
 await request('local');await request('account',{copy:true});assert.equal(h.data['innerGardenFlomo:uid:a'].notes.some(n=>n.id==='late-original'),false);
});
test('expired authentication retains selected account library, explicit sign-out returns local',async()=>{
 const {h,request}=await setup();vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:false,authRequired:true,cachedAccountId:'uid:a'});",h.context);let status=await request('status');assert.equal(status.selectedOwner,'uid:a');assert.equal(status.syncEnabled,true);
 vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:false,authRequired:false,cachedAccountId:'uid:a'});",h.context);status=await request('status');assert.equal(status.selectedOwner,'');
});
