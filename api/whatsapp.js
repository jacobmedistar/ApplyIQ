import {createHmac,timingSafeEqual} from 'node:crypto';
import {database,env,json,rpc} from '../lib/gmail.js';
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const text='Thank you for your study abroad inquiry. Your counsellor will contact you soon. If you prefer a particular time, reply with your preferred day, time and time zone.';
const approval=(db,member,job,lease,recipient)=>createHmac('sha256',db.key)
  .update(JSON.stringify(['applyiq-whatsapp-v1',db.tenant,member,job,lease,recipient,text])).digest('hex');

export async function POST(request) {
  const db=database();
  const key=env('SUPABASE_PUBLISHABLE_KEY');
  if (!db || !key) return json({error:'WhatsApp approval is unavailable.'},503);
  const authorization=request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({error:'Sign in first.'},401);
  let body;
  try {body=await request.json();} catch {return json({error:'Invalid request.'},400);}
  try {
    const identity=await fetch(new URL('/auth/v1/user',db.url),{
      headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(6000)
    });
    if (!identity.ok) return json({error:'Could not verify your staff session.'},identity.status===401?401:502);
    const {id:member}=await identity.json();
    if (!uuid(member)) return json({error:'Could not verify your staff session.'},401);
    const scope={tenant:db.tenant,member};
    if (body?.action==='list' || body?.action==='approve') {
      if (body.action==='approve' && (!Array.isArray(body.ids) || !body.ids.length ||
           body.ids.length>5 || !body.ids.every(uuid))) return json({error:'Choose between one and five messages.'},422);
      if (body.action==='list') await rpc(db,'expire_staff_whatsapp_leases',scope);
      const rows=await rpc(db,'staff_whatsapp_batch',{...scope,approved:body.action==='approve'?body.ids:null});
      return json({messages:rows.map(row=>({...row,text,
        proof:row.lease ? approval(db,member,row.job_id,row.lease,row.recipient) : undefined
      }))});
    }
    if (!uuid(body?.job) || !uuid(body.lease)) return json({error:'Invalid delivery reference.'},422);
    const lease={...scope,job:body.job,lock_id:body.lease};
    if (body.action==='check') {
      const expected=approval(db,member,body.job,body.lease,body.recipient);
      if (body.text!==text || typeof body.proof!=='string' || !/^[a-f\d]{64}$/.test(body.proof) ||
          !timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(body.proof,'hex'))) return json({allowed:false});
      return json({allowed:await rpc(db,'staff_whatsapp_can_send',lease)});
    }
    if (body.action==='finish' && ['accepted','failed','uncertain','retry','skipped'].includes(body.outcome)) {
      return json({saved:await rpc(db,'finish_browser_acknowledgement',{
        tenant:db.tenant,staff_id:member,job:body.job,lock_id:body.lease,outcome:body.outcome
      })});
    }
    return json({error:'Invalid request.'},400);
  } catch {return json({error:'WhatsApp approval could not be processed.'},502);}
}
