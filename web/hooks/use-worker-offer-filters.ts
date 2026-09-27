import {useMemo, useState} from 'react';
import type {Provider, WorkerClass, WorkerOffer} from '../../shared/pool.js';
import {compareOffers, type OfferSort} from '../../shared/worker-offers.js';

type Filters = {region: string; ceiling: string; sort: OfferSort; gpuTypes: string[]};
const defaults: Filters = {region: 'all', ceiling: '', sort: 'price', gpuTypes: []};

export function useWorkerOfferFilters(items: WorkerOffer[], role: WorkerClass, provider: Provider) {
  const [byView, setByView] = useState<Partial<Record<`${WorkerClass}:${Provider}`, Filters>>>({});
  const view = `${role}:${provider}` as const;
  const filters = byView[view] ?? defaults;
  const setFilter = (change: Partial<Filters>) =>
    setByView(current => ({...current, [view]: {...(current[view] ?? defaults), ...change}}));
  const {providerItems, gpuTypes, filtered} = useMemo(() => {
    const providerItems = items.filter(offer => offer.provider === provider);
    // Options come from the whole provider catalog, independent of other filters and sorting.
    const gpuTypes = [...new Set(providerItems.map(offer => offer.gpu))];
    const filtered = providerItems.filter(offer =>
      (!filters.gpuTypes.length || filters.gpuTypes.includes(offer.gpu)) &&
      (provider === 'runpod' || filters.region === 'all' || offer.region === filters.region) &&
      (!filters.ceiling || offer.hourly <= Number(filters.ceiling))
    ).sort((a, b) => compareOffers(a, b, filters.sort));
    return {providerItems, gpuTypes, filtered};
  }, [items, provider, filters]);
  return {filters, setFilter, providerItems, gpuTypes, filtered};
}
