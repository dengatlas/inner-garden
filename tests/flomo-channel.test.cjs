'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function channel(status) {
 const sent=[],listeners=[];
 const context={setTimeout,clearTimeout,chrome:{runtime:{connect:()=>({onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener(){}},postMessage(message){sent.push(message);queueMicrotask(()=>listeners.forEach(fn=>fn({requestId:message.requestId,ok:true,result:message.method==='status'?status:{notes:[]}})));},disconnect(){}})}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('extension/flomo-channel.js','utf8'),context);
 return {api:context.InnerGardenFlomoChannel,sent};
}
test('new page refuses old worker status before sending any read or write',async()=>{
 const h=channel({loggedIn:true,accountId:'uid:a'});
 await assert.rejects(h.api.request({method:'save',owner:'',note:{body:'preserve input'}}),/重新加载|版本/);
 assert.deepEqual(h.sent.map(message=>message.method),['status']);
});
test('valid handshake pins subsequent writes to the versioned worker protocol',async()=>{
 const h=channel({protocolVersion:2,loggedIn:true,accountId:'uid:a',selectedOwner:'uid:a',syncEnabled:true,activated:true});
 await h.api.request({method:'read',owner:'uid:a'});await h.api.request({method:'draft',owner:'uid:a',draft:{body:'kept'}});
 assert.deepEqual(h.sent.map(message=>message.method),['status','read','draft']);assert.ok(h.sent.every(message=>message.protocolVersion===2));
});
