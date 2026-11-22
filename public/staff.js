import {sources,stages,departments,acknowledgementLinks} from './crm.js';

const login = document.querySelector('#login');
const queue = document.querySelector('#queue');
const message = document.querySelector('#message');
const signOut = document.querySelector('#sign-out');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const inquiry = document.querySelector('#inquiry');
const inquiryPanel = document.querySelector('#inquiry-panel');
const inquiryStatus = document.querySelector('#inquiry-status');
const details = document.querySelector('#lead-details');
const detailStatus = document.querySelector('#lead-status');
const routing = document.querySelector('#lead-routing');
const schedule = document.querySelector('#schedule-followup');
const assignment = document.querySelector('#lead-assignment');
const gmailPanel = document.querySelector('#gmail-connection');
const gmailStatus = document.querySelector('#gmail-status');
const gmailConnect = document.querySelector('#gmail-connect');
const gmailDisconnect = document.querySelector('#gmail-disconnect');
const whatsappPanel = document.querySelector('#whatsapp-approval');
const whatsappStatus = document.querySelector('#whatsapp-status');
const whatsappBatch = document.querySelector('#whatsapp-batch');
const whatsappMessages = document.querySelector('#whatsapp-messages');
let pendingWhatsApp=[];
const leadName = document.querySelector('#lead-name');
const leadContact = document.querySelector('#lead-contact');
const leadStage = document.querySelector('#lead-stage');
const inquiryHistory = document.querySelector('#lead-inquiries');
const followups = document.querySelector('#lead-followups');
const dueContact = document.querySelector('#due-contact');
const dueStatus = document.querySelector('#due-contact-status');
const dueList = document.querySelector('#due-contact-list');
const refreshContact = document.querySelector('#refresh-contact');
let contactTimer;
let contactRequest=0;
let currentLead;
let detailRequest = 0;
let pendingFollowup;
for (const stage of stages) routing.elements.stage.add(new Option(stage,stage));
for (const department of departments) routing.elements.department.add(new Option(department,department));
for (const source of sources) inquiry.elements.source.add(new Option(source,source));
let pendingInquiry;
let token;
let page = 1;
let session = 0;

async function api(options, query = '') {
  const response = await fetch('/api/staff'+query, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The staff workspace is unavailable.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function reset() {
  session++;
  clearInterval(contactTimer);
  contactTimer=undefined;
  contactRequest++;
  dueContact.hidden=true;
  gmailPanel.hidden=true;
  whatsappPanel.hidden=whatsappBatch.hidden=true;
  whatsappStatus.textContent='';
  whatsappMessages.replaceChildren();
  whatsappBatch.reset();
  pendingWhatsApp=[];
  gmailStatus.textContent='';
  gmailDisconnect.hidden=true;
  dueList.replaceChildren();
  dueStatus.textContent='';
  details.close();
  token = undefined;
  page = 1;
  queue.hidden = signOut.hidden = true;
  login.hidden = false;
  inquiryPanel.hidden = true;
  inquiry.reset();
  inquiryStatus.textContent = '';
  pendingInquiry = undefined;
  document.querySelector('#leads').replaceChildren();
  document.querySelector('#membership').textContent = '';
}

async function loadLeads(targetPage) {
  const currentSession = session;
  previous.disabled = next.disabled = true;
  try {
    const data = await api({headers:{Authorization:'Bearer '+token}},'?page='+targetPage);
    if (session !== currentSession) return;
    page = targetPage;
    document.querySelector('#membership').textContent = data.staff.department+' · '+data.staff.role.replaceAll('_',' ');
    const list = document.querySelector('#leads');
    list.replaceChildren();
    for (const lead of data.leads) {
      const row = document.createElement('article');
      row.className = 'row';
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = lead.name;
      const topic = document.createElement('p');
      topic.textContent = lead.topic+' · '+lead.department;
      const stage = document.createElement('span');
      stage.className = 'pill';
      stage.textContent = lead.stage;
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open lead';
      open.setAttribute('aria-label','Open '+lead.name);
      open.addEventListener('click',()=>openLead(lead.id));
      identity.append(name,topic);
      row.append(identity,stage,open);
      list.append(row);
    }
    if (!data.leads.length) list.textContent = 'No active leads available.';
    document.querySelector('#page').textContent = 'Page '+page;
    previous.disabled = page===1;
    next.disabled = !data.hasNext;
    login.hidden = true;
    signOut.hidden = queue.hidden = false;
    inquiryPanel.hidden = data.staff.role !== 'super_admin';
    dueContact.hidden=false;
    gmailPanel.hidden=false;
    whatsappPanel.hidden=false;
    if (!contactTimer) {
      void loadDueContact();
      void manageGmail('status');
      void reviewWhatsApp();
      contactTimer=setInterval(loadDueContact,60000);
    }
    message.textContent = '';
  } catch (error) {
    if (session !== currentSession) return;
    reset();
    message.textContent = error.message;
  }
}

login.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit = login.querySelector('button');
  submit.disabled = true;
  message.textContent = 'Signing in…';
  try {
    const credentials = Object.fromEntries(new FormData(login));
    login.reset();
    const data = await api({
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)
    });
    token = data.token;
    await loadLeads(1);
  } catch (error) {
    reset();
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

const returnedGmail = new URL(location.href).searchParams.get('gmail');
if (returnedGmail) {
  message.textContent = returnedGmail==='connected'?'Gmail connected. Sign in to continue.':'Gmail could not connect. Sign in to try again.';
  history.replaceState(null,'',location.pathname+location.hash);
}

async function manageGmail(action) {
  const generation=session;
  gmailConnect.disabled=gmailDisconnect.disabled=true;
  gmailStatus.textContent='Checking Gmail…';
  try {
    const response=await fetch('/api/gmail',{method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'
    },body:JSON.stringify({action})});
    const result=await response.json();
    if (generation!==session) return;
    if (!response.ok) throw Error(result.error || 'Could not manage this Gmail connection.');
    if (action==='connect') {
      location.assign(result.url);
      return;
    }
    gmailDisconnect.hidden=!result.email;
    gmailConnect.textContent=result.email?'Change Gmail account':'Connect Gmail';
    gmailStatus.textContent=result.email?'Connected as '+result.email:'No Gmail mailbox connected.';
  } catch (error) {
    if (generation===session) gmailStatus.textContent=error.message;
  } finally {
    if (generation===session) gmailConnect.disabled=gmailDisconnect.disabled=false;
  }
}
gmailConnect.addEventListener('click',()=>manageGmail('connect'));
gmailDisconnect.addEventListener('click',()=>manageGmail('disconnect'));

async function whatsappApi(body) {
  const response=await fetch('/api/whatsapp',{method:'POST',headers:{
    Authorization:'Bearer '+token,'Content-Type':'application/json'
  },body:JSON.stringify(body)});
  const result=await response.json();
  if (!response.ok) throw Error(result.error || 'WhatsApp approval could not be processed.');
  return result;
}

function whatsappBrowser(action,fields={},delay=3000) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timeout=setTimeout(()=>{
      window.removeEventListener('message',reply);
      reject(Error('Install or reconnect the ApplyIQ WhatsApp extension, then try again.'));
    },delay);
    function reply(event) {
      if (event.source!==window || event.origin!==location.origin ||
          event.data?.type!=='applyiq-whatsapp-result' || event.data.id!==id) return;
      clearTimeout(timeout);
      window.removeEventListener('message',reply);
      if (event.data.result?.error) reject(Error(event.data.result.error));
      else resolve(event.data.result);
    }
    window.addEventListener('message',reply);
    window.postMessage({type:'applyiq-whatsapp-request',id,action,...fields},location.origin);
  });
}

async function reviewWhatsApp(emptyMessage='No assigned inquiries are awaiting WhatsApp approval.') {
  const generation=session;
  whatsappBatch.hidden=true;
  whatsappMessages.replaceChildren();
  pendingWhatsApp=[];
  whatsappStatus.textContent='Checking pending WhatsApp messages…';
  try {
    const {messages}=await whatsappApi({action:'list'});
    if (generation!==session) return;
    pendingWhatsApp=messages;
    whatsappBatch.hidden=!messages.length;
    renderList(whatsappMessages,messages,'',(row,item)=>{
      const entry=document.createElement('div');
      const recipient=document.createElement('strong');
      const text=document.createElement('p');
      recipient.textContent=item.student+' · '+item.recipient;
      text.textContent=item.text;
      entry.append(recipient,text);
      row.append(entry);
    });
    whatsappStatus.textContent=messages.length?'Review each recipient and message before approving this batch.':emptyMessage;
  } catch (error) {
    if (generation===session) whatsappStatus.textContent=error.message;
  }
}
document.querySelector('#whatsapp-review').addEventListener('click',()=>reviewWhatsApp());

whatsappBatch.addEventListener('submit',async event=>{
  event.preventDefault();
  const generation=session;
  const sender=whatsappBatch.elements.sender.value.trim().replace(/[\s().-]/g,'');
  if (!/^\+[1-9]\d{7,14}$/.test(sender)) {
    whatsappStatus.textContent='Enter your linked WhatsApp number with its country code.';
    return;
  }
  const button=whatsappBatch.querySelector('button');
  const reviewed=new Map(pendingWhatsApp.map(job=>[job.job_id,job]));
  button.disabled=true;
  document.querySelector('#whatsapp-review').disabled=true;
  let sent=0;
  let incomplete=0;
  let approved=false;
  try {
    if (!(await whatsappBrowser('ping'))?.ready || generation!==session) return;
    const {messages}=await whatsappApi({action:'approve',ids:[...reviewed.keys()]});
    if (generation!==session) return;
    approved=true;
    whatsappBatch.hidden=true;
    for (const job of messages) {
      if (generation!==session) return;
      const prior=reviewed.get(job.job_id);
      if (prior?.recipient!==job.recipient || prior.text!==job.text) {
        await whatsappApi({action:'finish',job:job.job_id,lease:job.lease,outcome:'retry'});
        incomplete++;
        continue;
      }
      whatsappStatus.textContent='Sending approved WhatsApp messages…';
      try {
        const result=await whatsappBrowser('send',{job,token,sender},65000);
        if (result.outcome==='accepted') sent++;
        else incomplete++;
      } catch {
        incomplete++;
      }
    }
    whatsappStatus.textContent='Confirmed: '+sent+'. Unconfirmed or skipped: '+(incomplete+reviewed.size-messages.length)+'.';
  } catch (error) {
    if (generation===session) whatsappStatus.textContent=error.message;
  } finally {
    if (generation===session) {
      if (approved) pendingWhatsApp=[];
      button.disabled=false;
      document.querySelector('#whatsapp-review').disabled=false;
    }
  }
});

function renderList(container,records,emptyText,render) {
  container.replaceChildren();
  if (!records.length) container.textContent=emptyText;
  for (const record of records) {
    const row=document.createElement('div');
    row.className='row';
    render(row,record);
    container.append(row);
  }
}

const dateLabel = value => new Date(value).toLocaleString();

async function loadDueContact() {
  if (!token) return;
  const generation=++contactRequest;
  refreshContact.disabled=true;
  try {
    const {inquiries,hasMore}=await api({headers:{Authorization:'Bearer '+token}},'?view=due-contact');
    if (generation!==contactRequest) return;
    dueStatus.textContent=hasMore?'Showing the 50 oldest inquiries.':'';
    renderList(dueList,inquiries,'No inquiries have been waiting for ten minutes.',(row,item)=>{
      const label=document.createElement('span');
      label.textContent=[item.lead.name,item.topic,item.source,dateLabel(item.received_at)].join(' · ');
      const button=document.createElement('button');
      button.type='button';
      button.textContent='Open inquiry';
      button.addEventListener('click',()=>openLead(item.lead_id,'',item.id));
      row.append(label,button);
    });
  } catch (error) {
    if (generation!==contactRequest) return;
    if (error.status===401) {
      reset();
      message.textContent=error.message;
    } else {
      dueStatus.textContent=error.message;
    }
  } finally {
    if (generation===contactRequest) refreshContact.disabled=false;
  }
}
refreshContact.addEventListener('click',loadDueContact);

async function openLead(id,status='',selectedInquiry) {
  const generation=++detailRequest;
  currentLead=undefined;
  routing.hidden=schedule.hidden=assignment.hidden=true;
  leadName.textContent='Lead details';
  leadContact.textContent=leadStage.textContent='';
  inquiryHistory.replaceChildren();
  followups.replaceChildren();
  detailStatus.textContent='Loading lead…';
  if (!details.open) details.showModal();
  try {
    const {lead,canEdit,canContact}=await api({headers:{Authorization:'Bearer '+token}},'?lead='+encodeURIComponent(id));
    if (generation!==detailRequest || !details.open) return;
    currentLead=lead;
    leadName.textContent=lead.name;
    leadContact.textContent=[lead.phone,lead.email,lead.topic].join(' · ');
    leadStage.textContent=lead.stage+' · '+lead.department;
    routing.elements.stage.value=lead.stage;
    routing.elements.department.value=lead.department;
    routing.hidden=schedule.hidden=!canEdit;
    renderList(inquiryHistory,lead.inquiries,'No inquiry history available.',(row,item)=>{
      const label=document.createElement('span');
      label.textContent=[item.source,item.topic,dateLabel(item.received_at),
        item.contacted_at?'Contact recorded at '+dateLabel(item.contacted_at):'Contact not recorded',
        item.whatsapp_opt_in_at?'WhatsApp opt-in recorded':'WhatsApp opt-in missing'].join(' · ');
      row.append(label);
      if (!canContact) return;
      if (!item.contacted_at) {
        const links=acknowledgementLinks(item);
        for (const [channel,url] of Object.entries(links)) {
          if (!url) continue;
          const link=document.createElement('a');
          link.href=url;
          link.target='_blank';
          link.rel='noopener noreferrer';
          link.className='pill';
          link.textContent=channel==='email'?'Open Gmail draft':'Open WhatsApp draft';
          row.append(link);
        }
      }
      const button=(text,action,success)=>{
        const control=document.createElement('button');
        control.type='button';
        control.textContent=text;
        control.addEventListener('click',()=>saveWorkflow(control,action,{inquiryId:item.id},success));
        row.append(control);
      };
      if (!item.contacted_at) button('Record contact','record-contact','Contact recorded.');
      if (item.whatsapp_opt_in_at) {
        button('Record WhatsApp opt-out','revoke-whatsapp-opt-in','WhatsApp opt-out recorded.');
      } else {
        button('Confirm student opted in to WhatsApp','record-whatsapp-opt-in','WhatsApp opt-in recorded.');
      }
      if (item.id===selectedInquiry) row.querySelector('a,button')?.focus();
    });
    renderList(followups,lead.followups,'No follow-ups scheduled.',(row,item)=>{
      const label=document.createElement('span');
      label.textContent=[item.title,dateLabel(item.due_at),item.completed_at?'Completed':item.automatic?'Automatic':'Scheduled'].join(' · ');
      row.append(label);
      if (canEdit && !item.completed_at) {
        const button=document.createElement('button');
        button.type='button';
        button.textContent='Mark complete';
        button.addEventListener('click',()=>saveWorkflow(button,'complete-followup',{followupId:item.id},'Follow-up completed.'));
        row.append(button);
      }
    });
    detailStatus.textContent=status;
    if (canEdit) {
      try {
        const {assignees}=await api({headers:{Authorization:'Bearer '+token}},'?view=assignees');
        if (generation!==detailRequest || !details.open) return;
        const select=assignment.elements.assignee;
        select.replaceChildren(new Option('Unassigned',''));
        for (const staff of assignees) select.add(new Option((staff.email || staff.id)+' · '+staff.department,staff.id));
        if (lead.assigned_to && !assignees.some(staff=>staff.id===lead.assigned_to)) {
          select.add(new Option('Inactive staff',lead.assigned_to));
        }
        select.value=lead.assigned_to || '';
        assignment.hidden=false;
      } catch {
        if (generation===detailRequest && details.open) detailStatus.textContent='Staff assignment options could not be loaded.';
      }
    }
  } catch (error) {
    if (generation!==detailRequest || !details.open) return;
    if (error.status===401) {
      reset();
      message.textContent=error.message;
    } else {
      detailStatus.textContent=error.message;
    }
  }
}

async function saveWorkflow(button,action,fields,success) {
  if (!currentLead || details.dataset.saving) return;
  const id=currentLead.id;
  const generation=detailRequest;
  details.dataset.saving='true';
  button.disabled=true;
  detailStatus.textContent='Saving…';
  try {
    await api({method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({...fields,leadId:id})},'?action='+action);
    if (generation!==detailRequest || !details.open) return;
    if (action==='schedule-followup') {
      schedule.reset();
      pendingFollowup=undefined;
    }
    await openLead(id,success);
    if (action==='record-contact' || action==='update-lead') void loadDueContact();
    if (action==='update-lead') await loadLeads(page);
  } catch (error) {
    if (generation!==detailRequest || !details.open) return;
    if (error.status===401) {
      reset();
      message.textContent=error.message;
    } else {
      detailStatus.textContent=error.message;
    }
  } finally {
    delete details.dataset.saving;
    button.disabled=false;
  }
}

routing.addEventListener('submit',event=>{
  event.preventDefault();
  if (!currentLead) return;
  const fields=Object.fromEntries(new FormData(routing));
  if (fields.stage===currentLead.stage && fields.department===currentLead.department) return;
  saveWorkflow(routing.querySelector('button'),'update-lead',{
    ...fields,previousStage:currentLead.stage,previousDepartment:currentLead.department
  },'Stage and department saved.');
});
assignment.addEventListener('submit',event=>{
  event.preventDefault();
  if (!currentLead) return;
  const assignee=assignment.elements.assignee.value || null;
  if (assignee===currentLead.assigned_to) return;
  saveWorkflow(assignment.querySelector('button'),'assign-lead',{
    assignee,previousAssignee:currentLead.assigned_to
  },'Staff assignment saved.');
});
schedule.addEventListener('submit',event=>{
  event.preventDefault();
  if (!currentLead) return;
  const fields=Object.fromEntries(new FormData(schedule));
  const date=new Date(fields.due);
  if (Number.isNaN(date.getTime())) return;
  const snapshot=JSON.stringify([currentLead.id,fields]);
  if (pendingFollowup?.snapshot!==snapshot) pendingFollowup={snapshot,id:crypto.randomUUID()};
  saveWorkflow(schedule.querySelector('button'),'schedule-followup',{
    title:fields.title,due:date.toISOString(),followupId:pendingFollowup.id
  },'Follow-up scheduled.');
});
document.querySelector('#close-lead').addEventListener('click',()=>details.close());
details.addEventListener('close',()=>{
  detailRequest++;
  currentLead=undefined;
  schedule.reset();
  pendingFollowup=undefined;
  leadContact.textContent='';
  inquiryHistory.replaceChildren();
  followups.replaceChildren();
});
signOut.addEventListener('click',()=>{reset();message.textContent='Signed out.';});
previous.addEventListener('click',()=>loadLeads(page-1));
next.addEventListener('click',()=>loadLeads(page+1));

inquiry.addEventListener('submit',async event=>{
  event.preventDefault();
  const currentSession=session;
  const submit=inquiry.querySelector('button');
  const fields=Object.fromEntries(new FormData(inquiry));
  const snapshot=JSON.stringify(fields);
  if (pendingInquiry?.snapshot!==snapshot) pendingInquiry={snapshot,id:crypto.randomUUID()};
  submit.disabled=true;
  inquiryStatus.textContent='Saving inquiry…';
  try {
    await api({method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'
    },body:JSON.stringify({...fields,externalId:pendingInquiry.id})},'?action=create-inquiry');
    if (session!==currentSession) return;
    pendingInquiry=undefined;
    inquiry.reset();
    inquiryStatus.textContent='Inquiry saved.';
    await loadLeads(1);
  } catch (error) {
    if (session!==currentSession) return;
    if (error.status===401) {
      reset();
      message.textContent=error.message;
    } else {
      inquiryStatus.textContent=error.message;
    }
  } finally {
    submit.disabled=false;
  }
});
