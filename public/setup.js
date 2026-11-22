const form=document.querySelector('#setup');
const status=document.querySelector('#setup-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');
  const {key,email,password}=Object.fromEntries(new FormData(form));
  button.disabled=true;
  status.textContent='Creating administrator…';
  try {
    const response=await fetch('/api/setup',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
      body:JSON.stringify({email,password})});
    const result=await response.json();
    status.textContent=response.ok?'Administrator created. You can now sign in.':result.error;
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
