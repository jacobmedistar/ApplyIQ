window.addEventListener('message',async event=>{
  if (event.source!==window || event.origin!==location.origin || event.data?.type!=='applyiq-whatsapp-request') return;
  const {id,action,job,token,sender}=event.data;
  if (!['ping','send'].includes(action) || typeof id!=='string') return;
  let result;
  try {
    result=await chrome.runtime.sendMessage({action,job,token,sender});
  } catch {
    result={error:'The browser extension did not respond.'};
  }
  window.postMessage({type:'applyiq-whatsapp-result',id,result},location.origin);
});
