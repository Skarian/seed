import {ResizablePrompt} from './resizable-prompt.js';
import {PromptInput} from './prompt-input.js';
import type {ComposerHandle} from './inline-composer.js';
import {inputLabels,remapReferences} from '../shared/reference-labels.js';
import type {PreviewMedia} from './media-preview.js';
import {AspectPicker,BatchPicker,LengthPicker,SeedControl} from './request-controls.js';
import type {JobRecord} from '../shared/jobs.js';
import {jobState} from '../shared/jobs.js';
import {JobsView,JobDetails,JobOutputs,JobButton,JobMedia,jobName} from './job-ui.js';
import {Modal} from './modal.js';
import {BrandSwitcher} from './brand-switcher.js';
import {workflowLabels} from './workflow-labels.js';
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
import './job-ui.css';
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
    title: workflowLabels["text-to-image"],
    placeholder: "Describe your image…",
  },
  "image-to-image": {
    title: workflowLabels["image-to-image"],
    placeholder: "Describe what to change…",
  },
  "text-to-video": {
    title: workflowLabels["text-to-video"],
    placeholder: "Describe the scene, movement and sound…",
  },
  "reference-to-video": {
    title: workflowLabels["reference-to-video"],
    placeholder: "Describe the scene using your references…",
  },
};
type Draft = {
  note?:string;
  sourceJob?:string;
  resolvedSeeds?:string[];
  size?:string;
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
        note:typeof entry?.note==='string'?entry.note:'',
        sourceJob:entry?.sourceJob,size:entry?.size,resolvedSeeds:entry?.resolvedSeeds,
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
    onClose={close} note={<AssetNote id={id}/>}/>;
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
  const promptInput=useRef<ComposerHandle>(null);
  const [inputPreview,setInputPreview]=useState<PreviewMedia|null>(null);
  const priorInputs=useRef<{workflow:string;labels:Map<string,string>;prompt:string}|null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [jobs,setJobs]=useState<JobRecord[]>([]);
  const [resultDetail,setResultDetail]=useState<string|null>(null),[resultPreview,setResultPreview]=useState<JobRecord|null>(null);
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




  const [connectionRevision, setConnectionRevision] = useState(0);
  const [draftError, setDraftError] = useState(false);
  const draft = drafts[workflow] ?? emptyDraft();
  useEffect(()=>{
    const query=new URLSearchParams(location.search),id=query.get('fromJob');if(!id)return;
    let disposed=false;
    void (async()=>{
      const response=await fetch('/api/v1/jobs/'+encodeURIComponent(id));if(!response.ok)throw Error('Original job is no longer available.');
      const job:JobRecord=await response.json(),r=job.request;
      if(r.mode!==mode)throw Error('Switch to the original job’s mode to reuse this request.');
      const refs=await Promise.all((r.references??[]).map(async ref=>{
        const response=await fetch('/api/v1/assets/'+ref.asset_id);const asset=response.ok?await response.json():null;
        return {id:ref.id,asset_id:ref.asset_id,name:asset?.name??'No longer available',kind:ref.kind,type:asset?.mime_type??ref.kind+'/*',url:'/api/v1/assets/'+ref.asset_id+'/content',role:ref.role,framing:ref.framing,include_audio:ref.include_audio,start:ref.range?.start_seconds??0,end:(ref.range?.start_seconds??0)+(ref.range?.duration_seconds??0),duration:asset?.metadata?.duration_seconds,width:asset?.metadata?.width,height:asset?.metadata?.height};
      }));
      const ids=query.get('outputs')?.split(',')??[id];
      const originals=await Promise.all(ids.map(async output=>{const response=await fetch('/api/v1/jobs/'+encodeURIComponent(output));if(!response.ok)throw Error('Output no longer available.');return await response.json() as JobRecord;}));
      if(originals.some(j=>j.submission_id!==job.submission_id))throw Error('Choose outputs from one request.');
      if(disposed)return;
      setWorkflow(r.workflow);setHighQuality(r.quality==='high');
      setDrafts(current=>({...current,[r.workflow]:{prompt:r.prompt,note:r.note,aspect:r.output.aspect,duration:String(r.output.duration_seconds??5),exportImages:r.output.format==='images',audio:r.audio?.output??'generated',count:originals.length,resolvedSeeds:query.get('seed')==='new'?undefined:originals.map(j=>j.seed),randomSeed:query.get('seed')==='new',seed:job.seed,sourceJob:job.id,size:r.output.size}}));
      references.replace('video',refs);setAdvancedOpen(true);
      if(refs.some(ref=>ref.name==='No longer available'))setGenerationError('An original input is no longer available. Remove or replace it before generating.');
      history.replaceState(null,'','/');
    })().catch(e=>{if(!disposed)setGenerationError(e.message);});
    return()=>{disposed=true;};
  },[mode]);
  const updateDraft = (change: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [workflow]: { ...(current[workflow] ?? emptyDraft()), ...change, ...((change.seed!==undefined||change.randomSeed!==undefined||change.count!==undefined)?{resolvedSeeds:undefined}:{}) },
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
  const promptLabels=inputLabels(references.groups.video.map(r=>({...r,asset_id:r.id})));
  const promptMentions=[...promptLabels].map(([id,token])=>{const ref=references.groups.video.find(r=>r.id===(id.endsWith(':audio')?id.slice(0,-6):id))!;return {id,token,label:token.slice(1,-1),name:ref.name+(id.endsWith(':audio')?' · soundtrack':''),kind:ref.kind,url:ref.url,onPreview:()=>setInputPreview(ref)};});
  promptMentions.sort((a,b)=>references.groups.video.findIndex(r=>r.id===(a.id.endsWith(':audio')?a.id.slice(0,-6):a.id))-references.groups.video.findIndex(r=>r.id===(b.id.endsWith(':audio')?b.id.slice(0,-6):b.id))||Number(a.id.endsWith(':audio'))-Number(b.id.endsWith(':audio')));
  useEffect(()=>{const prior=priorInputs.current;let prompt=draft.prompt;if(prior?.workflow===workflow&&prior.prompt===draft.prompt){prompt=remapReferences(prompt,prior.labels,promptLabels);if(prompt!==draft.prompt)updateDraft({prompt});}priorInputs.current={workflow,labels:promptLabels,prompt};},[workflow,draft.prompt,JSON.stringify([...promptLabels])]);
  const seedValid =
    draft.randomSeed ||
    (/^(0|[1-9][0-9]{0,15})$/.test(draft.seed) &&
      BigInt(draft.seed) + BigInt(draft.count - 1) <= 9007199254740991n);
  const jobCount = studio ? studio.queue.active + studio.queue.waiting : null;
  const missingReference =
    workflow === "reference-to-video"
      ? referencePromptIssue(draft.prompt, references.groups.video)
      : "";
  const gpuUnavailable = !studio?.worker.connected || Boolean(studio.worker.stale);
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
    if (gpuUnavailable) return;
    if (!canGenerate || submitting) return;
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
      ...(draft.note?.trim()?{note:draft.note.trim()}:{}),
      mode,
      output: {
        aspect: draft.aspect,
        size: draft.size ?? (video ? "native" : "1mp"),
        ...(video ? { duration_seconds: Number(draft.duration), ...(draft.exportImages ? {format:"images"} : {}) } : {}),
      },
      seed: draft.randomSeed ? "random" : draft.seed,
      count: draft.count,
      ...(draft.resolvedSeeds?{resolved_seeds:draft.resolvedSeeds}:{}),
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
      const response = await fetch(draft.sourceJob?"/api/v1/jobs/"+draft.sourceJob+"/repeat":"/api/v1/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pendingSubmission.current!.key,
        },
        body: draft.sourceJob?JSON.stringify({request:JSON.parse(body)}):body,
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
  const worker = studio?.worker;
  const preparationError =
    !worker?.stale && worker?.state === "preparing"
      ? worker.preparation?.error?.message
      : null;
  const tone =
    error || preparationError
      ? "error"
      : !studio
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
      (!studio
          ? "Checking connection…"
          : tone === "attention"
            ? worker?.connected
              ? "Ask your setup agent to reconnect the GPU."
              : "Ask your setup agent to connect a GPU."
            : tone === "ready"
              ? "Ready to generate."
              : worker?.state === "busy"
                ? "Generating…"
                : "Preparing models and engine…");
  function reset() {
    if (workflow === "image-to-image") references.reset("edit");
    if (workflow === "reference-to-video") references.reset("video");
    setDrafts((current) => ({ ...current, [workflow]: emptyDraft() }));
    setAdvancedOpen(false);
  }

  return (
    <div className={`studio-shell ${sidebarOpen?'sidebar-visible':''} page-${page}`}>
      {!sidebarOpen&&<header className="app-bar"><button className="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded={sidebarOpen} aria-controls="app-sidebar" onClick={()=>setSidebarOpen(!sidebarOpen)}>☰</button></header>}
      <Sidebar open={sidebarOpen} wide={wide} onOpenChange={setSidebarOpen} heading={<BrandSwitcher page={page} onNavigate={navigate} icon={<span className="brand-mark"><SeedMark /></span>}>
          seed
        </BrandSwitcher>}>
        <div className="header-status">
<Collapsible.Root open={gpuOpen} onOpenChange={setGpuOpen}><Collapsible.Trigger asChild><button
            className="pod-button"
            data-tone={tone}
            aria-label={`Pod connection: ${workerLabel}`}
          >
            <Icon name="pod" />
            <span className="pod-label">GPU Status<small>{workerLabel}</small></span><span className="gpu-indicator" aria-hidden="true"/>
          </button></Collapsible.Trigger><Collapsible.Content>      <section
        id="pod-details"
        className="gpu-details"
        aria-label="GPU connection details"
      >
        <p className="popover-note">{detail}</p>
        {tone === "activity" &&
          worker?.state === "preparing" &&
          !worker.stale && (
            <p className="popover-note preparation-detail">
              {worker.preparation?.phase}
            </p>
          )}
      </section>
</Collapsible.Content></Collapsible.Root>
<button onClick={()=>{if(!wide)setSidebarOpen(false);setJobsOpen(true);}} aria-haspopup="dialog"
            className="jobs-button"
            aria-label={`Jobs${jobCount === null ? "" : `, ${jobCount}`}`}
          >
            <Icon name="jobs" />
            <span>Active Jobs</span><span className="job-count">{jobCount ?? "–"}</span>
          </button>
        </div>

        <div className="sidebar-section" ref={setSidebarTarget}/>
        {page!=='chat'&&<div className="sidebar-chats-heading"><button onClick={()=>navigate('chat')}>Chats</button><button aria-label="New chat" title="New chat" onClick={()=>{sessionStorage.removeItem('seed.chat.selected.'+(spicy?'nsfw':'sfw'));navigate('chat');}}>+</button></div>}
        {page==='generate'&&<div className="sidebar-section"><p className="section-label">Workflows</p>{Object.entries(workflows).filter(([id])=>id!=='image-to-image').map(([id,value])=><button key={id} className={workflow===id?'selected':''} onClick={()=>{setWorkflow(id as WorkflowId);setAdvancedOpen(false);if(!wide)setSidebarOpen(false);}}>{value.title}</button>)}</div>}
        {page==='library'&&<div className="sidebar-section"><p className="section-label">Media type</p>{['all','image','video','audio','sequence'].map(type=><button key={type} className={libraryType===type?'selected':''} onClick={()=>{setLibraryType(type);if(!wide)setSidebarOpen(false);}}>{type==='all'?'All media':type==='sequence'?'Frame sequences':type.charAt(0).toUpperCase()+type.slice(1)+'s'}</button>)}</div>}
      </Sidebar>

      {inputPreview&&<MediaPreview media={inputPreview} referenceLabel={promptMentions.find(m=>m.url===inputPreview.url)?.label} onClose={()=>setInputPreview(null)}/>}
      {jobsOpen&&<JobsView mode={spicy?'nsfw':'sfw'} onClose={()=>setJobsOpen(false)}/>}
      {resultPreview&&<JobMedia job={resultPreview} onClose={()=>setResultPreview(null)}/>}
      {resultDetail&&jobs.some(j=>j.id===resultDetail)&&<JobDetails initial={resultDetail} jobs={jobs.filter(j=>j.submission_id===jobs.find(j=>j.id===resultDetail)!.submission_id)} onClose={()=>setResultDetail(null)}/>}
      <main>
        {page === "generate" ? (
          <>
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
                {workflow==='reference-to-video'?<PromptInput key={workflow} ref={promptInput} id="prompt" value={draft.prompt} onChange={prompt=>updateDraft({prompt})} mentions={promptMentions} placeholder={workflows[workflow].placeholder}/>:(<ResizablePrompt><textarea
                  id="prompt"
                  value={draft.prompt}
                  onChange={(event) =>
                    updateDraft({ prompt: event.target.value })
                  }
                  placeholder={workflows[workflow].placeholder}
                /></ResizablePrompt>)}

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
                  onInsert={label=>promptInput.current?.insert(label+' ')}
                />
              )}
              <div className="output-settings">
                <fieldset>
                  <legend>Aspect ratio</legend>
                  <AspectPicker value={draft.aspect} onChange={aspect=>updateDraft({aspect})}/>
                </fieldset>
                <label className="batch-field">
                  Batch size
                  <BatchPicker value={draft.count} onChange={count=>updateDraft({count})}/>
                </label>
                {video && (
                  <fieldset>
                    <legend>Length</legend>
                    <LengthPicker value={Number(draft.duration)} step={capability?.workflows[workflow]?.duration_seconds?.step===1||!capability?.revision?1:5} onChange={duration=>updateDraft({duration:String(duration)})}/>
                  </fieldset>
                )}
                            {video && <label className="quality-field">Quality<select aria-label="Quality" value={highQuality?'high':'fast'} onChange={e=>setHighQuality(e.target.value==='high')}><option value="fast">Fast</option><option value="high">High</option></select></label>}
              </div>

              {videoQualityIssue && <p role="status">{videoQualityIssue}</p>}
              {video&&<div className="generate-extra-settings"><label>Export<select value={draft.exportImages?'images':'video'} onChange={e=>updateDraft({exportImages:e.target.value==='images'})}><option value="video">Video</option><option value="images">Images</option></select></label>              {video && !draft.exportImages && (
                <label className="video-audio">
                  Soundtrack
                  <select
                    value={draft.audio ?? "generated"}
                    onChange={(event) =>
                      updateDraft({
                        audio: event.target.value as "generated" | "silent",
                      })
                    }
                  >
                    <option value="generated">Generated</option>
                    <option value="silent">Silent</option>
                  </select>
                </label>
              )}</div>}
              {video && draft.exportImages && capability?.revision && !capability.workflows[workflow]?.export_formats?.includes('images') && <p>Update the worker to export images.</p>}
              <div className="generation-options">

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
                  <SeedControl random={draft.randomSeed} value={draft.seed} onChange={(randomSeed,seed)=>updateDraft({randomSeed,seed})}/>
                  {!seedValid&&<p role="alert">Use a whole number from 0 to 9007199254740991, leaving room for the batch.</p>}
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

                            <label className="generation-note">Note<input maxLength={4000} placeholder="Optional note for the generated assets" value={draft.note??''} onChange={e=>updateDraft({note:e.target.value})}/></label>
{generationError && <p role="alert">{generationError}</p>}
<button
                className={"generate-button"+(gpuUnavailable?" no-gpu":"")}
                disabled={submitting || !canGenerate}
                onClick={() => void generate()}
                title={
                  canGenerate
                    ? undefined
                    : "Connect a compatible pod and enter a prompt to generate."
                }
              >
                {submitting ? (
                  "Submitting…"
                ) : gpuUnavailable ? "No GPU Available" : (
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
              {deleteError && <p role="alert">{deleteError}</p>}
              {uploadProgress && <p role="status">{uploadProgress}</p>}
              {submission.length>0&&<section className="job-chat-wrap" aria-label="Output preview"><div className="job-request-card"><div className="job-request-heading"><strong>{jobName(workflow)}</strong><JobButton icon="info" label="View job details" iconOnly onClick={()=>setResultDetail(submission[0]!)}/></div><JobOutputs jobs={jobs.filter(j=>submission.includes(j.id))} onSelect={j=>jobState(j)==='completed'?setResultPreview(j):setResultDetail(j.id)}/></div></section>}

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



