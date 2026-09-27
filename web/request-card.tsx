import React from 'react';
import type { ImageRequest } from '../shared/generation.js';
import { EditableItem } from './revision-controls.js';
import { JobButton } from './job-ui.js';
import { SelectedLoras } from './lora-picker.js';
import './request-card.css';

type CardProps = {
  request: ImageRequest;
  className?: string;
  header: React.ReactNode;
  actions: React.ReactNode;
  footer?: React.ReactNode;
  onEdit: () => void;
};
export function RequestCard({ request, header, actions, footer, onEdit, className = '' }: CardProps) {
  return (
    <EditableItem
      className={'job-request-card request-card-surface ' + className + (footer ? ' has-footer' : '')}
      label="Edit request"
      onEdit={onEdit}
    >
      <div className="request-card-body">
        {header}
        <div className="job-controls">{actions}</div>
        <SelectedLoras request={request} />
      </div>
      {footer}
    </EditableItem>
  );
}

/** Approval snapshots the request; rental management lives in the worker popup. */
export function ApprovalCard({
  request,
  header,
  disabled,
  onEdit,
  onDeny,
  onApprove,
}: {
  request: ImageRequest;
  header: React.ReactNode;
  disabled: boolean;
  onEdit: () => void;
  onDeny: () => void;
  onApprove: () => void;
}) {
  return (
    <RequestCard
      request={request}
      className="approval-card"
      header={header}
      onEdit={onEdit}
      actions={
        <>
          <JobButton icon="close" label="Deny" danger disabled={disabled} onClick={onDeny} />
          <button
            type="button"
            className="job-review-button"
            disabled={disabled}
            onClick={onApprove}
          >
            Approve
          </button>
        </>
      }
    />
  );
}
