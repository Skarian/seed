import type { WorkerOffer } from './pool.js';

export type OfferSort = 'price' | 'download_cost' | 'download_speed' | 'reliability' | 'availability';
export function modelDownloadCost(offer: WorkerOffer): number | undefined {
  return offer.model_download_bytes === undefined || offer.download_per_gb === undefined
    ? undefined : offer.model_download_bytes / 1e9 * offer.download_per_gb;
}
export function compareOffers(a: WorkerOffer, b: WorkerOffer, sort: OfferSort): number {
  const value = (o: WorkerOffer) => sort === 'download_cost' ? modelDownloadCost(o)
    : sort === 'download_speed' ? o.download_mbps : sort === 'reliability' ? o.reliability
    : sort === 'availability' ? (o.stock ? {HIGH:3,MEDIUM:2,LOW:1}[o.stock] : undefined) : o.hourly;
  const av = value(a), bv = value(b);
  if (av === undefined || bv === undefined) return av === bv ? a.hourly - b.hourly : av === undefined ? 1 : -1;
  return (av - bv) * (sort === 'download_speed' || sort === 'reliability' || sort === 'availability' ? -1 : 1) || a.hourly - b.hourly;
}
