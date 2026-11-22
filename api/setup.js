import {timingSafeEqual} from 'node:crypto';
const json = (body,status) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function POST(request) {
  const {APPLYIQ_SETUP_KEY,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY,SUPABASE_ORG_ID} = process.env;
  const setupKey = APPLYIQ_SETUP_KEY?.trim();
  if (!setupKey || setupKey.length < 32 || !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_ORG_ID) {
    return json({error:'Administrator setup is unavailable.'},503);
  }
  const expected = Buffer.from(setupKey);
  const authorization = request.headers.get('authorization') || '';
  const given = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
  if (given.length!==expected.length || !timingSafeEqual(expected,given)) return json({error:'Invalid setup key.'},401);
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
    headers:{apikey:key,...(key===SUPABASE_SERVICE_ROLE_KEY?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},
    body:body && JSON.stringify(body),signal:AbortSignal.timeout(8000)
  });
  const admin = (path,body) => call(path,SUPABASE_SERVICE_ROLE_KEY,body);
  try {
    const existing=await admin('/rest/v1/staff?select=user_id&limit=1&org_id=eq.'+encodeURIComponent(SUPABASE_ORG_ID));
    if (!existing.ok) return json({error:'Could not check administrator setup.'},502);
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
