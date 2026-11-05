/**
 * Guardado de partidas en IndexedDB (Dexie) y exportación/importación como archivo JSON.
 * Funciona en el hilo principal y en Web Workers (IndexedDB está disponible en ambos).
 */
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { WorldDatabase } from '../data/schema';
import { GAME_STATE_VERSION, type GameState } from '../engine/game';
import { ensureDefaults } from '../engine/manager';

export interface SaveMeta {
  id: string;
  gameId: string;
  name: string;
  clubName: string;
  date: string;
  season: string;
  savedAt: string;
  auto: boolean;
  sizeBytes: number;
}

interface SaveBlob {
  id: string;
  data: string;
}

class SavesDB extends Dexie {
  meta!: Table<SaveMeta, string>;
  blobs!: Table<SaveBlob, string>;
  constructor() {
    super('banquillo');
    this.version(1).stores({ meta: 'id, gameId, savedAt', blobs: 'id' });
  }
}

let db: SavesDB | null = null;
const getDb = () => (db ??= new SavesDB());

export const SAVE_FORMAT = 'banquillo-save';

export function serializeGame(state: GameState): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: GAME_STATE_VERSION, state });
}

const SaveFile = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.number().int(),
  state: z
    .object({
      version: z.number().int(),
      id: z.string(),
      seed: z.number(),
      date: z.string(),
      season: z.string(),
      userClubId: z.string(),
      world: WorldDatabase,
      fixtures: z.array(z.unknown()),
      inbox: z.array(z.unknown()),
    })
    .passthrough(),
});

/** Valida y devuelve una partida a partir del texto de un archivo exportado. */
export function deserializeGame(text: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido');
  }
  const r = SaveFile.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`El archivo no es una partida de Banquillo válida (${i?.path.join('.') ?? ''}: ${i?.message ?? ''})`);
  }
  if (r.data.version > GAME_STATE_VERSION) throw new Error('La partida es de una versión más nueva del juego');
  const state = r.data.state as unknown as GameState;
  if (!state.world.clubs.some((c) => c.id === state.userClubId)) throw new Error('El club del usuario no existe en la partida');
  return ensureDefaults(state);
}

export async function saveGame(state: GameState, opts: { auto?: boolean; slotId?: string } = {}): Promise<SaveMeta> {
  const data = serializeGame(state);
  const club = state.world.clubs.find((c) => c.id === state.userClubId);
  const id = opts.slotId ?? (opts.auto ? `auto-${state.id}` : `${state.id}-${Date.now().toString(36)}`);
  const meta: SaveMeta = {
    id,
    gameId: state.id,
    name: state.name,
    clubName: club?.name ?? '',
    date: state.date,
    season: state.season,
    savedAt: new Date().toISOString(),
    auto: !!opts.auto,
    sizeBytes: data.length,
  };
  const d = getDb();
  await d.transaction('rw', d.meta, d.blobs, async () => {
    await d.blobs.put({ id, data });
    await d.meta.put(meta);
  });
  return meta;
}

export async function listSaves(): Promise<SaveMeta[]> {
  return (await getDb().meta.toArray()).sort((a, b) => (a.savedAt > b.savedAt ? -1 : 1));
}

export async function loadGame(id: string): Promise<GameState> {
  const blob = await getDb().blobs.get(id);
  if (!blob) throw new Error('Partida guardada no encontrada');
  return deserializeGame(blob.data);
}

export async function deleteSave(id: string): Promise<void> {
  const d = getDb();
  await d.transaction('rw', d.meta, d.blobs, async () => {
    await d.meta.delete(id);
    await d.blobs.delete(id);
  });
}
