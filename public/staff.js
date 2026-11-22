const login = document.querySelector('#login');
const queue = document.querySelector('#queue');
const message = document.querySelector('#message');
const signOut = document.querySelector('#sign-out');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
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
  token = undefined;
  page = 1;
  queue.hidden = signOut.hidden = true;
  login.hidden = false;
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
      identity.append(name,topic);
      row.append(identity,stage);
      list.append(row);
    }
    if (!data.leads.length) list.textContent = 'No active leads available.';
    document.querySelector('#page').textContent = 'Page '+page;
    previous.disabled = page===1;
    next.disabled = !data.hasNext;
    login.hidden = true;
    signOut.hidden = queue.hidden = false;
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
signOut.addEventListener('click',()=>{reset();message.textContent='Signed out.';});
previous.addEventListener('click',()=>loadLeads(page-1));
next.addEventListener('click',()=>loadLeads(page+1));
