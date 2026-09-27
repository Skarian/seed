import type {InputReference} from '../shared/generation.js';

/** Source media retrieval stays asset-based; navigation follows request instances. */
export interface RequestPreviewContext {
  inputId:string;
  references:InputReference[];
  label?:string;
}
export type PreviewRequestInput=(assetId:string,context?:RequestPreviewContext)=>void;
