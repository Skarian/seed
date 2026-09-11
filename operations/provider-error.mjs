// Preserve actionable provider diagnostics without echoing credentials or env maps.
export function providerError(response, problem, {body, headers}) {
  const hidden = [headers.Authorization?.replace(/^Bearer /i,''), ...Object.values(body?.env ?? {})]
    .filter(value=>typeof value==='string' && value.length>5);
  const clean = value => {
    if(typeof value!=='string')return undefined;
    let text=value.slice(0,2000);
    for(const secret of hidden)text=text.replaceAll(secret,'[redacted]');
    return text.replace(/https?:\/\/\S+/g,'[URL omitted]')
      .replace(/\b(?:hf_|rpa_|ghp_|github_pat_)[\w-]+/g,'[redacted]')
      .replace(/(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
  };
  const details={status:response.status,code:clean(problem?.code ?? problem?.error),
    title:clean(problem?.title),detail:clean(problem?.detail ?? problem?.msg),
    retry_after:response.headers.get('retry-after')};
  // Validation paths explain bad requests without reproducing submitted values.
  if(Array.isArray(problem?.errors))details.fields=problem.errors.map(e=>clean(e.field ?? e.path ?? e.pointer)).filter(Boolean);
  const error=new Error(`Provider HTTP ${response.status}: ${details.detail || details.title || details.code || 'Request rejected'}. Inspect state before retrying a mutation.`);
  error.provider=details;
  return error;
}
