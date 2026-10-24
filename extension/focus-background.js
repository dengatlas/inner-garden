'use strict';
const focusRecords=globalThis.InnerGardenFocusRecords;
const FOCUS_ACCOUNTS_KEY='innerGardenFocusAccounts';
async function focusDeviceId(){let id=await workspaceStorage.get('innerGardenFocusDeviceId');if(!id){id=workspaceContract.createId('focus-device');await workspaceStorage.set('innerGardenFocusDeviceId',id);}return id;}
async function focusRead(){const stored=await workspaceStorage.get(FOCUS_ACCOUNTS_KEY);return focusRecords.load(stored||null,[],await focusDeviceId());}
function focusOwner(){const state=backgroundSyncClient.getPublicState();return state.loggedIn?state.accountId:'';}
async function focusWorkspace(){const state=await focusRead(),owner=focusOwner();return {...workspaceContract.clone(backgroundWorkspace),...(owner&&state.syncAccounts[owner]?{focusSessions:focusRecords.list(state,owner)}:{})};}
async function focusApply(workspace,owner){if(Array.isArray(workspace.focusSessions)){const state=await focusRead();focusRecords.merge(state,owner,workspace.focusSessions);await workspaceStorage.set(FOCUS_ACCOUNTS_KEY,state);}const next={...workspace};delete next.focusSessions;return next;}
function focusRemaining(timer,now){return timer.isRunning?Math.max(0,timer.remainingMs-Math.max(0,now-timer.startedAt)):timer.remainingMs;}
async function focusControl(message){
  const now=Date.now(),owner=focusOwner();let state;
  let timer=await workspaceStorage.get('focusTimer')||{mode:'focus',durationMs:1500000,remainingMs:1500000,isRunning:false,startedAt:null,customMinutes:15};
  const initialMode=timer.mode,initialId=timer.sessionId;let completed=false;
  function reset(mode=timer.mode){const durationMs=mode==='custom'?(timer.customMinutes||15)*60000:mode==='break'?300000:1500000;timer={mode,durationMs,remainingMs:durationMs,isRunning:false,startedAt:null,customMinutes:timer.customMinutes||15,note:'',sessionId:'',ownerAccountId:'',sessionStartedAt:null};}
  if(timer.isRunning&&focusRemaining(timer,now)<=0){
    state=await focusRead();
    const end=timer.startedAt+timer.remainingMs;
    if(timer.mode!=='break'){
      const record=focusRecords.normalize({id:timer.sessionId||'legacy-focus-'+timer.startedAt,mode:timer.mode,durationMs:timer.durationMs,startedAt:timer.sessionStartedAt||end-timer.durationMs,completedAt:end,note:timer.note||'',sourceDeviceId:await focusDeviceId()});
      if(record)focusRecords.merge(state,timer.ownerAccountId||'',[record]);
    }
    reset(timer.mode==='break'?'focus':'break');completed=true;
  }
  const action=message.action||'read';
  if(action==='toggle'){
    if(timer.isRunning){timer.remainingMs=focusRemaining(timer,now);timer.startedAt=null;timer.isRunning=false;}
    else {if(!timer.sessionId){const legacyElapsed=Math.max(0,timer.durationMs-timer.remainingMs);timer.sessionId=workspaceContract.createId('focus');timer.sessionStartedAt=now-legacyElapsed;timer.ownerAccountId=legacyElapsed?'':owner;}timer.isRunning=true;timer.startedAt=now;}
  }else if(action==='mode'){
    if(['focus','break','custom'].includes(message.mode))reset(message.mode);
  }else if(action==='custom'){
    timer.customMinutes=Math.max(1,Math.min(180,Math.round(Number(message.minutes)||15)));reset('custom');
  }else if(action==='reset')reset();
  else if(action==='note'&&!timer.sessionId)timer.note=String(message.note||'').slice(0,80);
  if(action!=='read'||completed)await chrome.storage.local.set({...(state?{[FOCUS_ACCOUNTS_KEY]:state}:{}),focusTimer:timer});
  if(action!=='read'||completed)chrome.runtime.sendMessage({channel:'inner-garden-focus-update'}).catch(()=>{});
  return {timer,completed,completedMode:completed?initialMode:'',completedId:completed?initialId:''};
}
async function focusHandle(message){
  if(message.method==='timer')return focusControl(message);
  const owner=focusOwner(),state=await focusRead();
  if(message.method==='enable'||message.method==='claim'){
    if(!owner||owner!==message.expectedAccountId)throw new Error('账号已切换，请重新确认');
    if(message.method==='claim'||message.enabled)focusRecords.claim(state,owner,message.ids||[]);
    if(message.method==='enable')state.syncAccounts[owner]=Boolean(message.enabled);
    await workspaceStorage.set(FOCUS_ACCOUNTS_KEY,state);
  }
  if(!['read','enable','claim'].includes(message.method))throw new Error('不支持的专注操作');
  return {owner,enabled:Boolean(owner&&state.syncAccounts[owner]),records:focusRecords.list(state,owner),preview:focusRecords.preview(state)};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.channel!=='inner-garden-focus-request')return;
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('')))return;
  const task=workspaceControls.then(async()=>{await (workspaceReady||=initializeBackgroundWorkspace());return serializeWorkspaceWrite(()=>focusHandle(message));});
  workspaceControls=task.catch(()=>{});
  task.then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
});
