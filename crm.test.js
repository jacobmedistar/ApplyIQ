import test from 'node:test';
import assert from 'node:assert/strict';
import {intake} from './public/crm.js';
const input = {name:'Sample Student',phone:'98765 43210',email:'SAMPLE@example.com',topic:'MBA',source:'Website'};
const now = '2026-11-22T00:00:00.000Z';
test('normalizes contacts, retains repeat inquiries, schedules exactly one first follow-up',()=>{
  const state={leads:[]};
  const lead=intake(state,input,now);
  assert.equal(lead.phone,'+919876543210');
  assert.equal(lead.email,'sample@example.com');
  assert.equal(intake(state,{...input,source:'WhatsApp',topic:'MSc'},now),lead);
  assert.deepEqual(lead.inquiries.map(i=>[i.source,i.topic,i.at]),[['WhatsApp','MSc',now],['Website','MBA',now]]);
  assert.equal(lead.tasks.length,1);
  assert.equal(lead.tasks[0].due,'2026-11-23T00:00:00.000Z');
  assert.equal(lead.audit.length,2);
});
test('blocks incomplete contacts, conflicting identities and replayed source events',()=>{
  const state={leads:[]};
  assert.throws(()=>intake(state,{...input,email:''},now),/valid email/);
  intake(state,{...input,externalId:'campaign-1'},now);
  assert.throws(()=>intake(state,{...input,externalId:'campaign-1'},now),/already/);
  intake(state,{...input,email:'another@example.com',phone:'+919000000000'},now);
  assert.throws(()=>intake(state,{...input,email:'another@example.com'},now),/different records/);
  assert.equal(state.leads.length,2);
});
