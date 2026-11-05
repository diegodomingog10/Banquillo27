/**
 * Ojeo: los ojeadores del club se asignan a un país o a una liga y cada semana observan
 * jugadores. El conocimiento de cada jugador (0-100) revela atributos poco a poco y
 * reduce el margen de error, que también depende de la calidad del ojeador.
 *
 * Conocimiento base sin ojear: jugadores propios 100; de la misma liga 35; del mismo
 * país 20; del resto 0 (solo datos públicos: club, edad, posición, valor aproximado).
 */
import { mainPosition } from '../data/ability';
import { ALL_ATTRS, type AttrKey } from '../data/attributes';
import { GROUP_OF_POSITION } from '../data/positions';
import type { Player, Staff } from '../data/schema';
import { weekday } from './calendar';
import { addDays, ageAt } from './date';
import { addMessage, indexes, leagueOf, type GameState } from './game';
import { clamp, hashString } from './rng';

export interface ScoutAssignment {
  scoutId: string;
  target: { kind: 'nation' | 'competition'; id: string };
  /** Filtro opcional: grupo de posición y edad máxima. */
  focus: { group: string | null; maxAge: number | null };
  since: string;
  /** Jugadores observados en esta misión (para el informe). */
  seen: string[];
}

export interface Knowledge {
  level: number;
  /** Calidad (1-20) del mejor ojeador que lo ha visto. */
  quality: number;
  updated: string;
  scoutId: string | null;
}

export interface ScoutRequest {
  playerId: string;
  scoutId: string;
  due: string;
}

export interface ScoutingState {
  assignments: ScoutAssignment[];
  knowledge: Record<string, Knowledge>;
  requests: ScoutRequest[];
}

export function initScouting(state: GameState): ScoutingState {
  return (state.scouting = { assignments: [], knowledge: {}, requests: [] });
}

export function userScouts(state: GameState): Staff[] {
  const club = indexes(state).clubs.get(state.userClubId);
  if (!club) return [];
  const ids = new Set(club.staffIds);
  return state.world.staff.filter((s) => ids.has(s.id) && (s.role === 'scout' || s.role === 'chiefScout' || s.role === 'directorOfFootball'));
}

export function scoutQuality(s: Staff): number {
  return (s.attributes.judgingAbility + s.attributes.judgingPotential) / 2;
}

/** Nivel de conocimiento del jugador para el club del usuario. */
export function knowledgeOf(state: GameState, p: Player): { level: number; quality: number } {
  if (p.clubId === state.userClubId) return { level: 100, quality: 20 };
  const k = state.scouting.knowledge[p.id];
  const ix = indexes(state);
  const userLeague = leagueOf(state, state.userClubId);
  const userNation = ix.clubs.get(state.userClubId)?.nationId;
  const club = p.clubId ? ix.clubs.get(p.clubId) : undefined;
  let base = 0;
  if (club && userLeague?.teamIds.includes(club.id)) base = 35;
  else if (club && club.nationId === userNation) base = 20;
  else if (!club && p.nationalities[0] === userNation) base = 15;
  const level = Math.max(base, k?.level ?? 0);
  return { level, quality: k ? Math.max(k.quality, 9) : 9 };
}

/** Atributos que se ven (null = desconocido) con su margen de error. */
export function scoutedAttributes(state: GameState, p: Player) {
  const { level, quality } = knowledgeOf(state, p);
  const reveal = clamp((level - 5) / 70, 0, 1);
  const err = level >= 100 ? 0 : Math.round(clamp((1 - level / 100) * (24 - quality) / 4.5, 0, 5));
  const out = {} as Record<AttrKey, { value: number | null; min: number; max: number }>;
  for (const a of ALL_ATTRS) {
    const h = hashString(`${p.id}:${a}`);
    const v = p.attributes[a];
    if (level < 100 && (h % 1000) / 1000 >= reveal) { out[a] = { value: null, min: 1, max: 20 }; continue; }
    // Error determinista por jugador y atributo (no cambia al volver a mirar)
    const off = err ? ((h >> 10) % (2 * err + 1)) - err : 0;
    const shown = clamp(v + Math.round(off * 0.6), 1, 20);
    out[a] = { value: shown, min: clamp(shown - err, 1, 20), max: clamp(shown + err, 1, 20) };
  }
  return { level, quality, error: err, attributes: out, personalityKnown: level >= 60, hiddenKnown: level >= 80 };
}

/** Estimación de nivel actual y potencial (en estrellas 0-5) con margen según el ojeo. */
export function scoutedAbility(state: GameState, p: Player, reference: number) {
  const { level, quality } = knowledgeOf(state, p);
  const star = (v: number) => clamp(Math.round((v / Math.max(1, reference)) * 10) / 2, 0.5, 5);
  if (level >= 100) return { ca: [star(p.ca), star(p.ca)] as [number, number], pa: [star(p.pa), star(p.pa)] as [number, number] };
  const spread = (1 - level / 100) * (26 - quality) / 9;
  const h = hashString(`${p.id}:ab`);
  const bias = ((h % 100) / 100 - 0.5) * spread * 0.6;
  const caMid = star(p.ca) + bias;
  const paMid = star(Math.max(p.pa, p.ca)) + bias * 1.5;
  const r = (x: number) => clamp(Math.round(x * 2) / 2, 0.5, 5);
  return {
    ca: [r(caMid - spread / 2), r(caMid + spread / 2)] as [number, number],
    pa: [r(paMid - spread * 0.7), r(paMid + spread * 0.7)] as [number, number],
  };
}

function observe(state: GameState, p: Player, scout: Staff, amount: number): void {
  const q = scoutQuality(scout);
  const k = state.scouting.knowledge[p.id] ?? { level: knowledgeOf(state, p).level, quality: q, updated: state.date, scoutId: scout.id };
  k.level = clamp(Math.round(k.level + amount), 0, 99);
  k.quality = Math.max(k.quality, q);
  k.updated = state.date;
  k.scoutId = scout.id;
  state.scouting.knowledge[p.id] = k;
}

function candidates(state: GameState, a: ScoutAssignment): Player[] {
  const ix = indexes(state);
  let clubs: Set<string>;
  if (a.target.kind === 'competition') clubs = new Set(ix.comps.get(a.target.id)?.teamIds ?? []);
  else clubs = new Set(state.world.clubs.filter((c) => c.nationId === a.target.id).map((c) => c.id));
  return state.world.players.filter((p) => {
    if (p.clubId === state.userClubId) return false;
    const inTarget = p.clubId ? clubs.has(p.clubId) : a.target.kind === 'nation' && p.nationalities[0] === a.target.id;
    if (!inTarget) return false;
    if (a.focus.group && GROUP_OF_POSITION[mainPosition(p.positions)] !== a.focus.group) return false;
    if (a.focus.maxAge && ageAt(p.birthDate, state.date) > a.focus.maxAge) return false;
    return true;
  });
}

/** Ojeo diario: misiones (cada lunes) e informes pedidos (cuando vencen). */
export function scoutingDay(state: GameState): void {
  const sc = state.scouting;
  const ix = indexes(state);
  const staff = new Map(state.world.staff.map((s) => [s.id, s]));
  // Informes individuales
  const pending: ScoutRequest[] = [];
  for (const r of sc.requests) {
    if (r.due > state.date) { pending.push(r); continue; }
    const p = ix.players.get(r.playerId);
    const s = staff.get(r.scoutId);
    if (!p || !s) continue;
    observe(state, p, s, 45 + scoutQuality(s) * 1.5);
    addMessage(state, {
      type: 'scouting', priority: 'normal', key: 'scoutReport', sender: `${s.firstName} ${s.lastName}`,
      params: { player: p.commonName ?? `${p.firstName} ${p.lastName}`, verdict: verdictText(state, p) }, related: { playerId: p.id },
    });
  }
  sc.requests = pending;
  if (weekday(state.date) !== 1) return;
  for (const a of sc.assignments) {
    const s = staff.get(a.scoutId);
    if (!s || s.clubId !== state.userClubId) continue;
    const q = scoutQuality(s);
    const pool = candidates(state, a);
    if (!pool.length) continue;
    const regional = s.regionalKnowledge.includes(a.target.kind === 'nation' ? a.target.id : ix.comps.get(a.target.id)?.nationId ?? '');
    const n = Math.round(3 + q / 4);
    // Prefiere a quien conoce menos y a los mejores (el ojeador sabe dónde mirar)
    const seed = hashString(`${state.date}:${a.scoutId}`);
    const ranked = pool
      .map((p, i) => ({ p, score: (100 - knowledgeOf(state, p).level) * 0.6 + p.ca * 0.25 * (q / 15) + ((seed + i * 7919) % 40) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, n);
    for (const { p } of ranked) {
      observe(state, p, s, 18 + q * 1.2 + (regional ? 10 : 0));
      if (!a.seen.includes(p.id)) a.seen.push(p.id);
    }
    // Informe de la misión cada cuatro semanas
    const weeks = Math.round((Date.parse(state.date) - Date.parse(a.since)) / (7 * 86400000));
    if (weeks > 0 && weeks % 4 === 0) {
      const top = recommendations(state, a.seen).slice(0, 3);
      if (top.length) {
        addMessage(state, {
          type: 'scouting', priority: 'normal', key: 'scoutMission', sender: `${s.firstName} ${s.lastName}`,
          params: { target: targetName(state, a), count: a.seen.length, names: top.map((x) => `${x.name} (${x.position}, ${x.club})`).join('; ') },
        });
      }
    }
  }
}

export function targetName(state: GameState, a: Pick<ScoutAssignment, 'target'>): string {
  if (a.target.kind === 'competition') return indexes(state).comps.get(a.target.id)?.name ?? a.target.id;
  return state.world.nations.find((n) => n.id === a.target.id)?.name ?? a.target.id;
}

/** Nivel medio del once del usuario (referencia para "mejoraría al equipo"). */
function userReference(state: GameState): number {
  const squad = (indexes(state).squads.get(state.userClubId) ?? []).map((p) => p.ca).sort((a, b) => b - a);
  return squad.slice(0, 11).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(11, squad.length));
}

function estimatedCa(state: GameState, p: Player): number {
  const { level, quality } = knowledgeOf(state, p);
  const h = hashString(`${p.id}:ca`);
  const err = (1 - level / 100) * (24 - quality) * 1.2;
  return p.ca + ((h % 200) / 100 - 1) * err;
}

export function recommendation(state: GameState, p: Player): 'A' | 'B' | 'C' | 'D' {
  const ref = userReference(state);
  const ca = estimatedCa(state, p);
  const age = ageAt(p.birthDate, state.date);
  const pot = Math.max(p.pa, p.ca);
  if (ca >= ref + 8 || (age <= 21 && pot >= ref + 20)) return 'A';
  if (ca >= ref - 3 || (age <= 23 && pot >= ref + 8)) return 'B';
  if (ca >= ref - 15) return 'C';
  return 'D';
}

function verdictText(state: GameState, p: Player): string {
  switch (recommendation(state, p)) {
    case 'A': return 'Fichaje recomendado: mejoraría claramente al equipo.';
    case 'B': return 'Buen jugador; sería una incorporación útil.';
    case 'C': return 'Jugador de rotación para nuestro nivel.';
    default: return 'No mejora lo que tenemos.';
  }
}

export function recommendations(state: GameState, ids: readonly string[]) {
  const ix = indexes(state);
  return ids
    .map((id) => ix.players.get(id))
    .filter((p): p is Player => !!p && p.clubId !== state.userClubId)
    .map((p) => ({ id: p.id, name: p.commonName ?? `${p.firstName} ${p.lastName}`, position: mainPosition(p.positions), club: p.clubId ? ix.clubs.get(p.clubId)?.name ?? '' : 'Libre', rec: recommendation(state, p), ca: estimatedCa(state, p) }))
    .filter((x) => x.rec === 'A' || x.rec === 'B')
    .sort((a, b) => (a.rec === b.rec ? b.ca - a.ca : a.rec < b.rec ? -1 : 1));
}

// ---------------------------------------------------------------- acciones
export function assignScout(state: GameState, scoutId: string, target: ScoutAssignment['target'] | null, focus: ScoutAssignment['focus'] = { group: null, maxAge: null }): void {
  const scout = userScouts(state).find((s) => s.id === scoutId);
  if (!scout) throw new Error('Ese ojeador no es de tu club');
  state.scouting.assignments = state.scouting.assignments.filter((a) => a.scoutId !== scoutId);
  if (target) state.scouting.assignments.push({ scoutId, target, focus, since: state.date, seen: [] });
}

export function requestReport(state: GameState, playerId: string): { scout: string; due: string } {
  const p = indexes(state).players.get(playerId);
  if (!p) throw new Error('Jugador inexistente');
  const scouts = userScouts(state);
  if (!scouts.length) throw new Error('No tienes ojeadores');
  const existing = state.scouting.requests.find((r) => r.playerId === playerId);
  const busy = new Map<string, number>();
  for (const r of state.scouting.requests) busy.set(r.scoutId, (busy.get(r.scoutId) ?? 0) + 1);
  const scout = scouts.slice().sort((a, b) => (busy.get(a.id) ?? 0) - (busy.get(b.id) ?? 0) || scoutQuality(b) - scoutQuality(a))[0]!;
  if (existing) return { scout: `${scout.firstName} ${scout.lastName}`, due: existing.due };
  const regional = scout.regionalKnowledge.includes(p.nationalities[0] ?? '');
  const due = addDays(state.date, (regional ? 5 : 10) + (busy.get(scout.id) ?? 0) * 3);
  state.scouting.requests.push({ playerId, scoutId: scout.id, due });
  return { scout: `${scout.firstName} ${scout.lastName}`, due };
}

export function scoutingView(state: GameState) {
  const ix = indexes(state);
  const scouts = userScouts(state);
  return {
    scouts: scouts.map((s) => {
      const a = state.scouting.assignments.find((x) => x.scoutId === s.id) ?? null;
      return {
        id: s.id, name: `${s.firstName} ${s.lastName}`, role: s.role,
        ability: s.attributes.judgingAbility, potential: s.attributes.judgingPotential,
        regions: s.regionalKnowledge.map((n) => state.world.nations.find((x) => x.id === n)?.name ?? n),
        assignment: a ? { target: a.target, name: targetName(state, a), since: a.since, seen: a.seen.length, focus: a.focus } : null,
        requests: state.scouting.requests.filter((r) => r.scoutId === s.id).map((r) => ({ playerId: r.playerId, name: ix.players.get(r.playerId)?.lastName ?? '', due: r.due })),
      };
    }),
    targets: {
      nations: state.world.nations.map((n) => ({ id: n.id, name: n.name })),
      competitions: state.world.competitions.filter((c) => c.format === 'league').map((c) => ({ id: c.id, name: c.name, nation: state.world.nations.find((n) => n.id === c.nationId)?.name ?? '' })),
    },
    recommended: recommendations(state, Object.keys(state.scouting.knowledge).filter((id) => (state.scouting.knowledge[id]?.level ?? 0) >= 40)).slice(0, 25),
  };
}
