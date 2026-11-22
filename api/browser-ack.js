import {createHash,timingSafeEqual} from 'node:crypto';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const uuid=value=>typeof value==='string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);

export async function POST(request) {
  const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ORG_ID,BROWSER_ACK_WORKERS}=process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !uuid(SUPABASE_ORG_ID) || !BROWSER_ACK_WORKERS) return json({error:'Browser worker unavailable.'},503);
  let workers;
  try { workers=JSON.parse(BROWSER_ACK_WORKERS); } catch { return json({error:'Browser worker unavailable.'},503); }
  if (!Array.isArray(workers)) return json({error:'Browser worker unavailable.'},503);
  const bearer=request.headers.get('Authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/i.test(bearer)) return json({error:'Unauthorized.'},401);
  const digest=createHash('sha256').update(bearer.slice(7)).digest();
  const worker=workers.find(entry=>uuid(entry?.staffId) && /^[a-f0-9]{64}$/i.test(entry?.tokenHash || '') &&
    timingSafeEqual(Buffer.from(entry.tokenHash,'hex'),digest));
  if (!worker) return json({error:'Unauthorized.'},401);
  let input;
  try {input=await request.json();} catch {return json({error:'Invalid request.'},400);}
  const data={tenant:SUPABASE_ORG_ID,staff_id:worker.staffId};
  let fn;
  if (input?.action==='claim' && ['email','whatsapp'].includes(input.channel)) {
    fn='claim_browser_acknowledgement';
    data.delivery_channel=input.channel;
  } else if (uuid(input?.job) && uuid(input.lease)) {
    data.job=input.job;
    data.lock_id=input.lease;
    if (input.action==='check') fn='browser_acknowledgement_can_send';
    if (input.action==='finish' && ['accepted','retry','failed','skipped','uncertain'].includes(input.outcome)) {
      fn='finish_browser_acknowledgement';
      data.outcome=input.outcome;
    }
  }
  if (!fn) return json({error:'Invalid request.'},400);
  try {
    const key=SUPABASE_SERVICE_ROLE_KEY.trim();
    const result=await fetch(new URL('/rest/v1/rpc/'+fn,SUPABASE_URL.trim()),{
      method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},
      body:JSON.stringify(data),signal:AbortSignal.timeout(8000)
    });
    if (!result.ok) return json({error:'Browser queue unavailable.'},502);
    return json({result:await result.json()});
  } catch {return json({error:'Browser queue unavailable.'},502);}
}
