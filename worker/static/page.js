const el = id => document.getElementById(id);
async function request(route, body) {
  const response = await fetch('/worker/v1/' + route, body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await response.json();
  if (response.status === 401) { clearInterval(timer); el('unlock').hidden=false; el('connection').hidden=true; el('code').value=''; }
  if (!response.ok) throw new Error(result.error?.message ?? 'Connection failed.');
  return result;
}
let timer;
async function refresh() {
  try {
    const result = await request('status');
    el('unlock').hidden = true; el('connection').hidden = false;
    const prep = result.preparation;
    el('status').textContent = result.state === 'preparing' ? `Preparing: ${prep.phase}${prep.bytes_total ? ` (${Math.round(100 * prep.bytes_done / prep.bytes_total)}%)` : ''}` : result.state === 'busy' ? 'Generating' : 'Ready';
    el('error').textContent = prep.error?.message ?? '';
  } catch (error) { el('error').textContent = error.message; }
}
el('unlock').onsubmit = async event => {
  event.preventDefault();
  try { await request('unlock', {pairing_secret:el('secret').value}); el('secret').value=''; await refresh(); clearInterval(timer); timer=setInterval(refresh,3000); }
  catch(error) { el('secret').value=''; el('error').textContent=error.message; }
};
el('mint').onclick = async () => {
  try { const result = await request('pairing-codes', {}); el('code').value=result.connection_code; el('code-label').hidden=false; el('copy').hidden=false; el('expiry').textContent='Single use · expires in five minutes'; }
  catch(error) { el('error').textContent=error.message; }
};
el('copy').onclick = async () => { try { await navigator.clipboard.writeText(el('code').value); el('copy').textContent='Copied'; } catch { el('code').select(); el('error').textContent='Select and copy the code above.'; } };
// An existing unlock cookie survives refreshing the page.
request('status').then(() => { void refresh(); timer=setInterval(refresh,3000); }).catch(() => {});
