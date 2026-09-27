import React,{forwardRef,useRef,createContext,useContext} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
const ModalDepth=createContext(0);
type Props=React.HTMLAttributes<HTMLDivElement>&{onCancel:(event:{preventDefault:()=>void})=>void};
export const Modal=forwardRef<HTMLDivElement,Props>(function Modal({children,className,onCancel,...props},ref){
  const depth=useContext(ModalDepth);
  const trigger=useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  return <ModalDepth.Provider value={depth+1}><Dialog.Root open onOpenChange={open=>{if(!open)onCancel({preventDefault(){}});}}><Dialog.Portal><Dialog.Overlay className="modal-overlay" style={{zIndex:100+depth*2}}/><Dialog.Content ref={ref} className={'seed-modal '+(className??'')} {...props} style={{...props.style,zIndex:101+depth*2}} aria-describedby={props['aria-describedby']} onPointerDownOutside={e=>e.preventDefault()} onCloseAutoFocus={e=>{e.preventDefault();if(trigger.current?.isConnected)trigger.current.focus();}}><Dialog.Title className="sr-only">{props['aria-label']??'Review details'}</Dialog.Title>{children}</Dialog.Content></Dialog.Portal></Dialog.Root></ModalDepth.Provider>;
});
