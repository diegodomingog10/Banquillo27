/**
 * Gestión del equipo del usuario: alineación propia, cambios de táctica, familiaridad
 * táctica y preferencias de interfaz que viajan con la partida guardada.
 */
import { GROUP_OF_POSITION } from '../data/positions';
import type { Player } from '../data/schema';
import { indexes, type GameState } from './game';
import { initEconomy } from './economy';
import { initScouting } from './scouting';
import { initTransfers } from './transfers';
import { initBoard } from './board';
import { autoLineup, isAvailable, slotScore, type Lineup } from './lineup';
import { clamp } from './rng';
import { FORMATIONS, type TeamTactic } from './tactics';

export const DASHBOARD_TILES = ['nextMatch', 'table', 'form', 'objectives', 'absences', 'finances', 'news'] as const;
export type DashboardTile = (typeof DASHBOARD_TILES)[number];

export interface SquadView {
  id: string;
  name: string;
  columns: string[];
}

export interface UiPrefs {
  dashboard: { id: DashboardTile; visible: boolean }[];
  squadViews: SquadView[];
  shortlist: string[];
}

export const DEFAULT_UI: UiPrefs = {
  dashboard: DASHBOARD_TILES.map((id) => ({ id, visible: true })),
  squadViews: [],
  shortlist: [],
};

/** Completa campos añadidos en versiones posteriores (partidas antiguas). */
export function ensureDefaults(state: GameState): GameState {
  const s = state as GameState & Partial<Pick<GameState, 'ui' | 'userLineup' | 'tacticFamiliarity' | 'postMatch' | 'economy' | 'scouting' | 'transfers' | 'board'>>;
  if (!s.ui) s.ui = structuredClone(DEFAULT_UI);
  for (const id of DASHBOARD_TILES) if (!s.ui.dashboard.some((t) => t.id === id)) s.ui.dashboard.push({ id, visible: true });
  s.ui.squadViews ??= [];
  s.ui.shortlist ??= [];
  if (s.userLineup === undefined) s.userLineup = null;
  if (typeof s.tacticFamiliarity !== 'number') s.tacticFamiliarity = 75;
  if (s.postMatch === undefined) s.postMatch = null;
  // Fase 6: economía, ojeo, mercado y directiva
  if (!s.economy) initEconomy(state);
  if (!s.scouting) initScouting(state);
  if (!s.transfers) initTransfers(state);
  if (!s.board) initBoard(state);
  return state;
}

function userSquad(state: GameState): Player[] {
  return indexes(state).squads.get(state.userClubId) ?? [];
}

/**
 * Alineación efectiva del usuario: la que eligió, sustituyendo por el asistente a quien
 * no esté disponible (lesión, sanción, ya no está en el club).
 */
export function resolveUserLineup(state: GameState): Lineup & { replaced: string[] } {
  const squad = userSquad(state);
  const tactic = state.userTactic;
  const auto = autoLineup(squad, tactic);
  const chosen = state.userLineup;
  if (!chosen) return { ...auto, replaced: [] };
  const byId = new Map(squad.map((p) => [p.id, p]));
  const used = new Set<string>();
  const starting: string[] = [];
  const replaced: string[] = [];
  tactic.slots.forEach((slot, i) => {
    const id = chosen.starting[i];
    const p = id ? byId.get(id) : undefined;
    if (p && isAvailable(p) && !used.has(p.id)) {
      starting.push(p.id);
      used.add(p.id);
      return;
    }
    if (id) replaced.push(id);
    // Mejor disponible para ese hueco
    let best: Player | null = null;
    let bestS = -Infinity;
    for (const c of squad) {
      if (used.has(c.id) || !isAvailable(c)) continue;
      const s = slotScore(c, slot);
      if (s > bestS) { bestS = s; best = c; }
    }
    if (best) { starting.push(best.id); used.add(best.id); }
  });
  const bench = chosen.bench.filter((id) => !used.has(id) && byId.get(id) && isAvailable(byId.get(id)!));
  for (const id of auto.bench) if (bench.length < 9 && !used.has(id) && !bench.includes(id)) bench.push(id);
  return { starting, bench: bench.slice(0, 9), replaced };
}

/** Cambia la táctica del usuario. Cambiar de sistema cuesta familiaridad; los ajustes, menos. */
export function setUserTactic(state: GameState, tactic: TeamTactic): void {
  const prev = state.userTactic;
  if (!FORMATIONS[tactic.formation]) throw new Error(`Formación desconocida: ${tactic.formation}`);
  let fam = state.tacticFamiliarity;
  if (prev.formation !== tactic.formation) {
    fam = Math.min(fam, Math.max(30, fam - 35));
    // Reubicar a los titulares en la nueva formación por afinidad de posición
    const lineup = state.userLineup ?? resolveUserLineup(state);
    const prevPlayers = lineup.starting.map((id, i) => ({ id, pos: prev.slots[i]?.position })).filter((x) => x.id);
    const left = [...prevPlayers];
    const starting: (string | null)[] = tactic.slots.map((slot) => {
      let k = left.findIndex((x) => x.pos === slot.position);
      if (k < 0) k = left.findIndex((x) => x.pos && GROUP_OF_POSITION[x.pos] === GROUP_OF_POSITION[slot.position]);
      if (k < 0) k = left.findIndex((x) => x.pos !== 'GK' && slot.position !== 'GK');
      if (k < 0) return null;
      const [x] = left.splice(k, 1);
      return x?.id ?? null;
    });
    state.userLineup = { starting: starting.map((x) => x ?? ''), bench: lineup.bench };
  } else {
    const a = prev.instructions;
    const b = tactic.instructions;
    let changes = (Object.keys(b) as (keyof typeof b)[]).filter((k) => a[k] !== b[k]).length;
    if (prev.mentality !== tactic.mentality) changes++;
    fam = Math.max(40, fam - changes * 2);
  }
  state.tacticFamiliarity = clamp(Math.round(fam), 0, 100);
  state.userTactic = structuredClone(tactic);
}

export function setUserLineup(state: GameState, lineup: { starting: string[]; bench: string[] }): void {
  const ids = new Set(userSquad(state).map((p) => p.id));
  const starting = state.userTactic.slots.map((_, i) => (lineup.starting[i] && ids.has(lineup.starting[i]!) ? lineup.starting[i]! : ''));
  const seen = new Set(starting.filter(Boolean));
  if (seen.size !== starting.filter(Boolean).length) throw new Error('Un jugador no puede ocupar dos posiciones');
  state.userLineup = { starting, bench: lineup.bench.filter((id) => ids.has(id) && !seen.has(id)).slice(0, 9) };
}

/** La familiaridad crece con los días de trabajo y con los partidos jugados con el sistema. */
export function growFamiliarity(state: GameState, amount: number): void {
  state.tacticFamiliarity = clamp(state.tacticFamiliarity + amount * (1 - state.tacticFamiliarity / 115), 0, 100);
}
