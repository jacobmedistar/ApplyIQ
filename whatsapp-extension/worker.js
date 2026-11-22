const crm='https://applyiq-opal.vercel.app';
const whatsapp='https://web.whatsapp.com';
const phone=value=>typeof value==='string' && /^\+[1-9]\d{7,14}$/.test(value);
const uuid=value=>typeof value==='string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
let busy=false;

chrome.runtime.onMessage.addListener((input,source,reply)=>{
  if (!source.url?.startsWith(crm+'/staff.html')) return;
  if (input.action==='ping') {reply({ready:true});return;}
  if (input.action!=='send' || busy) {reply({error:'WhatsApp delivery is already running or unavailable.'});return;}
  const {job,token,sender}=input;
  if (!uuid(job?.job_id) || !uuid(job.lease) || !phone(job.recipient) || !phone(sender) ||
      typeof job.text!=='string' || job.text.length>500 || typeof token!=='string') {reply({error:'Invalid WhatsApp approval.'});return;}
  busy=true;
  send(job,token,sender).then(reply,()=>reply({error:'WhatsApp delivery could not be confirmed.'})).finally(()=>{busy=false;});
  return true;
});

async function send(job,token,sender) {
  const rpc=async (action,extra={})=>{
    const response=await fetch(crm+'/api/whatsapp',{method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({action,job:job.job_id,lease:job.lease,...extra}),signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('CRM queue unavailable');
    return response.json();
  };
  let tab;
  let outcome='retry';
  let clicked=false;
  try {
    const approval={recipient:job.recipient,text:job.text,proof:job.proof};
    if (!(await rpc('check',approval)).allowed) {
      outcome='skipped';
    } else {
      tab=await chrome.tabs.create({url:whatsapp+'/',active:false});
      await waitForTab(tab.id);
      const account=await inspect(tab.id,'sender',sender,'');
      if (account) {
        await chrome.tabs.update(tab.id,{url:whatsapp+'/send?'+new URLSearchParams({phone:job.recipient.slice(1),text:job.text})});
        await waitForTab(tab.id,'/send');
        const prepared=await inspect(tab.id,'recipient',job.recipient,job.text);
        if (prepared) {
          if (!(await rpc('check',approval)).allowed) {
            outcome='skipped';
          } else {
            clicked=true;
            outcome=await inspect(tab.id,'send',job.recipient,job.text)?'accepted':'uncertain';
          }
        }
      }
    }
  } catch {
    outcome=clicked?'uncertain':'retry';
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(()=>{});
  }
  const result=await rpc('finish',{outcome});
  return result.saved?{outcome}:{error:'WhatsApp status could not be saved.'};
}

async function waitForTab(id,path) {
  for (let attempt=0;attempt<24;attempt++) {
    const tab=await chrome.tabs.get(id);
    const current=tab.url && new URL(tab.url);
    if (tab.status==='complete' && current?.origin===whatsapp && (!path || current.pathname===path)) return;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('WhatsApp did not load');
}

async function inspect(tabId,mode,number,text) {
  const [response]=await chrome.scripting.executeScript({target:{tabId},args:[mode,number,text],func:async(mode,number,text)=>{
    if (location.origin!=='https://web.whatsapp.com') return false;
    const wait=async fn=>{
      for (let i=0;i<24;i++) {
        const value=fn();
        if (value) return value;
        await new Promise(resolve=>setTimeout(resolve,300));
      }
      return null;
    };
    const matches=panel=>{
      const links=[...panel.querySelectorAll('a[href^="tel:"]')];
      return links.length===1 && ('+'+links[0].getAttribute('href').replace(/\D/g,''))===number;
    };
    const panelWith=heading=>[...document.querySelectorAll('[role="complementary"],aside')].find(panel=>
      [...panel.querySelectorAll('h1,h2,h3,[role="heading"]')].some(title=>title.textContent.trim()===heading));
    const composer=()=>document.querySelector('#main footer [contenteditable=true][role=textbox]');
    if (mode==='sender') {
      const profile=await wait(()=>document.querySelector('button[aria-label="Profile"],[role=button][aria-label="Profile"]'));
      if (!profile) return false;
      profile.click();
      const panel=await wait(()=>panelWith('Profile'));
      return !!panel && matches(panel);
    }
    if (mode==='recipient') {
      if (!await wait(composer)) return false;
      const header=document.querySelector('#main header');
      const control=header?.querySelector('[aria-label="Contact info"]');
      const titles=header?.querySelectorAll('span[title]');
      const element=control || (titles?.length===1?titles[0]:null);
      if (!element) return false;
      element.click();
      const panel=await wait(()=>panelWith('Contact info'));
      const close=panel?.querySelector('[aria-label="Close"]');
      if (!panel || !matches(panel) || !close) return false;
      close.click();
      if (composer()?.innerText.trim()!==text) return false;
      document.querySelector('#main')?.setAttribute('data-applyiq-verified-recipient',number);
      return true;
    }
    const chat=document.querySelector('#main');
    if (chat?.getAttribute('data-applyiq-verified-recipient')!==number || composer()?.innerText.trim()!==text) return false;
    const buttons=chat.querySelectorAll('footer button[aria-label="Send"],footer [role=button][aria-label="Send"]');
    if (buttons.length!==1) return false;
    const isMessage=()=>[...chat.querySelectorAll('.message-out')].filter(item=>item.innerText.includes(text));
    const before=new Set(isMessage());
    buttons[0].click();
    return !!await wait(()=>isMessage().some(item=>!before.has(item)));
  }});
  return response?.result===true;
}
