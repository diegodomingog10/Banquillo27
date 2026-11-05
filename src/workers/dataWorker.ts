/// <reference lib="webworker" />
/**
 * Worker de datos: genera mundos e importa bases de datos fuera del hilo principal.
 */
import { generateWorld, type WorldGenOptions } from '../data/generator/generateWorld';
import { importDatabase, type ImportFile, type ImportOptions } from '../data/importers/importDatabase';
import { verifyDatabase } from '../data/verify';
import { simulateMatch, type MatchInput } from '../engine/matchEngine';

export type DataRequest =
  | { kind: 'generate'; id: number; options: WorldGenOptions }
  | { kind: 'import'; id: number; files: ImportFile[]; options: ImportOptions }
  | { kind: 'simulate'; id: number; matches: MatchInput[] };

self.onmessage = (ev: MessageEvent<DataRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  try {
    if (req.kind === 'generate') {
      const world = generateWorld(req.options);
      self.postMessage({ id: req.id, ok: true, ms: performance.now() - t0, world });
    } else if (req.kind === 'simulate') {
      const results = req.matches.map((m) => simulateMatch(m));
      self.postMessage({ id: req.id, ok: true, ms: performance.now() - t0, results });
    } else {
      const result = importDatabase(req.files, req.options);
      result.database.meta.createdAt = new Date().toISOString();
      const verify = verifyDatabase(result.database);
      self.postMessage({ id: req.id, ok: true, ms: performance.now() - t0, result, verify });
    }
  } catch (e) {
    self.postMessage({ id: req.id, ok: false, error: (e as Error).message });
  }
};
