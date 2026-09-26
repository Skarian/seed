/** A bounded attempt, not a retry loop. The preparation/job owner decides retries. */
export class WorkerHttpError extends Error {
  constructor(public readonly status: number, public readonly detail?:unknown) { super(`Worker returned HTTP ${status}.`,{cause:detail}); }
  get permanent() { return ![408,425,429,502,503,504].includes(this.status); }
}
export class TransferIntegrityError extends Error {}
export function actionableTransfer(error: unknown) {
  return error instanceof TransferIntegrityError ||
    (error instanceof WorkerHttpError && error.permanent) ||
    ['ENOSPC','EACCES','EPERM','ENOENT','EDQUOT'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

export async function transferFetch(url: string, init: RequestInit, idleMs = 30000): Promise<Response> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(new Error('Transfer stopped making progress.')), idleMs); timer.unref?.(); };
  const clear = () => clearTimeout(timer);
  // Request encodes multipart using the native implementation. Observe its body
  // without buffering whole media files or inventing a multipart serializer.
  const encoded = new Request(url, init);
  touch();
  const body = encoded.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { touch(); controller.enqueue(chunk); },
  }));
  try {
    const response = await fetch(url, {
      method: encoded.method, headers: encoded.headers, redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal,
      ...(body ? {body, duplex: 'half'} : {}),
    } as RequestInit);
    touch();
    if (!response.body) { clear(); return response; }
    const reader = response.body.getReader();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { clear(); controller.close(); }
          else { touch(); controller.enqueue(next.value); }
        } catch (error) { clear(); controller.error(error); }
      },
      async cancel(reason) { clear(); abort.abort(); await reader.cancel(reason).catch(() => {}); },
    }), {status: response.status, statusText: response.statusText, headers: response.headers});
  } catch (error) { clear(); throw error; }
}
