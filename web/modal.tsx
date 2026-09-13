import React,{forwardRef,useRef} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
type Props=React.HTMLAttributes<HTMLDivElement>&{onCancel:(event:{preventDefault:()=>void})=>void};
export const Modal=forwardRef<HTMLDivElement,Props>(function Modal({children,className,onCancel,...props},ref){
  const trigger=useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  return <Dialog.Root open onOpenChange={open=>{if(!open)onCancel({preventDefault(){}});}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content ref={ref} className={'seed-modal '+(className??'')} {...props} aria-describedby={props['aria-describedby']} onPointerDownOutside={e=>e.preventDefault()} onCloseAutoFocus={e=>{e.preventDefault();if(trigger.current?.isConnected)trigger.current.focus();}}><Dialog.Title className="sr-only">{props['aria-label']??'Review details'}</Dialog.Title>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
});
