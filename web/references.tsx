import {inputLabels} from '../shared/reference-labels.js';
import {AssetThumbnail} from './asset-thumbnail.js';
import {Modal} from './modal.js';
import React, { useEffect, useRef, useState } from "react";
import { GalleryPicker } from "./gallery-picker.js";
import type { LibraryAsset } from "../shared/studio.js";
import { MediaPreview, Glyph } from "./media-preview.js";
import { useSpicy } from './spicy-mode.js';
import { uploadReferences } from './uploads.js';
import { AssetNote } from './asset-note.js';
export type MediaKind = "image" | "video" | "audio";
export type Reference = {
  file?: File;
  note?: string;
  asset_id?: string;
  include_audio?: boolean;
  framing?: "fit" | "fill";
  id: string;
  name: string;
  url: string;
  kind: MediaKind;
  type: string;
  width?: number;
  height?: number;
  duration?: number;
  start: number;
  end: number;
  role: string;
};
type Group = "edit" | "video";
let nextReferenceId = 0;
async function inspect(file: File | LibraryAsset): Promise<Reference> {
  const saved = "id" in file;
  let type: string;
  if (saved) {
    const response = await fetch(`/api/v1/assets/${file.id}`);
    if (!response.ok)
      throw Error(`${file.name}: this file is no longer available.`);
    const metadata = await response.json();
    type = metadata.mime_type ?? `${file.kind}/*`;
  } else type = file.type;
  const kind = type.split("/")[0] as MediaKind;
  if (!["image", "video", "audio"].includes(kind))
    throw new Error(`${file.name}: choose an image, video or audio file.`);
  if (
    !saved &&
    kind === "image" &&
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/heic",
      "image/heif",
      "image/tiff",
    ].includes(type)
  )
    throw new Error(
      `${file.name}: choose a supported raster image, such as JPEG, PNG or WebP.`,
    );
  const url = saved
    ? `/api/v1/assets/${file.id}/content`
    : URL.createObjectURL(file);
  try {
    const metadata = await new Promise<{
      width?: number;
      height?: number;
      duration?: number;
    }>((resolve, reject) => {
      const element =
        kind === "image" ? new Image() : document.createElement(kind);
      const timer = setTimeout(
        () => finish(new Error("Preview could not be read.")),
        15000,
      );
      function finish(error?: Error) {
        clearTimeout(timer);
        element.onerror = null;
        if (element instanceof HTMLImageElement) element.onload = null;
        else {
          element.onloadedmetadata = null;
          element.removeAttribute("src");
          element.load();
        }
        if (error) reject(error);
      }
      element.onerror = () =>
        finish(
          new Error(
            "This browser cannot preview this file. Try JPEG/PNG, MP4 or WAV/MP3.",
          ),
        );
      if (element instanceof HTMLImageElement)
        element.onload = () => {
          resolve({
            width: element.naturalWidth,
            height: element.naturalHeight,
          });
          finish();
        };
      else {
        element.preload = "metadata";
        element.onloadedmetadata = () => {
          if (!Number.isFinite(element.duration) || element.duration <= 0) {
            finish(new Error("No readable duration."));
            return;
          }
          resolve({
            duration: element.duration,
            ...(element instanceof HTMLVideoElement
              ? { width: element.videoWidth, height: element.videoHeight }
              : {}),
          });
          finish();
        };
      }
      element.src = url;
    });
    return {
      ...(saved ? { asset_id: file.id } : { file }),
      id: `reference-${++nextReferenceId}`,
      name: file.name,
      url,
      kind,
      type,
      ...metadata,
      start: 0,
      end: Math.min(15, metadata.duration ?? 0),
      role: "reference",
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: ${(error as Error).message}`);
  }
}
export function useReferences(deferUploads=false) {
  const {spicy}=useSpicy();
  const mode=spicy?'nsfw':'sfw';
  const [notes,setNotes]=useState<string[]>([]);
  const [groups, setGroups] = useState<Record<Group, Reference[]>>({
    edit: [],
    video: [],
  });
  const latest = useRef(groups);
  const modeGroups=useRef<Record<string,Record<Group,Reference[]>>>({});
  const previousMode=useRef(mode);
  latest.current = groups;
  const epochs = useRef({ edit: 0, video: 0 });
  const [errors, setErrors] = useState<Record<Group, string[]>>({
    edit: [],
    video: [],
  });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(
    () => () => {
      for (const list of Object.values(latest.current))
        for (const item of list) URL.revokeObjectURL(item.url);
      for(const saved of Object.values(modeGroups.current))for(const list of Object.values(saved))for(const item of list)URL.revokeObjectURL(item.url);
    },
    [],
  );
  function change(group: Group, list: Reference[]) {
    latest.current = { ...latest.current, [group]: list };
    setGroups(latest.current);
  }
  function reset(group: Group) {
    epochs.current[group]++;
    for (const item of latest.current[group]) URL.revokeObjectURL(item.url);
    change(group, []);
    setErrors((previous) => ({ ...previous, [group]: [] }));
  }
  async function add(group: Group, files: (File | LibraryAsset)[]) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const epoch = epochs.current[group];
    const messages: string[] = [];
    const missingNotes:string[]=[];
    try {
      for (const file of files) {
        let item: Reference;
        try {
          item = await inspect(file);
        } catch (error) {
          messages.push((error as Error).message);
          continue;
        }
        if (epochs.current[group] !== epoch) {
          URL.revokeObjectURL(item.url);
          break;
        }
        const rest = latest.current[group];
        let reason = "";
        if (group === "edit" && (item.kind !== "image" || rest.length >= 2))
          reason =
            "Image editing accepts a source image and an optional subject image.";
        if (
          group === "video" &&
          (rest.length >= 12 ||
            rest.filter((entry) => entry.kind === item.kind).length >=
              (item.kind === "image" ? 9 : 3))
        )
          reason =
            "Reference video supports up to 9 images, 3 videos and 3 audio files, with 12 references combined.";
        if (
          group === "video" &&
          item.duration !== undefined &&
          item.duration < 2
        )
          reason = "Choose a video or audio source at least 2 seconds long.";
        if (reason) {
          messages.push(`${file.name}: ${reason}`);
          URL.revokeObjectURL(item.url);
          continue;
        }
        item.role =
          group === "edit"
            ? rest.some((entry) => entry.role === "source")
              ? "subject"
              : "source"
            : item.kind === "image" && !rest.length
              ? "first_frame"
              : "reference";
        if(deferUploads&&item.file){change(group,[...latest.current[group],item]);missingNotes.push(item.id);continue;}
        try {
          const uploaded=await uploadReferences([item],mode,()=>{});
          item.asset_id=uploaded[0]!.asset_id;
          const response=await fetch('/api/v1/notes/'+item.asset_id);
          if(!response.ok)throw Error('Could not load asset note.');
          const saved=await response.json();
          if(epochs.current[group]!==epoch){URL.revokeObjectURL(item.url);break;}
          if(!saved.note&&!saved.inherited)missingNotes.push(item.asset_id!);
          change(group, [...latest.current[group], item]);
        } catch(error){messages.push((error as Error).message);URL.revokeObjectURL(item.url);}
      }
      if (epochs.current[group] === epoch) {
        setErrors((previous) => ({ ...previous, [group]: messages }));
        if(missingNotes.length)setNotes(missingNotes);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function remove(group: Group, id: string) {
    const item = latest.current[group].find((entry) => entry.id === id);
    if (item) URL.revokeObjectURL(item.url);
    change(
      group,
      latest.current[group].filter((entry) => entry.id !== id),
    );
  }
  function update(group: Group, id: string, values: Partial<Reference>) {
    change(
      group,
      latest.current[group].map((entry) =>
        entry.id === id ? { ...entry, ...values } : entry,
      ),
    );
  }
  useEffect(()=>{
    if(previousMode.current===mode)return;
    modeGroups.current[previousMode.current]=latest.current;previousMode.current=mode;
    epochs.current.edit++;epochs.current.video++;
    latest.current=modeGroups.current[mode]??{edit:[],video:[]};setGroups(latest.current);
    setNotes([]);setErrors({edit:[],video:[]});
  },[mode]);
  return { groups, errors, busy, add, remove, update, reset, replace:(group:Group,list:Reference[])=>{reset(group);change(group,list);}, notes, dismissNotes:()=>setNotes([]) };
}
export function referenceIssues(items: Reference[], group: Group) {
  const issues: string[] = [];
  for (const item of items)
    if (
      item.kind !== "image" &&
      (item.start < 0 ||
        item.end > item.duration! ||
        item.end - item.start < 2 ||
        item.end - item.start > 15)
    )
      issues.push(
        `${item.name}: choose a 2–15 second range within the source.`,
      );
  for (const kind of ["video", "audio"] as const)
    if (
      items
        .filter((item) => item.kind === kind)
        .reduce((total, item) => total + item.end - item.start, 0) > 15
    )
      issues.push(
        `Choose at most 15 seconds of ${kind} across the selected clips.`,
      );
  const roles =
    group === "edit" ? ["source", "subject"] : ["first_frame", "last_frame"];
  for (const role of roles)
    if (items.filter((item) => item.role === role).length > 1)
      issues.push(`Choose only one ${role.replaceAll("_", " ")} image.`);
  if (
    items
      .filter(
        (item) =>
          item.kind === "audio" ||
          (item.kind === "video" && item.include_audio),
      )
      .reduce((sum, item) => sum + item.end - item.start, 0) > 15
  )
    issues.push(
      "Choose at most 15 seconds of audio including video soundtracks.",
    );
  return issues;
}
export function referenceLabels(items:Reference[]){return inputLabels(items.map(item=>({...item,asset_id:item.id})));}
export function referencePromptIssue(prompt: string, items: Reference[]) {
  const labels = new Set(referenceLabels(items).values());
  return prompt.includes("[removed reference]") ||
    [...prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>/g)].some(
      (match) => !labels.has(match[0]),
    )
    ? "Edit the prompt to replace or remove its missing reference."
    : "";
}
export function ReferenceInputs({
  group,
  state,
  seconds = 5,
  onInsert,
}: {
  group: Group;
  state: ReturnType<typeof useReferences>;
  seconds?: number;
  onInsert?: (label: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [gallery, setGallery] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const items = state.groups[group];
  const labels = referenceLabels(items);
  const [dragging, setDragging] = useState(false);
  const issues = referenceIssues(items, group);
  const active = items.find((item) => item.id === selected);
  const errors = [...state.errors[group], ...issues];
  const controls = active && (
    <>
      {active.kind === "image" && (
        <label className="viewer-role">
          Use as
          <select
            aria-label={`Role for ${active.name}`}
            value={active.role}
            onChange={(event) =>
              state.update(group, active.id, { role: event.target.value })
            }
          >
            {(group === "edit"
              ? [
                  ["source", "Source scene"],
                  ["subject", "Subject identity"],
                ]
              : [
                  ["reference", "Reference"],
                  ["first_frame", "First frame"],
                  ["last_frame", "Last frame"],
                ]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {active.duration !== undefined && (
        <div className="clip-range">
          <span>Range (seconds)</span>
          <label>
            From
            <input
              aria-label={`Start for ${active.name}`}
              type="number"
              min="0"
              max={active.duration}
              step="any"
              value={active.start}
              onChange={(event) =>
                state.update(group, active.id, {
                  start: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            To
            <input
              aria-label={`End for ${active.name}`}
              type="number"
              min="0"
              max={active.duration}
              step="any"
              value={active.end}
              onChange={(event) =>
                state.update(group, active.id, {
                  end: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      )}
      {active.kind === "video" && (
        <label>
          <input
            type="checkbox"
            checked={Boolean(active.include_audio)}
            onChange={(event) =>
              state.update(group, active.id, {
                include_audio: event.target.checked,
              })
            }
          />
          Use video audio as a reference
        </label>
      )}
      {active.kind === "video" && (
        <span>
          Used range: {active.start.toFixed(2)}–
          {(
            active.start +
            (17 *
              Math.floor(
                (Math.min(
                  Math.floor((active.end - active.start) * 24),
                  17 * Math.ceil((seconds * 24 - 5) / 17) + 5,
                ) -
                  5) /
                  17,
              ) +
              5) /
              24
          ).toFixed(2)}{" "}
          seconds
        </span>
      )}
      {active.kind === "image" && active.role !== "reference" && (
        <label className="viewer-role">
          Framing
          <select
            value={active.framing ?? "fit"}
            onChange={(event) =>
              state.update(group, active.id, {
                framing: event.target.value as "fit" | "fill",
              })
            }
          >
            <option value="fit">Fit entire image</option>
            <option value="fill">Fill frame</option>
          </select>
        </label>
      )}
      {errors.length > 0 && (
        <ul className="reference-errors" role="alert">
          {errors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <section
      className="references"
      aria-label={group === "edit" ? "Image inputs" : "Video references"}
    >
      <input
        ref={input}
        aria-label="Choose reference files"
        className="file-picker"
        type="file"
        accept={group === "edit" ? "image/*" : "image/*,video/*,audio/*"}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void state.add(group, files);
        }}
      />
      <div
        className={`reference-dropbox ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void state.add(group, Array.from(event.dataTransfer.files));
        }}
      >
        <div className="reference-bar">
          <div className="reference-label">
            <span>{group === "edit" ? "Input Images" : "References"}</span>
            <details className="reference-help">
              <summary aria-label="Asset limits">
                <Glyph name="info" />
              </summary>
              <div>
                <span>
                  {items.length} {items.length === 1 ? "file" : "files"}{" "}
                  selected
                </span>
                <strong>max: {group === "edit" ? 2 : 12}</strong>
                <span>
                  {group === "edit"
                    ? "One source image and an optional subject image."
                    : "Up to 9 images, 3 videos and 3 audio files; 12 files combined."}
                </span>
              </div>
            </details>
          </div>
          <button
            type="button"
            className="gallery-open"
            disabled={state.busy}
            onClick={() => setGallery(true)}
          >
            Gallery
          </button>
          <button
            type="button"
            className="reference-add"
            aria-label="Add references"
            disabled={state.busy}
            onClick={() => input.current?.click()}
          >
            {state.busy ? "…" : "+"}
          </button>
        </div>
        <div>
          {items.length ? (
            <div className="reference-thumbnails">
              {items.map((item) => (
                <button
                  type="button"
                  className="reference-thumb"
                  key={item.id}
                  aria-label={`Preview ${item.name}`}
                  onClick={() => setSelected(item.id)}
                >
                  {item.kind === "image" ? (
                    <img src={item.url} alt="" />
                  ) : item.kind === "video" ? (
                    <>
                      <video src={item.url} muted preload="metadata" />
                      <span className="media-symbol" aria-hidden="true">
                        ▶
                      </span>
                    </>
                  ) : (
                    <span className="audio-symbol" aria-hidden="true">
                      ♫
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="reference-empty"
              disabled={state.busy}
              onClick={() => input.current?.click()}
            >
              {state.busy
                ? "Reading files…"
                : group === "edit"
                  ? "Drop images here or browse"
                  : "Drop images, video or audio here or browse"}
            </button>
          )}
        </div>
      </div>
      {!active && errors.length > 0 && (
        <ul className="reference-errors" role="alert">
          {errors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
      {group === "video" && items.some((item) => item.role === "reference") && (
        <div
          className="reference-labels"
          aria-label="Insert reference in prompt"
        >
          {items
            .filter((item) => item.role === "reference")
            .map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onInsert?.(labels.get(item.id)!)}
                title={"Insert " + labels.get(item.id) + " in prompt"}
              >
                {labels.get(item.id)}
              </button>
            ))}
        </div>
      )}
      {gallery && (
        <GalleryPicker
          group={group}
          existing={items}
          onClose={() => setGallery(false)}
          onSelect={async (assets) => {
            await state.add(group, assets);
            setGallery(false);
          }}
        />
      )}
      {active && (
        <MediaPreview
          key={active.id}
          media={active}
          onClose={() => setSelected(null)}
          onDelete={() => {
            state.remove(group, active.id);
            setSelected(null);
          }}
          controls={controls} note={active.asset_id&&<AssetNote id={active.asset_id}/>}
        />
      )}
      {state.notes.length>0&&<NoteModal ids={state.notes} close={state.dismissNotes}/>}
    </section>
  );
}

export function NoteModal({ids,close,local=[],onLocalNote}:{ids:string[];close:()=>void;local?:Reference[];onLocalNote?:(id:string,note:string)=>void}) {
  const [preview,setPreview]=useState<any>(null),[error,setError]=useState('');
  const [notes,setNotes]=useState<Record<string,{note:string;revision:number;original:string}>>({}),[saving,setSaving]=useState(false);
  const idsKey=JSON.stringify(ids);
  useEffect(()=>{const controller=new AbortController();setNotes({});setError('');
    void Promise.all((JSON.parse(idsKey) as string[]).map(async id=>{const draft=local.find(r=>r.id===id);if(draft)return [id,{note:draft.note??'',revision:0,original:draft.note??''}] as const;const response=await fetch('/api/v1/notes/'+encodeURIComponent(id),{signal:controller.signal});if(!response.ok)throw Error('Could not load asset notes.');const value=await response.json();return [id,{note:value.note,revision:value.revision,original:value.note}] as const;})).then(entries=>{if(!controller.signal.aborted)setNotes(Object.fromEntries(entries));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[idsKey]);
  async function save(){if(saving)return;setSaving(true);setError('');
    try{for(const id of ids){const item=notes[id];if(!item)throw Error('Asset notes are still loading.');const note=item.note.trim();if(local.some(r=>r.id===id)){onLocalNote?.(id,note);continue;}if(!note||note===item.original)continue;
      const response=await fetch('/api/v1/notes/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,revision:item.revision})});const value=await response.json();if(!response.ok)throw Error(value.error?.message??'Could not save note.');
      setNotes(current=>({...current,[id]:{note:value.note,revision:value.revision,original:value.note}}));
    }close();}catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  async function show(id:string){const draft=local.find(r=>r.id===id);if(draft){setPreview(draft);return;}try{const response=await fetch('/api/v1/assets/'+id);if(!response.ok)throw Error('Could not open this asset.');const asset=await response.json();setPreview({...asset,url:'/api/v1/assets/'+id+'/content',type:asset.mime_type??''});}catch(e){setError((e as Error).message);}}
  return <><Modal className="asset-notes-modal" aria-label="Describe assets" onCancel={()=>{if(!saving)close();}}>
    <header><div><h2>Describe your assets</h2><p>Add an optional note to help Seed understand each file.</p></div><button className="notes-close" aria-label="Close asset notes" disabled={saving} onClick={close}>×</button></header>
    <div className="asset-notes-list">{ids.map(id=><section className="asset-note-row" key={id}><AssetThumbnail id={id} local={local.find(r=>r.id===id)} onOpen={()=>void show(id)}/><div className="asset-note"><label htmlFor={"upload-note-"+id}>Note <span>(optional)</span></label><textarea id={"upload-note-"+id} aria-label="Asset note" value={notes[id]?.note??''} maxLength={4000} disabled={!notes[id]||saving} placeholder="Describe this file…" onChange={e=>{const note=e.target.value;setNotes(current=>({...current,[id]:{...current[id]!,note}}));}}/></div></section>)}</div>
    {error&&<p role="alert">{error}</p>}<footer><button className="primary-action" disabled={saving||ids.some(id=>!notes[id])} onClick={()=>void save()}>{saving?'Saving…':'Save'}</button></footer>
  </Modal>{preview&&<MediaPreview media={preview} onClose={()=>setPreview(null)}/>}</>;
}
