const subject='We received your study abroad inquiry';
const message='Thank you for your study abroad inquiry. A counsellor will contact you soon. If you prefer a particular time, please reply with your preferred day, time and time zone.';

export function draftUrl(channel,recipient) {
  if (channel==='email' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) {
    return 'https://mail.google.com/mail/u/0/?'+new URLSearchParams({view:'cm',fs:'1',to:recipient,su:subject,body:message});
  }
  if (channel==='whatsapp' && /^\+[1-9]\d{7,14}$/.test(recipient)) {
    return 'https://web.whatsapp.com/send?'+new URLSearchParams({phone:recipient.slice(1),text:message});
  }
  return null;
}

async function gmail(page,job,sender) {
  const fullAccount=page.locator('a[aria-label*="Google Account"]');
  const account=(await fullAccount.getAttribute('aria-label') || '').toLowerCase();
  if (!account.includes('('+sender.toLowerCase()+')')) return null;
  const compose=page.getByRole('dialog').filter({has:page.getByRole('button',{name:/^send(?:\s|$)/i})});
  const recipientChips=compose.locator('[email]');
  const emails=await recipientChips.evaluateAll(elements=>[...new Set(elements.map(element=>element.getAttribute('email').toLowerCase()))]);
  if (emails.length!==1 || emails[0]!==job.recipient.toLowerCase()) return null;
  if (await compose.locator('input[name="subjectbox"]').inputValue()!==subject) return null;
  if ((await compose.getByRole('textbox',{name:'Message Body'}).innerText()).trim()!==message) return null;
  return {
    send:()=>compose.getByRole('button',{name:/^send(?:\s|$)/i}).click(),
    confirm:()=>page.getByText('Message sent',{exact:true}).waitFor({state:'visible'})
  };
}

export function contactNumberMatches(text,recipient) {
  const compact=text.trim();
  return /^\+?[0-9][0-9 ().-]{6,22}$/.test(compact) &&
    compact.replace(/\D/g,'')===recipient.replace(/\D/g,'');
}

async function whatsapp(page,job) {
  const chat=page.locator('#main');
  const composer=chat.locator('footer [contenteditable=true][role=textbox]');
  await composer.waitFor({state:'visible'});
  const header=chat.locator('header');
  const namedContact=header.getByRole('button',{name:/contact info/i});
  if (await namedContact.count()===1) {
    await namedContact.click();
  } else {
    const title=header.locator('span[title]');
    if (await title.count()!==1) return null;
    await title.click();
  }
  const info=page.getByRole('complementary').filter({has:page.getByText('Contact info',{exact:true})});
  await info.waitFor({state:'visible'});
  const numbers=await info.locator('a[href^="tel:"]').evaluateAll(links=>links.map(link=>link.getAttribute('href').slice(4)));
  if (numbers.length!==1 || !contactNumberMatches(numbers[0],job.recipient)) return null;
  await info.getByRole('button',{name:'Close',exact:true}).click();
  if ((await composer.innerText()).trim()!==message) return null;
  const outgoing=chat.locator('.message-out').filter({hasText:message});
  const count=await outgoing.count();
  return {
    send:()=>chat.locator('footer').getByRole('button',{name:'Send',exact:true}).click(),
    confirm:async()=>{
      await outgoing.nth(count).waitFor({state:'visible'});
    }
  };
}

export async function deliver(context,channel,job,sender,canSend) {
  const url=draftUrl(channel,job.recipient);
  if (!url) return 'failed';
  let page;
  let attempted=false;
  try {
    page=await context.newPage();
    page.setDefaultTimeout(7500);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
    if (new URL(page.url()).origin!==new URL(url).origin) return 'retry';
    const actions=await (channel==='email' ? gmail(page,job,sender) : whatsapp(page,job));
    if (!actions) return 'retry';
    if (!await canSend()) return 'skipped';
    attempted=true;
    await actions.send();
    await actions.confirm();
    return 'accepted';
  } catch {
    return attempted ? 'uncertain' : 'retry';
  } finally {
    await page?.close().catch(()=>{});
  }
}
