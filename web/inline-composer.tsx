import {workflowIds} from '../shared/studio.js';
import {ResizablePrompt} from './resizable-prompt.js';
import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {MentionPicker,mentionPattern,isInputMention,type InputMention} from './input-mentions.js';
import {workflowLabels} from './workflow-labels.js';

const labels:Record<string,string>={...Object.fromEntries(Object.entries(workflowLabels).map(([k,v])=>['/'+k,v])),'/reasoning':'Reasoning'};
const tokens=new RegExp('(?<!\\S)(\\/(?:'+workflowIds.join('|')+'|reasoning))(?=\\s|$)','g');
function parts(text:string){return text.split(tokens);}
export function CommandText({text}:{text:string}){return <>{parts(text).map((part,i)=>labels[part]?<span className="command-badge" key={i}>{labels[part]}</span>:part)}</>;}
export interface ComposerHandle {value:string;selectionStart:number;selectionEnd:number;focus:()=>void;setSelectionRange:(start:number,end:number)=>void;insert:(text:string)=>void}
type Props={mentions?:InputMention[];label?:string;id?:string;disabled?:boolean;multiline?:boolean;value:string;placeholder:string;expanded:boolean;activeOption?:string;onChange:(value:string,caret:number)=>void;onSelect:(caret:number)=>void;onKeyDown:(event:React.KeyboardEvent<HTMLDivElement>)=>void;onPasteFiles:(files:File[])=>void};
function read(node:Node):string{
 if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
 if(node instanceof HTMLElement&&node.dataset.command)return node.dataset.command;
 if(node.nodeName==='BR')return '\n';
 return Array.from(node.childNodes).map(read).join('');
}
function offset(root:HTMLElement,node:Node|null,at:number):number{
 if(!node||!root.contains(node))return read(root).length;
 let total=0,found=false;
 function walk(current:Node){if(found)return;if(current===node){total+=current.nodeType===Node.TEXT_NODE?at:Array.from(current.childNodes).slice(0,at).map(read).join('').length;found=true;return;}if(current instanceof HTMLElement&&current.dataset.command){total+=read(current).length;return;}if(current.nodeType===Node.TEXT_NODE||current.nodeName==='BR'){total+=read(current).length;return;}for(const child of current.childNodes)walk(child);}
 walk(root);return total;
}
function locate(root:HTMLElement,position:number):[Node,number]{
 let left=position,result:[Node,number]|undefined;
 function walk(node:Node){if(result)return;if(node.nodeType===Node.TEXT_NODE){const size=read(node).length;if(left<=size)result=[node,left];else left-=size;return;}
  if(node instanceof HTMLElement&&node.dataset.command){const size=read(node).length;if(left<size){const parent=node.parentNode!;result=[parent,Array.from(parent.childNodes).indexOf(node)+(left?1:0)];}else left-=size;return;}
  for(const child of node.childNodes)walk(child);
 }
 walk(root);return result??[root,root.childNodes.length];
}
export const InlineComposer=forwardRef<ComposerHandle,Props>(function InlineComposer({mentions,label='Chat message',id,disabled=false,multiline=false,value,placeholder,expanded,activeOption,onChange,onSelect,onKeyDown,onPasteFiles},ref){
 const root=useRef<HTMLDivElement>(null),composing=useRef(false),lastSelection=useRef({start:0,end:0});
 const [mentionCaret,setMentionCaret]=useState(0),[mentionIndex,setMentionIndex]=useState(0),[mentionDismissed,setMentionDismissed]=useState(false);
 const query=value.slice(0,mentionCaret).match(/(?:^|\s)@([^@\n]*)$/)?.[1];
 const mentionOpen=mentions!==undefined&&query!==undefined&&!mentionDismissed&&!disabled;
 const choices=(mentions??[]).filter(item=>!item.hidden&&(item.label+' '+item.name).toLowerCase().includes((query??'').toLowerCase()));
 const option=mentionIndex%Math.max(1,choices.length);
 function track(at:number){setMentionCaret(at);onSelect(at);}
 function choose(item:InputMention){item.onChoose?.();const start=mentionCaret-(query?.length??0)-1;const next=value.slice(0,start)+item.token+' '+value.slice(mentionCaret);onChange(next,start+item.token.length+1);setMentionDismissed(true);requestAnimationFrame(()=>select(start+item.token.length+1,start+item.token.length+1));}
 function selection(){const el=root.current!,s=getSelection();if(document.activeElement===el&&s?.anchorNode&&el.contains(s.anchorNode))lastSelection.current={start:offset(el,s.anchorNode,s.anchorOffset),end:offset(el,s.focusNode,s.focusOffset)};return lastSelection.current;}
 function select(start:number,end:number){const el=root.current!;el.focus();const a=locate(el,start),b=locate(el,end),range=document.createRange();range.setStart(...a);range.setEnd(...b);const s=getSelection();s?.removeAllRanges();s?.addRange(range);lastSelection.current={start,end};track(end);}
 useImperativeHandle(ref,()=>({get value(){return read(root.current!);},get selectionStart(){const s=selection();return Math.min(s.start,s.end);},get selectionEnd(){const s=selection();return Math.max(s.start,s.end);},focus:()=>root.current?.focus(),setSelectionRange:select,insert}));
 function render(text:string){const el=root.current!;el.replaceChildren();for(const part of parts(text).flatMap(p=>mentions?p.split(mentionPattern):[p])){const mention=mentions?.find(item=>item.token===part),isMention=mentions!==undefined&&isInputMention(part);if(isMention){const chip=document.createElement('span');chip.className='input-mention'+(mention?'':' missing');chip.contentEditable='false';chip.dataset.command=part;chip.textContent=mention?.label??'Missing input';chip.title=mention?'Preview '+mention.name:'Remove or replace this missing input';chip.setAttribute('role','button');chip.tabIndex=0;chip.onclick=()=>mention?.onPreview();chip.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();mention?.onPreview();}};el.append(chip);continue;}if(!labels[part]){el.append(document.createTextNode(part));continue;}const chip=document.createElement('span');chip.className='command-badge';chip.contentEditable='false';chip.dataset.command=part;chip.append(document.createTextNode(labels[part]!));const remove=document.createElement('button');remove.type='button';remove.className='command-remove';remove.textContent='×';remove.setAttribute('aria-label','Remove '+labels[part]);remove.title='Remove '+labels[part];remove.onpointerdown=e=>e.preventDefault();remove.onclick=()=>{const start=offset(el,chip.parentNode,Array.from(chip.parentNode!.childNodes).indexOf(chip));const text=read(el),next=text.slice(0,start)+text.slice(start+part.length);onChange(next,start);requestAnimationFrame(()=>select(start,start));};chip.append(remove);el.append(chip);}if(!el.lastChild||el.lastChild.nodeType!==Node.TEXT_NODE)el.append(document.createTextNode(''));}
 const signature=JSON.stringify(mentions?.map(m=>[m.token,m.label]));const previousSignature=useRef<string|undefined>(undefined);
 useLayoutEffect(()=>{if(composing.current)return;const el=root.current!;if(read(el)!==value||el.dataset.rendered!==value||previousSignature.current!==signature){const focused=document.activeElement===el,s=selection();render(value);el.dataset.rendered=value;previousSignature.current=signature;if(focused)select(Math.min(s.start,value.length),Math.min(s.end,value.length));}},[value,signature]);
 function update(){if(composing.current)return;const el=root.current!,text=read(el).slice(0,16000);const at=selection().end;setMentionDismissed(false);setMentionIndex(0);track(at);onChange(text,at);}
 function insert(text:string){const s=selection(),start=Math.min(s.start,s.end),end=Math.max(s.start,s.end),next=read(root.current!).slice(0,start)+text+read(root.current!).slice(end);render(next);select(start+text.length,start+text.length);onChange(next,start+text.length);}
 return <div className="mention-editor">{mentionOpen&&<MentionPicker items={choices} index={option} choose={choose}/>}<ResizablePrompt chat={!multiline}><div id={id} ref={root} className="inline-composer" contentEditable={!disabled} aria-disabled={disabled} suppressContentEditableWarning role="combobox" aria-label={label} aria-multiline="true" aria-autocomplete="list" aria-expanded={expanded||mentionOpen} aria-controls={mentionOpen?'input-mention-options':expanded?'workflow-options':undefined} aria-activedescendant={mentionOpen&&choices.length?'input-mention-'+option:activeOption} data-placeholder={placeholder} onInput={update} onCompositionStart={()=>composing.current=true} onCompositionEnd={()=>{composing.current=false;update();}} onKeyUp={()=>track(selection().end)} onMouseUp={()=>track(selection().end)} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&mentionOpen){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMentionDismissed(true);return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setMentionIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+Math.max(1,choices.length))%Math.max(1,choices.length));return;}if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();if(choices[option])choose(choices[option]!);return;}}if(!e.nativeEvent.isComposing&&(e.key==='Backspace'||e.key==='Delete')){const s=selection();if(s.start===s.end){const at=s.start,all=read(root.current!);let position=0;for(const part of all.split(mentionPattern)){const end=position+part.length;if(isInputMention(part)&&((e.key==='Backspace'&&end===at)||(e.key==='Delete'&&position===at))){e.preventDefault();const next=all.slice(0,position)+all.slice(end);onChange(next,position);requestAnimationFrame(()=>select(position,position));return;}position=end;}}}onKeyDown(e);if(!e.defaultPrevented&&e.key==='Enter'&&(e.shiftKey||multiline)&&!e.nativeEvent.isComposing){e.preventDefault();insert('\n');}}} onCopy={e=>{const s=selection();if(s.start!==s.end){e.preventDefault();e.clipboardData.setData('text/plain',read(root.current!).slice(Math.min(s.start,s.end),Math.max(s.start,s.end)));}}} onPaste={e=>{e.preventDefault();const files=Array.from(e.clipboardData.files);if(files.length)onPasteFiles(files);else insert(e.clipboardData.getData('text/plain'));}}/></ResizablePrompt></div>;
});


