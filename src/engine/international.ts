/**
 * Selecciones nacionales: en cada parón internacional cada país convoca a sus 23
 * mejores jugadores y juega dos amistosos. Los convocados vuelven algo cansados (y a
 * veces tocados) pero más motivados; se cuentan sus internacionalidades.
 */
import { mainPosition } from '../data/ability';
import type { Player } from '../data/schema';
import { t } from '../i18n';
import { ageAt } from './date';
import { addMessage, indexes, type GameState } from './game';
import { clamp, createRng, hashString } from './rng';

export interface InternationalState {
  caps: Record<string, number>;
  goals: Record<string, number>;
  squads: Record<string, string[]>;
  results: { date: string; home: string; away: string; hg: number; ag: number }[];
}

export function initInternational(state: GameState): InternationalState {
  return (state.international = { caps: {}, goals: {}, squads: {}, results: [] });
}

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

function callUp(players: Player[]): Player[] {
  // 3 porteros y 20 de campo
  const gks = players.filter((p) => mainPosition(p.positions) === 'GK').slice(0, 3);
  const field = players.filter((p) => mainPosition(p.positions) !== 'GK').slice(0, 20);
  return [...gks, ...field];
}

/** Inicio y final de cada parón internacional. */
export function internationalDay(state: GameState): void {
  for (const b of state.calendar.internationalBreaks) {
    if (state.date === b.from && !state.processed[`intl:${b.from}`]) {
      state.processed[`intl:${b.from}`] = true;
      startBreak(state);
    }
    if (state.date === b.to && !state.processed[`intlend:${b.to}`]) {
      state.processed[`intlend:${b.to}`] = true;
      endBreak(state);
    }
  }
}

function startBreak(state: GameState): void {
  const byNation = new Map<string, Player[]>();
  for (const p of state.world.players) {
    if (!p.clubId || p.injury || ageAt(p.birthDate, state.date) < 17) continue;
    const n = p.nationalities[0];
    if (!n) continue;
    byNation.set(n, [...(byNation.get(n) ?? []), p]);
  }
  const intl = state.international;
  intl.squads = {};
  for (const [n, list] of byNation) {
    list.sort((a, b) => b.ca - a.ca);
    intl.squads[n] = callUp(list).map((p) => p.id);
  }
  const mine = Object.values(intl.squads).flat().map((id) => indexes(state).players.get(id)).filter((p): p is Player => p?.clubId === state.userClubId);
  if (mine.length) {
    addMessage(state, {
      type: 'player', priority: 'normal', key: 'callUps', sender: 'Selecciones nacionales',
      params: { count: mine.length, names: mine.map((p) => `${nameOf(p)} (${state.world.nations.find((x) => x.id === p.nationalities[0])?.name ?? ''})`).join(', ') },
    });
  }
}

function endBreak(state: GameState): void {
  const ix = indexes(state);
  const intl = state.international;
  const rng = createRng(hashString(`intl:${state.seed}:${state.date}`));
  const nations = Object.keys(intl.squads).filter((n) => (intl.squads[n]?.length ?? 0) >= 11);
  const strength = (n: string) => {
    const ps = (intl.squads[n] ?? []).map((id) => ix.players.get(id)).filter((p): p is Player => !!p).sort((a, b) => b.ca - a.ca).slice(0, 11);
    return ps.reduce((a, p) => a + p.ca, 0) / Math.max(1, ps.length);
  };
  // Dos amistosos por selección contra rivales al azar
  const order = rng.shuffle(nations);
  for (let round = 0; round < 2; round++) {
    const o = round === 0 ? order : rng.shuffle(order);
    for (let i = 0; i + 1 < o.length; i += 2) {
      const [h, a] = [o[i]!, o[i + 1]!];
      const d = (strength(h) - strength(a)) / 25;
      const hg = poisson(rng, Math.max(0.2, 1.35 + d * 0.6));
      const ag = poisson(rng, Math.max(0.2, 1.1 - d * 0.6));
      intl.results.unshift({ date: state.date, home: h, away: a, hg, ag });
      for (const [nat, goals] of [[h, hg], [a, ag]] as const) {
        const squad = (intl.squads[nat] ?? []).map((id) => ix.players.get(id)).filter((p): p is Player => !!p);
        const scorers = squad.filter((p) => ['ST', 'AM', 'LW', 'RW'].includes(mainPosition(p.positions)));
        for (let g = 0; g < goals && scorers.length; g++) {
          const s = rng.pick(scorers);
          intl.goals[s.id] = (intl.goals[s.id] ?? 0) + 1;
        }
      }
    }
  }
  if (intl.results.length > 80) intl.results.length = 80;
  // Vuelta de los convocados: cansancio, algún golpe, moral e internacionalidades
  for (const ids of Object.values(intl.squads)) {
    for (const id of ids) {
      const p = ix.players.get(id);
      if (!p) continue;
      const played = ids.indexOf(id) < 16;
      if (played) intl.caps[id] = (intl.caps[id] ?? 0) + 2;
      p.condition = clamp(p.condition - (played ? rng.int(6, 14) : 3), 40, 100);
      p.morale = clamp(p.morale + 3, 5, 100);
      if (played && !p.injury && rng.chance(0.015)) {
        const days = rng.int(4, 21);
        p.injury = { type: rng.pick(['hamstring', 'ankleSprain', 'calf', 'thigh']), severity: days > 10 ? 'moderate' : 'minor', startDate: state.date, daysOut: days, daysRemaining: days };
        if (p.clubId === state.userClubId) {
          addMessage(state, { type: 'injury', priority: 'high', key: 'internationalInjury', sender: 'Servicios médicos', params: { player: nameOf(p), injury: t(`injury.${p.injury.type}`), days }, related: { playerId: p.id } });
        }
      }
    }
  }
  const userNation = ix.clubs.get(state.userClubId)?.nationId;
  const res = intl.results.filter((r) => r.date === state.date && (r.home === userNation || r.away === userNation));
  const nm = (id: string) => state.world.nations.find((x) => x.id === id)?.name ?? id;
  for (const r of res) state.news.unshift({ date: state.date, type: 'international', text: `Amistoso: ${nm(r.home)} ${r.hg}-${r.ag} ${nm(r.away)}` });
  intl.squads = {};
}

function poisson(rng: ReturnType<typeof createRng>, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 10);
  return k - 1;
}

export function capsOf(state: GameState, playerId: string): { caps: number; goals: number } {
  return { caps: state.international.caps[playerId] ?? 0, goals: state.international.goals[playerId] ?? 0 };
}
