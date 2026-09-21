import React from 'react';
import type { ImageRequest } from '../server/workflows.js';
import { priceInput } from '../shared/pricing.js';
import { useEstimate } from './hooks/use-estimate.js';
import { CostPreview } from './cost-preview.js';
import { EditableItem } from './revision-controls.js';
import { JobButton } from './job-ui.js';
import './request-card.css';

type CardProps = {
  header: React.ReactNode;
  actions: React.ReactNode;
  footer?: React.ReactNode;
  onEdit: () => void;
};
export function RequestCard({ header, actions, footer, onEdit }: CardProps) {
  return (
    <EditableItem
      className={'job-request-card request-card-surface' + (footer ? ' has-footer' : '')}
      label="Edit request"
      onEdit={onEdit}
    >
      <div className="request-card-body">
        {header}
        <div className="job-controls">{actions}</div>
      </div>
      {footer}
    </EditableItem>
  );
}

/** One quote owns both the displayed total and the approval payload. */
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
  onApprove: (estimateId: string) => void;
}) {
  const cost = useEstimate(priceInput(request));
  return (
    <RequestCard
      header={header}
      onEdit={onEdit}
      footer={<CostPreview cost={cost} />}
      actions={
        <>
          <JobButton icon="close" label="Deny" danger disabled={disabled} onClick={onDeny} />
          <button
            type="button"
            className="job-review-button"
            disabled={disabled || !cost.estimate}
            onClick={() => cost.estimate && onApprove(cost.estimate.id)}
          >
            Approve
          </button>
        </>
      }
    />
  );
}
