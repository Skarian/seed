export const failureClasses = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'Unknown'] as const;
export const failureRoutes = ['generate', 'chat', 'library', 'admin', 'unknown'] as const;
export type ClientFailure = {
  kind: 'render' | 'async';
  error_class: typeof failureClasses[number];
  route: typeof failureRoutes[number];
  build?: string;
  frame?: { asset: string; line: number; column: number };
};
const assetName = /^[A-Za-z0-9_-]{1,100}\.js$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const coordinate = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 10_000_000;
export const failureAsset = (v: unknown): v is string => typeof v === 'string' && assetName.test(v);

/** Deliberately reject extra fields, including messages/stacks, at the storage boundary. */
export function validClientFailure(value: unknown): value is ClientFailure {
  if (!record(value) || Object.keys(value).some(k => !['kind','error_class','route','build','frame'].includes(k))) return false;
  if (!['render','async'].includes(value.kind as string) || !failureClasses.includes(value.error_class as any) || !failureRoutes.includes(value.route as any)) return false;
  if ('build' in value && !failureAsset(value.build)) return false;
  if ('frame' in value && (!record(value.frame) || Object.keys(value.frame).sort().join(',') !== 'asset,column,line' ||
    !failureAsset(value.frame.asset) || !coordinate(value.frame.line) || !coordinate(value.frame.column))) return false;
  return true;
}
