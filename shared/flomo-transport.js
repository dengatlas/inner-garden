(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InnerGardenFlomoTransport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const CHUNK=12000;
 async function exchange(send,action,data){
  if(action==='push'){
   const chunks=splitText(JSON.stringify(data.state)),parts=chunks.length;
   if(parts>128)throw Error('笔记库超过本次同步容量，本机记录已保留');
   for(let i=0;i<parts;i++)await send('push-part',{opId:data.opId,index:i,parts,content:chunks[i]});
   const result=await send('push',{opId:data.opId,baseRevision:data.baseRevision,uploadParts:parts});
   // The server may retain permanent-deletion markers omitted by an older client.
   // Always acknowledge the committed snapshot, never assume it equals the upload.
   return hydrate(send,result);
  }
  return hydrate(send,await send(action,data));
 }
 async function hydrate(send,result){
  if(result.state)return result;
  if(!result.snapshotId||!Number.isSafeInteger(result.parts)||result.parts<1||result.parts>128)throw Error('云端快照信息不完整，请重试');
  const chunks=[];
  for(let i=0;i<result.parts;i++){
   const part=await send('read-part',{snapshotId:result.snapshotId,index:i});
   if(part.index!==i||typeof part.content!=='string')throw Error('云端分块读取未完成，请重试');
   chunks.push(part.content);
  }
  return {...result,state:JSON.parse(chunks.join(''))};
 }
 function splitText(text){const chunks=[];for(let start=0;start<text.length;){let end=Math.min(start+CHUNK,text.length);if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;chunks.push(text.slice(start,end));start=end;}return chunks;}
 return {CHUNK,exchange,splitText};
});
