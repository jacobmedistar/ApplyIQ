export const stages = ['New inquiry','Counselling','Document collection','Application preparation','Application submitted','Offer received','Visa preparation','Visa submitted','Visa granted','Travel booked','Enrolled','Closed'];
export const departments = ['Front office','Marketing','Business development','Sales','Counselling','Admissions','Documentation','Accounts','Visa and ticketing','Student support','Branch management','Executive'];
export const sources = ['Website','Meta ads','Instagram','Facebook','WhatsApp','Messenger','Email','Referral','Walk-in','Other'];
export const contact = input => {
  const row = Object.fromEntries(Object.entries(input).map(([key,value]) => [key,String(value).trim()]));
  row.email = row.email.toLowerCase();
  row.phone = row.phone.replace(/[\s().-]/g,'');
  if (/^[6-9]\d{9}$/.test(row.phone)) row.phone = '+91'+row.phone;
  if (!row.name || !row.topic || !/^\+[1-9]\d{7,14}$/.test(row.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw Error('Enter a name, inquiry, valid email and phone with country code.');
  return row;
};
export const hoursFrom = (time,hours) => new Date(new Date(time).getTime()+hours*3600000).toISOString();
export function intake(state,input,now=new Date().toISOString()) {
  const row = contact(input);
  const matches = state.leads.filter(lead => lead.phone === row.phone || lead.email === row.email);
  if (matches.length > 1) throw Error('The phone and email identify different records. Review both records before merging.');
  if (row.externalId && state.leads.some(lead => lead.inquiries.some(i => i.source===row.source && i.externalId===row.externalId))) throw Error('This source event has already been recorded.');
  const existing = matches[0];
  const lead = existing || {...row,id:crypto.randomUUID(),stage:stages[0],inquiries:[],audit:[],tasks:[],notes:[],created:now};
  lead.inquiries.unshift({source:row.source,topic:row.topic,name:row.name,phone:row.phone,email:row.email,at:now,externalId:row.externalId});
  if (!existing) {
    state.leads.unshift(lead);
    lead.tasks.unshift({id:crypto.randomUUID(),title:'First follow-up',due:hoursFrom(now,24),status:'Open',automatic:true});
  }
  audit(lead,existing?'Added repeat inquiry':'Created lead',now);
  return lead;
}
export function audit(lead,event,at=new Date().toISOString()) {
  lead.audit.unshift({event,at,who:'Demo operator'});
}
