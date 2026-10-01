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
 function tag(value,start,end,path){
  const before=value.slice(0,start),active=/(?:^|\s)(#[^\s#]*)$/.exec(before);
  if(path===undefined&&active)return {value,start,end};
  const from=active?start-active[1].length:start;
  const tail=active?/^[^\s#]*/.exec(value.slice(end))[0].length:0;
  const prefix=from&&!/\s/.test(value[from-1])?' ':'';
  const token=prefix+'#'+(path===undefined?'':path+' ');
  return {value:value.slice(0,from)+token+value.slice(end+tail),start:from+token.length,end:from+token.length};
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
 const api={list,enter,tag,cardBody};if(typeof module==='object'&&module.exports)module.exports=api;else root.InnerGardenFlomoEditor=api;
})(globalThis);
