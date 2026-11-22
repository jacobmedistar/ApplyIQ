import {timingSafeEqual} from 'node:crypto';

const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const value = name => process.env[name]?.trim();

function emailDelivery() {
  const key=value('RESEND_API_KEY');
  const from=value('ACK_EMAIL_FROM');
  const reply=value('ACK_EMAIL_REPLY_TO');
  if (!key || !from || !reply) return null;
  const hours=value('ACK_WORKING_HOURS');
  const text=[
    'Thank you for your study abroad inquiry. A counsellor will contact you soon.',
    hours && 'Our working hours are '+hours+'.',
    'If you prefer a particular time, reply with your preferred day, time and time zone.'
  ].filter(Boolean).join('\n\n');
  return job=>fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',
      'Idempotency-Key':'applyiq-inquiry-'+job.job_id},
    body:JSON.stringify({from,to:[job.recipient],reply_to:reply,subject:'We received your study abroad inquiry',text}),
    signal:AbortSignal.timeout(7000)
  });
}

function whatsappDelivery() {
  const account=value('TWILIO_ACCOUNT_SID');
  const secret=value('TWILIO_AUTH_TOKEN');
  const sender=value('ACK_WHATSAPP_FROM');
  const template=value('ACK_WHATSAPP_CONTENT_SID');
  if (!account || !secret || !sender || !template) return null;
  return job=>fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(account)+'/Messages.json',{
    method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+secret).toString('base64')},
    body:new URLSearchParams({From:'whatsapp:'+sender,To:'whatsapp:'+job.recipient,ContentSid:template}),
    signal:AbortSignal.timeout(7000)
  });
}

async function deliver(channel,send,job) {
  try {
    const response=await send(job);
    if (response.ok) {
      const data=await response.json();
      const id=channel==='email' ? data.id : data.sid;
      if (typeof id==='string' && id) return {outcome:'accepted',external_id:id,reason:null};
      return {outcome:channel==='email'?'retry':'uncertain',external_id:null,reason:'missing_provider_id'};
    }
    const outcome=response.status===429 ? 'retry' : response.status>=500 || response.status===408
      ? (channel==='email'?'retry':'uncertain') : 'failed';
    return {outcome,external_id:null,reason:'provider_http_'+response.status};
  } catch {
    return {outcome:channel==='email'?'retry':'uncertain',external_id:null,reason:'provider_request_unconfirmed'};
  }
}

export async function POST(request) {
  const secret=value('ACK_WORKER_SECRET');
  const url=value('SUPABASE_URL');
  const key=value('SUPABASE_SERVICE_ROLE_KEY');
  const tenant=value('SUPABASE_ORG_ID');
  if (!secret || secret.length<32 || !url || !key || !tenant) return json({error:'Acknowledgement worker unavailable.'},503);
  const actual=Buffer.from(request.headers.get('Authorization') || '');
  const expected=Buffer.from('Bearer '+secret);
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return json({error:'Unauthorized.'},401);
  const channels=[['email',emailDelivery()],['whatsapp',whatsappDelivery()]].filter(([,send])=>send);
  if (!channels.length) return json({error:'No acknowledgement provider is configured.'},503);
  async function rpc(name,body) {
    const response=await fetch(new URL('/rest/v1/rpc/'+name,url),{
      method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(5000)
    });
    if (!response.ok) throw Error('Acknowledgement database request failed.');
    return response;
  }
  try {
    const results=await Promise.all(channels.map(async ([channel,send])=>{
      const jobs=await (await rpc('claim_inquiry_acknowledgements',{tenant,delivery_channel:channel})).json();
      const results=await Promise.allSettled(jobs.map(async job=>{
        const delivery=await deliver(channel,send,job);
        await rpc('finish_inquiry_acknowledgement',{job:job.job_id,lock_id:job.lease,...delivery});
        return delivery.outcome;
      }));
      return [channel,{processed:jobs.length,accepted:results.filter(r=>r.status==='fulfilled' && r.value==='accepted').length,
        unconfirmedWrites:results.filter(r=>r.status==='rejected').length}];
    }));
    return json(Object.fromEntries(results),results.some(([,r])=>r.unconfirmedWrites)?502:200);
  } catch {
    return json({error:'Could not process the acknowledgement queue.'},502);
  }
}
