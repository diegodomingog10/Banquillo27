/**
 * Data Hub (estadísticas de equipo, liga y jugadores, con valores por 90 minutos y
 * percentiles frente a su posición en la liga), Mundo (rankings, entrenadores,
 * selecciones) y Mi carrera.
 */
import { mainPosition } from '../data/ability';
import { GROUP_OF_POSITION } from '../data/positions';
import type { Player } from '../data/schema';
import { ageAt } from './date';
import { indexes, leagueOf, type GameState } from './game';

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function teamDataView(state: GameState) {
  const ix = indexes(state);
  const me = state.userClubId;
  const league = leagueOf(state, me);
  const played = state.fixtures.filter((f) => f.played && f.result && f.summary && f.season === state.season).sort((a, b) => (a.date < b.date ? -1 : 1));
  const matches = played.filter((f) => f.homeId === me || f.awayId === me).map((f) => {
    const home = f.homeId === me;
    const s = f.summary!;
    const i = home ? 0 : 1, j = home ? 1 : 0;
    return {
      id: f.id, date: f.date, opponent: ix.clubs.get(home ? f.awayId : f.homeId)?.name ?? '', home,
      competition: ix.comps.get(f.competitionId)?.shortName ?? '',
      gf: home ? f.result!.homeGoals : f.result!.awayGoals, ga: home ? f.result!.awayGoals : f.result!.homeGoals,
      xgFor: r2(s.xg[i]), xgAgainst: r2(s.xg[j]), shotsFor: s.shots[i], shotsAgainst: s.shots[j], possession: s.possession[i],
    };
  });
  // Tabla de estadísticas de la liga
  const rows = new Map<string, { clubId: string; name: string; p: number; gf: number; ga: number; xgf: number; xga: number; sf: number; sa: number; pos: number }>();
  if (league) {
    for (const id of league.teamIds) rows.set(id, { clubId: id, name: ix.clubs.get(id)?.name ?? id, p: 0, gf: 0, ga: 0, xgf: 0, xga: 0, sf: 0, sa: 0, pos: 0 });
    for (const f of played.filter((x) => x.competitionId === league.id)) {
      const s = f.summary!;
      for (const [id, i] of [[f.homeId, 0], [f.awayId, 1]] as const) {
        const r = rows.get(id);
        if (!r) continue;
        const j = i === 0 ? 1 : 0;
        r.p++;
        r.gf += i === 0 ? f.result!.homeGoals : f.result!.awayGoals;
        r.ga += i === 0 ? f.result!.awayGoals : f.result!.homeGoals;
        r.xgf += s.xg[i]; r.xga += s.xg[j]; r.sf += s.shots[i]; r.sa += s.shots[j]; r.pos += s.possession[i];
      }
    }
  }
  const leagueRows = [...rows.values()].map((r) => ({
    clubId: r.clubId, name: r.name, played: r.p, gf: r.gf, ga: r.ga,
    xgFor: r2(r.xgf), xgAgainst: r2(r.xga), xgDiff: r2(r.xgf - r.xga), goalsMinusXg: r2(r.gf - r.xgf),
    shotsPer: r.p ? r2(r.sf / r.p) : 0, shotsAgainstPer: r.p ? r2(r.sa / r.p) : 0, possession: r.p ? Math.round(r.pos / r.p) : 0,
  })).sort((a, b) => b.xgDiff - a.xgDiff);
  const avg = (k: 'xgFor' | 'xgAgainst' | 'shotsPer' | 'possession') => {
    const xs = leagueRows.filter((r) => r.played);
    return xs.length ? r2(xs.reduce((a, r) => a + (k === 'xgFor' || k === 'xgAgainst' ? r[k] / r.played : r[k]), 0) / xs.length) : 0;
  };
  const mine = leagueRows.find((r) => r.clubId === me);
  return {
    league: league?.name ?? null,
    matches,
    leagueRows,
    summary: mine && mine.played ? {
      xgForPer: r2(mine.xgFor / mine.played), xgAgainstPer: r2(mine.xgAgainst / mine.played), shotsPer: mine.shotsPer, possession: mine.possession,
      leagueXgPer: avg('xgFor'), leagueShotsPer: avg('shotsPer'), goalsMinusXg: mine.goalsMinusXg,
      rankXg: leagueRows.findIndex((r) => r.clubId === me) + 1,
    } : null,
  };
}

const METRICS = ['goals', 'assists', 'xg', 'shots', 'passes', 'tackles'] as const;
type Metric = (typeof METRICS)[number];
export const METRIC_LABEL: Record<Metric, string> = { goals: 'Goles', assists: 'Asistencias', xg: 'xG', shots: 'Tiros', passes: 'Pases completados', tackles: 'Entradas' };

interface Line { p: Player; minutes: number; apps: number; goals: number; assists: number; xg: number; shots: number; passes: number; tackles: number; rating: number; motm: number; clean: number }

function seasonLines(state: GameState, competitionId: string | null): Line[] {
  const out: Line[] = [];
  for (const p of state.world.players) {
    const ss = p.seasonStats.filter((s) => s.season === state.season && (!competitionId || s.competitionId === competitionId));
    const apps = ss.reduce((a, s) => a + s.apps, 0);
    if (!apps) continue;
    const sum = (k: 'minutes' | 'goals' | 'assists' | 'xg' | 'shots' | 'passesCompleted' | 'tackles' | 'playerOfMatch' | 'cleanSheets') => ss.reduce((a, s) => a + s[k], 0);
    out.push({
      p, apps, minutes: sum('minutes'), goals: sum('goals'), assists: sum('assists'), xg: sum('xg'), shots: sum('shots'),
      passes: sum('passesCompleted'), tackles: sum('tackles'), motm: sum('playerOfMatch'), clean: sum('cleanSheets'),
      rating: ss.reduce((a, s) => a + s.avgRating * s.apps, 0) / apps,
    });
  }
  return out;
}

export function playersDataView(state: GameState) {
  const ix = indexes(state);
  const league = leagueOf(state, state.userClubId);
  const lines = seasonLines(state, league?.id ?? null);
  const maxApps = Math.max(1, ...lines.map((l) => l.apps));
  const regular = lines.filter((l) => l.apps >= Math.max(3, maxApps * 0.4));
  const row = (l: Line, value: number) => ({ id: l.p.id, name: nameOf(l.p), club: l.p.clubId ? ix.clubs.get(l.p.clubId)?.name ?? '' : '', position: mainPosition(l.p.positions), value: r2(value), apps: l.apps, mine: l.p.clubId === state.userClubId });
  const top = (f: (l: Line) => number, pool = lines) => pool.slice().sort((a, b) => f(b) - f(a)).slice(0, 10).map((l) => row(l, f(l)));
  const leaders = {
    goals: top((l) => l.goals), assists: top((l) => l.assists), xg: top((l) => l.xg), rating: top((l) => l.rating, regular),
    motm: top((l) => l.motm), cleanSheets: top((l) => l.clean, lines.filter((l) => mainPosition(l.p.positions) === 'GK')),
  };
  // Por 90 minutos y percentiles frente a su grupo posicional (mín. 450 minutos)
  const per90 = (l: Line, m: Metric) => (l.minutes ? (l[m] / l.minutes) * 90 : 0);
  const pool = lines.filter((l) => l.minutes >= 450);
  const byGroup = new Map<string, Line[]>();
  for (const l of pool) {
    const g = GROUP_OF_POSITION[mainPosition(l.p.positions)];
    byGroup.set(g, [...(byGroup.get(g) ?? []), l]);
  }
  const pct = (l: Line, m: Metric) => {
    const g = byGroup.get(GROUP_OF_POSITION[mainPosition(l.p.positions)]) ?? [];
    if (g.length < 3) return null;
    const v = per90(l, m);
    return Math.round((g.filter((x) => per90(x, m) < v).length / (g.length - 1)) * 100);
  };
  const mine = lines.filter((l) => l.p.clubId === state.userClubId).sort((a, b) => b.minutes - a.minutes).map((l) => ({
    id: l.p.id, name: nameOf(l.p), position: mainPosition(l.p.positions), age: ageAt(l.p.birthDate, state.date), minutes: l.minutes, apps: l.apps, rating: r2(l.rating),
    metrics: METRICS.map((m) => ({ id: m, label: METRIC_LABEL[m], total: r2(l[m]), per90: r2(per90(l, m)), pct: l.minutes >= 450 ? pct(l, m) : null })),
  }));
  return { league: league?.name ?? null, leaders, mine, metrics: METRICS.map((m) => ({ id: m, label: METRIC_LABEL[m] })) };
}

export function worldView(state: GameState) {
  const ix = indexes(state);
  const clubs = state.world.clubs.slice().sort((a, b) => b.reputation - a.reputation).slice(0, 30).map((c, i) => ({
    rank: i + 1, id: c.id, name: c.name, reputation: c.reputation, league: leagueOf(state, c.id)?.name ?? '',
    nation: state.world.nations.find((n) => n.id === c.nationId)?.name ?? '', mine: c.id === state.userClubId,
  }));
  const leagues = state.world.competitions.filter((c) => c.format === 'league').map((c) => {
    const lv = c.teamIds.map((id) => {
      const top = (ix.squads.get(id) ?? []).map((p) => p.ca).sort((a, b) => b - a).slice(0, 11);
      return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
    });
    return { id: c.id, name: c.name, nation: state.world.nations.find((n) => n.id === c.nationId)?.name ?? '', level: c.level, strength: Math.round(lv.reduce((a, b) => a + b, 0) / Math.max(1, lv.length)), teams: c.teamIds.length };
  }).sort((a, b) => b.strength - a.strength);
  const staff = new Map(state.world.staff.map((s) => [s.id, s]));
  const managers = state.managerMoves.slice(0, 20).map((m) => ({
    date: m.date, club: ix.clubs.get(m.clubId)?.name ?? '', out: m.outId ? `${staff.get(m.outId)?.firstName ?? ''} ${staff.get(m.outId)?.lastName ?? ''}`.trim() : '—',
    in: m.inId ? `${staff.get(m.inId)?.firstName ?? ''} ${staff.get(m.inId)?.lastName ?? ''}`.trim() : '—',
  }));
  const nat = (id: string) => state.world.nations.find((n) => n.id === id)?.name ?? id;
  const internationals = state.international.results.slice(0, 20).map((r) => ({ ...r, home: nat(r.home), away: nat(r.away) }));
  const caps = Object.entries(state.international.caps).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, caps]) => {
    const p = ix.players.get(id);
    return p ? { id, name: nameOf(p), nation: nat(p.nationalities[0] ?? ''), caps, goals: state.international.goals[id] ?? 0, club: p.clubId ? ix.clubs.get(p.clubId)?.name ?? '' : 'Libre' } : null;
  }).filter(Boolean);
  const champions = [
    ...state.history.slice().reverse().slice(0, 16).map((h) => ({ season: h.season, competition: ix.comps.get(h.competitionId)?.name ?? h.competitionId, champion: h.championId ? ix.clubs.get(h.championId)?.name ?? '' : '—' })),
  ];
  return { clubs, leagues, managers, internationals, caps, champions };
}

export function careerView(state: GameState) {
  const c = state.career;
  const totals = c.clubs.reduce((a, s) => ({ m: a.m + s.matches, w: a.w + s.wins, d: a.d + s.draws, l: a.l + s.losses }), { m: 0, w: 0, d: 0, l: 0 });
  return {
    manager: `${state.manager.firstName} ${state.manager.lastName}`,
    clubs: c.clubs.map((s) => ({ ...s, winPct: s.matches ? Math.round((s.wins / s.matches) * 100) : 0 })).reverse(),
    trophies: c.trophies.slice().reverse(),
    totals: { ...totals, winPct: totals.m ? Math.round((totals.w / totals.m) * 100) : 0 },
    seasons: new Set(state.history.map((h) => h.season)).size,
  };
}
