import type { WorkerOffer } from '../shared/pool.js';
import { modelDownloadCost } from '../shared/worker-offers.js';

const money = (n: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: n > 0 && n < .01 ? 4 : 2,
}).format(n);
const stockLabel = {HIGH: 'High availability', MEDIUM: 'Medium availability', LOW: 'Low availability'};
const network = (mbps?: number) => mbps === undefined ? 'Not reported'
  : mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbit/s` : `${Math.round(mbps)} Mbit/s`;
const transfer = (rate?: number) => rate === undefined ? 'Not quoted'
  : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:4}).format(rate) + '/GB';

export function WorkerOfferCard({offer, quantity, onQuantity}: {
  offer: WorkerOffer; quantity: number; onQuantity: (n: number) => void;
}) {
  const stale = Date.parse(offer.expires_at) <= Date.now();
  const provider = offer.provider === 'runpod' ? 'RunPod' : 'Vast';
  const cost = modelDownloadCost(offer);
  return <article className={'pool-offer' + (quantity ? ' selected' : '')}>
    <label className="pool-offer-choice">
      <input type="checkbox" checked={quantity > 0} disabled={!offer.available || stale}
        onChange={e => onQuantity(e.target.checked ? 1 : 0)} />
      <span>
        <strong>{offer.gpu}</strong>
        <small>{provider} · {Number(offer.vram_gb.toFixed(1))} GB VRAM · {offer.ram_gb !== undefined
          ? `${Math.round(offer.ram_gb)} GB RAM` : offer.min_ram_gb !== undefined
            ? `${offer.min_ram_gb} GB RAM minimum` : 'RAM not reported'}</small>
      </span>
      <span className="pool-offer-price"><strong>{money(offer.hourly)}<small>/hr</small></strong><small>Disk included</small></span>
    </label>
    <dl className="pool-offer-signals">
      {offer.provider === 'vast' ? <>
      <div><dt>Model download</dt><dd>{cost === undefined ? 'Not quoted' : `${money(cost)} est.`}</dd></div>
      <div><dt>Advertised download</dt><dd>{network(offer.download_mbps)}</dd></div>
      <div><dt>Host quality</dt><dd>{offer.verified ? 'Verified' : 'Not reported'}{offer.reliability !== undefined && <small>{(offer.reliability * 100).toFixed(2)}% reliability</small>}</dd></div>
      <div><dt>Location</dt><dd>{offer.region}<small>{offer.available ? 'Available now' : 'Unavailable'}</small></dd></div>
      </> : <>
        <div><dt>Availability</dt><dd>{offer.stock ? stockLabel[offer.stock] : 'Not reported'}</dd></div>
        <div><dt>Cloud</dt><dd>{offer.cloud === 'secure' ? 'Secure Cloud' : offer.cloud === 'community' ? 'Community Cloud' : 'Not reported'}</dd></div>
        <div><dt>Placement</dt><dd>{offer.region}</dd></div>
        <div><dt>Regions with stock</dt><dd>{offer.locations?.length ? `${offer.locations.length} locations` : 'Not reported'}</dd></div>
      </>}
    </dl>
    <div className="pool-offer-bottom">
      <details>
        <summary>Machine details</summary>
        <dl>
          <div><dt>Disk</dt><dd>{offer.disk_gb} GB · {money(offer.storage_hourly)}/hr</dd></div>
          {offer.cpu_cores !== undefined && <div><dt>CPU</dt><dd>{offer.cpu_cores} cores</dd></div>}
          {offer.power_watts !== undefined && <div><dt>Power limit</dt><dd>{offer.power_watts} W</dd></div>}
          {offer.provider === 'vast' && <><div><dt>Download fee</dt><dd>{transfer(offer.download_per_gb)}</dd></div>
          <div><dt>Upload fee</dt><dd>{transfer(offer.upload_per_gb)}</dd></div></>}
          {offer.machine_id && <div><dt>Machine ID</dt><dd>{offer.machine_id}</dd></div>}
        </dl>
        {offer.provider === 'vast' && <p>{offer.model_download_bytes !== undefined ? `${(offer.model_download_bytes / 1e9).toFixed(1)} GB of base models. ` : ''}Download estimate excludes LoRAs, container layers and retries. Advertised speed is not a startup guarantee.</p>}
        {offer.provider === 'runpod' && <>
          <p>RunPod chooses the location at launch. Stock is not a reservation; RAM is a placement requirement.</p>
          {!!offer.locations?.length && <ul className="pool-offer-locations" aria-label="Regional availability">{offer.locations.map(d => <li key={d.id}>{d.name} <span>{stockLabel[d.stock]}</span></li>)}</ul>}
        </>}
      </details>
      {!offer.available ? <span>Currently unavailable</span> : stale ? <span>Quote expired</span>
        : quantity > 0 && offer.max_quantity > 1 ? <label className="pool-offer-quantity">Quantity
          <select aria-label={`Quantity for ${offer.gpu} on ${provider}`} value={quantity} onChange={e => onQuantity(Number(e.target.value))}>
            {Array.from({length: Math.min(offer.max_quantity, 16)}, (_, i) => <option key={i + 1}>{i + 1}</option>)}
          </select>
        </label> : <span>{offer.max_quantity === 1 ? 'Single GPU' : 'Choose quantity'}</span>}
    </div>
  </article>;
}
