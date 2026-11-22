import {timingSafeEqual} from 'node:crypto';
const json = (body,status) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function POST(request) {
  const {APPLYIQ_SETUP_KEY} = process.env;
  const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const SUPABASE_ORG_ID = process.env.SUPABASE_ORG_ID?.trim().toLowerCase();
  const setupKey = APPLYIQ_SETUP_KEY?.trim();
  if (!setupKey || setupKey.length < 32 || !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_ORG_ID) {
    return json({error:'Administrator setup is unavailable.'},503);
  }
  const expected = Buffer.from(setupKey);
  const authorization = request.headers.get('authorization') || '';
  const given = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
  if (given.length!==expected.length || !timingSafeEqual(expected,given)) return json({error:'Invalid setup key.'},401);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(SUPABASE_ORG_ID)) {
    return json({error:'SUPABASE_ORG_ID must contain the organization UUID from ApplyIQ, not the Supabase project reference.'},503);
  }
  let input;
  try {input=await request.json();} catch {return json({error:'Enter an email and password.'},400);}
  const email = typeof input?.email==='string' ? input.email.trim().toLowerCase() : '';
  const password = input?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 ||
      typeof password!=='string' || password.length<12 || Buffer.byteLength(password)>72) {
    return json({error:'Use a valid email and a password of at least 12 characters and at most 72 UTF-8 bytes.'},422);
  }
  const call = (path,key,body) => fetch(new URL(path,SUPABASE_URL),{
    method:body?'POST':'GET',
    headers:{apikey:key,...(key===SUPABASE_SERVICE_ROLE_KEY && !key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},
    body:body && JSON.stringify(body),signal:AbortSignal.timeout(8000)
  });
  const admin = (path,body) => call(path,SUPABASE_SERVICE_ROLE_KEY,body);
  try {
    const existing=await admin('/rest/v1/staff?select=user_id&limit=1&org_id=eq.'+encodeURIComponent(SUPABASE_ORG_ID));
    if (!existing.ok) {
      if (existing.status===401) return json({error:'Supabase rejected the backend key. Check that SUPABASE_SERVICE_ROLE_KEY belongs to the project in SUPABASE_URL.'},502);
      if (existing.status===403) return json({error:'The Supabase backend key cannot read the staff table. Check the key type and staff setup permissions.'},502);
      if (existing.status===404) return json({error:'The staff table is unavailable through the Supabase Data API. Check the project URL and schema.'},502);
      return json({error:'The Supabase staff check failed (HTTP '+existing.status+'). No administrator was created by this request.'},502);
    }
    if ((await existing.json()).length) return json({error:'Administrator setup is already complete.'},409);
    const created=await admin('/auth/v1/admin/users',{email,password,email_confirm:true,app_metadata:{applyiq_setup_org:SUPABASE_ORG_ID}});
    let user;
    if (created.ok) {
      user=await created.json();
    } else {
      // A previous request may have created Auth before the membership transaction finished.
      const retry=await call('/auth/v1/token?grant_type=password',SUPABASE_PUBLISHABLE_KEY,{email,password});
      if (retry.ok) ({user}=await retry.json());
    }
    if (!user?.id || user.app_metadata?.applyiq_setup_org!==SUPABASE_ORG_ID) {
      return json({error:'Could not create the account. Check the password policy or use a different email.'},409);
    }
    const linked=await admin('/rest/v1/rpc/bootstrap_staff',{target_org:SUPABASE_ORG_ID,target_user:user.id});
    if (!linked.ok) return json({error:'Could not finish setup. Check the setup migration and retry with the same credentials.'},502);
    if (await linked.json()!==true) return json({error:'Administrator setup is already complete.'},409);
    return json({ok:true},201);
  } catch {
    return json({error:'Setup could not finish. Retry with the same credentials.'},502);
  }
}
