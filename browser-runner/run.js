import {randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {deliver} from './delivery.js';

if (process.argv.includes('--generate-token')) {
  const token=randomBytes(32).toString('hex');
  console.log('Worker token (keep private): '+token);
  console.log('Worker tokenHash for Vercel: '+createHash('sha256').update(token).digest('hex'));
  process.exit(0);
}

const profile=process.env.BROWSER_PROFILE_DIR?.trim();
const channelSetting=process.env.BROWSER_ACK_CHANNELS?.trim() || 'email,whatsapp';
const channels=[...new Set(channelSetting.split(',').map(value=>value.trim()))];
const supported=channels.every(channel=>['email','whatsapp'].includes(channel));
const login=process.argv.includes('--login');
const staffEmail=process.env.BROWSER_GMAIL_ACCOUNT?.trim();
const token=process.env.BROWSER_ACK_TOKEN?.trim();
const app=process.env.BROWSER_ACK_ORIGIN?.trim();
if (!profile || !supported || (!login && (!/^https:\/\//.test(app || '') ||
  !/^[a-f0-9]{64}$/.test(token || '') || (channels.includes('email') && !staffEmail)))) {
  console.error('Check browser-runner settings in the ApplyIQ setup guide.');
  process.exit(1);
}

const {chromium}=await import('playwright-core');
const context=await chromium.launchPersistentContext(resolve(profile),{
  channel:'chrome',headless:false,locale:'en-US'
});

if (login) {
  const pages=context.pages();
  const first=pages[0] || await context.newPage();
  for (const [index,channel] of channels.entries()) {
    const page=index===0 ? first : await context.newPage();
    const url=channel==='email'?'https://mail.google.com/':'https://web.whatsapp.com/';
    await page.goto(url,{waitUntil:'domcontentloaded'});
  }
  console.log('Sign in to the intended accounts in this window, then close Chrome to save the profile.');
  await new Promise(resolveClose=>context.once('close',resolveClose));
} else {
  const endpoint=new URL('/api/browser-ack',app);
  const signal=new AbortController();
  process.on('SIGINT',()=>signal.abort());
  process.on('SIGTERM',()=>signal.abort());
  context.on('close',()=>signal.abort());
  const rpc=async body=>{
    const response=await fetch(endpoint,{method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Queue HTTP '+response.status);
    return (await response.json()).result;
  };
  try {
    while (!signal.signal.aborted) {
      const started=Date.now();
      await Promise.all(channels.map(async channel=>{
        try {
          const [job]=await rpc({action:'claim',channel});
          if (!job) return;
          const lease={job:job.job_id,lease:job.lease};
          const outcome=await deliver(context,channel,job,staffEmail,async()=>{
            const allowed=await rpc({action:'check',...lease});
            if (typeof allowed!=='boolean') throw Error('Invalid send authorization');
            return allowed;
          });
          const saved=await rpc({action:'finish',...lease,outcome});
          console.log(channel+': '+(saved ? outcome : 'result unconfirmed'));
        } catch (error) {
          console.error(channel+': '+(error.message.startsWith('Queue HTTP ') ? error.message : 'runner request failed'));
        }
      }));
      await pause(Math.max(1000,30000-(Date.now()-started)),undefined,{signal:signal.signal}).catch(()=>{});
    }
  } finally {
    await context.close().catch(()=>{});
  }
}
