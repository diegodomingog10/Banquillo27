/**
 * Progresión de jugadores (cada lunes): crecimiento según edad, potencial, minutos,
 * entrenamiento (plan, entrenadores, instalaciones, foco individual) y personalidad;
 * declive desde los 30 con diferencias por atributo (los físicos primero; los mentales
 * aguantan e incluso mejoran). Los atributos son enteros: el avance fraccionario se
 * acumula hasta sumar un punto.
 */
import { computeCA, estimateMarketValue, fullWeights, mainPosition } from '../data/ability';
import { GOALKEEPING_ATTRS, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS, type VisibleAttr } from '../data/attributes';
import { GROUP_OF_POSITION, type Position, type PositionGroup } from '../data/positions';
import type { Player } from '../data/schema';
import { t } from '../i18n';
import { weekday } from './calendar';
import { ageAt, yearsBetween } from './date';
import { addMessage, indexes, type GameState } from './game';
import { clamp } from './rng';
import { coachQuality, trainingFactor } from './training';

export interface ProgressionState {
  /** Avance fraccionario pendiente por jugador y atributo (y "pos:XX" para posiciones). */
  acc: Record<string, Record<string, number>>;
  /** Minutos recientes (suma con decaimiento semanal). */
  minutes: Record<string, number>;
  /** Cambios de atributos de los jugadores del usuario. */
  changes: Record<string, { date: string; attr: string; delta: number }[]>;
  /** CA al empezar la temporada y el mes (jugadores del usuario). */
  seasonStartCa: Record<string, number>;
  monthStartCa: Record<string, number>;
}

export function initProgression(state: GameState): ProgressionState {
  state.progression = { acc: {}, minutes: {}, changes: {}, seasonStartCa: {}, monthStartCa: {} };
  snapshotUser(state, 'seasonStartCa');
  snapshotUser(state, 'monthStartCa');
  return state.progression;
}

function snapshotUser(state: GameState, key: 'seasonStartCa' | 'monthStartCa'): void {
  const out: Record<string, number> = {};
  for (const p of indexes(state).squads.get(state.userClubId) ?? []) out[p.id] = p.ca;
  state.progression[key] = out;
}

export function recordMinutes(state: GameState, playerId: string, minutes: number): void {
  const m = state.progression.minutes;
  m[playerId] = (m[playerId] ?? 0) + minutes;
}

const isGkAttr = new Set<string>(GOALKEEPING_ATTRS);
const PHYS = new Set<string>(PHYSICAL_ATTRS);
const TECH = new Set<string>(TECHNICAL_ATTRS);
const MENT = new Set<string>(MENTAL_ATTRS);
const VISIBLE: string[] = [...TECHNICAL_ATTRS, ...MENTAL_ATTRS, ...PHYSICAL_ATTRS, ...GOALKEEPING_ATTRS];

/** Peso de cada atributo para la posición, normalizado a media 1 (los irrelevantes casi no se mueven). */
const RELEVANCE = new Map<PositionGroup, Record<string, number>>();
function relevance(group: PositionGroup): Record<string, number> {
  let r = RELEVANCE.get(group);
  if (r) return r;
  const w = fullWeights(group) as Record<VisibleAttr, number>;
  const attrs = VISIBLE.filter((a) => group === 'GK' || !isGkAttr.has(a));
  const mean = attrs.reduce((s, a) => s + (w[a as VisibleAttr] ?? 0), 0) / attrs.length || 1;
  r = {};
  for (const a of VISIBLE) r[a] = group !== 'GK' && isGkAttr.has(a) ? 0 : 0.25 + 0.75 * ((w[a as VisibleAttr] ?? 0) / mean);
  RELEVANCE.set(group, r);
  return r;
}

/** Puntos de CA por año en condiciones ideales según la edad. */
export function growthCurve(age: number): number {
  if (age <= 17) return 12;
  if (age <= 19) return 11;
  if (age <= 21) return 8.5;
  if (age <= 23) return 6.5;
  if (age <= 25) return 2.6;
  if (age <= 27) return 1.2;
  if (age <= 29) return 0.6;
  return 0;
}

/** Puntos de CA por año de declive según la edad. */
export function declineCurve(age: number): number {
  if (age < 30) return 0;
  return [2.4, 3.8, 5.2, 6.6, 8.4, 10, 12][Math.min(6, age - 30)]!;
}

function apply(state: GameState, p: Player, attr: string, delta: number, user: boolean): boolean {
  const acc = (state.progression.acc[p.id] ??= {});
  let v = (acc[attr] ?? 0) + delta;
  let changed = false;
  const attrs = p.attributes as unknown as Record<string, number>;
  while (Math.abs(v) >= 1) {
    const step = v > 0 ? 1 : -1;
    const next = attrs[attr]! + step;
    if (next < 1 || next > 20) { v = 0; break; }
    attrs[attr] = next;
    v -= step;
    changed = true;
    if (user) {
      const list = (state.progression.changes[p.id] ??= []);
      list.unshift({ date: state.date, attr, delta: step });
      if (list.length > 30) list.length = 30;
    }
  }
  if (Math.abs(v) < 1e-4) delete acc[attr];
  else acc[attr] = v;
  return changed;
}

/** Progresión semanal de todos los jugadores (los lunes). */
export function progressionDay(state: GameState): void {
  if (weekday(state.date) !== 1 || state.processed[`prog:${state.date}`]) return;
  state.processed[`prog:${state.date}`] = true;
  const ix = indexes(state);
  const quality = new Map<string, ReturnType<typeof coachQuality>>();
  const fallbackQ = { tactical: 7, technical: 7, physical: 7, setPieces: 7, goalkeeping: 7, mental: 7, youth: 7, medical: 7 };
  for (const p of state.world.players) {
    const club = p.clubId ? ix.clubs.get(p.clubId) : undefined;
    let q = fallbackQ;
    if (club) {
      q = quality.get(club.id) ?? coachQuality(state, club.id);
      quality.set(club.id, q);
    }
    const facilities = club ? club.facilities.training : 4;
    const age = ageAt(p.birthDate, state.date);
    const a = p.attributes;
    const pos = mainPosition(p.positions);
    const group = GROUP_OF_POSITION[pos];
    const rel = relevance(group);
    // Minutos: el titular habitual (~90 por semana) satura el factor
    const mins = state.progression.minutes[p.id] ?? 0;
    const minutesF = age <= 18 ? 0.7 + 0.3 * clamp(mins / 250, 0, 1) : 0.45 + 0.55 * clamp(mins / 380, 0, 1);
    const personality = 0.62 + ((a.professionalism + a.determination) / 40) * 0.76;
    const headroom = clamp((p.pa - p.ca) / 12, 0, 1);
    const youthBoost = age <= 19 && club ? 0.85 + club.facilities.juniorCoaching / 70 + q.youth / 80 : 1;
    const growth = growthCurve(age) * headroom * minutesF * personality * youthBoost * (club ? 1 : 0.6);
    const decline = declineCurve(age) * (1.3 - ((a.professionalism + a.naturalFitness) / 40) * 0.6);
    const user = p.clubId === state.userClubId;
    let changed = false;
    if (growth > 0 || decline > 0) {
      for (const attr of VISIBLE) {
        const r = rel[attr]!;
        if (r === 0) continue;
        let d = 0;
        if (growth > 0) d += (growth / 10 / 52) * r * (club ? trainingFactor(state, p, attr, q, facilities) : 0.8);
        if (decline > 0) {
          const k = PHYS.has(attr) ? 2.3 : TECH.has(attr) ? 0.75 : MENT.has(attr) ? -0.25 : 0.9;
          d -= (decline / 10 / 52) * r * k;
        }
        if (d !== 0 && apply(state, p, attr, d, user)) changed = true;
      }
    }
    // Posición nueva en entrenamiento individual
    const ind = user ? state.training.individual[p.id] : undefined;
    if (ind?.position) learnPosition(state, p, ind.position, q.tactical);
    if (changed) {
      p.ca = computeCA(p.attributes, pos);
      if (p.ca > p.pa) p.pa = p.ca;
    }
    // Los minutos recientes se olvidan poco a poco
    if (mins) state.progression.minutes[p.id] = mins * 0.8 < 1 ? 0 : mins * 0.8;
  }
  if (state.date.slice(8, 10) <= '07') monthlyReport(state);
}

function learnPosition(state: GameState, p: Player, pos: Position, tactical: number): void {
  const cur = p.positions.find((x) => x.position === pos);
  if (cur && cur.rating >= 20) { const ind = state.training.individual[p.id]; if (ind) ind.position = null; return; }
  const acc = (state.progression.acc[p.id] ??= {});
  const key = `pos:${pos}`;
  acc[key] = (acc[key] ?? 0) + 0.18 * (0.5 + p.attributes.versatility / 20) * (0.7 + tactical / 30);
  if (acc[key]! >= 1) {
    acc[key]! -= 1;
    if (cur) cur.rating = Math.min(20, cur.rating + 1);
    else p.positions.push({ position: pos, rating: 5 });
    if (cur?.rating === 20 || (cur && cur.rating % 5 === 0)) {
      addMessage(state, { type: 'player', priority: 'low', key: 'positionLearned', sender: 'Cuerpo técnico', params: { player: p.commonName ?? p.lastName, position: t(`posLong.${pos}`).toLowerCase(), level: cur.rating }, related: { playerId: p.id } });
    }
  }
}

/** Primera semana de cada mes: valor de mercado de todos y resumen de progresos del usuario. */
function monthlyReport(state: GameState): void {
  const ix = indexes(state);
  for (const p of state.world.players) {
    const club = p.clubId ? ix.clubs.get(p.clubId) : undefined;
    p.marketValue = estimateMarketValue({
      ca: p.ca, pa: p.pa, age: ageAt(p.birthDate, state.date),
      contractYears: p.contract ? Math.max(0, yearsBetween(state.date, p.contract.expires)) : 0,
      clubReputation: club?.reputation ?? 1500,
    });
  }
  const before = state.progression.monthStartCa;
  const squad = ix.squads.get(state.userClubId) ?? [];
  const deltas = squad.filter((p) => before[p.id] !== undefined).map((p) => ({ p, d: p.ca - before[p.id]! })).filter((x) => x.d !== 0).sort((a, b) => b.d - a.d);
  const up = deltas.filter((x) => x.d > 0).slice(0, 4);
  const down = deltas.filter((x) => x.d < 0).slice(-3).reverse();
  if (up.length || down.length) {
    const name = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
    addMessage(state, {
      type: 'staff', priority: 'low', key: 'progressReport', sender: 'Cuerpo técnico',
      params: {
        up: up.length ? up.map((x) => name(x.p)).join(', ') : 'nadie destacable',
        down: down.length ? down.map((x) => name(x.p)).join(', ') : 'nadie',
      },
    });
  }
  snapshotUser(state, 'monthStartCa');
}

/** Variación de CA en la temporada (para la plantilla y el entrenamiento). */
export function seasonDelta(state: GameState, p: Player): number | null {
  const s = state.progression.seasonStartCa[p.id];
  return s === undefined ? null : p.ca - s;
}

export function recentChanges(state: GameState, playerId: string, days = 60): { attr: string; delta: number }[] {
  const list = state.progression.changes[playerId] ?? [];
  const sum = new Map<string, number>();
  for (const c of list) {
    if (yearsBetween(c.date, state.date) * 365 > days) continue;
    sum.set(c.attr, (sum.get(c.attr) ?? 0) + c.delta);
  }
  return [...sum].filter(([, d]) => d !== 0).map(([attr, delta]) => ({ attr, delta }));
}

/** Nueva temporada: la foto de CA se renueva y se informa de la evolución. */
export function seasonProgressReport(state: GameState): void {
  const ix = indexes(state);
  const squad = ix.squads.get(state.userClubId) ?? [];
  const start = state.progression.seasonStartCa;
  const deltas = squad.filter((p) => start[p.id] !== undefined).map((p) => ({ p, d: p.ca - start[p.id]! })).sort((a, b) => b.d - a.d);
  const name = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
  if (deltas.length) {
    addMessage(state, {
      type: 'staff', priority: 'normal', key: 'seasonProgress', sender: 'Cuerpo técnico',
      params: {
        up: deltas.filter((x) => x.d > 0).slice(0, 5).map((x) => `${name(x.p)} (+${x.d})`).join(', ') || 'nadie',
        down: deltas.filter((x) => x.d < 0).slice(-4).reverse().map((x) => `${name(x.p)} (${x.d})`).join(', ') || 'nadie',
      },
    });
  }
  snapshotUser(state, 'seasonStartCa');
  snapshotUser(state, 'monthStartCa');
}
