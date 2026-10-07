(function(root){
 'use strict';
 function list(value,start,end,ordered){
  const from=start?value.lastIndexOf('\n',start-1)+1:0,selectionEnd=end>start&&value[end-1]==='\n'?end-1:end,to=value.indexOf('\n',selectionEnd),until=to<0?value.length:to;
  const lines=value.slice(from,until).split('\n');
  const text=lines.map((line,i)=>(ordered?(i+1)+'. ':'- ')+line.replace(/^\s*(?:\d+\. |[-*] )/,'')).join('\n');
  return {value:value.slice(0,from)+text+value.slice(until),start:from,end:from+text.length};
 }
 function enter(value,start,end){
  if(start!==end)return null;
  const from=start?value.lastIndexOf('\n',start-1)+1:0,line=value.slice(from,start),match=/^(\s*)(\d+\.|[-*]) (.*)$/.exec(line);
  if(!match)return null;
  if(!match[3]&& (start===value.length||value[start]==='\n'))return {value:value.slice(0,from)+value.slice(start),start:from,end:from};
  const prefix=match[1]+(/\d/.test(match[2])?(Number.parseInt(match[2],10)+1)+'.':match[2])+' ',text='\n'+prefix;
  return {value:value.slice(0,start)+text+value.slice(end),start:start+text.length,end:start+text.length};
 }
 function tagContext(value,start,end=start){
  if(start!==end)return null;
  const active=/(#[^\s#，。！？；：、,!?;:()（）\[\]【】{}<>“”「」"'`]*)$/u.exec(value.slice(0,start));
  if(!active)return null;
  const tail=/^[^\s#，。！？；：、,!?;:()（）\[\]【】{}<>“”「」"'`]*/u.exec(value.slice(end))[0];
  return {start:start-active[1].length,end:end+tail.length,query:active[1].slice(1)};
 }
 function tagSuggestions(tags,notes,query=''){
  const stats=new Map(tags.map(t=>[t.id,{...t,count:0,last:''}]));
  for(const note of notes){
   if(note.deletedAt||note.purgedAt)continue;
   for(const id of new Set(note.tagIds)){const item=stats.get(id);if(!item)continue;item.count++;const stamp=note.updatedAt||note.createdAt||'';if(stamp>item.last)item.last=stamp;}
  }
  const rows=[...stats.values()].filter(t=>t.path),alpha=(a,b)=>a.path.localeCompare(b.path,'zh-CN'),frequency=(a,b)=>b.count-a.count||b.last.localeCompare(a.last)||alpha(a,b);
  const q=query.toLocaleLowerCase();
  if(q)return [{label:'匹配标签',tags:rows.filter(t=>t.path.toLocaleLowerCase().includes(q)).sort((a,b)=>Number(!a.path.toLocaleLowerCase().startsWith(q))-Number(!b.path.toLocaleLowerCase().startsWith(q))||frequency(a,b))}];
  const used=rows.filter(t=>t.count);
  if(!used.length)return [{label:'已有标签',tags:rows.sort(alpha)}];
  return [{label:'常用标签',tags:[...used].sort(frequency).slice(0,3)},{label:'最近标签',tags:[...used].sort((a,b)=>b.last.localeCompare(a.last)||alpha(a,b)).slice(0,5)}];
 }
 function tag(value,start,end,path){
  const active=tagContext(value,start,end);
  if(path===undefined&&active)return {value,start,end};
  const from=active?active.start:start,until=active?active.end:end;
  const prefix=!active&&from&&!/\s/.test(value[from-1])?' ':'';
  const token=prefix+'#'+(path===undefined?'':path+' ');
  const rest=path!==undefined&&value[until]===' '?until+1:until;
  return {value:value.slice(0,from)+token+value.slice(rest),start:from+token.length,end:from+token.length};
 }
 function cardBody(value,paths){
  const tags=new Set(paths.filter(Boolean));
  return String(value).split('\n').map(line=>{
   let removed=false;
   const text=line.replace(/#([^\s#，。！？；：、,!?;:()（）\[\]【】{}<>“”「」"'`]+)/gu,(whole,path)=>{
    const clean=path.replace(/[.]+$/,'');
    if(!tags.has(clean))return whole;
    removed=true;return path.slice(clean.length);
   });
   return removed&&!text.trim()?null:text;
  }).filter(line=>line!==null).join('\n').replace(/^\n+|\n+$/g,'');
 }
 const api={list,enter,tag,tagContext,tagSuggestions,cardBody};if(typeof module==='object'&&module.exports)module.exports=api;else root.InnerGardenFlomoEditor=api;
})(globalThis);
