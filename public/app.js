import {stages,departments,sources,intake,audit,hoursFrom} from './crm.js';

const storageKey = 'applyiq-crm-demo-v1';
const state = JSON.parse(localStorage.getItem(storageKey) || '{"leads":[]}');
const view = document.querySelector('#view');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');
const notice = document.querySelector('#notice');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time = at => new Date(at).toLocaleString();
const options = (values, selected) => values.map(value => '<option'+(value===selected?' selected':'')+'>'+escape(value)+'</option>').join('');
const action = (label, id) => '<button data-lead="'+id+'">'+escape(label)+'</button>';
const save = message => {
  localStorage.setItem(storageKey,JSON.stringify(state));
  notice.textContent = message;
  render();
};
const heading = (title,description) => '<h1>'+title+'</h1><p class="muted">'+description+'</p>';
const empty = message => '<p class="empty">'+message+'</p>';
const metric = (label,number) => '<article class="card"><small>'+label+'</small><strong class="metric">'+number+'</strong></article>';
const list = leads => leads.map(lead => '<div class="row"><div><strong>'+escape(lead.name)+'</strong><br><small>'+escape(lead.topic)+' · '+lead.inquiries.length+' inquiries</small></div><span class="pill">'+escape(lead.stage)+'</span>'+action('Open',lead.id)+'</div>').join('') || empty('No inquiries here yet.');
const tasks = () => state.leads.filter(lead=>!lead.archived && !['Closed','Enrolled'].includes(lead.stage)).flatMap(lead=>lead.tasks.filter(task=>task.status==='Open').map(task=>({...task,lead}))).sort((a,b)=>a.due.localeCompare(b.due));
const taskList = rows => rows.map(task=>'<div class="row"><div><strong>'+escape(task.title)+'</strong><br><small>'+escape(task.lead.name)+' · '+escape(time(task.due))+'</small></div><span class="pill '+(new Date(task.due)<new Date()?'overdue':'')+'">'+(new Date(task.due)<new Date()?'Overdue':task.automatic?'Automatic':'Manual')+'</span>'+action('Open lead',task.lead.id)+'</div>').join('') || empty('No open follow-ups.');

function render() {
  const route = location.hash.slice(1) || 'overview';
  const labels = {overview:'Overview',leads:'Leads',pipeline:'Pipeline',followups:'Follow-ups',departments:'Departments'};
  const leads = state.leads.filter(lead=>!lead.archived);
  document.querySelector('#crumb').textContent = labels[route] || 'Overview';
  document.querySelectorAll('nav a').forEach(link=>{
    link.removeAttribute('aria-current');
    if (link.hash === '#'+route) link.setAttribute('aria-current','page');
  });
  if (route==='leads') {
    view.innerHTML = heading('Leads','Find a student and review every inquiry they have made.')+'<section class="panel"><label>Search leads<input id="search" type="search" placeholder="Name, phone, email or program"></label><div id="results">'+list(leads)+'</div></section><details class="panel"><summary>Archived leads</summary>'+list(state.leads.filter(lead=>lead.archived))+'</details>';
    document.querySelector('#search').oninput = event=>{
      const query=event.target.value.toLowerCase().trim();
      document.querySelector('#results').innerHTML=list(leads.filter(lead=>[lead.name,lead.topic,lead.email,lead.phone,...lead.inquiries.map(i=>i.topic)].join(' ').toLowerCase().includes(query)));
    };
  } else if (route==='pipeline') {
    view.innerHTML = heading('Student pipeline','Track each student from first inquiry through enrollment.')+'<div class="grid">'+stages.map(stage=>'<section class="card"><h2>'+stage+'</h2>'+list(leads.filter(lead=>lead.stage===stage))+'</section>').join('')+'</div>';
  } else if (route==='followups') {
    view.innerHTML = heading('Follow-ups','Review scheduled and overdue follow-ups across the pipeline.')+'<section class="panel">'+taskList(tasks())+'</section>';
  } else if (route==='departments') {
    view.innerHTML = heading('Departments','See the active records routed to each team.')+'<div class="grid">'+departments.map(dept=>'<section class="card"><h2>'+dept+'</h2>'+list(leads.filter(lead=>lead.department===dept))+'</section>').join('')+'</div>';
  } else {
    const queue = tasks();
    view.innerHTML = heading('Consultancy overview','Track inquiries, student progress and follow-ups.')+'<div class="grid">'+metric('Active leads',leads.filter(lead=>!['Enrolled','Closed'].includes(lead.stage)).length)+metric('Open follow-ups',queue.length)+metric('Overdue follow-ups',queue.filter(task=>new Date(task.due)<new Date()).length)+metric('Enrolled',leads.filter(lead=>lead.stage==='Enrolled').length)+'</div><section class="panel"><h2>Upcoming follow-ups</h2>'+taskList(queue.slice(0,5))+'</section><section class="panel"><h2>Recent leads</h2>'+list(leads.slice(0,5))+'</section>';
  }
}
const field=(label,name,type='text',required=false)=>'<label>'+label+'<input name="'+name+'" type="'+type+'" maxlength="250" '+(required?'required':'')+'></label>';
const close='<button type="button" data-close>Close</button>';
function newInquiry() {
  dialogContent.innerHTML='<h2>New inquiry</h2><form id="intake" class="form">'+field('Student name','name','text',true)+field('Phone','phone','tel',true)+field('Email','email','email',true)+field('Interested in','topic','text',true)+'<label>Source<select name="source">'+options(sources)+'</select></label>'+field('Source reference','externalId')+field('Preferred country','country')+field('Preferred intake','intake')+field('Highest qualification','qualification')+field('Program level','level')+field('Current location','location')+field('Budget','budget')+'<label>Department<select name="department">'+options(departments)+'</select></label><p class="wide" role="alert"></p><div class="wide toolbar">'+close+'<button class="primary">Record inquiry</button></div></form>';
  dialogContent.querySelector('form').onsubmit = event=>{
    event.preventDefault();
    try {
      const lead = intake(state,Object.fromEntries(new FormData(event.target)));
      save('Inquiry recorded for '+lead.name+'.');
      showLead(lead);
    } catch(error) {event.target.querySelector('[role=alert]').textContent=error.message;}
  };
  dialog.showModal();
}
const detail = (key,value)=>'<div><dt>'+key+'</dt><dd>'+escape(value || '—')+'</dd></div>';
function showLead(lead) {
  dialogContent.innerHTML='<div class="toolbar"><h2>'+escape(lead.name)+'</h2>'+close+'</div><dl class="details">'+detail('Phone',lead.phone)+detail('Email',lead.email)+detail('Country',lead.country)+detail('Intake',lead.intake)+detail('Qualification',lead.qualification)+detail('Program level',lead.level)+detail('Location',lead.location)+detail('Budget',lead.budget)+'</dl><form id="case" class="form"><label>Stage<select name="stage">'+options(stages,lead.stage)+'</select></label><label>Department<select name="department">'+options(departments,lead.department)+'</select></label><div class="toolbar wide"><button '+(lead.archived?'disabled':'')+'>Save stage and routing</button><button type="button" id="archive">'+(lead.archived?'Restore lead':'Archive lead')+'</button></div></form><section class="panel"><h2>Inquiry history</h2>'+lead.inquiries.map(i=>'<div class="row"><div><strong>'+escape(i.topic)+'</strong><br><small>'+escape(i.source)+' · '+escape(time(i.at))+' · '+escape(i.email)+' · '+escape(i.phone)+'</small></div></div>').join('')+'</section><section class="panel"><h2>Follow-ups</h2>'+lead.tasks.map(t=>'<div class="row"><div>'+escape(t.title)+'<br><small>'+escape(time(t.due))+' · '+t.status+'</small></div>'+(t.status==='Open'&&!lead.archived?'<button data-done="'+t.id+'">Mark complete</button>':'')+'</div>').join('')+(lead.archived?'':'<form id="task" class="form">'+field('Follow-up title','title','text',true)+field('Due date and time','due','datetime-local',true)+'<button>Add follow-up</button></form>')+'</section><section class="panel"><h2>Activity and audit trail</h2>'+lead.audit.map(entry=>'<div class="row"><div>'+escape(entry.event)+'<br><small>'+escape(entry.who)+' · '+escape(time(entry.at))+'</small></div></div>').join('')+'</section>';
  const update = (event,message) => {audit(lead,event);save(message);showLead(lead);};
  dialogContent.querySelector('#case').onsubmit = event=>{
    event.preventDefault();
    if (lead.archived) return;
    const data = Object.fromEntries(new FormData(event.target));
    const changed = ['stage','department'].filter(key=>lead[key]!==data[key]).map(key=>key+': '+lead[key]+' → '+data[key]);
    if (!changed.length) return;
    if (lead.stage!==data.stage && !['Closed','Enrolled'].includes(data.stage)) lead.tasks.unshift({id:crypto.randomUUID(),title:'Review '+data.stage.toLowerCase(),due:hoursFrom(new Date(),24),status:'Open',automatic:true});
    Object.assign(lead,data);
    update(changed.join(' · '),'Lead updated.');
  };
  dialogContent.querySelector('#archive').onclick = ()=>{
    lead.archived=!lead.archived;
    update(lead.archived?'Archived lead':'Restored lead',lead.archived?'Lead archived.':'Lead restored.');
  };
  const taskForm = dialogContent.querySelector('#task');
  if (taskForm) taskForm.onsubmit = event=>{
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const due = new Date(data.due).toISOString();
    if (!data.title.trim()) return;
    lead.tasks.unshift({id:crypto.randomUUID(),title:data.title.trim(),due,status:'Open',automatic:false});
    update('Scheduled '+data.title+' for '+time(due),'Follow-up scheduled.');
  };
  dialogContent.querySelectorAll('[data-done]').forEach(button=>button.onclick=()=>{
    const task = lead.tasks.find(t=>t.id===button.dataset.done);
    task.status='Complete';
    update('Completed '+task.title,'Follow-up completed.');
  });
  if (!dialog.open) dialog.showModal();
}

document.querySelector('#new').onclick=newInquiry;
view.onclick=event=>{
  const id=event.target.closest('[data-lead]')?.dataset.lead;
  if (id) showLead(state.leads.find(lead=>lead.id===id));
};
dialog.onclick=event=>{if (event.target.closest('[data-close]')) dialog.close();};
window.addEventListener('hashchange',render);
render();
