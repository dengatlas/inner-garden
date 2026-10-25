(() => {
 'use strict';
 const F=globalThis.InnerGardenFlomo,$=id=>document.getElementById(id);
 let state,owner='',filter='',trash=false,editing=null,incoming=null,draftTimer;
 let editForm=null,editBody=null,suspendedEdit=null,saving=false,newImages=[],editImages=[];
 const imageDrawers=new WeakMap();
 const tagEditors=new WeakMap();let tagEditorId=0;
 function refreshTagEditors(){for(const form of document.querySelectorAll('#flomoComposer,.flomo-inline-editor'))tagEditors.get(form)?.();}
 document.addEventListener('selectionchange',refreshTagEditors);
 window.addEventListener('resize',refreshTagEditors);
 const trashSelected=new Set();
 const expanded=new Set(), collapsedTags=new Set(), collapsedPinned=new Set();
 let accountStatus={},accountRefresh=0,syncing=false,enabling=false,pendingToggle=null,lastSyncResults=null;
 const request=async(method,data={})=>{try{return await globalThis.InnerGardenFlomoChannel.request({owner,method,...data});}catch(error){if(error.backgroundUnavailable)$('flomoReconnect').hidden=false;throw error;}};
 const message=text=>$('flomoMessage').textContent=text;
 const guarded=fn=>async(...args)=>{try{await fn(...args);}catch(e){message(e.message);}};
 function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
 function button(text,fn){const node=element('button',text);node.type='button';node.addEventListener('click',guarded(fn));return node;}
 function noteLabel(note){const lines=(note?.body||'').split('\n').map(line=>line.trim());return (lines.find(line=>line.replace(/(?:^|\s)#[^\s#]+/gu,'').trim())||lines.find(Boolean)||'无正文笔记').slice(0,48);}
 function locateEdit(id){const card=[...$('flomoNotes').querySelectorAll('.flomo-note')].find(node=>node.dataset.noteId===id);if(!card)return;card.scrollIntoView({block:'center',behavior:'smooth'});card.classList.add('flomo-note-located');setTimeout(()=>card.classList.remove('flomo-note-located'),1800);card.querySelector('textarea')?.focus();}
 async function beginEdit(note){
  const pending=editing&&editing.id!==note.id?editing:suspendedEdit&&suspendedEdit.id!==note.id?suspendedEdit:null;
  if(pending){await saveDraft();showDraftConflict(pending,note);return;}
  editImages=[...(suspendedEdit?.id===note.id?suspendedEdit.images||note.images||[]:note.images||[])];
  editing={...note,...(suspendedEdit?.id===note.id?{updatedAt:suspendedEdit.updatedAt,draftBody:suspendedEdit.body}:{})};suspendedEdit=null;editForm=null;render();locateEdit(note.id);
 }
 function showDraftConflict(pending,target){
  document.querySelector('.flomo-draft-dialog')?.remove();
  const dialog=element('dialog',undefined,'flomo-draft-dialog'),title=element('h3','有一条未保存的编辑草稿');
  const source=state.notes.find(note=>note.id===pending.id)||pending;
  const sourceTime=source.createdAt?new Date(source.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'';
  const description=element('p',`草稿来自 ${sourceTime} 的笔记「${noteLabel(source)}」。要编辑「${noteLabel(target)}」，请先处理这条草稿。`);
  const actions=element('div',undefined,'flomo-draft-dialog-actions');
  actions.append(button('定位草稿',()=>{dialog.close();if(!editing){editing={...source,updatedAt:pending.updatedAt,draftBody:pending.body};editImages=[...(pending.images||source.images||[])];suspendedEdit=null;editForm=null;render();}locateEdit(pending.id);}),button('放弃草稿并编辑',async()=>{editing=null;suspendedEdit=null;editForm=null;editBody=null;await saveDraft();dialog.close();await beginEdit(target);}),button('继续当前操作',()=>dialog.close()));
  dialog.append(title,description,actions);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 function bodyView(body){
  const pre=element('pre');const pattern=/(\*\*([^*\n]+)\*\*|==([^=\n]+)==|\*([^*\n]+)\*)/g;let offset=0;
  for(const match of body.matchAll(pattern)){pre.append(document.createTextNode(body.slice(offset,match.index)));pre.append(element(match[2]?'strong':match[3]?'mark':'em',match[2]||match[3]||match[4]));offset=match.index+match[0].length;}pre.append(document.createTextNode(body.slice(offset)));return pre;
 }
 function filters(){return {tagId:$('flomoExportTag').value,start:$('flomoStart').value,end:$('flomoEnd').value,trash:$('flomoIncludeTrash').checked};}
 function count(){try{$('flomoExportCount').textContent=`已选择 ${F.select(state,filters()).notes.length} 条笔记`;}catch(e){$('flomoExportCount').textContent=e.message;}}
 function render(){
  const focusedEditor=editForm?.contains(document.activeElement)?document.activeElement:null;
  const editorSelection=focusedEditor&&typeof focusedEditor.selectionStart==='number'?[focusedEditor.selectionStart,focusedEditor.selectionEnd,focusedEditor.selectionDirection]:null;
  const noteCount=state.notes.filter(note=>!note.deletedAt&&!note.purgedAt).length;
  $('flomoLibraryLabel').textContent=(owner?'账号笔记'+(accountStatus.accountId===owner&&accountStatus.username?' · '+accountStatus.username:''):'仅保存在这台电脑')+' · '+noteCount+' 条';
  const enabled=Boolean(accountStatus.syncEnabled);
  $('flomoAccount').hidden=Boolean(accountStatus.loggedIn);
  $('flomoAccount').textContent='登录账号';
  $('flomoSyncEnabled').checked=enabling&&pendingToggle!==null?pendingToggle:enabled;
  $('flomoSyncEnabled').disabled=!accountStatus.loggedIn||!accountStatus.configured||syncing||enabling;
  $('flomoSync').disabled=!enabled||!accountStatus.loggedIn||syncing||enabling;
  $('flomoSync').textContent=syncing?'同步中…':'立即同步';
  const mode=typeof workspaceSyncMode!=='undefined'&&workspaceSyncMode==='auto'?'自动模式：页面可见时约每12分钟检查。':'手动模式：点击立即同步才交换。';
  $('flomoSyncHelp').textContent=accountStatus.authRequired?'登录已失效，请在账号入口重新登录。账号笔记仍可离线编辑，同步设置已保留。':enabled?'当前账号 '+(accountStatus.username||accountStatus.accountId)+'。'+mode+' 每类内容分别显示结果，保存先写入本机。':accountStatus.activated?'flomo 同步已暂停，账号笔记仍可编辑；重新开启后合并交换。':accountStatus.loggedIn?'开启后合并原本机记录，并下载当前账号的云端笔记。':'先在页面上方登录账号，本机记录无需登录。';
  $('flomoLocal').hidden=!owner||!accountStatus.localCount;
  const progress=InnerGardenFlomoSync.status(state);
  $('flomoSyncStatus').textContent=(accountStatus.authRequired?'等待重新登录':owner&&!enabled?'已暂停传输，修改保存在本机':progress.error?'同步未完成：'+progress.error:progress.conflict?'有 '+progress.conflictCount+' 条差异待选择，其他笔记可继续同步':!owner?'已保存到本机':progress.dirty?'有修改待同步':progress.lastSyncedAt?'已同步':'尚未同步')+(progress.lastSyncedAt?' · 最近成功交换 '+new Date(progress.lastSyncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'')+(state.sync?.lastResult?' · 接收 '+state.sync.lastResult.received+' 条新增或更新':'');
  renderConflicts();
  const selected=$('flomoExportTag').value;
  $('flomoTags').replaceChildren(button('批量整理标签',openTagBatch));$('flomoExportTag').replaceChildren(new Option('全部标签',''));
  const ordered=state.tags.map(t=>({...t,path:F.tagPath(t.id,state.tags)})).sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'));
  const tagQuery=$('flomoTagSearch').value.trim().toLowerCase();
  const drawTags=(container,rows,pinned)=>{for(const t of rows){const row=element('div',undefined,'flomo-tag-row');row.style.paddingLeft=(t.depth||0)*12+'px';
    if(t.hasChildren)row.append(button(t.collapsed?'›':'⌄',()=>{const set=pinned?collapsedPinned:collapsedTags;set.has(t.id)?set.delete(t.id):set.add(t.id);render();}));
    const b=button('# '+t.name,()=>{filter=t.id;trash=false;render();});b.className='flomo-tag-name'+(t.id===filter?' selected':'');b.title=t.path;row.append(b);
    const menu=button('⋯',()=>openTagMenu(t,row));menu.setAttribute('aria-label','管理标签 '+t.path);menu.className='flomo-tag-menu-button';row.append(menu);container.append(row);
  }};
  $('flomoPinned').replaceChildren();const pinnedRows=F.pinnedTree(state.tags,collapsedPinned,tagQuery);if(pinnedRows.length){$('flomoPinned').append(element('h3','置顶标签'));drawTags($('flomoPinned'),pinnedRows,true);}
  const flat=[];const walk=(parent,depth)=>{for(const t of ordered.filter(t=>t.parentId===parent)){const hasChildren=ordered.some(c=>c.parentId===t.id);if(!tagQuery||t.path.toLowerCase().includes(tagQuery))flat.push({...t,depth,hasChildren,collapsed:collapsedTags.has(t.id)});if(!collapsedTags.has(t.id)||tagQuery)walk(t.id,depth+1);}};walk('',0);drawTags($('flomoTags'),flat,false);
  for(const t of ordered)$('flomoExportTag').append(new Option(t.path,t.id));
  $('flomoExportTag').value=selected;
  const query=$('flomoSearch').value.toLowerCase();
  const localNotes=new Map(state.notes.map(note=>[note.id,note]));
  const notes=F.select(state,{tagId:filter,trash:true}).notes.map(note=>localNotes.get(note.id)||note).filter(n=>Boolean(n.deletedAt)===trash).filter(n=>(n.body+' '+n.tagIds.map(t=>F.tagPath(t,state.tags)).join(' ')).toLowerCase().includes(query)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt.localeCompare(a.createdAt));
  for(const id of trashSelected)if(!trash||!notes.some(note=>note.id===id))trashSelected.delete(id);
  $('flomoTrashActions').hidden=!trash;
  $('flomoPurgeSelected').disabled=!trashSelected.size;
  $('flomoTrashCount').textContent='已选 '+trashSelected.size+' 条';
  $('flomoNotes').replaceChildren();
  if(!notes.length)$('flomoNotes').append(element('p',trash?'回收站是空的':'还没有笔记，写下第一点想法吧。'));
  for(const n of notes){
   const card=element('article',undefined,'flomo-note'+(expanded.has(n.id)?' expanded':''));
   card.dataset.noteId=n.id;
   if(!trash)card.addEventListener('dblclick',guarded(async event=>{if(event.target.closest('button, input, select, textarea, .flomo-inline-editor'))return;await beginEdit(n);}));
   card.append(element('header',(n.pinned?'置顶 · ':'')+new Date(n.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),element('div',n.tagIds.map(t=>'#'+F.tagPath(t,state.tags)).join('  '),'flomo-note-tags'),bodyView(InnerGardenFlomoEditor.cardBody(n.body,n.tagIds.map(t=>F.tagPath(t,state.tags)))));
   if(n.images?.length){const gallery=element('div',undefined,'flomo-images');for(const source of n.images){if(typeof source!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(source))continue;const image=element('img');image.src=source;image.alt='笔记图片';gallery.append(image);}card.append(gallery);}else if(n.attachmentCount)card.append(element('p',`${n.attachmentCount} 张图片保存在原设备`));
   const actions=element('div',undefined,'flomo-note-actions');
   actions.append(button(expanded.has(n.id)?'收起':'展开',()=>{expanded.has(n.id)?expanded.delete(n.id):expanded.add(n.id);render();}),button('复制',()=>navigator.clipboard.writeText(n.body)));
   if(!trash){actions.append(button('编辑',()=>beginEdit(n)),button(n.pinned?'取消置顶':'置顶',()=>change(n.id,'pin')),button('移到回收站',()=>change(n.id,'delete')));}else { const selected=element('input');selected.type='checkbox';selected.checked=trashSelected.has(n.id);selected.setAttribute('aria-label','选择回收站笔记');selected.addEventListener('change',()=>{selected.checked?trashSelected.add(n.id):trashSelected.delete(n.id);$('flomoPurgeSelected').disabled=!trashSelected.size;$('flomoTrashCount').textContent='已选 '+trashSelected.size+' 条';});actions.prepend(selected);actions.append(button('恢复',()=>change(n.id,'restore')),button('彻底删除',()=>purgeNotes([n.id]))); }
   if(editing?.id===n.id){
    if(!editForm){editForm=element('form',undefined,'flomo-inline-editor');editBody=element('textarea');editBody.value=editing.draftBody??editing.body;editBody.setAttribute('aria-label','编辑笔记正文');editForm.append(editBody);setupEditor(editForm,editBody,true);editForm.addEventListener('submit',guarded(async e=>{e.preventDefault();await submitNote(true);}));}
    card.replaceChildren(editForm);
   }else card.append(actions);
   $('flomoNotes').append(card);
  }
  count();
  if(focusedEditor?.isConnected){focusedEditor.focus({preventScroll:true});if(editorSelection)focusedEditor.setSelectionRange(...editorSelection);}
  refreshTagEditors();
 }
 function openTagBatch(){
  const library=owner, selected=new Set();let confirming=false;
  const dialog=element('dialog',undefined,'flomo-tag-batch'), heading=element('h3','批量整理标签'), search=element('input'), list=element('div',undefined,'flomo-tag-batch-list'), controls=element('div',undefined,'flomo-tag-batch-tools'), remove=button('删除所选（0）',async()=>{
   if(!selected.size)return;if(library!==owner)throw new Error('笔记库已切换，请重新选择');
   if(!confirming){confirming=true;status.textContent=`确认删除 ${selected.size} 个标签？笔记正文保留，未选中的子标签移到最近保留的上级。`;remove.textContent='确认删除所选';return;}
   try{state=await request('tagsDelete',{ids:[...selected]});if(selected.has(filter))filter='';dialog.close();render();message('标签已删除，笔记正文已保留');}catch(error){status.textContent=error.message;}
  }), status=element('p');
  search.placeholder='搜索标签名称或完整路径';search.setAttribute('aria-label',search.placeholder);remove.disabled=true;
  const matches=()=>state.tags.map(t=>({...t,path:F.tagPath(t.id,state.tags)})).filter(t=>t.path.toLowerCase().includes(search.value.trim().toLowerCase())).sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'));
  const draw=()=>{list.replaceChildren();for(const tag of matches()){const label=element('label'),check=element('input');check.type='checkbox';check.checked=selected.has(tag.id);check.addEventListener('change',()=>{check.checked?selected.add(tag.id):selected.delete(tag.id);update();});label.append(check,element('span',tag.path));list.append(label);}if(!list.childNodes.length)list.append(element('p','没有匹配的标签'));update();};
  const update=()=>{confirming=false;status.textContent='';remove.textContent=`删除所选（${selected.size}）`;remove.disabled=!selected.size;};
  controls.append(button('选择搜索结果',()=>{matches().forEach(t=>selected.add(t.id));draw();}),button('清空选择',()=>{selected.clear();draw();}));
  search.addEventListener('input',draw);dialog.setAttribute('aria-label','批量整理标签');dialog.append(heading,element('p','只删除勾选的标签，笔记正文会保留。'),search,controls,list,status,button('取消',()=>dialog.close()),remove);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());draw();dialog.showModal();search.focus();
 }
 function openTagMenu(tag,row){
  const old=row.nextElementSibling;if(old?.classList.contains('flomo-tag-menu')){old.remove();return;}
  document.querySelectorAll('.flomo-tag-menu').forEach(node=>node.remove());
  const menu=element('div',undefined,'flomo-tag-menu');
  menu.append(button(tag.pinned?'取消置顶':'置顶标签',async()=>{state=await request('tagPin',{id:tag.id});render();}),button('编辑名称与层级',()=>{
   const name=element('input'),parent=element('select');name.value=tag.name;name.setAttribute('aria-label','标签名称');parent.setAttribute('aria-label','上一级标签');parent.append(new Option('顶层标签',''));
   const excluded=new Set([tag.id]);let changed=true;while(changed){changed=false;for(const item of state.tags)if(excluded.has(item.parentId)&&!excluded.has(item.id)){excluded.add(item.id);changed=true;}}
   for(const item of state.tags.filter(item=>!excluded.has(item.id)).sort((a,b)=>F.tagPath(a.id,state.tags).localeCompare(F.tagPath(b.id,state.tags),'zh-CN')))parent.append(new Option(F.tagPath(item.id,state.tags),item.id));parent.value=tag.parentId||'';
   menu.replaceChildren(element('small','标签名称'),name,element('small','上一级标签'),parent,button('保存标签',async()=>{state=await request('tagUpdate',{id:tag.id,name:name.value,parentId:parent.value});render();message('标签已更新');}),button('取消',()=>menu.remove()));name.focus();
  }),button('删除标签',()=>{
   const children=state.tags.filter(item=>item.parentId===tag.id).length;
   const prompt=element('div',undefined,'flomo-tag-delete-confirm'),status=element('small');
   prompt.append(element('strong',`删除「${F.tagPath(tag.id,state.tags)}」？`),element('p',`笔记和正文中的 #文字保留；${children} 个直接子标签移到上一层。`),status);
   const actions=element('div',undefined,'flomo-tag-delete-actions');
   actions.append(button('保留标签',()=>menu.remove()),button('确认删除',async()=>{
    try{state=await request('tagDelete',{id:tag.id});if(state.tags.some(item=>item.id===tag.id))throw new Error('标签尚未删除，请重试');if(filter===tag.id)filter='';render();message(`已删除「${tag.name}」标签；正文里的 #文字仍保留`);}
    catch(error){status.textContent=error.message;}
   }));prompt.append(actions);menu.replaceChildren(prompt);prompt.scrollIntoView({block:'nearest'});actions.querySelector('button:last-child').focus();
  }));row.after(menu);
 }
 async function change(id,action){state=await request('change',{id,action});render();}
 function draftSnapshot(){return {body:$('flomoBody').value,images:[...newImages],edit:editing?{id:editing.id,updatedAt:editing.updatedAt,body:editBody?.value??editing.draftBody??editing.body,images:[...editImages]}:suspendedEdit};}
 async function saveDraft(){clearTimeout(draftTimer);if(!state)return;await request('draft',{draft:draftSnapshot()});}
 function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(guarded(saveDraft),400);}
 async function submitNote(isEdit){
  if(saving)return;
  saving=true;clearTimeout(draftTimer);
  const locked=[...document.querySelectorAll('#flomoSection button, #flomoSection textarea')];
  const previousDisabled=locked.map(node=>node.disabled);locked.forEach(node=>node.disabled=true);
  try {
  const input=isEdit?editBody:$('flomoBody'),body=input.value,note=isEdit?editing:null;
  const draft=draftSnapshot();if(isEdit)draft.edit=null;else{draft.body='';draft.images=[];}
  state=await request('save',{note:{id:note?.id,updatedAt:note?.updatedAt,body,images:[...(isEdit?editImages:newImages)]},draft});
  if(input.value===body){if(isEdit){editing=null;editForm=null;editBody=null;suspendedEdit=null;}else{newImages=[];imageDrawers.get(formFor(false))?.();input.value='';input.dispatchEvent(new Event('input'));}}
  await saveDraft();render();message('保存成功');
  } finally { saving=false;locked.forEach((node,index)=>node.disabled=previousDisabled[index]); }
 }
 async function readImage(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if(file.size>10*1024*1024)throw new Error('单张图片不能超过 10 MB');
  const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法打开'));image.src=source;});
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(img.width,img.height));canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
  let data=canvas.toDataURL('image/jpeg',.78);for(const quality of [.6,.42,.28]){if(data.length<=650000)break;data=canvas.toDataURL('image/jpeg',quality);}if(data.length>650000)throw new Error('图片压缩后仍过大，请缩小图片后重试');return data;
 }
 function numberTool(action){
  const node=button('',action);node.title='自动编号列表';node.setAttribute('aria-label','自动编号列表');node.addEventListener('mousedown',event=>event.preventDefault());
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','22');svg.setAttribute('height','22');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(ns,'path');path.setAttribute('d','M10 5h11M10 12h11M10 19h11M3 3h1v5M2.5 8H5M2 11c0-2 4-2 4 0 0 1-4 3-4 4h4M2 17h4l-2 2c3-1 3 3 0 3H2');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);node.append(svg);return node;
 }
 function formFor(isEdit){return isEdit?editForm:$('flomoComposer');}
 function setupEditor(form,input,isEdit){
  const bar=element('div',undefined,'flomo-editor-toolbar'),tools=element('div',undefined,'flomo-editor-tools'),popup=element('div',undefined,'flomo-editor-popup'),counter=element('span',undefined,'flomo-char-count');popup.hidden=true;
  const insert=(before,after='')=>{const start=input.selectionStart,end=input.selectionEnd,text=input.value.slice(start,end);input.setRangeText(before+text+after,start,end,'end');input.focus();input.dispatchEvent(new Event('input'));};
  const tool=(label,title,action)=>{const b=button(label,action);b.title=title;b.setAttribute('aria-label',title);b.addEventListener('mousedown',e=>e.preventDefault());return b;};
  const suggestions=element('div',undefined,'flomo-tag-suggestions');suggestions.id='flomo-tag-suggestions-'+(++tagEditorId);suggestions.hidden=true;suggestions.setAttribute('role','listbox');suggestions.setAttribute('aria-label','标签候选');
  input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',suggestions.id);input.setAttribute('aria-expanded','false');
  let composing=false,dismissed=false,drawKey='',options=[],activeIndex=0;
  const context=()=>InnerGardenFlomoEditor.tagContext(input.value,input.selectionStart,input.selectionEnd);
  const hideTags=()=>{suggestions.hidden=true;drawKey='';input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const positionTags=()=>{
   if(suggestions.hidden)return;
   // A short-lived mirror measures wrapped text using the textarea's actual font and scroll position.
   const mirror=element('div'),style=getComputedStyle(input),rect=input.getBoundingClientRect(),base=form.getBoundingClientRect();
   for(const key of ['boxSizing','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','textIndent','tabSize'])mirror.style[key]=style[key];
   Object.assign(mirror.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',width:input.clientWidth+'px',whiteSpace:'pre-wrap',overflowWrap:'break-word',borderStyle:'solid'});
   mirror.textContent=input.value.slice(0,input.selectionStart);const caret=element('span','\u200b');mirror.append(caret);document.body.append(mirror);
   const point=caret.getBoundingClientRect(),origin=mirror.getBoundingClientRect(),line=Number.parseFloat(style.lineHeight)||24;
   const x=rect.left-base.left+point.left-origin.left-input.scrollLeft,y=rect.top-base.top+point.top-origin.top-input.scrollTop;
   mirror.remove();const width=Math.min(460,form.clientWidth-28);
   suggestions.style.width=width+'px';suggestions.style.left=Math.max(8,Math.min(x,form.clientWidth-width-8))+'px';
   const clip=isEdit?$('flomoNotes').getBoundingClientRect():{top:0,bottom:innerHeight},above=base.top+y-Math.max(12,clip.top)-4,below=Math.min(innerHeight-12,clip.bottom)-base.top-y-line-4;
   const up=below<Math.min(280,suggestions.scrollHeight)&&above>below;
   suggestions.style.maxHeight=Math.max(48,Math.min(280,up?above:below))+'px';
   const height=suggestions.offsetHeight;suggestions.style.top=(up?y-height-4:y+line+4)+'px';
  };
  const selectOption=index=>{activeIndex=index;options.forEach((node,i)=>node.setAttribute('aria-selected',String(i===index)));if(options[index])input.setAttribute('aria-activedescendant',options[index].id);else input.removeAttribute('aria-activedescendant');};
  const choose=path=>{if(!context())return;apply(InnerGardenFlomoEditor.tag(input.value,input.selectionStart,input.selectionEnd,path));hideTags();};
  const updateTags=()=>{
   const active=context();
   if(!state||composing||document.activeElement!==input||!active||dismissed){hideTags();return;}
   const tags=state.tags.map(t=>({...t,path:F.tagPath(t.id,state.tags)})),groups=InnerGardenFlomoEditor.tagSuggestions(tags,state.notes,active.query);
   const key=JSON.stringify([active.query,groups]);
   if(key!==drawKey){
    drawKey=key;suggestions.replaceChildren();options=[];
    for(const group of groups){if(!group.tags.length)continue;const heading=element('div',group.label,'flomo-tag-suggestion-heading');heading.setAttribute('role','presentation');suggestions.append(heading);
     for(const tag of group.tags){const row=button('',()=>choose(tag.path));row.className='flomo-tag-suggestion';row.id=suggestions.id+'-'+options.length;row.setAttribute('role','option');row.tabIndex=-1;
      const q=active.query.toLocaleLowerCase(),index=q?tag.path.toLocaleLowerCase().indexOf(q):-1;
      if(index<0)row.textContent=tag.path;else row.append(document.createTextNode(tag.path.slice(0,index)),element('mark',tag.path.slice(index,index+active.query.length)),document.createTextNode(tag.path.slice(index+active.query.length)));
      row.addEventListener('mousedown',event=>event.preventDefault());const slot=options.length;row.addEventListener('mousemove',()=>selectOption(slot));options.push(row);suggestions.append(row);
     }
    }
    if(!options.length){const empty=element('div',active.query?'没有匹配标签，继续输入可新建':'输入标签名称可新建标签','flomo-tag-suggestion-empty');empty.setAttribute('role','presentation');suggestions.append(empty);}
    selectOption(0);suggestions.scrollTop=0;
   }
   suggestions.hidden=false;input.setAttribute('aria-expanded','true');selectOption(activeIndex);positionTags();
  };
  tagEditors.set(form,updateTags);
  tools.append(tool('#','选择或新建标签',()=>{dismissed=false;popup.hidden=true;apply(InnerGardenFlomoEditor.tag(input.value,input.selectionStart,input.selectionEnd));updateTags();}));
  form.append(suggestions);
  input.addEventListener('input',()=>{dismissed=false;updateTags();});input.addEventListener('focus',updateTags);input.addEventListener('click',updateTags);input.addEventListener('scroll',positionTags);
  input.addEventListener('blur',hideTags);input.addEventListener('compositionstart',()=>{composing=true;hideTags();});input.addEventListener('compositionend',()=>{composing=false;dismissed=false;updateTags();});
  input.addEventListener('keydown',event=>{
   if(composing||event.isComposing||event.keyCode===229||suggestions.hidden||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
   if(event.key==='Escape'){event.preventDefault();dismissed=true;hideTags();}
   else if(options.length&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();selectOption((activeIndex+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);options[activeIndex].scrollIntoView({block:'nearest'});}
   else if(options.length&&['Enter','Tab'].includes(event.key)){event.preventDefault();options[activeIndex].click();}
  });
  const picker=element('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.multiple=true;picker.hidden=true;
  const gallery=element('div',undefined,'flomo-images');
  const drawImages=()=>{gallery.replaceChildren();(isEdit?editImages:newImages).forEach((source,index)=>{const item=element('div',undefined,'flomo-image-item'),img=element('img');img.src=source;img.alt='待保存图片 '+(index+1);item.append(img,button('移除',()=>{(isEdit?editImages:newImages).splice(index,1);drawImages();scheduleDraft();}));gallery.append(item);});};imageDrawers.set(form,drawImages);drawImages();
  picker.addEventListener('change',guarded(async()=>{const files=[...picker.files];picker.value='';const images=isEdit?editImages:newImages;if(files.length+images.length>9)throw new Error('每条笔记最多添加 9 张图片');const added=[];for(const file of files)added.push(await readImage(file));images.push(...added);drawImages();scheduleDraft();}));
  tools.append(tool('▧','添加本机图片',()=>picker.click()));form.append(picker,gallery);
  tools.append(tool('Aa','文字格式（Markdown）',()=>{const wasOpen=!popup.hidden&&popup.dataset.kind==='format';popup.dataset.kind='format';popup.replaceChildren(element('small','文字格式 · Markdown'));for(const [label,left,right] of [['粗体','**','**'],['斜体','*','*'],['高亮','==','==']])popup.append(button(label,()=>{insert(left,right);popup.hidden=true;}));popup.hidden=wasOpen;}));
  const apply=result=>{if(!result)return;input.value=result.value;input.focus();input.setSelectionRange(result.start,result.end);input.dispatchEvent(new Event('input'));};
  tools.append(tool('☷','无序列表',()=>apply(InnerGardenFlomoEditor.list(input.value,input.selectionStart,input.selectionEnd,false))),numberTool(()=>apply(InnerGardenFlomoEditor.list(input.value,input.selectionStart,input.selectionEnd,true))));
  input.addEventListener('keydown',event=>{if(event.defaultPrevented||event.key!=='Enter'||composing||event.isComposing||event.keyCode===229||event.shiftKey||event.ctrlKey||event.metaKey)return;const result=InnerGardenFlomoEditor.enter(input.value,input.selectionStart,input.selectionEnd);if(result){event.preventDefault();apply(result);}});
  const font=element('select');font.setAttribute('aria-label','编辑与阅读字体');for(const [value,label] of [['sans','默认'],['serif','宋体'],['kai','楷体']])font.append(new Option(label,value));font.value=localStorage.getItem('flomoFont')||'sans';font.addEventListener('change',()=>{localStorage.setItem('flomoFont',font.value);$('flomoSection').dataset.font=font.value;document.querySelectorAll('[aria-label="编辑与阅读字体"]').forEach(select=>select.value=font.value);});tools.append(font);
  bar.append(tools,counter);
  if(isEdit)bar.append(button('取消',async()=>{editing=null;suspendedEdit=null;editForm=null;editBody=null;await saveDraft();render();message('已取消编辑');}));
  else bar.append(button('取消',async()=>{if(($('flomoBody').value||newImages.length)&&!confirm('清空这条未保存的新笔记？'))return;$('flomoBody').value='';newImages=[];drawImages();input.dispatchEvent(new Event('input'));await saveDraft();message('已取消新建');}));
  const submit=element('button','➤','flomo-send');submit.type='submit';submit.title=isEdit?'保存修改':'保存新笔记';submit.setAttribute('aria-label',submit.title);submit.addEventListener('mousedown',event=>event.preventDefault());bar.append(submit);form.append(bar,popup);
  const update=()=>{counter.textContent=Array.from(input.value).length+' 字';scheduleDraft();};input.addEventListener('input',update);input.addEventListener('blur',guarded(saveDraft));counter.textContent=Array.from(input.value).length+' 字';
 }
 async function purgeNotes(ids){
  if(!ids.length)return;
  if(!confirm('彻底删除选中的 '+ids.length+' 条笔记？\n不能恢复。同步后也会从其他设备移除；已单独导出的文件不受影响。'))return;
  state=await request('purge',{ids});for(const id of ids)trashSelected.delete(id);render();message('已彻底删除；账号笔记请再同步，让其他设备也收到删除结果。');
 }
 $('flomoTrashSelectAll').addEventListener('click',()=>{const boxes=[...document.querySelectorAll('#flomoNotes input[type=checkbox]')];const all=boxes.length&&boxes.every(box=>box.checked);for(const box of boxes){box.checked=!all;box.dispatchEvent(new Event('change'));}});
 $('flomoPurgeSelected').addEventListener('click',guarded(()=>purgeNotes([...trashSelected])));
 function download(contents,format,label='flomo'){const url=URL.createObjectURL(new Blob([contents],{type:format==='json'?'application/json':'text/markdown;charset=utf-8'}));const a=element('a');a.href=url;a.download=`inner-garden-${label}-${F.dateKey(new Date())}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('flomoComposer').addEventListener('submit',guarded(async e=>{e.preventDefault();await submitNote(false);}));
 setupEditor($('flomoComposer'),$('flomoBody'),false);
 document.addEventListener('click',event=>{
  if(!editing||saving||editForm?.contains(event.target)||event.target.closest('.flomo-draft-dialog'))return;
  if(event.target.closest('.flomo-note-actions button')?.textContent==='编辑')return;
  event.preventDefault();event.stopPropagation();guarded(()=>submitNote(true))();
 },true);
 $('flomoSection').dataset.font=localStorage.getItem('flomoFont')||'sans';
 $('flomoAll').addEventListener('click',()=>{filter='';trash=false;render();});$('flomoTrash').addEventListener('click',()=>{filter='';trash=true;render();});$('flomoSearch').addEventListener('input',render);$('flomoTagSearch').addEventListener('input',render);
 for(const id of ['flomoExportTag','flomoStart','flomoEnd','flomoIncludeTrash'])$(id).addEventListener('change',count);
 $('flomoExportMd').addEventListener('click',guarded(()=>download(F.exportText(state,filters(),'md'),'md')));
 $('flomoExportJson').addEventListener('click',guarded(()=>download(F.exportText(state,filters(),'json'),'json')));
 $('flomoImport').addEventListener('click',()=>$('flomoImportFile').click());
 $('flomoImportFile').addEventListener('change',guarded(async()=>{
  const file=$('flomoImportFile').files[0];if(!file)return;if(file.size>4000000)throw new Error('文件过大，请分批导入');incoming=F.parse(await file.text(),file.name);const result=F.mergeImport(state,incoming);
  const panel=$('flomoImportPreview');panel.hidden=false;panel.replaceChildren(element('p',`${file.name}：新增 ${result.added} 条，重复 ${result.duplicates} 条，冲突副本 ${result.conflicts} 条。`),button('确认导入',async()=>{state=await request('import',{incoming});panel.hidden=true;incoming=null;render();message('导入完成');}),button('取消',()=>{incoming=null;panel.hidden=true;}));$('flomoImportFile').value='';
 }));
 async function switchLibrary(nextOwner,nextState){if(typeof nextOwner!=='string'||(nextOwner!==''&&!/^uid:[\w.:-]+$/.test(nextOwner)))throw Error('笔记库标识无效，请重新加载扩展并刷新页面；输入内容仍保留。');if(nextOwner!==owner)$('flomoScopeStatus').textContent='';owner=nextOwner;sessionStorage.setItem('flomoOwner',owner);localStorage.setItem('flomoOwner',owner);state=nextState;filter='';trash=false;restoreDraft();render();}
 async function refreshAccountStatus(){
  const ticket=++accountRefresh,next=await request('status');
  if(ticket!==accountRefresh)return;
  accountStatus=next;
  if(next.selectedOwner!==owner){await saveDraft();if(ticket!==accountRefresh)return;const target=await request('read',{owner:next.selectedOwner});if(ticket===accountRefresh)await switchLibrary(next.selectedOwner,target);}
 }
 function describeDifference(value,kind,tags){return kind==='notes'?[value.body,value.deletedAt?'在回收站':'正常笔记',value.pinned?'置顶':'未置顶','标签：'+value.tagIds.map(id=>F.tagPath(id,tags)).join('、'),'修改于 '+value.updatedAt].join('\n'):value.name+' · 上级 '+(value.parentId?F.tagPath(value.parentId,tags):'根目录')+' · '+(value.pinned?'置顶':'未置顶');}
 function renderConflicts(){
  const panel=$('flomoConflict'),entries=InnerGardenFlomoSync.conflicts(state);panel.replaceChildren();panel.hidden=!entries.length;
  for(const entry of entries){
   const row=element('div',undefined,'flomo-difference');row.append(element('strong',entry.kind==='notes'?'笔记内容不同':'标签内容不同'));
   for(const [label,value] of [['本机',entry.local],['云端',entry.remote]])row.append(element('small',label),element('pre',value?describeDifference(value,entry.kind,label==='本机'?state.tags:state.sync.conflict.remote.state.tags):'已删除'));
   const expected={local:entry.local,remote:entry.remote};
   for(const [choice,label] of [['local','采用本机'],['remote','采用云端'],...(entry.kind==='notes'?[['both','两个版本都保存']]:[])]){
    const action=button(label,async()=>{state=await request('resolve',{selection:{kind:entry.kind,id:entry.id,choice,expected}});render();await runSync();});action.disabled=syncing;row.append(action);
   }panel.append(row);
  }
 }
 async function runSync(){
  if(!accountStatus.syncEnabled){message('flomo 同步已暂停，修改保存在本机；重新开启后交换。');return;}
  if(syncing)return;syncing=true;lastSyncResults=null;render();message('正在交换已开启的账号数据…');
  try{await performWorkspaceSync(false);const result=lastSyncResults?.scopes.flomo;message(!result?'笔记尚未执行同步，请查看账号状态后重试。':result.error?'笔记同步未完成：'+result.error:result.conflict?'其他笔记已交换，仍有差异待选择。':result.dirty?'笔记已交换，仍有本机修改待同步。':'笔记同步完成 · 接收 '+result.received+' 条新增或更新');}
  finally{syncing=false;try{await refreshAccountStatus();state=await request('read');}finally{render();}}
 }
 async function enableAccountSync(){
  await saveDraft();await refreshAccountStatus();
  if(!accountStatus.loggedIn){message('请先在页面上方登录账号。');document.getElementById('weeklyWorkspace')?.scrollIntoView({behavior:'smooth'});return;}
  if(!accountStatus.configured)throw new Error('笔记同步服务尚未配置，本机内容已保留。');
  if(accountStatus.syncEnabled)return;
  const enableAccountId=accountStatus.accountId;
  const panel=$('flomoEnablePreview');
  const activate=async()=>{if(enabling)return;enabling=true;render();try{const result=await request('account',{copy:true,expectedAccountId:enableAccountId});panel.hidden=true;await refreshAccountStatus();await switchLibrary(result.owner,result.state);await runSync();}finally{enabling=false;render();}};
  if(accountStatus.activated||accountStatus.localCount===0){await activate();return;}
  panel.replaceChildren(element('p','将 '+accountStatus.localCount+' 条原本机笔记加入账号 '+(accountStatus.username||accountStatus.accountId)+'，同时下载云端笔记。原记录保留为归档，图片留在这台电脑。'),button('确认开启',activate),button('取消',()=>{panel.hidden=true;render();}));panel.hidden=false;render();
 }
 $('flomoAccount').addEventListener('click',guarded(enableAccountSync));
 $('flomoSyncEnabled').addEventListener('change',guarded(async()=>{const enabled=$('flomoSyncEnabled').checked;pendingToggle=enabled;try{if(enabled)await enableAccountSync();else{enabling=true;render();await request('pause',{expectedAccountId:accountStatus.accountId});await refreshAccountStatus();state=await request('read');message('flomo 同步已暂停，账号笔记仍可离线编辑。');}}finally{enabling=false;pendingToggle=null;if(state)render();}}));
 window.addEventListener('inner-garden-sync-result',event=>{if(event.detail.accountId!==accountStatus.accountId)return;lastSyncResults=event.detail;$('flomoScopeStatus').textContent=Object.entries(event.detail.scopes).map(([scope,result])=>({workspace:'日程 / 日课',focus:'专注记录',flomo:'笔记'}[scope]||scope)+'：'+(result.error|| (result.conflict?'有差异待选择':result.dirty?'仍有修改待同步':'已同步'))).join(' · ');});
 $('flomoSync').addEventListener('click',guarded(runSync));
 $('flomoReconnect').addEventListener('click',guarded(async()=>{const retained=!state?draftSnapshot():null;globalThis.InnerGardenFlomoChannel.reconnect();await refreshAccountStatus();state=await request('read');if(retained&&(retained.body||retained.images.length)){$('flomoBody').value=retained.body;newImages=[...retained.images];imageDrawers.get($('flomoComposer'))?.();}render();$('flomoReconnect').hidden=true;message('插件连接已恢复，输入内容保留；请核对笔记后再保存。');}));
 async function showBackup(id){
  const targetOwner=owner,snapshot=await request('backupRead',{id});if(owner!==targetOwner)throw new Error('账号已切换，请重新打开备份');
  const dialog=element('dialog',undefined,'flomo-history-dialog'),expected=snapshot.expected,choices={},differences=[];
  dialog.append(element('h3',id==='original-local'?'原本机记录归档':'备份预览'));
  if(snapshot.draft){const body=[snapshot.draft.body,snapshot.draft.edit?.body].filter(Boolean).join('\n\n');if(body)dialog.append(element('small','原库未保存草稿（不会覆盖当前草稿，可复制保留）'),element('pre',body),button('复制原草稿',()=>navigator.clipboard.writeText(body)));}
  for(const note of snapshot.notes.filter(n=>!n.purgedAt)){
   const row=element('div',undefined,'flomo-difference'),difference=snapshot.differences.find(item=>item.id===note.id),current=difference?.local;
   row.append(element('pre',note.body+(note.deletedAt?'\n（在回收站）':'')));
   if(difference){
    differences.push(note.id);row.prepend(element('small','当前内容'),element('pre',current.body),element('small','备份内容'));
    const options=element('select');options.append(new Option('请选择这条笔记的处理方式',''),new Option('保留当前','local'),new Option('采用备份','remote'),new Option('两个版本都保留','both'));options.addEventListener('change',()=>{choices[note.id]=options.value;});row.append(options);
   }dialog.append(row);
  }
  const status=element('p');dialog.append(status,button('导出 JSON',()=>download(F.exportText(snapshot,{trash:true},'json'),'json','flomo-backup')),button('合并恢复',async()=>{
   if(owner!==targetOwner)throw new Error('账号已切换，请重新打开备份');
   if(differences.some(id=>!choices[id])){status.textContent='请逐条选择不同内容的处理方式。';return;}
   try{state=await request('backupRestore',{id,expected,sourceExpected:snapshot.sourceExpected,choices});dialog.close();render();message('备份已合并，原内容另存为恢复前备份。');await showBackups();}catch(error){status.textContent=error.message;}
  }),button('关闭',()=>dialog.close()));
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 async function showBackups(){const panel=$('flomoBackupList');panel.replaceChildren();panel.hidden=false;const entries=await request('backupList');if(!entries.length)panel.append(element('p','还没有备份。'));for(const entry of entries){const row=element('div',undefined,'flomo-difference');row.append(element('p',entry.reason+' · '+(entry.createdAt?new Date(entry.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'历史时间未知')+' · '+entry.count+' 条'),button('预览 / 导出 / 恢复',()=>showBackup(entry.id)));panel.append(row);}}
 $('flomoRecovery').addEventListener('click',guarded(showBackups));
 $('flomoBackupCreate').addEventListener('click',guarded(async()=>{await request('backupCreate');await showBackups();message('本机备份已创建');}));
 $('flomoLocal').addEventListener('click',guarded(()=>showBackup('original-local')));
 $('flomoPalette').value=['green','paper','blue'].includes(localStorage.getItem('flomoPalette'))?localStorage.getItem('flomoPalette'):'green';$('flomoSection').dataset.palette=$('flomoPalette').value;
 $('flomoPalette').addEventListener('change',()=>{const palette=$('flomoPalette').value;localStorage.setItem('flomoPalette',palette);$('flomoSection').dataset.palette=palette;});
 chrome.runtime.onMessage.addListener(event=>{if(event?.channel==='tab-out-workspace-status'||event?.channel==='tab-out-workspace-update'||event?.channel==='inner-garden-flomo-library')guarded(async()=>{await refreshAccountStatus();if(state)render();})();if(event?.channel==='inner-garden-flomo-changed'&&event.owner===owner&&!saving)guarded(async()=>{state=await request('read');if(!document.querySelector('.flomo-tag-menu'))render();})();});
 function restoreDraft(){suspendedEdit=null;const d=state.draft||{},edit=d.edit||(d.id?d:null);$('flomoBody').value=d.id?'':d.body||'';const counter=$('flomoComposer').querySelector('.flomo-char-count');if(counter)counter.textContent=Array.from($('flomoBody').value).length+' 字';newImages=[...(d.images||[])];imageDrawers.get($('flomoComposer'))?.();const n=edit&&state.notes.find(n=>n.id===edit.id);editImages=[...(edit?.images||n?.images||[])];editing=n?{...n,updatedAt:edit.updatedAt,draftBody:edit.body}:null;editForm=null;editBody=null;}
 guarded(async()=>{await refreshAccountStatus();if(!state){state=await request('read');restoreDraft();}render();})();
})();
