import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryAsset } from '../../shared/studio.js';
import { presentAsset } from '../spicy-mode.js';
import {ORGANIZATION_CHANGED,getOrganizationEpoch,reconcileOrganization,type OrganizationChange} from './use-asset-organization.js';

export type LibraryFilter = 'all' | 'image' | 'video' | 'audio';
type State = {
  items: LibraryAsset[];
  cursor: string | null;
  loaded: boolean;
  loadingMore: boolean;
  error?: string;
  deleting?: string;
};
export function useLibrary(
  mode: 'sfw' | 'nsfw',
  filter: LibraryFilter,
  onDeleted: (id: string) => void,
  favoritesOnly=false,
  collectionId='',
) {
  const [state, setState] = useState<State>({
    items: [],
    cursor: null,
    loaded: false,
    loadingMore: false,
  });
  const [revision, setRevision] = useState(0);
  const deleted = useRef(new Set<string>()),
    expanded = useRef(false),
    paging = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const lastBase=useRef('');
  const base = '/api/v1/assets?mode=' + mode + (filter === 'all' ? '' : '&kind=' + filter)+(favoritesOnly?'&favorites=true':'')+(collectionId?'&collection_id='+encodeURIComponent(collectionId):'');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const normalize = (items: LibraryAsset[],epoch:number) =>
    items
      .map(asset=>reconcileOrganization(asset,epoch))
      .map(presentAsset)
      .filter(
        (asset) =>
          !deleted.current.has(asset.id) &&
          (asset.mode ?? 'sfw') === mode &&
          (!favoritesOnly||asset.favorite===true) &&
          (!collectionId||!('collection_ids' in asset)||((asset as LibraryAsset&{collection_ids:string[]}).collection_ids.includes(collectionId))) &&
          (filter === 'all' || asset.kind === filter),
      );
  useEffect(() => {
    if(lastBase.current!==base){lastBase.current=base;expanded.current=false;setState({items:[],cursor:null,loaded:false,loadingMore:false});}
    const abort = new AbortController();
    controller.current = abort;
    paging.current = false;
    setState((current) => ({ ...current, loadingMore: false }));
    let running = false;
    async function read() {
      if (running) return;
      running = true;
      const epoch=getOrganizationEpoch();
      try {
        const response = await fetch(base, { signal: abort.signal });
        if (!response.ok) throw Error('Could not load Library. Retrying…');
        const result = await response.json();
        if (abort.signal.aborted) return;
        const items = normalize(result.items,epoch);
        setState((current) => ({
          ...current,
          loaded: true,
          error: undefined,
          items: expanded.current
            ? [
                ...items,
                ...current.items.filter((asset) => !items.some((fresh) => fresh.id === asset.id)),
              ]
            : items,
          cursor: expanded.current ? current.cursor : (result.next_cursor ?? null),
        }));
      } catch (error) {
        if (!abort.signal.aborted)
          setState((current) => ({ ...current, error: (error as Error).message }));
      } finally {
        running = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), 3000);
    window.addEventListener('seed:library-changed', refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('seed:library-changed', refresh);
    };
  }, [base, revision, refresh]);
  useEffect(()=>{
    function changed(event:Event){
      const value=(event as CustomEvent<OrganizationChange>).detail;
      setState(current=>({...current,items:current.items.flatMap(asset=>{
        if(asset.id!==value.id)return [asset];
        if((favoritesOnly&&value.favorite===false)||(collectionId&&value.collection_ids&&!value.collection_ids.includes(collectionId)))return [];
        return [{...asset,...(value.favorite!==undefined?{favorite:value.favorite}:{})}];
      })}));
    }
    window.addEventListener(ORGANIZATION_CHANGED,changed);
    return()=>window.removeEventListener(ORGANIZATION_CHANGED,changed);
  },[favoritesOnly,collectionId,refresh]);
  async function more() {
    if (!state.cursor || paging.current) return;
    const abort = controller.current!;
    paging.current = true;
    const epoch=getOrganizationEpoch();
    setState((current) => ({ ...current, loadingMore: true, error: undefined }));
    try {
      const response = await fetch(base + '&cursor=' + encodeURIComponent(state.cursor), {
        signal: abort.signal,
      });
      if (!response.ok) throw Error('Could not load older media. Try again.');
      const result = await response.json();
      if (abort.signal.aborted) return;
      expanded.current = true;
      const additions = normalize(result.items,epoch).filter(asset => !state.items.some(existing => existing.id === asset.id));
      setState((current) => ({
        ...current,
        items: [
          ...current.items,
          ...normalize(result.items,epoch).filter(
            (asset) => !current.items.some((existing) => existing.id === asset.id),
          ),
        ],
        cursor: result.next_cursor ?? null,
      }));
      return additions;
    } catch (error) {
      if (!abort.signal.aborted)
        setState((current) => ({ ...current, error: (error as Error).message }));
    } finally {
      if (!abort.signal.aborted) {
        paging.current = false;
        setState((current) => ({ ...current, loadingMore: false }));
      }
    }
  }
  async function remove(id: string) {
    setState((current) => ({ ...current, deleting: id }));
    try {
      const response = await fetch('/api/v1/assets/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const result = await response.json();
        throw Error(result.error?.message ?? 'Could not delete this file.');
      }
      deleted.current.add(id);
      setState((current) => ({
        ...current,
        items: current.items.filter((asset) => asset.id !== id),
      }));
      onDeleted(id);
      window.dispatchEvent(new Event('seed:collections-changed'));
      refresh();
    } finally {
      setState((current) => ({ ...current, deleting: undefined }));
    }
  }
  return { ...state, more, remove, refresh };
}
