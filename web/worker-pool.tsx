import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast/headless";
import {
  workerClassLabels,
  workerStateLabels,
  type PoolAction,
  type PoolWorker,
  type Provider,
} from "../shared/pool.js";
import { useWorkerPool } from "./hooks/use-worker-pool.js";
import { useWorkerOffers } from "./hooks/use-worker-offers.js";
import { useWorkerLaunch } from "./hooks/use-worker-launch.js";
import { Modal } from "./modal.js";
import "./worker-pool.css";
import { WorkerOfferCard } from "./worker-offer.js";
import { type OfferSort } from "../shared/worker-offers.js";
import { useWorkerOfferFilters } from './hooks/use-worker-offer-filters.js';
import { GpuTypeFilter } from './gpu-type-filter.js';
import { formatSpend } from './format.js';
import { WorkerPreparation } from './worker-preparation.js';
import { WorkerStartupLogs } from './worker-startup-logs.js';
import { poolStatusText } from './worker-status.js';
import { WorkerShutdownConfirm, type WorkerShutdown } from './worker-shutdown-confirm.js';
import { hasUndismissedLaunchFailure, isRejectedLaunch, workerStatusLabel } from '../shared/worker-outcome.js';

export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
const elapsed = (seconds: number) =>
  seconds < 60
    ? "<1m"
    : seconds < 3600
      ? Math.floor(seconds / 60) + "m"
      : Math.floor(seconds / 3600) +
        "h " +
        Math.floor((seconds % 3600) / 60) +
        "m";
const providerName = (provider: string) =>
  provider === "runpod" ? "RunPod" : "Vast";
const workerLabel = workerStatusLabel;
export function WorkerActivityRow({ worker }: { worker: PoolWorker }) {
  const pool = useWorkerPool();
  return (
    <section className="worker-activity">
      <div className="job-list-heading">
        <h3>
          {workerClassLabels[worker.worker_class]} worker{" "}
          <small>· {providerName(worker.provider)}</small>
        </h3>
        <span
          className={
            "activity-state" + (worker.issue ? " needs-attention" : "")
          }
        >
          {workerLabel(worker)}
        </span>
      </div>
      <p>{worker.gpu}</p>
      <small>
        {new Date(worker.created_at).toLocaleString()} · {isRejectedLaunch(worker)
          ? 'No rental was created' : `${money(worker.hourly)}/hr · ${formatSpend(worker.estimated_spend)} estimated spend`}
      </small>
      {worker.issue && <p role="alert">{worker.issue.message}</p>}
      <div className="activity-actions">
        <button onClick={() => isRejectedLaunch(worker) ? pool.findAnother(worker.worker_class) : pool.open(undefined, worker.id)}>
          {isRejectedLaunch(worker) ? 'Find another GPU' : worker.issue ? "Resolve worker issue" : "View worker"}
        </button>
      </div>
    </section>
  );
}
function GPU({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="13" rx="3" />
      <circle cx="12" cy="11.5" r="3.5" />
      <path d="M7 21v-3m5 3v-3m5 3v-3M1 8h3m16 0h3M1 14h3m16 0h3" />
    </svg>
  );
}

export function WorkerPoolStatus() {
  const { snapshot, error, open } = useWorkerPool(),
    summary = snapshot?.summary,
    failedLaunches = snapshot?.workers.filter(hasUndismissedLaunchFailure).length ?? 0;
  return (
    <button
      className="worker-status-button"
      onClick={() => open()}
      aria-haspopup="dialog"
      aria-label="GPU workers"
    >
      <GPU />
      <span>
        <strong>
          GPU workers{" "}
          <i
            className={
              "worker-indicator " +
              (error || summary?.needs_attention || failedLaunches
                ? "attention"
                : summary?.active
                  ? "active"
                  : "")
            }
          />
        </strong>
        <small>
          {error
            ? "Reconnect needed"
            : !summary
              ? "Checking workers…"
              : summary.active || failedLaunches
                ? [summary.active && poolStatusText(snapshot!.workers), failedLaunches && `${failedLaunches} launch${failedLaunches === 1 ? '' : 'es'} failed`].filter(Boolean).join(' · ')
                : "No workers running"}
        </small>
        {!!summary?.active && (
          <small>{money(summary.hourly)}/hr · {formatSpend(summary.estimated_spend)} spent</small>
        )}
      </span>
      <span className="worker-status-chevron">↗</span>
    </button>
  );
}

export function WorkerPoolDialog({
  onCredentials,
}: {
  onCredentials: () => void;
}) {
  const pool = useWorkerPool();
  const launch = useWorkerLaunch();
  const { dialog } = pool;
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Desktop scrolls the content; short/mobile screens scroll the whole dialog.
    modalRef.current?.scrollTo({ top: 0 });
    contentRef.current?.scrollTo({ top: 0 });
  }, [dialog.open, dialog.tab]);
  const [shutdown, setShutdown] = useState<WorkerShutdown | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  useEffect(() => setSelection({}), [dialog.workerClass, dialog.selectionVersion]);
  useEffect(() => { if (!dialog.open) setShutdown(null); }, [dialog.open]);
  if (!dialog.open) return null;
  const summary = pool.snapshot?.summary;
  const active =
    pool.snapshot?.workers.filter((worker) => worker.state !== "released") ??
    [];
  const launchFailures = pool.snapshot?.workers.filter(hasUndismissedLaunchFailure) ?? [];
  const released = pool.snapshot?.workers.filter(w => w.state === 'released' && !isRejectedLaunch(w)).sort((a,b) => (b.released_at ?? '').localeCompare(a.released_at ?? '')) ?? [];
  const selectedReleased = released.find(w => w.id === dialog.workerId);
  const recent = released.slice(0,12);
  if (selectedReleased && !recent.includes(selectedReleased)) recent.push(selectedReleased);
  return (
    <Modal
      ref={modalRef}
      className="worker-pool-modal"
      aria-label="GPU workers"
      onCancel={() => {
        // Nested dialogs can route Escape to this layer. Dismiss only the
        // confirmation, and keep it open while its request is in flight.
        if (!shutdown) pool.close();
        else if (!pool.pending.has(shutdown.worker?.id ?? 'pool')) setShutdown(null);
      }}
    >
      <header className="pool-heading">
        <div>
          <p className="pool-eyebrow">YOUR COMPUTE</p>
          <h2>GPU workers</h2>
          <p>Dedicated workers for your images and videos.</p>
        </div>
        <button
          className="pool-close"
          aria-label="Close GPU workers"
          onClick={pool.close}
        >
          ×
        </button>
      </header>
      <div className="pool-summary" aria-label="Worker costs">
        <div>
          <span>Rented workers</span>
          <strong>{summary?.active ?? "—"}</strong>
        </div>
        <div>
          <span>Hourly rate</span>
          <strong>
            {summary ? money(summary.hourly) : "—"}
            <small>/hr</small>
          </strong>
        </div>
        <div>
          <span>Estimated spend</span>
          <strong>{summary ? formatSpend(summary.estimated_spend) : "—"}</strong>
        </div>
      </div>
      <nav className="pool-tabs" aria-label="GPU worker views">
        <button
          aria-current={dialog.tab === "workers" ? "page" : undefined}
          onClick={() => pool.setTab("workers")}
        >
          Workers{active.length > 0 && <span>{active.length}</span>}
        </button>
        <button
          aria-current={dialog.tab === "add" ? "page" : undefined}
          onClick={() => pool.setTab("add")}
        >
          Add workers
        </button>
      </nav>
      <div className="pool-content" ref={contentRef}>
        {pool.error && (
          <p className="pool-notice warning" role="alert">
            {pool.error} <button onClick={pool.refresh}>Retry</button>
          </p>
        )}
        {dialog.tab === "add" ? (
          <AddWorkers
            onCredentials={onCredentials}
            selection={selection}
            setSelection={setSelection}
            launch={launch}
          />
        ) : (
          <>
            {launchFailures.length > 0 && <section className="pool-launch-failures" aria-label="Failed launches">
              {launchFailures.map(worker => <LaunchFailure key={worker.id} worker={worker} onCredentials={onCredentials} />)}
            </section>}
            {!pool.loaded && !pool.error ? (
              <p className="pool-loading" role="status">
                Loading workers…
              </p>
            ) : !active.length ? (launchFailures.length ? null : (
              <div className="pool-empty">
                <GPU />
                <h3>Your next idea starts here</h3>
                <p>
                  Start an Image or Video worker. Approved requests wait safely
                  until a compatible worker is ready.
                </p>
                <button
                  className="pool-primary"
                  onClick={() => pool.setTab("add")}
                >
                  Find workers <span>↗</span>
                </button>
              </div>
            )
            ) : (
              <>
                <div className="pool-worker-list">
                  {active.map((worker) => (
                    <WorkerRow
                      key={worker.id}
                      worker={worker}
                      selected={worker.id === dialog.workerId}
                      onCredentials={onCredentials}
                      onShutdown={(action) => setShutdown({ action, worker })}
                    />
                  ))}
                </div>
                <p className="pool-running-note">
                  Workers stay running until you quit them. Preparation and idle
                  time count toward estimated spend; provider invoices may
                  include other charges.
                </p>
                <div className="pool-quit-all">
                  <span>
                    {active.length === 1 ? '1 worker' : `All ${active.length} workers`} · {money(summary?.hourly ?? 0)}
                    /hr
                  </span>
                  <div>
                    <button
                      disabled={pool.pending.has("pool") || !active.some(worker => worker.actions.includes('finish'))}
                      onClick={() => setShutdown({ action: "finish" })}
                    >
                      Finish jobs and quit all
                    </button>
                    <button
                      className="pool-danger"
                      disabled={pool.pending.has("pool")}
                      onClick={() => setShutdown({ action: "quit" })}
                    >
                      Cancel jobs and quit all now
                    </button>
                  </div>
                </div>
              </>
            )}
            {!!pool.snapshot?.workers.some(
              (worker) => worker.state === "released" && !isRejectedLaunch(worker),
            ) && (
              <details className="pool-released" key={selectedReleased?.id ?? 'recent'} open={selectedReleased ? true : undefined}>
                <summary>Recently released</summary>
                {recent.map((worker) => (
                    <section className="pool-released-worker" key={worker.id}>
                    <div className="pool-released-identity">
                      <span>
                        {workerClassLabels[worker.worker_class]} · {worker.gpu}
                        <small>
                          {providerName(worker.provider)} ·{" "}
                          {elapsed(worker.elapsed_seconds)}
                        </small>
                      </span>
                      <strong>
                        {formatSpend(worker.estimated_spend)}
                        <small>estimated total</small>
                      </strong>
                    </div>
                    <WorkerStartupLogs worker={worker} selected={worker.id === dialog.workerId} />
                    </section>
                  ))}
              </details>
            )}
          </>
        )}
      </div>
      {shutdown && <WorkerShutdownConfirm request={shutdown} onClose={() => setShutdown(null)} />}
    </Modal>
  );
}

function LaunchFailure({ worker, onCredentials }: {worker: PoolWorker; onCredentials: () => void}) {
  const pool = useWorkerPool();
  const [error, setError] = useState('');
  async function dismiss() {
    setError('');
    try { await pool.action('dismiss_launch_failure', worker.id); }
    catch (failure) { setError((failure as Error).message); }
  }
  return <article className="pool-launch-failure" aria-label={`${workerClassLabels[worker.worker_class]} worker launch failed`}>
    <div className="pool-worker-top"><span className={'worker-role ' + worker.worker_class}>{workerClassLabels[worker.worker_class]}</span><strong>Launch failed</strong></div>
    <h3>{worker.gpu}</h3>
    <p className="pool-failure-provider">{providerName(worker.provider)} · {worker.region}</p>
    <p role="alert">{worker.issue?.message ?? 'The provider rejected this launch.'}</p>
    <p className="pool-failure-cost">No rental was created. Estimated rental spend: {formatSpend(worker.estimated_spend)}.</p>
    <WorkerStartupLogs worker={worker} />
    <div className="pool-worker-actions">
      <button className="pool-primary" onClick={() => pool.findAnother(worker.worker_class)}>Find another GPU</button>
      {/credential|account|auth/i.test(worker.issue?.code ?? '') && <button onClick={onCredentials}>Open Credentials</button>}
      <button disabled={pool.pending.has(worker.id)} onClick={() => void dismiss()}>Dismiss</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </article>;
}

function WorkerRow({
  worker,
  selected,
  onCredentials,
  onShutdown,
}: {
  worker: PoolWorker;
  selected: boolean;
  onCredentials: () => void;
  onShutdown: (action: WorkerShutdown['action']) => void;
}) {
  const pool = useWorkerPool(),
    [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<PoolAction | null>(null);
  const failed =
    worker.preparation?.files.filter(
      (file) => file.optional && file.error && !file.omitted,
    ) ?? [];
  const busy = pool.pending.has(worker.id) || pool.pending.has("pool");
  async function action(value: Exclude<PoolAction, 'finish' | 'quit'>, paths?: string[]) {
    setError("");
    setPendingAction(value);
    try {
      await pool.action(value, worker.id, paths);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPendingAction(null);
    }
  }
  return (
    <article
      className={
        "pool-worker " +
        (selected ? "selected " : "") +
        (worker.issue ? "has-issue" : "")
      }
      aria-label={
        workerClassLabels[worker.worker_class] + " worker " + worker.gpu
      }
    >
      <div className="pool-worker-top">
        <span className={"worker-role " + worker.worker_class}>
          {workerClassLabels[worker.worker_class]}
        </span>
        <span className={"worker-state " + worker.state}>
          <i />
          {workerLabel(worker)}
        </span>
      </div>
      <div className="pool-worker-identity">
        <div>
          <h3>{worker.gpu}</h3>
          <p>
            {providerName(worker.provider)} · {worker.vram_gb} GB ·{" "}
            {worker.region}
          </p>
        </div>
        <div className="pool-worker-rate">
          <strong>
            {money(worker.hourly)}
            <small>/hr</small>
          </strong>
          <span>{elapsed(worker.elapsed_seconds)} rented</span>
        </div>
      </div>
      <div className="pool-worker-progress">
        <span>
          {worker.current_activity ||
              (worker.state === "ready"
                ? "Ready for your next request"
                : workerStateLabels[worker.state])}
        </span>
        <span>
          Estimated spend <strong>{formatSpend(worker.estimated_spend)}</strong>
        </span>
      </div>
      <WorkerPreparation worker={worker} serverTime={pool.snapshot?.server_time} />
      <WorkerStartupLogs worker={worker} selected={selected} />
      {worker.issue && (
        <div className="pool-notice warning" role="alert">
          <p>{worker.issue.message}</p>
          {/credential|account|auth/i.test(worker.issue.code) && (
            <button onClick={onCredentials}>Open Credentials</button>
          )}
        </div>
      )}
      {worker.actions.includes("local_fallback") && (
        <div className="pool-local-fallback">
          <p>
            Use this PC to download missing base models and transfer them to
            this worker. Adapters still download directly.
          </p>
          <button disabled={busy} onClick={() => void action("local_fallback")}>
            Download through this PC
          </button>
        </div>
      )}
      {failed.length > 0 && (
        <div className="pool-lora-failures">
          <strong>Some LoRAs could not be prepared</strong>
          {failed.map((file, index) => (
            <p key={file.path}>
              Adapter {index + 1}
              <small>{file.error}</small>
            </p>
          ))}
          <div>
            <button
              disabled={busy}
              onClick={() => void action("retry_preparation")}
            >
              {pendingAction === 'retry_preparation' ? 'Retrying…' : 'Retry preparation'}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(
                  "omit_loras",
                  failed.map((file) => file.path),
                )
              }
            >
              Continue without{" "}
              {failed.length === 1 ? "this LoRA" : "these LoRAs"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="pool-notice warning">
          {error}
        </p>
      )}
      <details className="pool-worker-details">
        <summary>
          Worker details · {worker.installed_loras.length}{" "}
          {worker.installed_loras.length === 1 ? "LoRA" : "LoRAs"} prepared
        </summary>
        <dl>
          <div>
            <dt>Compute</dt>
            <dd>{money(worker.compute_hourly)}/hr</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{money(worker.storage_hourly)}/hr</dd>
          </div>
        </dl>
        <p>
          {worker.installed_loras.length
            ? "Choose prepared adapters in Generate or Chat."
            : "No custom LoRAs prepared."}
        </p>
        <p>
          The prepared LoRA set is fixed for this worker. New imports are
          included when you start another worker.
        </p>
        {worker.console_url && (
          <a
            href={worker.console_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open {providerName(worker.provider)} ↗
          </a>
        )}
      </details>
      <footer className="pool-worker-actions">
        {worker.actions.includes("reconnect") && (
          <button disabled={busy} onClick={() => void action("reconnect")}>
            Reconnect
          </button>
        )}
        {worker.actions.includes("retry_preparation") && !failed.length && (
          <button
            disabled={busy}
            onClick={() => void action("retry_preparation")}
          >
            {pendingAction === 'retry_preparation' ? 'Retrying…' : 'Retry preparation'}
          </button>
        )}
        {worker.actions.includes("finish") && (
          <button disabled={busy} onClick={() => onShutdown("finish")}>
            Finish jobs and quit
          </button>
        )}
        {worker.actions.includes("quit") && (
          <button
            className="pool-danger"
            disabled={busy}
            onClick={() => onShutdown("quit")}
          >
            Cancel jobs and quit now
          </button>
        )}
      </footer>
    </article>
  );
}

function AddWorkers({
  onCredentials,
  selection,
  setSelection,
  launch,
}: {
  onCredentials: () => void;
  selection: Record<string, number>;
  setSelection: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  launch: ReturnType<typeof useWorkerLaunch>;
}) {
  const pool = useWorkerPool(),
    role = pool.dialog.workerClass;
  const offers = useWorkerOffers(role, true);
  const [provider, setProvider] = useState<Provider>("vast");
  const items = offers.result?.items ?? [];
  const {filters, setFilter, providerItems, gpuTypes, filtered} = useWorkerOfferFilters(items, role, provider);
  const {region, ceiling, sort} = filters;
  const providerCounts = {vast: 0, runpod: 0};
  for (const offer of items) providerCounts[offer.provider]++;
  const issues = offers.result?.issues.filter(issue => !issue.provider || issue.provider === provider) ?? [];
  const selected = items.filter((offer) => selection[offer.id]);
  const selectedCounts = {vast: 0, runpod: 0};
  for (const offer of selected) selectedCounts[offer.provider] += selection[offer.id]!;
  const count = selected.reduce((n, offer) => n + selection[offer.id]!, 0),
    rate = selected.reduce(
      (n, offer) => n + offer.hourly * selection[offer.id]!,
      0,
    );
  const expired = selected.some(
    (offer) => Date.parse(offer.expires_at) <= Date.now(),
  );
  async function submit() {
    if (
      await launch.launch({
        selections: selected.map((offer) => ({
          offer_id: offer.id,
          quantity: selection[offer.id]!,
        })),
        max_hourly: Number(rate.toFixed(8)),
      })
    ) {
      setSelection({});
      toast.success("Worker request submitted · Preparing your compute");
    }
  }
  return (
    <div className="pool-add">
      <div className="pool-role-picker" role="group" aria-label="Worker type">
        {(["image", "video"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={role === value}
            onClick={() => pool.setWorkerClass(value)}
          >
            <span>{value === "image" ? "▧" : "▷"}</span>
            <strong>{workerClassLabels[value]} worker</strong>
            <small>
              {value === "image"
                ? "Krea generation · Qwen editing"
                : "H3 videos · references and native audio"}
            </small>
          </button>
        ))}
      </div>
      <div className="pool-offer-heading">
      <div className="pool-provider-picker" role="group" aria-label="GPU provider">
        {(["vast", "runpod"] as const).map(value => <button key={value}
          aria-label={providerName(value)} aria-pressed={provider === value} onClick={() => setProvider(value)}>
          <strong>{providerName(value)}</strong>
          <small>{selectedCounts[value] ? `${selectedCounts[value]} selected · ` : ""}{offers.loading ? "Searching…"
            : offers.result?.issues.some(issue => issue.provider === value) ? "Needs attention"
              : `${providerCounts[value]} ${value === "vast" ? "host" : "GPU type"}${providerCounts[value] === 1 ? "" : "s"}`}</small>
        </button>)}
      </div>
        <button disabled={offers.loading} onClick={offers.refresh}>
          {offers.loading ? "Searching…" : "Refresh"}
        </button>
      </div>
      <div className={"pool-filters provider-" + provider}>
        <GpuTypeFilter key={`${role}:${provider}`} options={gpuTypes} value={filters.gpuTypes}
          onChange={gpuTypes => setFilter({gpuTypes})} loading={offers.loading} />
        {provider === "vast" && <label>
          Region
          <select
            value={region}
            onChange={(event) => setFilter({region: event.target.value})}
          >
            <option value="all">All regions</option>
            {[...new Set(providerItems.map((offer) => offer.region))]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </label>}
        <label>
          Maximum hourly rate
          <input
            aria-label="Maximum hourly rate"
            type="number"
            min="0"
            step="0.1"
            placeholder="No limit"
            value={ceiling}
            onChange={(event) => setFilter({ceiling: event.target.value})}
          />
        </label>
        <label>Sort by
          <select value={sort} onChange={event => setFilter({sort: event.target.value as OfferSort})}>
            <option value="price">Lowest hourly rate</option>
            {provider === "vast" ? <><option value="download_cost">Lowest download cost</option>
            <option value="download_speed">Fastest download</option>
            <option value="reliability">Highest reliability</option></>
              : <option value="availability">Highest availability</option>}
          </select>
        </label>
      </div>
      {offers.error && (
        <p className="pool-notice warning" role="alert">
          {offers.error} <button onClick={offers.refresh}>Retry search</button>
        </p>
      )}
      {issues.map((issue, index) => (
        <div key={index} className="pool-notice warning" role="status">
          <strong>
            {issue.provider && !issue.message.toLowerCase().includes(providerName(issue.provider).toLowerCase()) ? providerName(issue.provider) + ": " : ""}
            {issue.message}
          </strong>
          {/credential|auth|config/i.test(issue.code) && (
            <button onClick={onCredentials}>Open Credentials</button>
          )}
        </div>
      ))}
      {offers.loading && !items.length ? (
        <div className="pool-loading" role="status">
          <span className="generation-spinner" />
          Searching available GPUs…
        </div>
      ) : filtered.length ? (
        <div className="pool-offers">
          {filtered.map((offer) => (
            <WorkerOfferCard
              key={offer.id}
              offer={offer}
              quantity={selection[offer.id] ?? 0}
              onQuantity={(value) =>
                setSelection((current) => ({ ...current, [offer.id]: value }))
              }
            />
          ))}
        </div>
      ) : (
        <div className="pool-empty compact">
          <h3>{!providerItems.length && issues.length ? 'Availability needs attention' : 'No matching GPUs'}</h3>
          <p>
            {!providerItems.length && issues.length ? 'Resolve the provider messages above, then refresh availability.'
              : filters.gpuTypes.length ? 'Choose other GPU types, clear the GPU filter or adjust the other filters.'
              : provider === 'vast' ? 'Try another region, raise the rate limit or refresh availability.' : 'Raise the rate limit, refresh availability or check Vast.'}
          </p>
          {!!filters.gpuTypes.length && <button onClick={() => setFilter({gpuTypes: []})}>Clear GPU filter</button>}
        </div>
      )}
      <p className="pool-offer-note">
        Every new worker prepares all enabled compatible LoRAs. Availability is
        checked again when you start. Workers remain rented until you quit them.
      </p>
      <div className="pool-launch-footer">
        <div>
          <strong>
            {count
              ? `${count} worker${count === 1 ? "" : "s"} selected`
              : "Choose your workers"}
          </strong>
          <span>
            {count
              ? `${money(rate)}/hr added · ${money(rate + (pool.snapshot?.summary.hourly ?? 0))}/hr total`
              : "Rates include listed compute and storage."}
          </span>
          {!!count && <span className="pool-selection-providers">{(["vast", "runpod"] as const).filter(p => selectedCounts[p]).map(p => `${selectedCounts[p]} ${providerName(p)}`).join(" · ")}</span>}
        </div>
        <button
          className="pool-primary"
          disabled={!count || expired || launch.busy || offers.loading}
          onClick={() => void submit()}
        >
          {launch.busy
            ? "Starting…"
            : count
              ? `Start ${count} worker${count === 1 ? "" : "s"}`
              : "Start workers"}{" "}
          <span>↗</span>
        </button>
        {expired && (
          <p role="alert">
            These quotes expired. Refresh availability before starting.
          </p>
        )}
        {launch.error && <p role="alert">{launch.error}</p>}
        <small>
          Startup, idle time and transfers may add to the total. Estimated spend
          begins when resources are allocated.
        </small>
      </div>
    </div>
  );
}
