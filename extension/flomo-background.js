 'use strict';
const flomoContract=globalThis.InnerGardenFlomo;
const flomoEngine=globalThis.InnerGardenFlomoSync;
let flomoWrites=Promise.resolve(),flomoNetwork=null;
const flomoKey=owner=>'innerGardenFlomo:'+ (owner||'local');
function flomoWrite(fn){const result=flomoWrites.then(fn);flomoWrites=result.catch(()=>{});return result;}
async function flomoRead(owner){const key=flomoKey(owner),stored=(await chrome.storage.local.get(key))[key];if(stored && (stored.version!==1 || !Array.isArray(stored.notes) || !Array.isArray(stored.tags)))throw new Error('笔记库无法读取，请保留本机数据');return stored || flomoContract.empty();}
async function flomoSave(owner,state,notify=true){await chrome.storage.local.set({[flomoKey(owner)]:state});if(notify)chrome.runtime.sendMessage({channel:'inner-garden-flomo-changed',owner}).catch(()=>{});return state;}
async function flomoAuth(){await (workspaceReady ||= initializeBackgroundWorkspace());if(workspaceAccountTransition)await workspaceAccountTransition;const state=backgroundSyncClient.getPublicState();if(!state.loggedIn || !state.accountId)throw new Error('请先登录账号');return {accountId:state.accountId,accessToken:await backgroundSyncClient.ensureAccessToken()};}
async function flomoSync(owner){
 if(flomoNetwork)throw new Error('已有 flomo 同步进行中，请稍后重试');
 flomoNetwork=(async()=>{
 const auth=await flomoAuth();if(auth.accountId!==owner)throw new Error('请打开当前登录账号的笔记库');
 const base=String((globalThis.TAB_OUT_SYNC_CONFIG||{}).flomoApiBaseUrl||'').replace(/\/+$/,'');if(!base)throw new Error('flomo 云端接口尚未配置，笔记已保存在本机');
 const guard=()=>{if(backgroundSyncClient.getPublicState().accountId!==owner)throw new Error('账号已切换，同步已暂停');};
 await flomoEngine.sync({read:()=>flomoRead(owner),mutate:fn=>flomoWrite(async()=>{guard();return flomoSave(owner,fn(await flomoRead(owner)));}),request:(action,data)=>globalThis.InnerGardenFlomoTransport.exchange(async(part,value)=>{guard();const response=await fetch(base+'/'+part,{method:'POST',headers:{Authorization:'Bearer '+auth.accessToken,'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();guard();if(!response.ok)throw new Error(result.message || 'flomo 同步失败');return result;},action,data)});
 })().finally(()=>{flomoNetwork=null;});return flomoNetwork;
}
async function flomoHandle(message){
 const owner=String(message.owner||''),method=message.method;
 if(method==='read')return flomoWrite(async()=>{const state=await flomoRead(owner);if(globalThis.InnerGardenPromptSeed?.apply(state,flomoContract))await flomoSave(owner,state,false);return state;});
 if(method==='status'){await (workspaceReady ||= initializeBackgroundWorkspace());const account=backgroundSyncClient.getPublicState();return {loggedIn:Boolean(account.loggedIn),accountId:account.accountId||'',username:account.username||'',configured:Boolean((globalThis.TAB_OUT_SYNC_CONFIG||{}).flomoApiBaseUrl),localCount:(await flomoRead('')).notes.length};}
 if(method==='sync'){await flomoSync(owner);return flomoRead(owner);}
 if(method==='account'){
 const auth=await flomoAuth();return flomoWrite(async()=>{let state=await flomoRead(auth.accountId);if(message.copy && owner!==auth.accountId){const source=await flomoRead(owner);state=flomoContract.mergeImport(state,flomoContract.portable(source)).state;const signature=(note,tags)=>JSON.stringify([note.body,note.createdAt,note.deletedAt||null,Boolean(note.pinned),note.tagIds.map(id=>flomoContract.tagPath(id,tags).toLowerCase()).sort()]);const targets=new Map(state.notes.map(note=>[signature(note,state.tags),note]));for(const original of source.notes){const note=targets.get(signature(original,source.tags));if(note)note.images=[...new Set([...(note.images||[]),...(original.images||[])])];}state.copyBackup={version:1,notes:source.notes,tags:source.tags};await flomoSave(auth.accountId,state);}return {owner:auth.accountId,state};});
 }
 return flomoWrite(async()=>{
 let state=await flomoRead(owner),stamp=new Date().toISOString();
 if(method==='save'){
 const input=message.note||{},body=flomoContract.normalizeBody(input.body);
 const previous=input.id?state.notes.find(n=>n.id===input.id):null;
 if(input.id&&!previous)throw new Error('这条笔记已不存在');
 if(previous&&previous.deletedAt)throw new Error('请先恢复笔记');
 const images=input.images===undefined?(previous?.images||[]):input.images;
 if(!Array.isArray(images)||images.length>9||images.some(value=>typeof value!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))||images.reduce((size,value)=>size+value.length,0)>6*1024*1024)throw new Error('图片过多或过大，请减少图片后重试');
 if(!body.trim()&&!images.length)throw new Error('先写下一点想法或添加图片');
 const changed=previous&&input.updatedAt!==previous.updatedAt;
 const inlineTagIds=flomoContract.hashtags(body).map(p=>flomoContract.ensureTag(state,p));
 const tagIds=[...new Set([...(previous?previous.tagIds.filter(t=>!(previous.inlineTagIds||[]).includes(t)):[]),...inlineTagIds])];
 const note={id:changed||!previous?flomoContract.id('memo'):previous.id,body,tagIds,inlineTagIds,images:flomoContract.clone(images),attachmentCount:Math.max(images.length,previous&&!previous.images?.length?previous.attachmentCount||0:0),createdAt:previous&&!changed?previous.createdAt:stamp,updatedAt:stamp,pinned:previous?previous.pinned:false,deletedAt:null};
 if(previous&&!changed)state.notes[state.notes.indexOf(previous)]=note;else state.notes.push(note);
 state.draft=message.draft||null;
 }else if(method==='tagUpdate'){
 const tag=state.tags.find(t=>t.id===message.id);if(!tag)throw new Error('标签不存在');
 const name=String(message.name||'').trim(),parentId=String(message.parentId||'');
 if(!name||name.length>60||/[\/#\r\n]/.test(name))throw new Error('标签名称为1至60字，不能包含斜线或换行');
 if(parentId&&!state.tags.some(t=>t.id===parentId))throw new Error('上级标签不存在');
 let cursor=parentId;const visited=new Set();while(cursor){if(cursor===tag.id||visited.has(cursor))throw new Error('不能移动到自己或下级标签中');visited.add(cursor);cursor=state.tags.find(t=>t.id===cursor)?.parentId||'';}
 if(state.tags.some(t=>t.id!==tag.id&&t.parentId===parentId&&t.name.toLowerCase()===name.toLowerCase()))throw new Error('同一层已有这个标签');
 Object.assign(tag,{name,parentId,updatedAt:stamp});
 }else if(method==='tagDelete'||method==='tagsDelete'){
 state=flomoContract.deleteTags(state,method==='tagDelete'?[message.id]:message.ids);
 }else if(method==='purge'){
 state=flomoContract.purge(state,message.ids);
 }else if(method==='tagPin'){const tag=state.tags.find(t=>t.id===message.id);if(!tag)throw new Error('标签不存在');tag.pinned=!tag.pinned;tag.updatedAt=stamp;}else if(method==='draft'){state.draft=message.draft;}
 else if(method==='change'){
 const note=state.notes.find(n=>n.id===message.id);if(!note||note.purgedAt)throw new Error('笔记已彻底删除');
 if(message.action==='pin')note.pinned=!note.pinned;
 else if(message.action==='delete')note.deletedAt=stamp;
 else if(message.action==='restore')note.deletedAt=null;
 else throw new Error('未知笔记操作');note.updatedAt=stamp;
 }else if(method==='import'){const old=flomoContract.portable(state);state=flomoContract.mergeImport(state,message.incoming).state;state.importBackup=old;}
 else if(method==='resolve')state=flomoEngine.resolve(state,message.choice);
 else throw new Error('未知 flomo 操作');
 flomoContract.validate(flomoContract.portable(state));return flomoSave(owner,state,method!=='draft');
 });
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.channel!=='inner-garden-flomo-request')return;
 if(sender.id!==chrome.runtime.id || (sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))){respond({ok:false,error:'来源无效'});return;}
 flomoHandle(message).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
});

// A dedicated connection routes replies only from this worker, independent of other open pages.
if(chrome.runtime.onConnect)chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='inner-garden-flomo')return;
 const sender=port.sender;
 if(sender?.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(''))){port.disconnect();return;}
 port.onMessage.addListener(message=>{
  const reply=value=>{try{port.postMessage({requestId:message.requestId,...value});}catch(_){}};
  flomoHandle(message).then(result=>reply({ok:true,result}),error=>reply({ok:false,error:error.message}));
 });
});
