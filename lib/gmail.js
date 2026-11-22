import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export const env=name=>process.env[name]?.trim();

export function database() {
  const url=env('SUPABASE_URL');
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  const tenant=env('SUPABASE_ORG_ID');
  return url && key && tenant ? {url,key,tenant} : null;
}

export function google() {
  const clientId=env('GMAIL_CLIENT_ID');
  const secret=env('GMAIL_CLIENT_SECRET');
  const origin=env('GMAIL_CALLBACK_ORIGIN');
  const encryption=env('GMAIL_TOKEN_KEY');
  if (!clientId || !secret || !origin || !/^[a-f0-9]{64}$/i.test(encryption || '')) return null;
  const callback=new URL('/api/gmail',origin);
  if (callback.protocol!=='https:') return null;
  return {clientId,secret,callback,key:Buffer.from(encryption,'hex')};
}

export function seal(key,context,value) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([iv, cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}

export function unseal(key,context,value) {
  const data=Buffer.from(value,'base64url');
  const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]).toString('utf8');
}

export async function rpc(db,name,body) {
  const result=await fetch(new URL('/rest/v1/rpc/'+name,db.url),{
    method:'POST',headers:{apikey:db.key,...(db.key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+db.key}),'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(6000)
  });
  if (!result.ok) throw Error('Database request failed');
  return result.status===204 ? null : result.json();
}

export function oauthToken(options,parameters) {
  return fetch('https://oauth2.googleapis.com/token',{
    method:'POST',body:new URLSearchParams({client_id:options.clientId,client_secret:options.secret,...parameters}),
    signal:AbortSignal.timeout(7000)
  });
}

export const validEmail=value=>typeof value==='string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
export const tokenContext=(org,staff)=>'gmail:'+org+':'+staff;

export function messageBody(sender,recipient,workingHours=env('ACK_WORKING_HOURS')) {
  if (!validEmail(sender) || !validEmail(recipient)) throw Error('Invalid mailbox');
  const body=['Thank you for your study abroad inquiry. Your counsellor will contact you soon.',
    workingHours && 'Our working hours are '+workingHours+'.',
    'If you prefer a particular time, reply with your preferred day, time and time zone.'].filter(Boolean).join('\r\n\r\n');
  return Buffer.from([
    'From: '+sender,'To: '+recipient,'Subject: We received your study abroad inquiry','MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
    Buffer.from(body).toString('base64').match(/.{1,76}/g).join('\r\n')
  ].join('\r\n')).toString('base64url');
}
