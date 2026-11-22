import {contact,sources,stages,departments} from '../public/crm.js';

const json = (body, status = 200) => Response.json(body, {
  status, headers: {'Cache-Control': 'no-store'}
});

function config() {
  const {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ORG_ID} = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_ORG_ID) return null;
  return {url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, org: SUPABASE_ORG_ID};
}

function requestSupabase(settings, path, {token, body, headers, method = body ? 'POST' : 'GET'} = {}) {
  const options = new Headers(headers);
  options.set('apikey', settings.key);
  if (token) options.set('Authorization', 'Bearer '+token);
  if (body) options.set('Content-Type', 'application/json');
  return fetch(new URL(path, settings.url), {
    method, headers: options,
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
}

export async function POST(request) {
  const settings = config();
  if (!settings) return json({error:'Staff sign-in is unavailable.'},503);
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'create-inquiry') {
    return createInquiry(request,settings);
  }
  if (['record-contact','record-whatsapp-opt-in','revoke-whatsapp-opt-in'].includes(action)) {
    return updateInquiry(request,settings,action);
  }
  if (['update-lead','schedule-followup','complete-followup'].includes(action)) {
    return changeWorkflow(request,settings,action);
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

const isUuid = value => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);

async function updateInquiry(request,settings,action) {
  const auth=request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({error:'Sign in to continue.'},401);
  const token=auth.slice(7);
  let data;
  try {data=await request.json();} catch {return json({error:'Invalid inquiry request.'},400);}
  if (!isUuid(data?.leadId) || !isUuid(data.inquiryId)) return json({error:'Choose a valid inquiry.'},422);
  try {
    const params=leadScope(settings,data.leadId,'lead_id');
    params.set('id','eq.'+data.inquiryId);
    params.set('select','id');
    let body;
    if (action==='record-contact') {
      const user=await requestSupabase(settings,'/auth/v1/user',{token});
      if ([401,403].includes(user.status)) return json({error:'Your session has expired. Sign in again.'},401);
      if (!user.ok) return json({error:'Could not verify your identity.'},502);
      params.set('contacted_at','is.null');
      body={contacted_at:new Date().toISOString(),contacted_by:(await user.json()).id};
    } else {
      body={whatsapp_opt_in_at:action==='record-whatsapp-opt-in'?new Date().toISOString():null};
    }
    const result=await requestSupabase(settings,'/rest/v1/inquiries?'+params,{
      token,method:'PATCH',body,headers:{Prefer:'return=representation'}
    });
    if (result.status===401) return json({error:'Your session has expired. Sign in again.'},401);
    if (result.status===403) return json({error:'You cannot update this inquiry.'},403);
    if (!result.ok) return json({error:'Could not update this inquiry.'},502);
    if (!(await result.json()).length) return json({error:'The inquiry already changed or you cannot edit it. Reopen the lead.'},409);
    return json({ok:true});
  } catch {
    return json({error:'Could not confirm the inquiry update.'},502);
  }
}

function leadScope(settings,id,column='id') {
  return new URLSearchParams({org_id:'eq.'+settings.org,[column]:'eq.'+id});
}

async function changeWorkflow(request,settings,action) {
  const authorization=request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({error:'Sign in to continue.'},401);
  const token=authorization.slice(7);
  let data;
  try {data=await request.json();} catch {return json({error:'Invalid workflow request.'},400);}
  if (!isUuid(data?.leadId)) return json({error:'Choose a valid lead.'},422);
  let path, body, method='PATCH';
  if (action==='update-lead') {
    if (!stages.includes(data.stage) || !departments.includes(data.department)) return json({error:'Choose a valid stage and department.'},422);
    if (!stages.includes(data.previousStage) || !departments.includes(data.previousDepartment)) return json({error:'Reload the lead before changing it.'},422);
    const scope=leadScope(settings,data.leadId);
    scope.set('stage','eq.'+data.previousStage);
    scope.set('department','eq.'+data.previousDepartment);
    path='/rest/v1/leads?'+scope;
    body={stage:data.stage,department:data.department};
  } else if (action==='schedule-followup') {
    const title=typeof data.title==='string' ? data.title.trim() : '';
    const due=typeof data.due==='string' ? Date.parse(data.due) : NaN;
    if (!title || title.length>250 || !Number.isFinite(due) || !isUuid(data.followupId)) return json({error:'Enter a follow-up title and due date.'},422);
    const params = new URLSearchParams({on_conflict:'id'});
    path='/rest/v1/followups?'+params;
    method='POST';
    body={id:data.followupId,org_id:settings.org,lead_id:data.leadId,title,due_at:new Date(due).toISOString()};
  } else {
    if (!isUuid(data.followupId)) return json({error:'Choose a valid follow-up.'},422);
    const scope=leadScope(settings,data.leadId,'lead_id');
    scope.set('id','eq.'+data.followupId);
    path='/rest/v1/followups?'+scope;
    body={completed_at:new Date().toISOString()};
  }
  try {
    const prefer=method==='POST' ? 'resolution=ignore-duplicates,return=representation' : 'return=representation';
    const result=await requestSupabase(settings,path,{token,body,method,headers:{Prefer:prefer}});
    if (result.status===401) return json({error:'Your session has expired. Sign in again.'},401);
    if (result.status===403) return json({error:'You do not have permission to make this change.'},403);
    if (!result.ok) return json({error:'Could not save this change. Check that the workflow migration has been applied.'},502);
    const rows=await result.json();
    if (!rows.length && method!=='POST') return json({error:'This record changed or is no longer editable. Reopen the lead and try again.'},409);
    if (!rows.length) {
      const scope=leadScope(settings,data.leadId,'lead_id');
      scope.set('id','eq.'+data.followupId);
      scope.set('select','id,title,due_at');
      const existing=await requestSupabase(settings,'/rest/v1/followups?'+scope,{token});
      const [row]=existing.ok ? await existing.json() : [];
      if (row?.title!==body.title || Date.parse(row?.due_at)!==Date.parse(body.due_at)) return json({error:'Could not verify the saved follow-up.'},409);
    }
    return json({ok:true});
  } catch {
    return json({error:'Could not confirm the change. Reopen the lead to check its state.'},502);
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
    if (new URL(request.url).searchParams.get('view')==='due-contact') {
      const params=new URLSearchParams({
        select:'id,lead_id,topic,source,received_at,lead:leads!inner(id,name,department,stage,archived_at,assigned_to)',
        org_id:'eq.'+settings.org,
        contacted_at:'is.null',
        received_at:'lte.'+new Date(Date.now()-600000).toISOString(),
        'lead.archived_at':'is.null',
        'lead.stage':'not.in.(Closed,Enrolled)',
        order:'received_at.asc,id.asc',
        limit:'51'
      });
      if (staff.role!=='super_admin') {
        if (departments.includes(staff.department)) {
          params.set('lead.or','(department.eq."'+staff.department+'",assigned_to.eq.'+id+')');
        } else {
          params.set('lead.assigned_to','eq.'+id);
        }
      }
      const result=await requestSupabase(settings,'/rest/v1/inquiries?'+params,{token});
      if (!result.ok) return json({error:'Could not load inquiries waiting for contact.'},502);
      const rows=await result.json();
      return json({inquiries:rows.slice(0,50),hasMore:rows.length>50});
    }
    const leadId = new URL(request.url).searchParams.get('lead');
    if (leadId!==null) {
      if (!isUuid(leadId)) return json({error:'Choose a valid lead.'},422);
      const params=leadScope(settings,leadId);
      params.set('select','id,name,phone,email,topic,department,stage,assigned_to,inquiries(id,source,topic,phone,email,received_at,contacted_at,whatsapp_opt_in_at),followups(id,title,due_at,completed_at,automatic)');
      params.set('archived_at','is.null');
      params.set('inquiries.order','received_at.desc');
      params.set('followups.order','due_at.asc');
      const result=await requestSupabase(settings,'/rest/v1/leads?'+params,{token});
      if (!result.ok) return json({error:'Could not load this lead.'},502);
      const [lead]=await result.json();
      const canEdit=staff.role==='super_admin';
      return lead ? json({lead,canEdit,canContact:canEdit || staff.department===lead.department || lead.assigned_to===id}) :
        json({error:'Lead not found or access denied.'},404);
    }
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
