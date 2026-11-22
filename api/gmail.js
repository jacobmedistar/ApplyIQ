import {createHash,randomBytes} from 'node:crypto';
import {database,google,env,json,rpc,seal,unseal,oauthToken,validEmail,tokenContext} from '../lib/gmail.js';

const callbackCookie='applyiq_gmail_state';
const cookie=(value,age)=>callbackCookie+'='+value+'; Path=/api/gmail; Max-Age='+age+'; Secure; HttpOnly; SameSite=Lax';

export async function POST(request) {
  const db=database();
  const publishable=env('SUPABASE_PUBLISHABLE_KEY');
  if (!db || !publishable) return json({error:'Gmail connections are unavailable.'},503);
  const token=request.headers.get('Authorization');
  if (!token?.startsWith('Bearer ')) return json({error:'Sign in first.'},401);
  let action;
  try {({action}=await request.json());} catch {return json({error:'Invalid request.'},400);}
  if (!['connect','disconnect','status'].includes(action)) return json({error:'Invalid request.'},400);
  try {
    const user=await fetch(new URL('/auth/v1/user',db.url),{
      headers:{apikey:publishable,Authorization:token},signal:AbortSignal.timeout(6000)
    });
    if (!user.ok) return json({error:'Could not verify your staff session.'},user.status===401?401:502);
    const {id}=await user.json();
    const data=await rpc(db,'staff_gmail_connection',{tenant:db.tenant,member:id,operation:action==='connect'?'status':action});
    if (action!=='connect') return json(data);
    const options=google();
    if (!options) return json({error:'Google OAuth is not configured.'},503);
    const verifier=randomBytes(32).toString('base64url');
    const state=randomBytes(24).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const stored=seal(options.key,'gmail-oauth',JSON.stringify({id,tenant:db.tenant,state,verifier,expires:Date.now()+300000}));
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({
      client_id:options.clientId,redirect_uri:options.callback.href,response_type:'code',state,
      scope:'openid email https://www.googleapis.com/auth/gmail.send',
      access_type:'offline',prompt:'consent select_account',code_challenge:challenge,code_challenge_method:'S256'
    });
    return Response.json({url:url.href},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie(stored,300)}});
  } catch {
    return json({error:'Could not manage this Gmail connection.'},502);
  }
}

export async function GET(request) {
  const db=database();
  let options;
  try {options=google();} catch {return json({error:'Google OAuth is not configured.'},503);}
  if (!db || !options) return json({error:'Google OAuth is not configured.'},503);
  const redirect=status=>new Response(null,{status:303,headers:{
    Location:'/staff.html?gmail='+status,'Set-Cookie':cookie('',0),'Cache-Control':'no-store'
  }});
  try {
    const params=new URL(request.url).searchParams;
    const encoded=(request.headers.get('Cookie') || '').split(';').map(value=>value.trim())
      .find(value=>value.startsWith(callbackCookie+'='))?.slice(callbackCookie.length+1);
    if (!encoded || !params.get('code')) return redirect('failed');
    const state=JSON.parse(unseal(options.key,'gmail-oauth',encoded));
    if (state.tenant!==db.tenant || state.expires<=Date.now() || params.get('state')!==state.state) return redirect('failed');
    const exchanged=await oauthToken(options,{code:params.get('code'),code_verifier:state.verifier,
      grant_type:'authorization_code',redirect_uri:options.callback.href});
    if (!exchanged.ok) return redirect('failed');
    const tokens=await exchanged.json();
    if (!tokens.refresh_token || !tokens.access_token ||
      !tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.send')) return redirect('failed');
    const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
      headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(6000)
    });
    if (!identity.ok) return redirect('failed');
    const {email,email_verified}=await identity.json();
    if (!validEmail(email) || email_verified!==true) return redirect('failed');
    await rpc(db,'staff_gmail_connection',{tenant:db.tenant,member:state.id,operation:'connect',mailbox:email,
      sealed_token:seal(options.key,tokenContext(db.tenant,state.id),tokens.refresh_token)});
    return redirect('connected');
  } catch {
    return redirect('failed');
  }
}
