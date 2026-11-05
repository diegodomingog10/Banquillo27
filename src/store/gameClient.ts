import type { GameApi } from '../workers/gameWorker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/gameWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
      const p = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      if (!p) return;
      if (ev.data.ok) p.resolve(ev.data.value);
      else p.reject(new Error(ev.data.error));
    };
  }
  return worker;
}

type Params<F> = F extends (p: infer P) => unknown ? P : never;
type Result<F> = F extends (...a: never[]) => Promise<infer R> ? R : never;

/** Llamada tipada al Worker de partida: game('continue', undefined). */
export function game<K extends keyof GameApi>(method: K, params?: Params<GameApi[K]>): Promise<Result<GameApi[K]>> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, method, params });
  });
}
