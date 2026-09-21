import type {Job} from '../server/jobs.js';
export type JobRecord=Job;
export function jobState(job:JobRecord){
  if(job.state==='completed')return 'completed';
  if(job.recovery_blocked)return 'failed';
  return ({needs_attention:'unknown',uploading:'starting',submitting:'starting',copying:'saving',cancel_requested:'cancelling'} as Record<string,string>)[job.state]??job.state;
}
export const jobStateLabels:Record<string,string>={queued:'Queued',starting:'Starting',running:'Generating',saving:'Saving',cancelling:'Cancelling',completed:'Complete',failed:'Failed',blocked:'Needs action',unknown:'Status unknown',cancelled:'Cancelled'};
export const jobActive=(j:JobRecord)=>!['completed','failed','cancelled','unknown','blocked'].includes(jobState(j));
export function groupJobs(jobs:JobRecord[]){const groups=new Map<string,JobRecord[]>();for(const job of jobs){const key=job.submission_id||job.id;groups.set(key,[...(groups.get(key)??[]),job]);}return [...groups.values()].map(g=>g.sort((a,b)=>a.submission_index-b.submission_index));}
