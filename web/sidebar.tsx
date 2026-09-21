import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import './sidebar.css';
export function Sidebar({
  open,
  wide,
  onOpenChange,
  children,
  heading,
  footer,
}: {
  open: boolean;
  wide: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  heading: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const header = (
    <div className="sidebar-brand-header">
      {heading}
      <button
        className="sidebar-toggle"
        aria-label="Close sidebar"
        onClick={() => {
          onOpenChange(false);
          requestAnimationFrame(() =>
            document.querySelector<HTMLButtonElement>('.app-bar .sidebar-toggle')?.focus(),
          );
        }}
      >
        ‹
      </button>
    </div>
  );
  const body = (
    <>
      {header}
      <div className="sidebar-content">{children}</div>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </>
  );
  if (wide)
    return (
      <aside
        id="app-sidebar"
        className="app-sidebar sidebar-layout"
        aria-label="Sidebar"
        inert={!open}
      >
        {body}
      </aside>
    );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sidebar-backdrop" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <aside
            id="app-sidebar"
            className="app-sidebar sidebar-layout mobile-sidebar"
            aria-label="Sidebar"
          >
            <Dialog.Title className="sr-only">Sidebar</Dialog.Title>
            {body}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
