import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
export function Sidebar({open,wide,onOpenChange,children}:{open:boolean;wide:boolean;onOpenChange:(open:boolean)=>void;children:React.ReactNode}){
 if(wide)return <aside id="app-sidebar" className="app-sidebar" aria-label="Sidebar" inert={!open}>{children}</aside>;
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="sidebar-backdrop"/><Dialog.Content asChild aria-describedby={undefined}><aside id="app-sidebar" className="app-sidebar mobile-sidebar" aria-label="Sidebar"><div className="drawer-heading"><Dialog.Title>Sidebar</Dialog.Title><Dialog.Close aria-label="Close sidebar">✕</Dialog.Close></div>{children}</aside></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

