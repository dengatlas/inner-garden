(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InnerGardenFocusRecords=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MODES=['focus','custom','countup'];
  const dateKey=time=>new Date(Number(time)+28800000).toISOString().slice(0,10);
  const clone=value=>JSON.parse(JSON.stringify(value));
  function normalize(value){
    if(!value||!value.id||!MODES.includes(value.mode))return null;
    const completedAt=Number(value.completedAt),durationMs=Math.round(Number(value.durationMs)),start=Number(value.startedAt);
    if(!Number.isSafeInteger(completedAt)||completedAt<=0||completedAt>8640000000000000-28800000||!Number.isSafeInteger(durationMs)||durationMs<=0)return null;
    const startedAt=Number.isFinite(start)&&start>=0&&start<completedAt?start:Math.max(0,completedAt-durationMs);
    return {id:String(value.id),mode:value.mode,startedAt,completedAt,durationMs,note:String(value.note||'').trim().slice(0,80),dateKey:dateKey(completedAt),sourceDeviceId:String(value.sourceDeviceId||'')};
  }
  function records(values){const map=new Map();for(const value of values||[]){const record=normalize(value);if(record)map.set(record.id,record);}return [...map.values()].sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id));}
  function empty(){return {version:1,accounts:{},guest:[],claims:{},syncAccounts:{},legacyBackup:null};}
  function load(value,legacy,deviceId){
    if(value&&(value.version!==1||!value.accounts||!Array.isArray(value.guest)))throw new Error('专注记录无法读取，请保留本机数据');
    const state=value?clone(value):empty();state.claims||={};state.syncAccounts||={};
    if(!state.migrated){state.legacyBackup=clone(legacy||[]);state.guest=records([...state.guest,...(legacy||[]).map(r=>({...r,sourceDeviceId:r.sourceDeviceId||deviceId}))]);state.migrated=true;}
    return state;
  }
  function list(state,owner){return records(owner?state.accounts[owner]||[]:state.guest);}
  function merge(state,owner,incoming){const next=records([...list(state,owner),...incoming]);if(owner)state.accounts[owner]=next;else state.guest=next;return next;}
  function preview(state){const items=records(state.guest).filter(r=>!state.claims[r.id]);return {ids:items.map(r=>r.id),count:items.length,start:items[0]?.dateKey||'',end:items[items.length-1]?.dateKey||''};}
  function claim(state,owner,ids){
    if(!owner)throw new Error('请先登录账号');
    const requested=new Set(ids||[]),items=list(state,'').filter(r=>requested.has(r.id)&&!state.claims[r.id]);
    // Save the account copy and claim journal in the same local transaction.
    merge(state,owner,items);for(const item of items)state.claims[item.id]=owner;
    state.guest=state.guest.filter(r=>!state.claims[r.id]);return items.length;
  }
  function statistics(values,view='day',anchor=dateKey(Date.now())){
    const day=new Date(anchor+'T00:00:00Z');let start=anchor,end;
    if(view==='week'){day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);start=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+7);}
    else if(view==='month'){day.setUTCDate(1);start=day.toISOString().slice(0,10);day.setUTCMonth(day.getUTCMonth()+1);}
    else day.setUTCDate(day.getUTCDate()+1);
    end=day.toISOString().slice(0,10);const items=records(values).filter(r=>r.dateKey>=start&&r.dateKey<end).reverse();
    return {start,end,count:items.length,durationMs:items.reduce((sum,r)=>sum+r.durationMs,0),items};
  }
  return {MODES,dateKey,normalize,records,empty,load,list,merge,preview,claim,statistics};
});
