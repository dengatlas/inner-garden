const test = require('node:test');
const assert = require('node:assert/strict');
const { workerHarness, clone } = require('./worker-harness.cjs');
function setup(initial = {}) {
  const worker = workerHarness(initial);
  const calls = [];
  worker.context.fetch = async (url, options) => {
    calls.push({url, options});
    const result = url.endsWith('/device/code')
      ? {device_code:'PRIVATE-DEVICE',user_code:'ABCD-EFGH',expires_in:300,interval:5}
      : url.endsWith('/token') ? {access_token:'PRIVATE-ACCESS',refresh_token:'PRIVATE-REFRESH',expires_in:3600,sub:'phone-uid'}
      : {sub:'phone-uid',name:'same-nickname'};
    return {ok:true,status:200,text:async()=>JSON.stringify(result)};
  };
  return {worker,calls};
}
test('worker waits for exact UID confirmation and keeps credentials out of page responses and broadcasts', async()=>{
  const {worker,calls}=setup();
  const initial=await worker.request({method:'initialize'});
  const local=clone(initial.workspace);local.logs['2026-10-01']={inspiration:'local draft'};
  await worker.request({method:'persist',base:initial.workspace,workspace:local,ownerId:''});
  const started=await worker.request({method:'startDeviceLogin'});
  const preview=await worker.request({method:'pollDeviceLogin',args:[started.value.id]});
  assert.equal(preview.state.loggedIn,false);assert.equal(worker.data.tabOutSyncAuth,undefined);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer PRIVATE-ACCESS');
  await assert.rejects(worker.request({method:'confirmDeviceLogin',args:[started.value.id,'wrong-uid']}),/核对/);
  const adopted=await worker.request({method:'confirmDeviceLogin',args:[started.value.id,'phone-uid']});
  assert.equal(adopted.state.userId,'phone-uid');assert.equal(adopted.workspace.logs['2026-10-01'].inspiration,'local draft');
  assert.doesNotMatch(JSON.stringify([started,preview,adopted,worker.broadcasts]),/PRIVATE-/);
  assert.equal(calls.length,3); // Confirmation does not silently upload anything.
  await assert.rejects(worker.request({method:'confirmDeviceLogin',args:[started.value.id,'phone-uid']}),/核对/);
});
test('new page challenge supersedes old challenge and worker restart cannot adopt its session',async()=>{
  const {worker}=setup();
  const a=await worker.request({method:'startDeviceLogin'});
  const b=await worker.request({method:'startDeviceLogin'});
  assert.equal((await worker.request({method:'pollDeviceLogin',args:[a.value.id]})).value.status,'expired');
  await worker.request({method:'cancelDeviceLogin',args:[a.value.id]});
  assert.equal((await worker.request({method:'pollDeviceLogin',args:[b.value.id]})).value.status,'authorized');
  const restarted=setup(worker.data).worker;
  assert.equal((await restarted.request({method:'pollDeviceLogin',args:[b.value.id]})).value.status,'expired');
  await assert.rejects(restarted.request({method:'confirmDeviceLogin',args:[b.value.id,'phone-uid']}),/核对/);
});
