import type { WorldGenOptions } from '../data/generator/generateWorld';
import type { ImportFile, ImportOptions, ImportResult } from '../data/importers/importDatabase';
import type { WorldDatabase } from '../data/schema';
import type { VerifyReport } from '../data/verify';
import type { DataRequest } from '../workers/dataWorker';
import type { MatchInput, MatchResult } from '../engine/matchEngine';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (data: unknown) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/dataWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number }>) => {
      pending.get(ev.data.id)?.(ev.data);
      pending.delete(ev.data.id);
    };
  }
  return worker;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function call<T>(req: WithoutId<DataRequest>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, (d) => {
      const r = d as { ok: boolean; error?: string };
      if (r.ok) resolve(d as T);
      else reject(new Error(r.error));
    });
    getWorker().postMessage({ ...req, id } as DataRequest);
  });
}

export const dataClient = {
  simulate: (matches: MatchInput[]) => call<{ results: MatchResult[]; ms: number }>({ kind: 'simulate', matches }),
  generate: (options: WorldGenOptions) => call<{ world: WorldDatabase; ms: number }>({ kind: 'generate', options }),
  import: (files: ImportFile[], options: ImportOptions) =>
    call<{ result: ImportResult; verify: VerifyReport; ms: number }>({ kind: 'import', files, options }),
};
