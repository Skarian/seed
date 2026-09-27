export interface ConversationLine {role:string;text:string}
export interface ConversationSummary {through:number;text:string}

export async function compactConversation(history:ConversationLine[],previous:ConversationSummary|undefined,summarize:(input:string)=>Promise<string>){
  const start=previous?.through??0;
  if(start>history.length)throw Error('Conversation summary is inconsistent with its history.');
  if(JSON.stringify(history.slice(start)).length<=60000)return {summary:previous,recent:history.slice(start)};
  const through=Math.max(start,history.length-8);
  if(through===start)return {summary:previous,recent:history.slice(start)};
  const input=JSON.stringify({previous_summary:previous?.text??'',earlier_messages:history.slice(start,through)});
  if(input.length>200000)throw Error('The earlier conversation exceeds the summarization budget. Start a new chat with the relevant assets.');
  const text=(await summarize(input)).trim();
  if(!text||text.length>16000)throw Error('Conversation summary did not complete within its budget. Try sending again.');
  return {summary:{through,text},recent:history.slice(through)};
}

// Only omit visual context for narrowly recognized, entirely settings-only messages.
// Unrecognized or mixed requests keep the images; merely seeing them in an older turn is insufficient.
export function settingsOnlyMessage(text:string):boolean {
  const value=text.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^please\s+/, '');
  return /^(?:(?:set|change|use|make)\s+)?(?:the\s+)?seed\s+(?:(?:to|is)\s+)?(?:random|\d+)$/.test(value)
    || /^(?:(?:set|change)\s+)?(?:the\s+)?(?:count|output count|number of outputs)\s+(?:to\s+)?\d+$/.test(value)
    || /^(?:make|generate|create)\s+\d+\s+(?:outputs?|copies|variations)$/.test(value)
    || /^(?:(?:set|change)\s+)?(?:the\s+)?(?:aspect ratio|aspect)\s+(?:to\s+)?(?:16:9|9:16)$/.test(value);
}
