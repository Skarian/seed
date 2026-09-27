import {it,expect} from 'vitest';
import {compareOffers,modelDownloadCost} from '../shared/worker-offers.js';
import type {WorkerOffer} from '../shared/pool.js';
const offer=(values:Partial<WorkerOffer>)=>({hourly:1,...values} as WorkerOffer);
it('estimates decimal-GB base downloads, distinguishes unknown from free and keeps unknowns last',()=>{
  const paid=offer({model_download_bytes:100e9,download_per_gb:.0026});
  const free=offer({model_download_bytes:100e9,download_per_gb:0});
  const unknown=offer({model_download_bytes:100e9});
  expect(modelDownloadCost(paid)).toBeCloseTo(.26);
  expect(modelDownloadCost(free)).toBe(0);expect(modelDownloadCost(unknown)).toBeUndefined();
  expect([unknown,paid,free].sort((a,b)=>compareOffers(a,b,'download_cost'))).toEqual([free,paid,unknown]);
  expect([unknown,offer({download_mbps:500}),offer({download_mbps:7000})].sort((a,b)=>compareOffers(a,b,'download_speed')).map(o=>o.download_mbps)).toEqual([7000,500,undefined]);
});
it('ranks RunPod stock ahead of unknown stock, breaking equal-stock ties by price',()=>{
  const offers=[offer({hourly:.5}),offer({stock:'LOW',hourly:1}),offer({stock:'HIGH',hourly:3}),offer({stock:'HIGH',hourly:2})];
  expect(offers.sort((a,b)=>compareOffers(a,b,'availability')).map(o=>o.hourly)).toEqual([2,3,1,.5]);
});
