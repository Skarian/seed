import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
export function Sidebar({open,wide,onOpenChange,children,heading}:{open:boolean;wide:boolean;onOpenChange:(open:boolean)=>void;children:React.ReactNode;heading:React.ReactNode}){
 const header=<div className="sidebar-brand-header">{heading}<button className="sidebar-toggle" aria-label="Close sidebar" onClick={()=>{onOpenChange(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.app-bar .sidebar-toggle')?.focus());}}>‹</button></div>;
 if(wide)return <aside id="app-sidebar" className="app-sidebar" aria-label="Sidebar" inert={!open}>{header}{children}</aside>;
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="sidebar-backdrop"/><Dialog.Content asChild aria-describedby={undefined}><aside id="app-sidebar" className="app-sidebar mobile-sidebar" aria-label="Sidebar"><Dialog.Title className="sr-only">Sidebar</Dialog.Title>{header}{children}</aside></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
