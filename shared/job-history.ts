/** Passive compatibility for saved API-provider jobs. No transport or pricing behavior. */
export type HistoricalProviderIssue = {code:string;message:string;action:string;url?:string;status?:number;retryable:boolean;retry_after_seconds?:number;provider_type?:string};
export type HistoricalFalReceipt = {request_id:string;status_url:string;response_url:string;cancel_url:string};
export type HistoricalEstimate = {id:string;currency:'USD';per_item:number;total:number;count:number;endpoint:string;billable_units:number;unit:string;breakdown:string;expires_at:string};
