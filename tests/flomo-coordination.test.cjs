const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {workerHarness}=require('./worker-harness.cjs');
const F=require('../shared/flomo');
async function ready() {
 const h=workerHarness({}, {enabled:false});await h.request({method:'initialize'});
 h.context.syntheticAccount='uid:a';
 vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:true,configured:true,accountId:syntheticAccount});backgroundSyncClient.ensureAccessToken=async()=> 'synthetic-token';",h.context);
 return h;
}
test('account library choice follows login, preserves local viewing, and never copies the previous account',async()=>{
 const h=await ready();h.data['innerGardenFlomo:uid:a']=F.empty();
 assert.equal((await h.message({channel:'inner-garden-flomo-request',method:'status'})).result.selectedOwner,'uid:a');
 await h.message({channel:'inner-garden-flomo-request',method:'local'});
 assert.equal((await h.message({channel:'inner-garden-flomo-request',method:'status'})).result.selectedOwner,'');
 h.context.syntheticAccount='uid:b';
 assert.equal((await h.message({channel:'inner-garden-flomo-request',method:'status'})).result.selectedOwner,'');
 await h.message({channel:'inner-garden-flomo-request',method:'account',owner:'uid:a',copy:true});
 assert.equal(h.data['innerGardenFlomo:uid:b'].notes.length,0);
 h.context.syntheticAccount='uid:a';
 assert.equal((await h.message({channel:'inner-garden-flomo-request',method:'status'})).result.selectedOwner,'uid:a');
});
test('workspace failure does not block opted-in flomo and repeated automatic triggers survive a worker restart',async()=>{
 const h=await ready();h.data['innerGardenFlomo:uid:a']=F.empty();
 vm.runInContext("backgroundSyncClient.sync=async()=>{throw Error('workspace offline')};flomoSync=async()=>{globalThis.flomoCalls=(globalThis.flomoCalls||0)+1};",h.context);
 const first=await h.request({method:'sync',reason:'automatic'});
 assert.equal(first.value.scopes.workspace.error,'workspace offline');assert.ok(first.value.scopes.flomo.ok);assert.equal(h.context.flomoCalls,1);
 assert.ok((await h.request({method:'sync',reason:'automatic'})).value.skipped);
 await h.request({method:'sync',reason:'manual'});assert.equal(h.context.flomoCalls,2);
 const restarted=workerHarness(h.data,{enabled:false});await restarted.request({method:'initialize'});
 restarted.context.syntheticAccount='uid:a';vm.runInContext("backgroundSyncClient.getPublicState=()=>({loggedIn:true,accountId:syntheticAccount});",restarted.context);
 assert.ok((await restarted.request({method:'sync',reason:'automatic'})).value.skipped);
});
test('unopened accounts never upload flomo during unified synchronization',async()=>{
 const h=await ready();vm.runInContext("backgroundSyncClient.sync=async()=>({state:backgroundSyncClient.getPublicState()});flomoSync=async()=>{throw Error('must not run')};",h.context);
 const result=await h.request({method:'sync',reason:'manual'});assert.equal(result.value.scopes.flomo,undefined);assert.equal(h.data['innerGardenFlomo:uid:a'],undefined);
});

test('successful exchange reports remaining workspace queue and conflicts',async()=>{
 const h=await ready();
 vm.runInContext("backgroundSyncClient.sync=async()=>({state:{...backgroundSyncClient.getPublicState(),queued:2,conflicts:1}});",h.context);
 const result=await h.request({method:'sync',reason:'manual'});
 assert.equal(result.value.scopes.workspace.ok,true);
 assert.equal(result.value.scopes.workspace.dirty,true);
 assert.equal(result.value.scopes.workspace.conflict,true);
});
