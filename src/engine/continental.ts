/**
 * Torneos continentales (formato groupCup): sorteo de grupos con bombos por reputación
 * evitando equipos del mismo país, fase de grupos a ida y vuelta, eliminatorias a doble
 * partido (el global decide; si hay empate, prórroga y penaltis en la vuelta) y final a
 * partido único en campo neutral. Las plazas salen de las clasificaciones de liga.
 */
import type { Competition } from '../data/schema';
import { roundMoney } from '../data/ability';
import { addDays, isoFromParts } from './date';
import { credit } from './economy';
import { addFixture, addMessage, indexes, nextId, recordTrophy, rngFor, type Fixture, type GameState } from './game';
import { computeStandings, type StandingRow } from './standings';
import { inRanges } from './calendar';

export interface ContinentalGroup {
  name: string;
  teams: string[];
}

export interface KnockoutTie {
  a: string; // juega la ida en casa
  b: string;
  leg1: string | null;
  leg2: string | null;
  winnerId: string | null;
}

export interface KnockoutRound {
  key: string; // r16, qf, sf, final
  drawDate: string;
  dates: string[]; // una (final) o dos fechas
  drawn: boolean;
  ties: KnockoutTie[];
}

export interface ContinentalState {
  competitionId: string;
  drawDate: string;
  drawn: boolean;
  groups: ContinentalGroup[];
  groupDates: string[];
  rounds: KnockoutRound[];
  championId: string | null;
}

const KO_KEYS: Record<number, string> = { 16: 'r16', 8: 'qf', 4: 'sf', 2: 'final' };

function weekdayDates(from: string, to: string, weekday: number, blocked: { from: string; to: string }[], reserved: Set<string>): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== weekday) continue;
    if (inRanges(d, blocked) || reserved.has(d)) continue;
    out.push(d);
  }
  return out;
}

function spread(dates: string[], n: number): string[] {
  if (dates.length <= n) return dates.slice(0, n);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(dates[Math.round((i * (dates.length - 1)) / Math.max(1, n - 1))]!);
  return out;
}

/** Planifica un torneo continental para la temporada (fechas reservadas para que no choquen). */
export function planContinental(state: GameState, comp: Competition, year: number, reserved: Set<string>): ContinentalState | null {
  const clubs = indexes(state).clubs;
  const teams = comp.teamIds.filter((id) => clubs.has(id));
  const g = comp.rules.groups;
  const size = g?.size ?? 4;
  const count = Math.max(1, Math.min(g?.count ?? 8, Math.floor(teams.length / size)));
  if (teams.length < size) return null;
  const blocked = state.calendar.internationalBreaks;
  // El torneo principal los martes; el segundo, los jueves
  const wd = comp.reputation >= 8000 ? 2 : 4;
  const groupDates = spread(weekdayDates(isoFromParts(year, 9, 14), isoFromParts(year, 12, 12), wd, blocked, reserved), (size - 1) * 2);
  const qualifiers = count * (g?.qualifiersPerGroup ?? 2);
  let p = 1;
  while (p * 2 <= qualifiers) p *= 2;
  const rounds: KnockoutRound[] = [];
  const koDates = weekdayDates(isoFromParts(year + 1, 2, 10), isoFromParts(year + 1, 5, 20), wd, blocked, reserved);
  const keys: string[] = [];
  for (let s = p; s >= 2; s /= 2) keys.push(KO_KEYS[s] ?? `r${s}`);
  // Una fecha de inicio por ronda (repartidas) y la vuelta, una semana después
  const starts = spread(koDates.slice(0, -1), keys.length);
  for (const [k, key] of keys.entries()) {
    const first = starts[k] ?? isoFromParts(year + 1, 5, 27);
    const dates = [first];
    if (key !== 'final' && comp.rules.knockoutLegs >= 2) dates.push(koDates.find((d) => d >= addDays(first, 7)) ?? addDays(first, 7));
    rounds.push({ key, drawDate: addDays(first, -14), dates, drawn: false, ties: [] });
  }
  for (const d of [...groupDates, ...rounds.flatMap((r) => r.dates)]) reserved.add(d);
  return { competitionId: comp.id, drawDate: isoFromParts(year, 8, 27), drawn: false, groups: Array.from({ length: count }, (_, k) => ({ name: String.fromCharCode(65 + k), teams: [] })), groupDates, rounds, championId: null };
}

// ---------------------------------------------------------------- sorteos
function drawGroups(state: GameState, cs: ContinentalState): void {
  const ix = indexes(state);
  const comp = ix.comps.get(cs.competitionId)!;
  const rng = rngFor(state, `cdraw:${cs.competitionId}:${state.season}`);
  const n = cs.groups.length;
  const size = comp.rules.groups?.size ?? 4;
  const teams = comp.teamIds.filter((id) => ix.clubs.has(id)).sort((a, b) => (ix.clubs.get(b)!.reputation - ix.clubs.get(a)!.reputation)).slice(0, n * size);
  const nation = (id: string) => ix.clubs.get(id)?.nationId ?? '';
  const avoid = comp.rules.groups?.avoidSameNation ?? true;
  const pots = Array.from({ length: size }, (_, k) => teams.slice(k * n, (k + 1) * n));
  for (const pot of pots) {
    const order = rng.shuffle(pot);
    for (const team of order) {
      const open = cs.groups.filter((g) => g.teams.length < pots.indexOf(pot) + 1);
      const ok = open.filter((g) => !avoid || !g.teams.some((x) => nation(x) === nation(team)));
      const target = (ok.length ? ok : open)[0] ?? cs.groups.find((g) => g.teams.length < size)!;
      target.teams.push(team);
    }
  }
  // Calendario de la fase de grupos (ida y vuelta)
  for (const g of cs.groups) {
    const t = g.teams;
    if (t.length < 2) continue;
    const pairs: [string, string][][] = t.length === 4
      ? [[[t[0]!, t[3]!], [t[1]!, t[2]!]], [[t[2]!, t[0]!], [t[3]!, t[1]!]], [[t[0]!, t[1]!], [t[2]!, t[3]!]]]
      : t.slice(1).map((x) => [[t[0]!, x]]);
    const all = [...pairs, ...pairs.map((md) => md.map(([h, a]) => [a, h] as [string, string]))];
    all.forEach((md, k) => {
      for (const [homeId, awayId] of md) {
        addFixture(state, { id: nextId(state, 'f'), competitionId: cs.competitionId, season: state.season, round: `gs:${k + 1}`, stage: 'continental', date: cs.groupDates[k] ?? addDays(cs.groupDates.at(-1) ?? state.date, 7 * (k + 1)), homeId, awayId, played: false, decideWinner: false, result: null, summary: null, group: g.name });
      }
    });
  }
  cs.drawn = true;
  // Ingreso por participar
  for (const id of teams) credit(state, id, 'prizes', comp.prizes.tvPerTeam);
  const mine = cs.groups.find((g) => g.teams.includes(state.userClubId));
  if (mine) {
    addMessage(state, {
      type: 'competition', priority: 'high', key: 'continentalDraw', sender: comp.name,
      params: {
        cup: comp.name, group: mine.name, rivals: mine.teams.filter((x) => x !== state.userClubId).map((x) => ix.clubs.get(x)?.name ?? x).join(', '),
        groups: cs.groups.map((g) => `Grupo ${g.name}: ${g.teams.map((x) => ix.clubs.get(x)?.name ?? x).join(', ')}`).join('\n'),
        pots: pots.map((pot, k) => `Bombo ${k + 1}: ${pot.map((x) => ix.clubs.get(x)?.name ?? x).join(', ')}`).join('\n'),
      },
      related: { competitionId: comp.id },
    });
  }
}

export function groupTable(state: GameState, cs: ContinentalState, g: ContinentalGroup): StandingRow[] {
  const comp = indexes(state).comps.get(cs.competitionId)!;
  const fx = state.fixtures.filter((f) => f.competitionId === cs.competitionId && f.group === g.name && f.played && f.result);
  return computeStandings(g.teams, fx.map((f) => ({ homeId: f.homeId, awayId: f.awayId, homeGoals: f.result!.homeGoals, awayGoals: f.result!.awayGoals })), comp.rules);
}

function drawKnockout(state: GameState, cs: ContinentalState, idx: number): boolean {
  const ix = indexes(state);
  const round = cs.rounds[idx]!;
  const comp = ix.comps.get(cs.competitionId)!;
  const rng = rngFor(state, `kdraw:${cs.competitionId}:${state.season}:${round.key}`);
  let pairs: [string, string][] = [];
  if (idx === 0) {
    // Primeros contra segundos de otro grupo (y de otro país si se puede)
    const q = comp.rules.groups?.qualifiersPerGroup ?? 2;
    const tables = cs.groups.map((g) => ({ g, t: groupTable(state, cs, g) }));
    const firsts = tables.map((x) => ({ id: x.t[0]?.clubId, g: x.g.name, pts: x.t[0]?.points ?? 0 })).filter((x) => x.id) as { id: string; g: string; pts: number }[];
    const seconds = q >= 2 ? tables.map((x) => ({ id: x.t[1]?.clubId, g: x.g.name, pts: x.t[1]?.points ?? 0 })).filter((x) => x.id) as { id: string; g: string; pts: number }[] : [];
    const slots = round.key === 'final' ? 2 : round.key === 'sf' ? 4 : round.key === 'qf' ? 8 : 16;
    const qualified = [...firsts, ...seconds.sort((a, b) => b.pts - a.pts)].slice(0, slots);
    const top = qualified.slice(0, slots / 2);
    const bottom = rng.shuffle(qualified.slice(slots / 2));
    const nation = (id: string) => ix.clubs.get(id)?.nationId;
    for (const w of top) {
      let k = bottom.findIndex((r) => r.g !== w.g && nation(r.id) !== nation(w.id));
      if (k < 0) k = bottom.findIndex((r) => r.g !== w.g);
      if (k < 0) k = 0;
      const r = bottom.splice(k, 1)[0]!;
      pairs.push([r.id, w.id]); // el segundo juega la ida en casa
    }
  } else {
    const winners = cs.rounds[idx - 1]!.ties.map((t) => t.winnerId).filter((x): x is string => !!x);
    const order = rng.shuffle(winners);
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i]!, order[i + 1]!]);
  }
  if (!pairs.length) return false;
  round.ties = [];
  for (const [a, b] of pairs) {
    const tie: KnockoutTie = { a, b, leg1: null, leg2: null, winnerId: null };
    const single = round.dates.length < 2;
    const d1 = round.dates[0]! < state.date ? addDays(state.date, 3) : round.dates[0]!;
    const f1: Fixture = { id: nextId(state, 'f'), competitionId: cs.competitionId, season: state.season, round: `ko:${round.key}${single ? '' : ':1'}`, stage: 'continental', date: d1, homeId: a, awayId: b, played: false, decideWinner: single, result: null, summary: null, neutral: round.key === 'final' };
    addFixture(state, f1);
    tie.leg1 = f1.id;
    if (!single) {
      const d2 = round.dates[1]! <= d1 ? addDays(d1, 7) : round.dates[1]!;
      const f2: Fixture = { id: nextId(state, 'f'), competitionId: cs.competitionId, season: state.season, round: `ko:${round.key}:2`, stage: 'continental', date: d2, homeId: b, awayId: a, played: false, decideWinner: true, result: null, summary: null, firstLegId: f1.id };
      addFixture(state, f2);
      tie.leg2 = f2.id;
    }
    round.ties.push(tie);
  }
  round.drawn = true;
  const mine = round.ties.find((x) => x.a === state.userClubId || x.b === state.userClubId);
  if (mine) {
    const opp = mine.a === state.userClubId ? mine.b : mine.a;
    addMessage(state, {
      type: 'competition', priority: 'normal', key: 'cupDraw', sender: comp.name,
      params: {
        cup: comp.name, round: `ko:${round.key}`.startsWith('ko:final') ? 'Final' : roundName(round.key), club: ix.clubs.get(state.userClubId)?.name ?? '',
        opponent: ix.clubs.get(opp)?.name ?? '', venue: round.key === 'final' ? 'campo neutral' : mine.a === state.userClubId ? 'ida en casa' : 'ida fuera', date: round.dates[0]!,
        pairings: round.ties.map((x) => `${ix.clubs.get(x.a)?.name} - ${ix.clubs.get(x.b)?.name}`).join('\n'),
      },
      related: { competitionId: comp.id },
    });
  }
  return true;
}

export function roundName(key: string): string {
  return ({ r16: 'Octavos de final', qf: 'Cuartos de final', sf: 'Semifinales', final: 'Final' } as Record<string, string>)[key] ?? key;
}

/** Sorteos que tocan hoy. Devuelve true si hubo alguno (para detener el tiempo). */
export function continentalDay(state: GameState): boolean {
  let stop = false;
  const ix = indexes(state);
  for (const cs of Object.values(state.continental)) {
    if (!cs.drawn && state.date >= cs.drawDate) { drawGroups(state, cs); stop = cs.groups.some((g) => g.teams.includes(state.userClubId)) || stop; continue; }
    const idx = cs.rounds.findIndex((r) => !r.drawn);
    if (idx < 0 || state.date < cs.rounds[idx]!.drawDate) continue;
    const prevDone = idx === 0
      ? state.fixtures.filter((f) => f.competitionId === cs.competitionId && f.stage === 'continental' && f.round.startsWith('gs:')).every((f) => f.played)
      : cs.rounds[idx - 1]!.ties.every((t) => t.winnerId);
    if (!prevDone) continue;
    const alive = idx === 0 || cs.rounds[idx - 1]!.ties.some((t) => t.winnerId === state.userClubId);
    if (drawKnockout(state, cs, idx) && alive && cs.rounds[idx]!.ties.some((t) => t.a === state.userClubId || t.b === state.userClubId)) stop = true;
  }
  void ix;
  return stop;
}

/** Tras un partido continental: premios y avance de las eliminatorias. */
export function afterContinentalFixture(state: GameState, f: Fixture): void {
  const cs = state.continental[f.competitionId];
  if (!cs || !f.result) return;
  const ix = indexes(state);
  const comp = ix.comps.get(cs.competitionId)!;
  const r = f.result;
  // Premios por partido de grupos
  if (f.round.startsWith('gs:')) {
    if (r.homeGoals > r.awayGoals) credit(state, f.homeId, 'prizes', comp.prizes.perWin);
    else if (r.awayGoals > r.homeGoals) credit(state, f.awayId, 'prizes', comp.prizes.perWin);
    else { credit(state, f.homeId, 'prizes', comp.prizes.perDraw); credit(state, f.awayId, 'prizes', comp.prizes.perDraw); }
    return;
  }
  for (const [ri, round] of cs.rounds.entries()) {
    const tie = round.ties.find((t) => t.leg1 === f.id || t.leg2 === f.id);
    if (!tie) continue;
    const decisive = tie.leg2 ? f.id === tie.leg2 : true;
    if (!decisive) return;
    tie.winnerId = r.winnerId ?? (r.homeGoals >= r.awayGoals ? f.homeId : f.awayId);
    const loser = tie.winnerId === tie.a ? tie.b : tie.a;
    credit(state, tie.winnerId, 'prizes', comp.prizes.byRound[Math.min(ri + 1, comp.prizes.byRound.length - 1)] ?? 0);
    if (loser === state.userClubId) {
      addMessage(state, { type: 'competition', priority: 'normal', key: 'cupOut', params: { cup: comp.name, club: ix.clubs.get(loser)?.name ?? '', round: roundName(round.key).toLowerCase(), opponent: ix.clubs.get(tie.winnerId)?.name ?? '' }, related: { competitionId: comp.id } });
    }
    if (round.key === 'final') {
      cs.championId = tie.winnerId;
      recordTrophy(state, cs.competitionId, tie.winnerId);
      state.news.unshift({ date: state.date, type: 'cup', text: `${ix.clubs.get(tie.winnerId)?.name ?? ''} gana la ${comp.name}` });
      credit(state, tie.winnerId, 'prizes', roundMoney((comp.prizes.byRound.at(-1) ?? 0) * 1.5));
    }
    return;
  }
}

/** Contexto de la vuelta: goles de la ida vistos desde el partido de vuelta. */
export function aggregateFor(state: GameState, f: Fixture): { home: number; away: number } | undefined {
  if (!f.firstLegId) return undefined;
  const first = indexes(state).fixtures.get(f.firstLegId);
  if (!first?.result) return undefined;
  // En la vuelta el local es el visitante de la ida
  return { home: first.result.awayGoals, away: first.result.homeGoals };
}

/** Plazas continentales para la temporada siguiente según las clasificaciones finales. */
export function qualifyContinental(state: GameState, finalTables: Map<string, { clubId: string; position: number }[]>): void {
  const comps = state.world.competitions;
  const entrants = new Map<string, string[]>();
  for (const league of comps) {
    if (league.format !== 'league') continue;
    const table = finalTables.get(league.id);
    if (!table) continue;
    for (const spot of league.continentalSpots ?? []) {
      const ids = table.filter((r) => spot.positions.includes(r.position)).map((r) => r.clubId);
      entrants.set(spot.competitionId, [...(entrants.get(spot.competitionId) ?? []), ...ids]);
    }
  }
  for (const [id, teams] of entrants) {
    const c = comps.find((x) => x.id === id);
    if (c && teams.length >= 4) c.teamIds = [...new Set(teams)];
  }
}

export function continentalView(state: GameState, competitionId: string) {
  const cs = state.continental[competitionId];
  if (!cs) return null;
  const ix = indexes(state);
  const name = (id: string) => ix.clubs.get(id)?.name ?? id;
  return {
    drawn: cs.drawn,
    drawDate: cs.drawDate,
    groups: cs.groups.map((g) => ({ name: g.name, table: groupTable(state, cs, g).map((r) => ({ ...r, clubName: name(r.clubId) })) })),
    rounds: cs.rounds.map((r) => ({
      key: r.key, label: roundName(r.key), drawn: r.drawn, dates: r.dates,
      ties: r.ties.map((t) => {
        const l1 = t.leg1 ? ix.fixtures.get(t.leg1) : undefined;
        const l2 = t.leg2 ? ix.fixtures.get(t.leg2) : undefined;
        const agg = l1?.result ? [l1.result.homeGoals + (l2?.result?.awayGoals ?? 0), l1.result.awayGoals + (l2?.result?.homeGoals ?? 0)] : null;
        return { a: t.a, b: t.b, aName: name(t.a), bName: name(t.b), agg, winnerId: t.winnerId, pens: l2?.result?.penalties ?? l1?.result?.penalties ?? null };
      }),
    })),
    champion: cs.championId ? name(cs.championId) : null,
  };
}
