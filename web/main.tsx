import {Sidebar} from './sidebar.js';
import * as Collapsible from '@radix-ui/react-collapsible';
import {useAppLayout} from './app-layout.js';
import { SpicyProvider, SpicyBrand, useSpicy, presentAsset } from "./spicy-mode.js";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  LibraryAsset,
  StudioSnapshot,
  WorkflowId,
} from "../shared/studio.js";
import "./style.css";
import { FrameViewer } from "./frame-viewer.js";
import { AssetNote } from './asset-note.js';
import { Chat } from './chat.js';
import { MediaPreview } from './media-preview.js';
import { ConfirmDialog } from "./confirm-dialog.js";
import { MediaCard, LoadingIndicator } from "./media-card.js";
import { uploadReferences } from "./uploads.js";
import {
  ReferenceInputs,
  useReferences,
  referenceIssues,
  referencePromptIssue,
} from "./references.js";

const workflows: Record<WorkflowId, { title: string; placeholder: string }> = {
  "text-to-image": {
    title: "Text to image",
    placeholder: "Describe your image…",
  },
  "image-to-image": {
    title: "Image to image",
    placeholder: "Describe what to change…",
  },
  "text-to-video": {
    title: "Text to video",
    placeholder: "Describe the scene, movement and sound…",
  },
  "reference-to-video": {
    title: "Reference to video",
    placeholder: "Describe the scene using your references…",
  },
};
type Draft = {
  prompt: string;
  aspect: "16:9" | "9:16";
  duration: string;
  exportImages?: boolean;
  audio?: "generated" | "silent";
  count: number;
  randomSeed: boolean;
  seed: string;
};
const emptyDraft = (): Draft => ({
  prompt: "",
  aspect: "16:9",
  duration: "5",
  count: 1,
  randomSeed: true,
  seed: "0",
});
function loadDrafts(): Partial<Record<WorkflowId, Draft>> {
  try {
    const saved = JSON.parse(
      localStorage.getItem("seed.drafts.v2") ??
        localStorage.getItem("studio.drafts.v2") ??
        "{}",
    );
    const legacy = JSON.parse(localStorage.getItem("studio.drafts.v1") ?? "{}");
    const result: Partial<Record<WorkflowId, Draft>> = {};
    for (const id of Object.keys(workflows) as WorkflowId[]) {
      const entry = saved?.[id];
      result[id] = {
        prompt:
          typeof entry?.prompt === "string"
            ? entry.prompt
            : typeof legacy?.[id] === "string"
              ? legacy[id]
              : "",
        aspect: entry?.aspect === "9:16" ? "9:16" : "16:9",
        duration:
          Number.isInteger(Number(entry?.duration)) && Number(entry.duration)>=5 && Number(entry.duration)<=15
            ? entry.duration
            : "5",
        exportImages: entry?.exportImages === true,
        count:
          Number.isInteger(entry?.count) &&
          entry.count >= 1 &&
          entry.count <= 16
            ? entry.count
            : 1,
        randomSeed: entry?.randomSeed !== false,
        audio: entry?.audio === "silent" ? "silent" : "generated",
        seed: typeof entry?.seed === "string" ? entry.seed : "0",
      };
    }
    return result;
  } catch {
    return {};
  }
}
function loadHighQuality(): boolean {
  try {
    return localStorage.getItem("seed.video.high-quality") === "true";
  } catch {
    return false;
  }
}
function SeedMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect
        x="7"
        y="5"
        width="19"
        height="22"
        rx="3"
        transform="rotate(12 16 16)"
      />
      <rect
        x="6"
        y="5"
        width="19"
        height="22"
        rx="3"
        transform="rotate(-12 16 16)"
      />
    </svg>
  );
}
function Icon({
  name,
}: {
  name: "reset" | "jobs" | "pod" | "resize" | "close";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "reset" && (
        <>
          <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
        </>
      )}
      {name === "jobs" && (
        <>
          <rect x="4" y="5" width="16" height="15" rx="3" />
          <path d="M8 3v4m8-4v4M8 11h8m-8 4h5" />
        </>
      )}
      {name === "pod" && (
        <>
          <rect x="4" y="4" width="16" height="7" rx="2" />
          <rect x="4" y="14" width="16" height="6" rx="2" />
          <path d="M8 7.5h.01M8 17h.01m5-9.5h3m-3 9.5h3" />
        </>
      )}
      {name === "resize" && <path d="m8 18 10-10m-4 10 4-4" />}
      {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
    </svg>
  );
}

function SavedImage({
  id,
  kind,
  close,
}: {
  id: string;
  kind: "image" | "video" | "audio" | "sequence";
  close: () => void;
}) {
  return <MediaPreview label={kind==='image'?'Saved image':'Saved media'}
    media={{name:'Saved generation',url:`/api/v1/assets/${id}/content`,kind:kind==='sequence'?'image':kind,type:kind}}
    onClose={close} controls={<AssetNote id={id}/>}/>;
}

function App() {
  const {open:sidebarOpen,setOpen:setSidebarOpen,wide}=useAppLayout();
  const [sidebarTarget,setSidebarTarget]=useState<HTMLDivElement|null>(null);
  const [libraryType,setLibraryType]=useState('all');
  const [gpuOpen,setGpuOpen]=useState(false),[jobsOpen,setJobsOpen]=useState(false);
  const [page, setPage] = useState(
    location.pathname === "/chat" ? "chat" : location.pathname === "/library" ? "library" : "generate",
  );
  const [workflow, setWorkflow] = useState<WorkflowId>("text-to-image");
  const [drafts, setDrafts] = useState(loadDrafts);
  const [highQuality, setHighQuality] = useState(loadHighQuality);
  const references = useReferences();
  const [promptHeight, setPromptHeight] = useState(240);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [studio, setStudio] = useState<StudioSnapshot | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const { spicy } = useSpicy();
  const mode = spicy ? "nsfw" : "sfw";
  const visibleAssets = assets.filter(
    (asset) => (asset.mode ?? 'sfw') === mode && (libraryType==='all'||asset.kind===libraryType),
  );
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const loadedMore = useRef(false);
  const deletedAssets = useRef(new Set<string>());
  const [deletingAsset, setDeletingAsset] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Pick<LibraryAsset, "id" | "kind"> | null>(null);
  const [jobs, setJobs] = useState<
    Array<{
      id: string;
      state: string;
      generation_percent?: number;
      outputs: string[];
      request?: {output?: {format?: string};workflow?:string};
      error: string | null;
      uncertainty_acknowledged?: boolean;
    }>
  >([]);
  const [capability, setCapability] = useState<{
    revision: string | null;
    workflows: Record<string, { enabled: boolean; modes: string[]; export_formats?: string[]; duration_seconds?: {step?:number}; qualities?: string[]; native_export?: boolean }>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [submission, setSubmission] = useState<string[]>([]);
  const pendingSubmission = useRef<{ key: string; body: string } | null>(null);
  const [viewAsset, setViewAsset] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectionCode, setConnectionCode] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [editConnection, setEditConnection] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [draftError, setDraftError] = useState(false);
  const draft = drafts[workflow] ?? emptyDraft();
  const updateDraft = (change: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [workflow]: { ...(current[workflow] ?? emptyDraft()), ...change },
    }));
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const responses = await Promise.all(
          ["/api/v1/studio", "/api/v1/jobs", "/api/v1/capabilities"].map(
            (url) => fetch(url, { signal: controller.signal }),
          ),
        );
        if (responses.some((response) => !response.ok))
          throw new Error("Unavailable");
        const [status, history, capabilities] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (!disposed) {
          setStudio(status);
          setJobs(
            history.items.map((job: { outputs: string[] }) => ({
              ...job,
              outputs: job.outputs.filter(
                (id) => !deletedAssets.current.has(id),
              ),
            })),
          );
          setCapability(capabilities);
          setError("");
        }
      } catch {
        if (!disposed) setError("seed is unavailable.");
      }
    }
    async function refreshLibrary() {
      try {
        const response = await fetch("/api/v1/assets?mode=" + mode + (libraryType==='all'?'':'&kind='+libraryType), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const library = await response.json();
        if (disposed) return;
        library.items = library.items.map(presentAsset).filter(
          (asset: LibraryAsset) => !deletedAssets.current.has(asset.id),
        );
        setAssets((current) =>
          loadedMore.current
            ? [
                ...library.items,
                ...current.filter(
                  (asset) =>
                    !library.items.some(
                      (fresh: LibraryAsset) => fresh.id === asset.id,
                    ),
                ),
              ]
            : library.items,
        );
        if (!loadedMore.current) setAssetCursor(library.next_cursor ?? null);
        setLibraryLoaded(true);
        setLibraryError("");
      } catch {
        if (!disposed) setLibraryError("Could not load Library. Retrying…");
      }
    }
    void refresh();
    void refreshLibrary();
    const timer = setInterval(() => {
      void refresh();
      void refreshLibrary();
    }, 3000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [connectionRevision, mode, libraryType]);
  useEffect(() => { setAssets([]); setAssetCursor(null); loadedMore.current=false; setLibraryLoaded(false); setViewAsset(null); setDeleteTarget(null); }, [mode,libraryType]);
  useEffect(() => {
    try {
      localStorage.setItem("seed.drafts.v2", JSON.stringify(drafts));
      localStorage.setItem("seed.video.high-quality", String(highQuality));
      setDraftError(false);
    } catch {
      setDraftError(true);
    }
  }, [drafts, highQuality]);
  useEffect(() => {
    const onPopState = () =>
      setPage(location.pathname === "/chat" ? "chat" : location.pathname === "/library" ? "library" : "generate");
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  function navigate(next: string) {
    if(!wide)setSidebarOpen(false);
    setPage(next);
    history.pushState(null, "", next === 'chat' ? '/chat' : next === "library" ? "/library" : "/");
  }
  const video = workflow.endsWith("video");
  const videoCapability = capability?.workflows[workflow];
  const videoQualityIssue = video && capability?.revision
    ? !videoCapability?.native_export
      ? "Update the worker to preserve native video quality."
      : highQuality && !videoCapability.qualities?.includes("high")
        ? "Update the worker to use High Quality."
        : !highQuality && !videoCapability.qualities?.includes("fast")
          ? "Fast video is unavailable. Turn on High Quality to continue."
        : ""
    : "";
  const seedValid =
    draft.randomSeed ||
    (/^(0|[1-9][0-9]{0,15})$/.test(draft.seed) &&
      BigInt(draft.seed) + BigInt(draft.count - 1) <= 9007199254740991n);
  const jobCount = studio ? studio.queue.active + studio.queue.waiting : null;
  const missingReference =
    workflow === "reference-to-video"
      ? referencePromptIssue(draft.prompt, references.groups.video)
      : "";
  const canGenerate =
    !videoQualityIssue &&
    !missingReference &&
    (!video || (!draft.exportImages || capability?.workflows[workflow]?.export_formats?.includes("images"))) &&
    (!video || [5,10,15].includes(Number(draft.duration)) || capability?.workflows[workflow]?.duration_seconds?.step===1) &&
    workflow !== "image-to-image" &&
    (workflow !== "reference-to-video" ||
      (references.groups.video.length > 0 &&
        referenceIssues(references.groups.video, "video").length === 0)) &&
    capability?.workflows[workflow]?.enabled &&
    capability.workflows[workflow].modes.includes(mode) &&
    studio?.worker.connected &&
    !studio.worker.stale &&
    seedValid &&
    Boolean(draft.prompt.trim());
  async function generate() {
    if (missingReference) return;
    setSubmitting(true);
    setGenerationError("");
    let uploaded;
    try {
      if (workflow === "reference-to-video")
        uploaded = await uploadReferences(
          references.groups.video,
          mode,
          setUploadProgress,
        );
    } catch (failure) {
      setGenerationError((failure as Error).message);
      setSubmitting(false);
      setUploadProgress("");
      return;
    }
    setUploadProgress("");
    const body = JSON.stringify({
      workflow,
      capabilities_revision: capability?.revision,
      prompt: draft.prompt,
      mode,
      output: {
        aspect: draft.aspect,
        size: video ? "native" : "1mp",
        ...(video ? { duration_seconds: Number(draft.duration), ...(draft.exportImages ? {format:"images"} : {}) } : {}),
      },
      seed: draft.randomSeed ? "random" : draft.seed,
      count: draft.count,
      ...(uploaded ? { references: uploaded } : {}),
      ...(video ? { quality: highQuality ? "high" : "fast", audio: { output: draft.audio ?? "generated" } } : {}),
    });
    if (pendingSubmission.current?.body !== body)
      pendingSubmission.current = {
        key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        body,
      };
    try {
      const response = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pendingSubmission.current!.key,
        },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) pendingSubmission.current = null;
        throw new Error(
          result.error?.message ?? "Could not submit generation.",
        );
      }
      setSubmission(result.jobs.map((j: { id: string }) => j.id));
      pendingSubmission.current = null;
      setConnectionRevision((x) => x + 1);
    } catch (failure) {
      setGenerationError(
        (failure as Error).message +
          (pendingSubmission.current
            ? " Retry uses the same submission key."
            : ""),
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function moreAssets() {
    if (!assetCursor) return;
    const response = await fetch(
      "/api/v1/assets?mode=" + mode + (libraryType==='all'?'':'&kind='+libraryType) + "&cursor=" + encodeURIComponent(assetCursor),
    );
    if (!response.ok) {
      setGenerationError("Could not load older images.");
      return;
    }
    const page = await response.json();
    loadedMore.current = true;
    setAssets((current) => [
      ...current,
      ...page.items.map(presentAsset).filter(
        (asset: LibraryAsset) =>
          !deletedAssets.current.has(asset.id) &&
          !current.some((existing) => existing.id === asset.id),
      ),
    ]);
    setAssetCursor(page.next_cursor);
  }
  async function deleteAsset(asset: Pick<LibraryAsset, "id" | "kind">) {
    setDeletingAsset(asset.id);
    setDeleteError("");
    try {
      const response = await fetch(
        (asset.kind === "sequence" ? "/api/v1/sequences/" : "/api/v1/assets/") + encodeURIComponent(asset.id),
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Could not delete this file.");
      }
      deletedAssets.current.add(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      loadedMore.current = false;
      setAssetCursor(null);
      setJobs((current) =>
        current.map((job) => ({
          ...job,
          outputs: job.outputs.filter((id) => id !== asset.id),
        })),
      );
      setSubmission((current) =>
        current.filter(
          (id) =>
            !jobs.some(
              (job) =>
                job.id === id &&
                job.outputs.length === 1 &&
                job.outputs[0] === asset.id,
            ),
        ),
      );
      setConnectionRevision((value) => value + 1);
    } catch (failure) {
      throw failure;
    } finally {
      setDeletingAsset(null);
    }
  }
  async function jobAction(url: string) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Operation failed.");
      }
      setConnectionRevision((x) => x + 1);
    } catch (failure) {
      setGenerationError((failure as Error).message);
    }
  }
  const jobLabel = (state: string) =>
    ({
      queued: "Queued",
      submitting: "Sending to GPU",
      running: "Generating",
      copying: "Saving to your PC",
      copy_pending: "Waiting to resume transfer",
      completed: "Saved",
      cancelled: "Cancelled",
      cancel_requested: "Cancelling",
      failed: "Failed",
      needs_attention: "Needs attention",
    })[state] ?? state;
  async function changeConnection(remove = false) {
    setConnecting(true);
    setConnectionError("");
    const code = connectionCode.trim();
    setConnectionCode("");
    try {
      const response = await fetch(
        "/api/v1/connection",
        remove
          ? { method: "DELETE" }
          : {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ connection_code: code }),
            },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Connection failed.");
      setStudio(null);
      setEditConnection(false);
      setConnectionRevision((value) => value + 1);
    } catch (failure) {
      setConnectionError((failure as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  const worker = studio?.worker;
  const preparationError =
    !worker?.stale && worker?.state === "preparing"
      ? worker.preparation?.error?.message
      : null;
  const tone =
    error || preparationError
      ? "error"
      : connecting || !studio
        ? "activity"
        : worker?.stale || worker?.state === "disconnected"
          ? "attention"
          : worker?.state === "ready"
            ? "ready"
            : "activity";
  const workerLabel = {
    error: "Error",
    activity: "Working",
    attention: "Not connected",
    ready: "Ready",
  }[tone];
  const detail = error
    ? "Cannot reach seed. Check that the app is running on your PC."
    : preparationError ||
      (connecting
        ? "Connecting…"
        : !studio
          ? "Checking connection…"
          : tone === "attention"
            ? worker?.connected
              ? "Cannot reach your pod. Check it in RunPod, or connect another pod."
              : "Paste a connection code from your pod to get started."
            : tone === "ready"
              ? "Your GPU is connected and ready."
              : worker?.state === "busy"
                ? "Generating…"
                : "Preparing models and engine…");
  const showConnectionForm =
    (editConnection && (tone === "attention" || connecting)) ||
    Boolean(studio && !worker?.connected);
  function reset() {
    if (workflow === "image-to-image") references.reset("edit");
    if (workflow === "reference-to-video") references.reset("video");
    setDrafts((current) => ({ ...current, [workflow]: emptyDraft() }));
    setPromptHeight(240);
    setAdvancedOpen(false);
  }

  return (
    <div className={`studio-shell ${sidebarOpen?'sidebar-visible':''} page-${page}`}>
      <header className="app-bar"><button className="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded={sidebarOpen} aria-controls="app-sidebar" onClick={()=>setSidebarOpen(!sidebarOpen)}>☰</button>        <SpicyBrand onNavigate={() => navigate("generate")}>
          <span className="brand-mark"><SeedMark /></span>
          seed
        </SpicyBrand>
<span className="page-label">{page}</span></header>
      <Sidebar open={sidebarOpen} wide={wide} onOpenChange={setSidebarOpen}>
        <div className="header-status">
<Collapsible.Root open={gpuOpen} onOpenChange={setGpuOpen}><Collapsible.Trigger asChild><button
            className="pod-button"
            data-tone={tone}
            aria-label={`Pod connection: ${workerLabel}`}
          >
            <Icon name="pod" />
            <span className="status-dot" />
            <span className="pod-label">GPU connection<small>{workerLabel}</small></span><span className="chevron">⌄</span>
          </button></Collapsible.Trigger><Collapsible.Content>      <section
        id="pod-details"
        className="sidebar-dropdown"
        aria-labelledby="pod-title"
      >
        <div className="popover-title">
          <h2 id="pod-title">Pod connection</h2>
          <button
            className="icon-button"
            onClick={()=>setGpuOpen(false)}
            aria-label="Close pod details"
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="popover-status" data-tone={tone} role="status">
          <span className="status-dot" />
          {workerLabel}
        </p>
        <p className="popover-note">{detail}</p>
        {tone === "activity" &&
          worker?.state === "preparing" &&
          !connecting &&
          !worker.stale && (
            <p className="popover-note preparation-detail">
              {worker.preparation?.phase}
            </p>
          )}
        <a
          className="popover-link"
          href="https://console.runpod.io/pods"
          target="_blank"
          rel="noreferrer"
        >
          Open RunPod ↗
        </a>
        {showConnectionForm && (
          <form
            className="connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void changeConnection();
            }}
          >
            <label htmlFor="connection-code">Connection code</label>
            <textarea
              id="connection-code"
              autoComplete="off"
              spellCheck={false}
              value={connectionCode}
              onChange={(event) => setConnectionCode(event.target.value)}
              placeholder="Paste from your pod"
              rows={2}
            />
            <button
              type="submit"
              disabled={connecting || !connectionCode.trim()}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
            {worker?.connected && (
              <button
                className="connection-secondary"
                type="button"
                disabled={connecting}
                onClick={() => {
                  setEditConnection(false);
                  setConnectionCode("");
                  setConnectionError("");
                }}
              >
                Cancel
              </button>
            )}
          </form>
        )}
        {worker?.connected && (
          <div className="connection-actions">
            {tone === "attention" && !showConnectionForm && (
              <button
                disabled={connecting}
                onClick={() => setEditConnection(true)}
              >
                Connect a pod
              </button>
            )}
            <button
              className="connection-secondary"
              disabled={connecting}
              onClick={() => void changeConnection(true)}
            >
              Forget connection
            </button>
          </div>
        )}
        {connectionError && (
          <p className="connection-error" role="alert">
            {connectionError}
          </p>
        )}
      </section>
</Collapsible.Content></Collapsible.Root>
<Collapsible.Root open={jobsOpen} onOpenChange={setJobsOpen}><Collapsible.Trigger asChild><button
            className="jobs-button"
            aria-label={`Jobs${jobCount === null ? "" : `, ${jobCount}`}`}
          >
            <Icon name="jobs" />
            <span>Jobs</span><span className="job-count">{jobCount ?? "–"}</span>
          </button></Collapsible.Trigger><Collapsible.Content>      <section
        id="job-details"
        className="sidebar-dropdown"
        aria-labelledby="jobs-title"
      >
        <div className="popover-title">
          <h2 id="jobs-title">Jobs</h2>
          <button
            className="icon-button"
            onClick={()=>setJobsOpen(false)}
            aria-label="Close jobs"
          >
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <p role="status">Job status unavailable.</p>
        ) : (
          <>
            <div className="job-summary">
              <span>
                Active <strong>{studio?.queue.active ?? "–"}</strong>
              </span>
              <span>
                Waiting <strong>{studio?.queue.waiting ?? "–"}</strong>
              </span>
            </div>
            <div className="job-list">
              {jobs.length === 0 ? (
                <p className="popover-note">No jobs yet.</p>
              ) : (
                jobs.map((job) => (
                  <div key={job.id}>
                    <span>
                      {job.state === "running" && !job.generation_percent
                        ? "Model loading…"
                        : jobLabel(job.state)}
                      {job.state === "running" &&
                        (job.generation_percent ?? 0) > 0 && (
                          <strong
                            className="job-percent"
                            title="Sampling progress; decoding and saving follow"
                          >
                            {job.generation_percent}%
                          </strong>
                        )}
                    </span>
                    {![
                      "completed",
                      "failed",
                      "cancelled",
                      "needs_attention",
                    ].includes(job.state) && (
                      <button
                        onClick={() =>
                          void jobAction(`/api/v1/jobs/${job.id}/cancel`)
                        }
                      >
                        Cancel
                      </button>
                    )}
                    {job.error && <p>{job.error}</p>}
                    {job.state === "needs_attention" &&
                      !job.uncertainty_acknowledged && (
                        <button
                          onClick={() =>
                            void jobAction(`/api/v1/jobs/${job.id}/acknowledge`)
                          }
                        >
                          Continue without rerunning
                        </button>
                      )}
                    {job.uncertainty_acknowledged && (
                      <p>Acknowledged. This job will not be rerun.</p>
                    )}
                  </div>
                ))
              )}
            </div>
            <button
              className="queue-control"
              onClick={() =>
                void jobAction(
                  `/api/v1/queue/${studio?.queue.paused ? "resume" : "pause"}`,
                )
              }
            >
              {studio?.queue.paused ? "Resume queue" : "Pause queue"}
            </button>
            {studio?.safe_to_terminate === true && (
              <p className="popover-note">Safe to stop the pod.</p>
            )}
          </>
        )}
      </section>
</Collapsible.Content></Collapsible.Root>
        </div>
        <nav aria-label="Main navigation">
          {["library", "generate", "chat"].map((item) => (
            <button
              key={item}
              aria-current={page === item ? "page" : undefined}
              onClick={() => navigate(item)}
            >
              {item === "generate" ? "Generate" : item === "chat" ? "Chat" : "Library"}
            </button>
          ))}
        </nav>
        <div className="sidebar-section" ref={setSidebarTarget}/>
        {page==='generate'&&<div className="sidebar-section"><p className="section-label">Workflows</p>{Object.entries(workflows).filter(([id])=>id!=='image-to-image').map(([id,value])=><button key={id} className={workflow===id?'selected':''} onClick={()=>{setWorkflow(id as WorkflowId);setAdvancedOpen(false);if(!wide)setSidebarOpen(false);}}>{value.title}</button>)}</div>}
        {page==='library'&&<div className="sidebar-section"><p className="section-label">Media type</p>{['all','image','video','audio','sequence'].map(type=><button key={type} className={libraryType===type?'selected':''} onClick={()=>{setLibraryType(type);if(!wide)setSidebarOpen(false);}}>{type==='all'?'All media':type==='sequence'?'Frame sequences':type.charAt(0).toUpperCase()+type.slice(1)+'s'}</button>)}</div>}
      </Sidebar>
      <main>
        {page === "generate" ? (
          <>
            <div className="workflow-bar">
              <label className="workflow-select">
                <span>Workflow</span>
                <select
                  value={workflow}
                  onChange={(event) => {
                    setWorkflow(event.target.value as WorkflowId);
                    setPromptHeight(240);
                    setAdvancedOpen(false);
                  }}
                >
                  {Object.entries(workflows).filter(([id])=>id!=="image-to-image").map(([id, value]) => (
                    <option key={id} value={id}>
                      {value.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <section
              className="composer"
              aria-label={workflows[workflow].title}
            >
              <div className="prompt-heading">
                <label htmlFor="prompt">Prompt</label>
                <button
                  className="icon-button"
                  onClick={reset}
                  aria-label="Reset form"
                  title="Reset this workflow"
                >
                  <Icon name="reset" />
                </button>
              </div>
              <div className="prompt-editor">
                <textarea
                  id="prompt"
                  value={draft.prompt}
                  onChange={(event) =>
                    updateDraft({ prompt: event.target.value })
                  }
                  placeholder={workflows[workflow].placeholder}
                  style={{ height: promptHeight }}
                />
                <button
                  className="resize-handle"
                  aria-label="Resize prompt"
                  title="Drag to resize; use arrow keys for small adjustments"
                  onPointerDown={(event) => {
                    drag.current = { y: event.clientY, height: promptHeight };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (drag.current)
                      setPromptHeight(
                        Math.max(
                          140,
                          Math.min(
                            800,
                            drag.current.height +
                              event.clientY -
                              drag.current.y,
                          ),
                        ),
                      );
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setPromptHeight((height) =>
                        Math.max(
                          140,
                          Math.min(
                            800,
                            height + (event.key === "ArrowDown" ? 20 : -20),
                          ),
                        ),
                      );
                    }
                  }}
                >
                  <Icon name="resize" />
                </button>
              </div>
              {draftError && (
                <p role="alert">
                  Draft could not be saved. Keep a copy before closing.
                </p>
              )}
              {(workflow === "image-to-image" ||
                workflow === "reference-to-video") && (
                <ReferenceInputs
                  key={workflow}
                  group={workflow === "image-to-image" ? "edit" : "video"}
                  state={references}
                  seconds={Number(draft.duration)}
                  onInsert={(label) =>
                    updateDraft({
                      prompt:
                        draft.prompt +
                        (draft.prompt.endsWith(" ") || !draft.prompt
                          ? ""
                          : " ") +
                        label +
                        " ",
                    })
                  }
                />
              )}
              <div className="output-settings">
                <fieldset>
                  <legend>Aspect ratio</legend>
                  <div className="frame-options">
                    {(["16:9", "9:16"] as const).map((aspect) => (
                      <button
                        key={aspect}
                        className="frame-option"
                        aria-pressed={draft.aspect === aspect}
                        aria-label={`${aspect === "16:9" ? "Landscape" : "Portrait"} ${aspect}`}
                        onClick={() => updateDraft({ aspect })}
                      >
                        <span
                          className={`frame-shape ${aspect === "9:16" ? "portrait" : "landscape"}`}
                        />
                        <span>
                          {aspect === "16:9" ? "Landscape" : "Portrait"}
                          <small>{aspect}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {video && (
                  <fieldset>
                    <legend>Length</legend>
                    {capability?.workflows[workflow]?.duration_seconds?.step === 1 || !capability?.revision ?
                      <label className="duration-slider"><span>{draft.duration} seconds</span><input aria-label="Length" type="range" min="5" max="15" step="1" value={draft.duration} onChange={e=>updateDraft({duration:e.target.value})}/></label> :
                      <div className="duration-options">{['5','10','15'].map(duration=><button key={duration} aria-pressed={draft.duration===duration} onClick={()=>updateDraft({duration})}>{duration}s</button>)}</div>}

                  </fieldset>
                )}
              </div>
              {video && <label className="export-images" title="Prioritizes acting, motion and dialogue. Takes longer."><input type="checkbox" checked={highQuality} onChange={e=>setHighQuality(e.target.checked)}/>High Quality</label>}
              {videoQualityIssue && <p role="status">{videoQualityIssue}</p>}
              {video && <label className="export-images"><input type="checkbox" checked={Boolean(draft.exportImages)} onChange={e=>updateDraft({exportImages:e.target.checked})}/>Export as images</label>}
              {video && draft.exportImages && capability?.revision && !capability.workflows[workflow]?.export_formats?.includes('images') && <p>Update the worker to export images.</p>}
              <div className="generation-options">
                <label className="batch-field">
                  Generations
                  <select
                    aria-label="Generations"
                    value={draft.count}
                    onChange={(event) =>
                      updateDraft({ count: Number(event.target.value) })
                    }
                  >
                    {Array.from({ length: 16 }, (_, index) => index + 1).map(
                      (count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  className="advanced-toggle"
                  aria-expanded={advancedOpen}
                  aria-controls="advanced-options"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  Advanced{" "}
                  <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
                </button>
              </div>
              {advancedOpen && (
                <section
                  id="advanced-options"
                  className="advanced-options"
                  aria-label="Advanced settings"
                >
                  <label className="seed-switch">
                    <input
                      type="checkbox"
                      checked={draft.randomSeed}
                      onChange={(event) =>
                        updateDraft({ randomSeed: event.target.checked })
                      }
                    />
                    Random seed
                  </label>
                  {draft.randomSeed ? (
                    <p>Different seed for each generation.</p>
                  ) : (
                    <>
                      <label className="seed-field" htmlFor="seed">
                        Starting seed
                        <input
                          id="seed"
                          type="text"
                          inputMode="numeric"
                          maxLength={16}
                          value={draft.seed}
                          aria-invalid={!seedValid}
                          aria-describedby="seed-help"
                          onChange={(event) =>
                            updateDraft({ seed: event.target.value })
                          }
                        />
                      </label>
                      <p id="seed-help">
                        {seedValid
                          ? "For batches, each seed increases by 1."
                          : "Use a whole number from 0 to 9007199254740991, leaving room for the batch."}
                      </p>
                    </>
                  )}
                </section>
              )}
              {!advancedOpen && !seedValid && (
                <p role="alert">Check the starting seed in Advanced.</p>
              )}
              {mode === "nsfw" &&
                capability?.workflows[workflow]?.enabled &&
                !capability.workflows[workflow].modes.includes("nsfw") && (
                  <p className="popover-note">
                    Spicy mode is not available on this pod.
                  </p>
                )}
              {missingReference && <p role="alert">{missingReference}</p>}
              {video && !draft.exportImages && (
                <label className="video-audio">
                  Audio
                  <select
                    value={draft.audio ?? "generated"}
                    onChange={(event) =>
                      updateDraft({
                        audio: event.target.value as "generated" | "silent",
                      })
                    }
                  >
                    <option value="generated">Generated soundtrack</option>
                    <option value="silent">Silent</option>
                  </select>
                </label>
              )}
              <button
                className="generate-button"
                disabled={!canGenerate || submitting}
                onClick={() => void generate()}
                title={
                  canGenerate
                    ? undefined
                    : "Connect a compatible pod and enter a prompt to generate."
                }
              >
                {submitting ? (
                  "Submitting…"
                ) : (
                  <>
                    Create{" "}
                    {draft.count > 1
                      ? `${draft.count} ${video && !draft.exportImages ? "videos" : "images"}`
                      : video && !draft.exportImages
                        ? "video"
                        : draft.exportImages && video ? "images" : "image"}{" "}
                    <span>↗</span>
                  </>
                )}
              </button>
              {generationError && <p role="alert">{generationError}</p>}
              {deleteError && <p role="alert">{deleteError}</p>}
              {uploadProgress && <p role="status">{uploadProgress}</p>}
              {submission.length > 0 && (
                <section
                  className="generation-results"
                  aria-label="Output preview"
                >
                  {submission.map((id) => {
                    const job = jobs.find((j) => j.id === id);
                    return (
                      <div key={id}>
                        {job?.outputs?.length ? (
                          job.request?.output?.format === 'images' ? <MediaCard kind="sequence" src={`/api/v1/assets/${job.outputs[0]}/preview`} frameCount={job.outputs.length} name="Image sequence" onOpen={()=>setViewAsset(job.id)} onDelete={()=>setDeleteTarget({id:job.id,kind:'sequence'})} deleting={deletingAsset!==null}/> : job.outputs.map((asset) => (
                            <MediaCard
                              key={asset}
                              src={`/api/v1/assets/${asset}/content`}
                              kind={
                                assets.find((item) => item.id === asset)
                                  ?.kind ?? (video ? "video" : "image")
                              }
                              name={
                                video ? "Generated video" : "Generated image"
                              }
                              onOpen={() => setViewAsset(asset)}
                              onDelete={() =>
                                setDeleteTarget({
                                  id: asset,
                                  kind:
                                    assets.find((item) => item.id === asset)
                                      ?.kind ?? (video ? "video" : "image"),
                                })
                              }
                              deleting={deletingAsset !== null}
                            />
                          ))
                        ) : (
                          <>
                            <div className="empty-mark">
                              <SeedMark />
                            </div>
                            <p>{job ? jobLabel(job.state) : "Queued"}</p>
                          </>
                        )}
                        {job?.error && <p role="alert">{job.error}</p>}
                      </div>
                    );
                  })}
                </section>
              )}
            </section>
          </>
        ) : page === 'chat' ? <Chat sidebarTarget={sidebarTarget} onChooseChat={()=>{if(!wide)setSidebarOpen(false);}} /> : (
          <section className="library">
            <div className="library-heading">
              <h1>Library</h1>

            </div>
            {deleteError && <p role="alert">{deleteError}</p>}
            {libraryError && <p role="alert">{libraryError}</p>}
            {!libraryLoaded ? (
              <LoadingIndicator label="Loading Library…" />
            ) : visibleAssets.length === 0 ? (
              <div className="library-empty">
                <div className="empty-mark">
                  <SeedMark />
                </div>
                <p>
                  {assets.length
                    ? "No visible files."
                    : "No saved files yet."}
                </p>
              </div>
            ) : (
              <div className="library-grid">
                {visibleAssets.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    src={`/api/v1/assets/${asset.cover_id??asset.id}/${asset.kind==='sequence'?'preview':'content'}`}
                    frameCount={asset.frame_count}
                    kind={asset.kind}
                    name={asset.name}
                    onOpen={() => setViewAsset(asset.id)}
                    onDelete={() => setDeleteTarget(asset)}
                    deleting={deletingAsset !== null}
                  />
                ))}
              </div>
            )}
            {assetCursor && (
              <button
                className="queue-control"
                onClick={() => void moreAssets()}
              >
                Load more
              </button>
            )}
          </section>
        )}
        <footer>seed</footer>
      </main>
      {deleteTarget && <ConfirmDialog title={`Delete this ${deleteTarget.kind}?`} description="This permanently removes the saved file from your PC. This cannot be undone." action="Delete" onConfirm={() => deleteAsset(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
      {viewAsset && (assets.find(a=>a.id===viewAsset)?.kind==='sequence' || jobs.some(j=>j.id===viewAsset && j.request?.output?.format==='images')) ?
        <FrameViewer id={viewAsset} onClose={()=>setViewAsset(null)} onChanged={()=>setConnectionRevision(v=>v+1)}/> : viewAsset && (
        <SavedImage
          kind={
            assets.find((asset) => asset.id === viewAsset)?.kind ??
            (video ? "video" : "image")
          }
          id={viewAsset}
          close={() => setViewAsset(null)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SpicyProvider><App /></SpicyProvider>
  </React.StrictMode>,
);
