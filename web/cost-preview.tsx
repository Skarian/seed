import React from 'react';
import { money } from '../shared/pricing.js';
import type { CostEstimate } from './hooks/use-estimate.js';
import './cost-preview.css';

/** Shared estimate footer for Generate, approval cards, and request review. */
export function CostPreview({ cost }: { cost: CostEstimate }) {
  return (
    <div className="cost-preview" aria-live="polite">
      {cost.estimate ? (
        <span>
          Cost Estimate: <strong>{money(cost.estimate.total)}</strong>
        </span>
      ) : cost.error ? (
        <div className="cost-preview-error">
          <span role="alert">{cost.error}</span>
          {cost.issue?.action && <small>{cost.issue.action}</small>}
          <div>
            {cost.issue?.url && (
              <a
                href={cost.issue.url}
                {...(cost.issue.url.startsWith('https:')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {cost.issue.code === 'insufficient_funds'
                  ? 'Add fal credit ↗'
                  : 'Review account settings ↗'}
              </a>
            )}
            <button type="button" onClick={cost.refresh}>
              Retry estimate
            </button>
          </div>
        </div>
      ) : (
        <span>
          {cost.enabled
            ? 'Cost Estimate: calculating…'
            : 'Add your fal key in Admin to see the cost.'}
        </span>
      )}
    </div>
  );
}
