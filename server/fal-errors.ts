export type ProviderIssue = {code:string;message:string;action:string;url?:string;status?:number;retryable:boolean;retry_after_seconds?:number;provider_type?:string};
/** Never return provider input, arbitrary URLs, or raw authentication messages. */
export function falIssue(status:number, body:unknown={}, retryAfter?:string|null):ProviderIssue {
  const b=body as any, details=Array.isArray(b?.detail)?b.detail:[];
  const type=String(b?.error_type??b?.error?.type??details[0]?.type??'');
  const text=[typeof body==='string'?body:'',typeof b?.detail==='string'?b.detail:'',b?.error?.message,typeof b?.error==='string'?b.error:'',b?.message].filter(v=>typeof v==='string').join(' ').toLowerCase();
  let issue:ProviderIssue={code:'provider_error',message:'fal could not complete this request.',action:'Review the request and try again when fal is available.',retryable:false,status};
  // Older queue gateways return an untyped 403 "User is locked. Reason: Exhausted balance".
  if(status===402||['insufficient_balance','insufficient_credits','balance_exhausted'].includes(type)||(status===403&&/exhausted balance|insufficient (balance|credits|funds)|out of credits/.test(text)))
    issue={...issue,code:'insufficient_funds',message:'Your fal account does not have enough credit.',action:'Add credit in fal, then continue the waiting request or review a retry.',url:'https://fal.ai/dashboard/billing'};
  else if(status===401)issue={...issue,code:'invalid_credentials',message:'fal did not accept the API key.',action:'Replace the fal key in Admin → Credentials.',url:'/admin?section=credentials'};
  else if(status===403)issue={...issue,code:'access_denied',message:'Your fal account cannot access this operation.',action:'Check the key’s permissions and account access in fal.',url:'https://fal.ai/dashboard/keys'};
  else if(status===429)issue={...issue,code:'rate_limited',message:'fal is limiting requests right now.',action:'Wait, then continue the waiting request or review a retry.',retryable:true};
  else if(type==='content_policy_violation')issue={...issue,code:'content_rejected',message:'fal declined the prompt or reference content.',action:'Review the prompt and references before trying again.'};
  else if(type==='file_download_error')issue={...issue,code:'input_unavailable',message:'fal could not download an input or LoRA.',action:'Check the input files and adapter status, then retry.'};
  else if(type==='no_media_generated')issue={...issue,code:'no_output',message:'The model returned no media.',action:'Adjust the request before trying again.'};
  else if(status===404)issue={...issue,code:'not_found',message:'fal could not find the model or request.',action:'Check the saved request in fal before submitting it again.',url:'https://fal.ai/dashboard/requests'};
  else if(status===400||status===422)issue={...issue,code:'invalid_input',message:'fal rejected the generation settings or adapter.',action:'Check reference formats, clip lengths, and LoRA compatibility before retrying.'};
  else if(status===408||status===504||/timeout/.test(type))issue={...issue,code:'provider_timeout',message:'The fal request timed out.',action:'Check the saved request status before trying again.',retryable:true};
  else if(status>=500||/runner_|internal_|downstream_/.test(type))issue={...issue,code:'provider_unavailable',message:'fal encountered a service or model error.',action:'Wait for fal to recover. Check this request before retrying.',retryable:true};
  if(/^[a-z_]{1,80}$/.test(type))issue.provider_type=type;
  if(retryAfter){const seconds=/^\d+$/.test(retryAfter)?Number(retryAfter):Math.ceil((Date.parse(retryAfter)-Date.now())/1000);if(Number.isFinite(seconds)&&seconds>0)issue.retry_after_seconds=Math.min(seconds,86400);}
  return issue;
}
export class FalError extends Error {
  readonly issue:ProviderIssue;
  constructor(public status:number,body?:unknown,retryAfter?:string|null){const issue=falIssue(status,body,retryAfter);super(issue.message+' '+issue.action);this.issue=issue;}
}
