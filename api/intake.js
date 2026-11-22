import {timingSafeEqual} from 'node:crypto';
import {contact,sources} from '../public/crm.js';

const answer = (data,status) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request) {
  const {INTAKE_SECRET,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ORG_ID} = process.env;
  if (!INTAKE_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ORG_ID) return answer({error:'Intake is unavailable'},503);
  const expected = Buffer.from('Bearer '+INTAKE_SECRET);
  const provided = Buffer.from(request.headers.get('authorization') || '');
  if (expected.length !== provided.length || !timingSafeEqual(expected,provided)) return answer({error:'Unauthorized'},401);
  let row;
  try {
    const input = await request.json();
    const fields = ['name','phone','email','topic','source','externalId'];
    if (!fields.every(key=>typeof input[key]==='string' && input[key].trim().length>0 && input[key].length<=500)) throw Error();
    row = contact(Object.fromEntries(fields.map(key=>[key,input[key]])));
    if (!sources.includes(row.source)) throw Error();
  } catch {
    return answer({error:'Provide name, phone, email, inquiry topic, source and a unique source event ID'},422);
  }
  try {
    const response = await fetch(new URL('/rest/v1/rpc/record_inquiry',SUPABASE_URL),{
      method:'POST',
      headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,
        ...(SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_') ? {} : {Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY}),
        'Content-Type':'application/json'},
      body:JSON.stringify({tenant:SUPABASE_ORG_ID,student_name:row.name,canonical_phone:row.phone,student_email:row.email,inquiry_topic:row.topic,inquiry_source:row.source,source_id:row.externalId}),
      signal:AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) return data.code==='23505' ? answer({error:'Conflicting student identity requires review'},409) : answer({error:'Unable to record inquiry'},502);
    return answer({leadId:data},200);
  } catch {
    return answer({error:'Unable to record inquiry'},502);
  }
}
