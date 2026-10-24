(() => {
  'use strict';
  const F=globalThis.InnerGardenFocusRecords;
  let state=null,view='day';
  const request=async(method,data={})=>{const response=await chrome.runtime.sendMessage({channel:'inner-garden-focus-request',method,...data});if(!response?.ok)throw Error(response?.error||'专注记录暂时无法读取');return response.result;};
  const root=document.createElement('div');root.className='focus-record-tools';
  root.innerHTML='<label for="focusTaskNote">本次任务</label><input id="focusTaskNote" maxlength="80" placeholder="可选，记录这次专注的事情"><button id="focusRecordsOpen" class="focus-btn">专注记录</button>';
  document.getElementById('focusTimer').after(root);
  const dialog=document.createElement('dialog');dialog.className='focus-record-dialog';dialog.id='focusRecordsDialog';
  dialog.innerHTML='<div class="focus-record-heading"><h2>专注记录</h2><button id="focusRecordsClose" class="focus-btn">关闭</button></div><p id="focusRecordOwner"></p><label><input type="checkbox" id="focusRecordsSync"> 同步当前账号的完成记录与统计</label><p id="focusSyncNotice">手动立即同步；自动模式下前台每12分钟检查。计时器各自在本机运行。</p><button id="focusClaimHistory" class="focus-btn" hidden>认领本机历史</button><div class="focus-record-filters"><button data-focus-view="day">今日</button><button data-focus-view="week">本周</button><button data-focus-view="month">本月</button><input type="date" id="focusRecordDate" aria-label="查看日期"><button id="focusRecordsSyncNow">立即同步</button></div><p id="focusRecordSummary"></p><div id="focusRecordList"></div><p id="focusRecordFeedback" role="status"></p>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),feedback=text=>$('focusRecordFeedback').textContent=text;
  $('focusRecordDate').value=F.dateKey(Date.now());
  function render(){
    if(!state)return;
    const stats=F.statistics(state.records,view,$('focusRecordDate').value||F.dateKey(Date.now()));
    dialog.querySelectorAll('[data-focus-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.focusView===view)));
    $('focusRecordOwner').textContent=state.owner?'当前账号 · '+(workspaceSyncClient?.getPublicState().username||state.owner):'访客 · 仅保存在本机';
    $('focusRecordsSync').checked=state.enabled;$('focusRecordsSync').disabled=!state.owner;
    $('focusRecordsSyncNow').disabled=!state.owner||!state.enabled;
    $('focusClaimHistory').hidden=!state.owner||!state.preview.count;
    $('focusClaimHistory').textContent='认领本机历史（'+state.preview.count+' 条）';
    $('focusRecordSummary').textContent=stats.start+' 起 · '+stats.count+' 次 · '+Math.round(stats.durationMs/60000)+' 分钟';
    const list=$('focusRecordList');list.replaceChildren();
    if(!stats.items.length){const empty=document.createElement('p');empty.textContent='这段时间还没有完成记录';list.append(empty);}
    for(const record of stats.items){const row=document.createElement('article'),heading=document.createElement('strong'),body=document.createElement('p');row.className='focus-record-row';heading.textContent=record.dateKey+' · '+({focus:'专注',custom:'自定义',countup:'正计时'}[record.mode])+' · '+Math.round(record.durationMs/60000)+' 分钟';body.textContent=new Date(record.startedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})+'–'+new Date(record.completedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})+(record.note?' · '+record.note:'');row.append(heading,body);list.append(row);}
  }
  async function refresh(){state=await request('read');render();const input=$('focusTaskNote');input.disabled=Boolean(focusTimerState.sessionId);if(document.activeElement!==input)input.value=focusTimerState.note||'';}
  const guarded=fn=>async()=>{try{await fn();}catch(error){feedback(error.message);showToast(error.message);}};
  $('focusRecordsOpen').addEventListener('click',guarded(async()=>{await refresh();dialog.showModal();}));
  $('focusRecordsClose').addEventListener('click',()=>dialog.close());
  $('focusRecordDate').addEventListener('change',render);
  dialog.querySelectorAll('[data-focus-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.focusView;render();}));
  $('focusRecordsSync').addEventListener('change',guarded(async()=>{
    const enabled=$('focusRecordsSync').checked,owner=state.owner,preview=state.preview;
    if(enabled){const answer=await focusConfirmation('开启专注同步',preview);if(!answer){render();return;}}
    state=await request('enable',{enabled,expectedAccountId:owner,ids:enabled?preview.ids:[]});render();
    if(enabled){await performWorkspaceSync(false);await refresh();}
  }));
  $('focusClaimHistory').addEventListener('click',guarded(async()=>{const preview=state.preview,owner=state.owner;if(await focusConfirmation('认领本机历史',preview)){state=await request('claim',{expectedAccountId:owner,ids:preview.ids});render();feedback('历史已加入当前账号，可点击立即同步');}}));
  $('focusRecordsSyncNow').addEventListener('click',guarded(async()=>{await performWorkspaceSync(false);await refresh();}));
  $('focusTaskNote').addEventListener('blur',guarded(async()=>{await focusTimerRequest('note',{note:$('focusTaskNote').value});}));
  async function focusConfirmation(title,preview){
    const confirmation=document.createElement('dialog');confirmation.className='focus-record-dialog';const heading=document.createElement('h3'),description=document.createElement('p'),yes=document.createElement('button'),no=document.createElement('button');heading.textContent=title;description.textContent=preview.count?preview.count+' 条本机历史（'+preview.start+' 至 '+preview.end+'）将加入当前账号，其他账号不会自动带入。':'开启当前账号的已完成专注历史与统计同步，进行中的计时仍留在本机。';yes.textContent='确认';no.textContent='取消';confirmation.append(heading,description,yes,no);document.body.append(confirmation);
    return new Promise(resolve=>{let confirmed=false;yes.onclick=()=>{confirmed=true;confirmation.close();};no.onclick=()=>confirmation.close();confirmation.onclose=()=>{confirmation.remove();resolve(confirmed);};confirmation.showModal();});
  }
  window.addEventListener('inner-garden-focus-recorded',()=>refresh().catch(error=>feedback(error.message)));
  window.addEventListener('inner-garden-sync-result',event=>{if(state?.owner!==event.detail.accountId)return;const result=event.detail.scopes.focus;if(result)feedback(result.error||(result.dirty?'有完成记录待同步':'专注记录同步完成'));});
  chrome.runtime.onMessage.addListener(message=>{if(message?.channel==='inner-garden-focus-update')focusTimerRequest().then(refresh).catch(error=>feedback(error.message));else if(['tab-out-workspace-update','tab-out-workspace-status'].includes(message?.channel))refresh().catch(error=>feedback(error.message));});
  refresh().catch(error=>feedback(error.message));
})();
