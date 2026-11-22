import {timingSafeEqual} from 'node:crypto';
import {database,google,env,json,rpc,unseal,oauthToken,tokenContext,messageBody} from '../lib/gmail.js';

export async function POST(request) {
  const secret=env('ACK_WORKER_SECRET');
  const db=database();
  let options;
  try {options=google();} catch {return json({error:'Gmail worker unavailable.'},503);}
  if (!secret || secret.length<32 || !db || !options) return json({error:'Gmail worker unavailable.'},503);
  const actual=Buffer.from(request.headers.get('Authorization') || '');
  const expected=Buffer.from('Bearer '+secret);
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return json({error:'Unauthorized.'},401);
  try {
    const jobs=await rpc(db,'claim_gmail_acknowledgements',{tenant:db.tenant});
    const results=await Promise.allSettled(jobs.map(job=>processJob(db,options,job)));
    const unconfirmed=results.filter(r=>r.status==='rejected').length;
    return json({processed:jobs.length,accepted:results.filter(r=>r.status==='fulfilled' && r.value==='accepted').length,unconfirmed},
      unconfirmed ? 502 : 200);
  } catch {
    return json({error:'Could not process the Gmail queue.'},502);
  }
}

async function processJob(db,options,job) {
  const lease={tenant:db.tenant,member:job.staff_id,job:job.job_id,lock_id:job.lease};
  const payload=async()=> (await rpc(db,'gmail_acknowledgement_payload',lease))[0];
  let outcome='retry';
  let externalId=null;
  let attempted=false;
  let reason=null;
  try {
    const current=await payload();
    if (!current) {
      outcome='skipped';
    } else {
      const refresh=unseal(options.key,tokenContext(db.tenant,job.staff_id),current.sealed_token);
      const token=await oauthToken(options,{grant_type:'refresh_token',refresh_token:refresh});
      if (!token.ok) {
        outcome=token.status===429 || token.status>=500?'retry':'failed';
        reason='oauth_http_'+token.status;
      } else {
        const {access_token:accessToken}=await token.json();
        if (!accessToken) throw Error('Missing access token');
        const latest=await payload();
        if (!latest) {
          outcome='skipped';
        } else if (latest.sealed_token===current.sealed_token && latest.sender===current.sender) {
          const raw=messageBody(latest.sender,latest.recipient);
          attempted=true;
          const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
            method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
            body:JSON.stringify({raw}),signal:AbortSignal.timeout(8000)
          });
          if (response.ok) {
            externalId=(await response.json()).id;
            outcome=externalId?'accepted':'uncertain';
          } else {
            reason='gmail_http_'+response.status;
            outcome=response.status===429?'retry':response.status>=500 || response.status===408?'uncertain':'failed';
          }
        }
      }
    }
  } catch {
    outcome=attempted?'uncertain':'retry';
    reason=attempted?'gmail_send_unconfirmed':'gmail_preflight_failed';
  }
  const saved=await rpc(db,'finish_gmail_acknowledgement',{...lease,outcome,external_id:externalId || null,reason});
  if (!saved) throw Error('Could not confirm the queue update');
  return outcome;
}
