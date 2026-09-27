import React from 'react';
import {inputLabelPatternSource} from '../shared/reference-labels.js';
import './input-mentions.css';
export type InputMention={id:string;token:string;label:string;name:string;kind:string;url:string;asset_id?:string;input_id?:string;channel?:'audio';earlier?:boolean;hidden?:boolean;onChoose?:()=>void;onPreview:()=>void};
const boundMentionSource='\\['+inputLabelPatternSource+'\\]\\(asset:[^)]+\\)';
const mentionSource='<'+inputLabelPatternSource+'>|'+boundMentionSource+'|\\[removed reference\\]';
export const boundMentionPattern=new RegExp('('+boundMentionSource+')','g');
export const unboundMentionPattern=new RegExp('<'+inputLabelPatternSource+'>');
export const mentionPattern=new RegExp('('+mentionSource+')','g');
const wholeMentionPattern=new RegExp('^(?:'+mentionSource+')$');
export function isInputMention(value:string){return wholeMentionPattern.test(value);}
export function MentionThumbnail({item}:{item:InputMention}){return <span className="mention-thumbnail" aria-hidden="true">{item.kind==='image'?<img src={item.url} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>:item.kind==='video'?<><video src={item.url+'#t=0.1'} muted playsInline preload="metadata"/><span>▶</span></>:<span>♫</span>}</span>;}
export function MentionPicker({items,index,choose}:{items:InputMention[];index:number;choose:(item:InputMention)=>void}){return <div className="mention-picker" role="listbox" id="input-mention-options" aria-label="Input references">{!items.length?<p>No matching inputs</p>:items.map((item,i)=><button key={item.id} id={'input-mention-'+i} type="button" role="option" aria-selected={i===index} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(item)}><MentionThumbnail item={item}/><span><strong>{item.label}</strong><small>{item.name}</small></span>{item.earlier&&<small>Earlier in chat</small>}</button>)}</div>;}
export function MentionText({text,onPreview}:{text:string;onPreview:(id:string,label?:string)=>void}){return <>{text.split(boundMentionPattern).map((part,i)=>{const match=part.match(/^\[([^\]]+)\]\(asset:([^)]+)\)$/);return match?<button type="button" className="input-mention" key={i} title="Preview input" onClick={()=>onPreview(match[2]!,match[1]!)}>{match[1]}</button>:part;})}</>;}
