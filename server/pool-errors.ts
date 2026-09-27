import type { PoolIssue, Provider } from "../shared/pool.js";
/** A bounded initial transport wait; retain evidence without declaring a fault. */
export class WorkerStarting extends Error {}
export class PoolError extends Error {
  constructor(
    public issue: PoolIssue,
    public definitive = true,
    public retryAfterMs?: number,
  ) {
    super(issue.message);
  }
}
export function providerFailure(status: number, provider: Provider, detail?:unknown): PoolError {
  const data=detail as any;
  const providerCode=String(data?.error?.code??data?.error??data?.code??'').toLowerCase();
  const reason=String(data?.detail??data?.msg??data?.message??'').toLowerCase();
  // Provider-specific replies can use 400/200 for business failures. Keep raw
  // explanations in private diagnostics; user copy remains controlled.
  if(status===400||status===200) {
    if(/insufficient.*(fund|credit|balance)|balance.*(low|insufficient)/.test(providerCode+' '+reason)) status=402;
    else if(/no.*(capacity|gpu.*available)|offer.*(unavailable|rented)|not.*rentable|no_such_ask/.test(providerCode+' '+reason))status=409;
  }
  const [code, message, action, retryable] =
    status === 401
      ? [
          "invalid_credentials",
          "The provider key was rejected.",
          "Update credentials",
          false,
        ]
      : status === 402
        ? [
            "insufficient_funds",
            "The provider balance is too low to start this worker.",
            "Open provider billing",
            false,
          ]
        : status === 403
          ? [
              "access_denied",
              "The provider key cannot manage these resources.",
              "Update credentials",
              false,
            ]
          : status === 429
            ? [
                "rate_limited",
                "The provider is receiving too many requests.",
                "Retry",
                true,
              ]
            : status === 409
              ? [
                  "capacity_unavailable",
                  "This capacity is no longer available.",
                  "Refresh offers",
                  true,
                ]
              : status === 400 || status === 422
                ? ['invalid_provider_request','The provider rejected the worker configuration. Details were saved in acquisition history.','Review worker configuration',false]
              : [
                  "provider_unavailable",
                  "The provider could not complete this operation.",
                  "Retry",
                  true,
                ];
  return new PoolError(
    {
      code: String(code),
      message: String(message),
      action: String(action),
      retryable: Boolean(retryable),
      provider,
    },
    status < 500 && status !== 408,
  );
}
export function poolIssue(error: unknown, worker_id?: string): PoolIssue {
  return {
    ...(error instanceof PoolError
      ? error.issue
      : {
          code: "connection_failed",
          message:
            "Cannot reach this worker. Reconnect or quit the rental; it may still be billed.",
          retryable: true,
          action: "Reconnect",
        }),
    ...(worker_id ? { worker_id } : {}),
  };
}
