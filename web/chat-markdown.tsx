import React from 'react';
import {Streamdown} from 'streamdown';

const components = {
  strong: ({children}:any) => <strong>{children}</strong>,
  em: ({children}:any) => <em>{children}</em>,
  del: ({children}:any) => <del>{children}</del>,
  a: ({href,children}:any) => <a href={href && /^(https?:|mailto:|\/|#)/i.test(href)?href:undefined} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({alt}:any) => <span>{alt || 'Image'}</span>,
  pre: ({children}:any) => <pre>{children}</pre>,
  code: ({children}:any) => <code>{children}</code>,
  table: ({children}:any) => <div className="markdown-table"><table>{children}</table></div>,
};
export function ChatMarkdown({text,streaming=false}:{text:string;streaming?:boolean}){
  return <Streamdown className="chat-markdown" mode={streaming?'streaming':'static'} isAnimating={streaming} controls={false} components={components} rehypePlugins={[]} skipHtml>{text}</Streamdown>;
}


