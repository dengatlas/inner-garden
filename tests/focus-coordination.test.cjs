'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {workerHarness}=require('./worker-harness.cjs');
async function ready(){const h=workerHarness({}, {enabled:false});await h.request({method:'initialize'});h.context.fixtureOwner='uid:a';h.context.fixtureClock=Date.UTC(2026,9,24,2);vm.runInContext("Date.now=()=>fixtureClock;backgroundSyncClient.getPublicState=()=>({loggedIn:Boolean(fixtureOwner),accountId:fixtureOwner});",h.context);return h;}
async function focus(h,method,data={}){const response=await h.message({channel:'inner-garden-focus-request',method,...data});if(!response.ok)throw Error(response.error);return response.result;}
test('worker records each completed timer once across tabs, retains first owner and excludes paused time',async()=>{
 const h=await ready();await focus(h,'timer',{action:'note',note:'跨端任务'});const started=await focus(h,'timer',{action:'toggle'});
 h.context.fixtureClock+=60000;await focus(h,'timer',{action:'toggle'});h.context.fixtureClock+=120000;await focus(h,'timer',{action:'toggle'});
 h.context.fixtureOwner='uid:b';h.context.fixtureClock+=1440000;
 const results=await Promise.all([focus(h,'timer'),focus(h,'timer')]);assert.equal(results.filter(r=>r.completed).length,1);
 const store=h.data.innerGardenFocusAccounts;assert.equal(store.accounts['uid:a'].length,1);assert.equal(store.accounts['uid:a'][0].id,started.timer.sessionId);assert.equal(store.accounts['uid:a'][0].durationMs,1500000);assert.equal(store.accounts['uid:a'][0].startedAt,Date.UTC(2026,9,24,2));assert.equal(store.accounts['uid:a'][0].note,'跨端任务');assert.equal((await focus(h,'read')).records.length,0);
 h.context.fixtureOwner='uid:a';assert.equal((await focus(h,'read')).records.length,1);
});
test('abandoning and completing a break never create focus records; guest claim is explicit and unique',async()=>{
 const h=await ready();h.context.fixtureOwner='';await focus(h,'timer',{action:'toggle'});await focus(h,'timer',{action:'reset'});assert.equal((await focus(h,'read')).records.length,0);
 await focus(h,'timer',{action:'toggle'});h.context.fixtureClock+=1500000;await focus(h,'timer');
 const guest=await focus(h,'read');assert.equal(guest.preview.count,1);await focus(h,'timer',{action:'toggle'});h.context.fixtureClock+=300000;await focus(h,'timer');assert.equal((await focus(h,'read')).records.length,1);
 h.context.fixtureOwner='uid:a';assert.equal((await focus(h,'read')).records.length,0);await focus(h,'enable',{enabled:true,expectedAccountId:'uid:a',ids:guest.preview.ids});assert.equal((await focus(h,'read')).records.length,1);
 h.context.fixtureOwner='uid:b';await focus(h,'enable',{enabled:true,expectedAccountId:'uid:b',ids:guest.preview.ids});assert.equal((await focus(h,'read')).records.length,0);
});
test('focus actions reject late account previews and normal timer reads do not broadcast writes',async()=>{
 const h=await ready();await assert.rejects(focus(h,'enable',{enabled:true,expectedAccountId:'uid:other'}),/账号已切换/);
 const count=h.broadcasts.length;await focus(h,'timer');await focus(h,'timer');assert.equal(h.broadcasts.length,count);
});
