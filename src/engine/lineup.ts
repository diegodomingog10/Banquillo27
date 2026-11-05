/**
 * Selección automática de alineación, banquillo y lanzadores (la usan la IA de los
 * clubes y el asistente del usuario).
 */
import { ROLE_BY_ID, roleSuitability } from '../data/roles';
import type { Position } from '../data/positions';
import type { Player } from '../data/schema';
import type { TeamTactic } from './tactics';

export interface Lineup {
  /** Id del jugador por cada slot de la táctica (mismo orden). */
  starting: string[];
  bench: string[];
}

export function positionRating(p: Player, pos: Position): number {
  return p.positions.find((x) => x.position === pos)?.rating ?? 1;
}

export function isAvailable(p: Player): boolean {
  return !p.injury && p.cards.suspendedMatches === 0;
}

/** Puntuación de un jugador para un slot: idoneidad al rol × familiaridad con la posición × forma física. */
export function slotScore(p: Player, slot: { position: Position; role: string }): number {
  const role = ROLE_BY_ID.get(slot.role);
  const suit = role ? roleSuitability(p.attributes, role) : p.ca / 10;
  const posFactor = 0.55 + 0.45 * (positionRating(p, slot.position) / 20);
  const cond = 0.6 + 0.4 * (p.condition / 100);
  return suit * posFactor * cond;
}

export function autoLineup(squad: readonly Player[], tactic: TeamTactic, benchSize = 9): Lineup {
  const pool = squad.filter(isAvailable);
  const used = new Set<string>();
  const starting: string[] = new Array(tactic.slots.length).fill('');
  // Primero los slots más exigentes (portero, luego por menos candidatos naturales)
  const order = tactic.slots
    .map((s, i) => ({ s, i, naturals: pool.filter((p) => positionRating(p, s.position) >= 15).length }))
    .sort((a, b) => (a.s.position === 'GK' ? -1 : b.s.position === 'GK' ? 1 : a.naturals - b.naturals));
  for (const { s, i } of order) {
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      if (s.position !== 'GK' && positionRating(p, 'GK') >= 15 && p.positions.length === 1) continue;
      const sc = slotScore(p, s);
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    if (best) { used.add(best.id); starting[i] = best.id; }
  }
  // Si faltan jugadores (plantilla muy corta), se completa con quien quede
  for (let i = 0; i < starting.length; i++) {
    if (starting[i]) continue;
    const any = squad.find((p) => !used.has(p.id));
    if (any) { used.add(any.id); starting[i] = any.id; }
  }
  const rest = pool.filter((p) => !used.has(p.id)).sort((a, b) => b.ca - a.ca);
  const bench: string[] = [];
  const gk = rest.find((p) => positionRating(p, 'GK') >= 15);
  if (gk && benchSize > 0) bench.push(gk.id);
  for (const p of rest) {
    if (bench.length >= benchSize) break;
    if (!bench.includes(p.id) && positionRating(p, 'GK') < 15) bench.push(p.id);
  }
  return { starting: starting.filter(Boolean), bench };
}

/** Lanzadores y capitán por atributos, entre los titulares. */
export function autoSetPieces(players: readonly Player[]): TeamTactic['setPieces'] {
  const outfield = players.filter((p) => positionRating(p, 'GK') < 15);
  const best = (f: (p: Player) => number) => outfield.slice().sort((a, b) => f(b) - f(a))[0]?.id ?? null;
  return {
    corners: best((p) => p.attributes.corners * 2 + p.attributes.crossing + p.attributes.technique),
    freeKicks: best((p) => p.attributes.freeKicks * 2 + p.attributes.technique + p.attributes.longShots),
    penalties: best((p) => p.attributes.penalties * 2 + p.attributes.composure + p.attributes.finishing),
    throwIns: best((p) => p.attributes.longThrows),
    captain: players.slice().sort((a, b) => b.attributes.leadership - a.attributes.leadership)[0]?.id ?? null,
  };
}
