import {contact,sources} from '../public/crm.js';

const json = (body, status = 200) => Response.json(body, {
  status, headers: {'Cache-Control': 'no-store'}
});

function config() {
  const {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ORG_ID} = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_ORG_ID) return null;
  return {url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, org: SUPABASE_ORG_ID};
}

function requestSupabase(settings, path, {token, body, headers} = {}) {
  const options = new Headers(headers);
  options.set('apikey', settings.key);
  if (token) options.set('Authorization', 'Bearer '+token);
  if (body) options.set('Content-Type', 'application/json');
  return fetch(new URL(path, settings.url), {
    method: body ? 'POST' : 'GET', headers: options,
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
}

export async function POST(request) {
  const settings = config();
  if (!settings) return json({error:'Staff sign-in is unavailable.'},503);
  if (new URL(request.url).searchParams.get('action') === 'create-inquiry') {
    return createInquiry(request,settings);
  }
  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return json({error:'Enter an email and password.'},400);
  }
  const {email,password} = credentials || {};
  if (typeof email !== 'string' || typeof password !== 'string' ||
      !email.trim() || !password || email.length > 320 || password.length > 1024) {
    return json({error:'Enter an email and password.'},400);
  }
  try {
    const result = await requestSupabase(settings,'/auth/v1/token?grant_type=password',{body:{email:email.trim(),password}});
    if (result.status === 429) return json({error:'Too many sign-in attempts. Try again later.'},429);
    if (result.status === 400 || result.status === 401) return json({error:'Sign-in failed. Check your email and password.'},401);
    if (!result.ok) return json({error:'Staff sign-in is unavailable.'},502);
    const {access_token: token} = await result.json();
    if (!token) return json({error:'Staff sign-in is unavailable.'},502);
    return json({token});
  } catch {
    return json({error:'Staff sign-in is unavailable.'},502);
  }
}

async function createInquiry(request,settings) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({error:'Sign in to continue.'},401);
  const token = authorization.slice(7);
  let row;
  try {
    const input = await request.json();
    const fields = ['name','phone','email','topic','source','externalId'];
    if (!fields.every(key=>typeof input[key]==='string' && input[key].trim() && input[key].length<=500)) throw Error();
    row = contact(Object.fromEntries(fields.map(key=>[key,input[key]])));
    if (!sources.includes(row.source) || !/^[0-9a-f-]{36}$/i.test(row.externalId)) throw Error();
  } catch {
    return json({error:'Enter a name, phone with country code, email, inquiry topic and source.'},422);
  }
  try {
    const result = await requestSupabase(settings,'/rest/v1/rpc/record_staff_inquiry',{token,body:{
      tenant:settings.org,student_name:row.name,canonical_phone:row.phone,student_email:row.email,
      inquiry_topic:row.topic,inquiry_source:row.source,source_id:row.externalId
    }});
    const data = await result.json();
    if (result.status===401) return json({error:'Your session has expired. Sign in again.'},401);
    if (result.status===403) return json({error:'Only an active super administrator can add inquiries.'},403);
    if (data?.code==='23505') return json({error:'The phone and email match different leads. Review the existing records.'},409);
    if (result.status===404) return json({error:'Staff intake is unavailable. Check the staff intake migration.'},503);
    if (!result.ok || typeof data!=='string') return json({error:'Could not add the inquiry. Retry this submission.'},502);
    return json({leadId:data},201);
  } catch {
    return json({error:'Could not confirm the inquiry was saved. Retry this submission.'},502);
  }
}

export async function GET(request) {
  const settings = config();
  if (!settings) return json({error:'Staff workspace is unavailable.'},503);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({error:'Sign in to continue.'},401);
  const token = authorization.slice(7);
  try {
    const userResult = await requestSupabase(settings,'/auth/v1/user',{token});
    if ([401,403].includes(userResult.status)) return json({error:'Your session has expired. Sign in again.'},401);
    if (!userResult.ok) return json({error:'Could not verify staff access.'},502);
    const {id} = await userResult.json();
    const org = encodeURIComponent(settings.org);
    const membership = await requestSupabase(settings,
      '/rest/v1/staff?select=department,role&active=eq.true&org_id=eq.'+org+'&user_id=eq.'+encodeURIComponent(id),{token});
    if (!membership.ok) return json({error:'Could not verify staff access.'},502);
    const [staff] = await membership.json();
    if (!staff) return json({error:'This account does not have access to ApplyIQ.'},403);
    const page = Number(new URL(request.url).searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return json({error:'Invalid page.'},400);
    const params = new URLSearchParams({
      select:'id,name,topic,department,stage,created_at', org_id:'eq.'+settings.org,
      archived_at:'is.null', order:'created_at.desc,id.desc', limit:'51', offset:String((page-1)*50)
    });
    const result = await requestSupabase(settings,'/rest/v1/leads?'+params,{token});
    if (!result.ok) return json({error:'Could not load leads.'},502);
    const leads = await result.json();
    return json({staff,leads:leads.slice(0,50),hasNext:leads.length>50});
  } catch {
    return json({error:'The staff workspace is unavailable.'},502);
  }
}
