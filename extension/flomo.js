(() => {
 'use strict';
 const F=globalThis.InnerGardenFlomo,$=id=>document.getElementById(id);
 let state,owner=localStorage.getItem('flomoOwner')||sessionStorage.getItem('flomoOwner')||'',filter='',trash=false,editing=null,incoming=null,draftTimer;
 let editForm=null,editBody=null,suspendedEdit=null,saving=false,newImages=[],editImages=[];
 const imageDrawers=new WeakMap();
 const tagEditors=new WeakMap();let tagEditorId=0;
 function refreshTagEditors(){for(const form of document.querySelectorAll('#flomoComposer,.flomo-inline-editor'))tagEditors.get(form)?.();}
 document.addEventListener('selectionchange',refreshTagEditors);
 window.addEventListener('resize',refreshTagEditors);
 const trashSelected=new Set();
 const expanded=new Set(), collapsedTags=new Set(), collapsedPinned=new Set();
 let accountStatus={},accountRefresh=0;
 const request=(method,data={})=>globalThis.InnerGardenFlomoChannel.request({owner,method,...data});
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
  $('flomoLibraryLabel').textContent=owner?'同步笔记'+(accountStatus.accountId===owner&&accountStatus.username?' · '+accountStatus.username:''):'仅保存在这台电脑';
  const enabled=Boolean(owner&&accountStatus.loggedIn&&accountStatus.accountId===owner);
  $('flomoAccount').hidden=enabled; $('flomoSync').disabled=!enabled;
  $('flomoSyncHelp').textContent=enabled?'已开启。账号自动同步也会交换这些笔记；立即同步会一起同步日程与笔记。图片仅留在原设备。':accountStatus.loggedIn?'开启后，将左侧笔记加入当前账号；然后点击立即同步。原来的本机记录会保留。':'先在上方账号入口登录，再开启 flomo 同步。本机记录无需登录。';
  $('flomoLocal').hidden=!owner||!accountStatus.localCount;
  $('flomoRecovery').hidden=!(state.sync?.recovery||state.importBackup||state.copyBackup);
  const progress=InnerGardenFlomoSync.status(state);
  $('flomoSyncStatus').textContent=(!enabled?'已保存到本机':progress.conflict?'有冲突待确认':progress.error?'同步未完成：'+progress.error:progress.dirty?'有修改待同步':progress.lastSyncedAt?'已同步':'尚未同步')+(progress.lastSyncedAt?' · 上次交换 '+new Date(progress.lastSyncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'')+(state.sync?.lastResult?' · 接收 '+state.sync.lastResult.received+' 条新增或更新':'');
  $('flomoConflict').hidden=!state.sync?.conflict;
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
 async function switchLibrary(nextOwner,nextState){owner=nextOwner;sessionStorage.setItem('flomoOwner',owner);localStorage.setItem('flomoOwner',owner);state=nextState;filter='';trash=false;restoreDraft();render();}
 async function refreshAccountStatus(){
  const ticket=++accountRefresh,next=await request('status');
  if(ticket!==accountRefresh)return;
  accountStatus=next;
  if(next.selectedOwner!==owner){await saveDraft();if(ticket!==accountRefresh)return;const target=await request('read',{owner:next.selectedOwner});if(ticket===accountRefresh)await switchLibrary(next.selectedOwner,target);}
 }
 $('flomoAccount').addEventListener('click',guarded(async()=>{
  await saveDraft();await refreshAccountStatus();
  if(!accountStatus.loggedIn){message('请先在页面上方登录账号，再开启 flomo 同步。');document.getElementById('weeklyWorkspace')?.scrollIntoView({behavior:'smooth'});return;}
  if(!accountStatus.configured)throw new Error('flomo 同步服务尚未配置，本机笔记仍可正常使用。');
  if(!confirm('开启 flomo 同步？\n原本机笔记将合并到当前登录账号，原记录保留；其他账号笔记不会复制。开启账号自动同步后，前台每12分钟交换数据，也可立即同步；图片仅留本机。'))return;
  const result=await request('account',{copy:true});await switchLibrary(result.owner,result.state);message('已开启 flomo 同步，点击“立即同步”完成首次交换。');
 }));
 $('flomoLocal').addEventListener('click',guarded(async()=>{await saveDraft();const next=await request('local');await switchLibrary('',next);message('正在查看启用同步前的本机记录；这些记录不会上传。开启同步可重新合并回当前账号。');}));
 $('flomoSync').addEventListener('click',guarded(async()=>{const b=$('flomoSync');b.disabled=true;message('正在同步日程与 flomo…');try{const ok=await performWorkspaceSync(false);message(ok?'已交换数据，请查看各项同步状态':'部分内容未完成，请查看同步结果');}finally{await refreshAccountStatus();state=await request('read');render();}}));
 $('flomoReconnect').addEventListener('click',guarded(async()=>{state=await request('read');await refreshAccountStatus();render();message('后台已连接，输入内容保留，请检查笔记后再保存。');}));
 document.querySelectorAll('[data-flomo-resolution]').forEach(b=>b.addEventListener('click',guarded(async()=>{if(!confirm('确认处理冲突？本机原版本将保留为恢复副本。'))return;state=await request('resolve',{choice:b.dataset.flomoResolution});render();message('冲突已处理，请再次同步');})));
 $('flomoRecovery').addEventListener('click',guarded(()=>{const recovery=state.sync?.recovery||state.importBackup||state.copyBackup;if(!recovery)throw new Error('暂时没有恢复副本');download(F.exportText(recovery,{trash:true},'json'),'json','flomo-recovery');}));
 $('flomoPalette').value=['green','paper','blue'].includes(localStorage.getItem('flomoPalette'))?localStorage.getItem('flomoPalette'):'green';$('flomoSection').dataset.palette=$('flomoPalette').value;
 $('flomoPalette').addEventListener('change',()=>{const palette=$('flomoPalette').value;localStorage.setItem('flomoPalette',palette);$('flomoSection').dataset.palette=palette;});
 chrome.runtime.onMessage.addListener(event=>{if(event?.channel==='tab-out-workspace-status'||event?.channel==='tab-out-workspace-update'||event?.channel==='inner-garden-flomo-library')guarded(async()=>{await refreshAccountStatus();if(state)render();})();if(event?.channel==='inner-garden-flomo-changed'&&event.owner===owner&&!saving)guarded(async()=>{state=await request('read');if(!document.querySelector('.flomo-tag-menu'))render();})();});
 function restoreDraft(){suspendedEdit=null;const d=state.draft||{},edit=d.edit||(d.id?d:null);$('flomoBody').value=d.id?'':d.body||'';newImages=[...(d.images||[])];imageDrawers.get($('flomoComposer'))?.();const n=edit&&state.notes.find(n=>n.id===edit.id);editImages=[...(edit?.images||n?.images||[])];editing=n?{...n,updatedAt:edit.updatedAt,draftBody:edit.body}:null;editForm=null;editBody=null;}
 guarded(async()=>{state=await request('read');restoreDraft();render();await refreshAccountStatus();render();})();
})();
