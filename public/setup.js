const form=document.querySelector('#setup');
const status=document.querySelector('#setup-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');
  const {key,email,password}=Object.fromEntries(new FormData(form));
  const setupKey=key.trim();
  if (setupKey.length<32) {
    status.textContent='Paste the full Vercel setup key. It must contain at least 32 characters.';
    form.elements.key.focus();
    return;
  }
  button.disabled=true;
  status.textContent='Creating administrator…';
  try {
    const response=await fetch('/api/setup',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+setupKey},
      body:JSON.stringify({email,password})});
    const result=await response.json();
    status.textContent=response.ok ? 'Administrator created. You can now sign in.' :
      response.status===401 ? 'The setup key does not match this deployment. Paste the value saved in Vercel Production.' :
      result.error;
    if (response.ok) {
      form.reset();
      form.remove();
    }
  } catch {
    status.textContent='Setup is unavailable. Try again with the same credentials.';
  } finally {
    button.disabled=false;
  }
});
