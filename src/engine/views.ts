/**
 * Vistas serializables del estado de la partida para la interfaz (se calculan en el
 * Worker y se envían al hilo principal: así no viaja el estado completo).
 */
import { mainPosition } from '../data/ability';
import { matchKits, type MatchKits } from '../data/kits';
import type { MatchEvent, Message, Player } from '../data/schema';
import { ageAt } from './date';
import { t } from '../i18n';
import { hasBlocking, indexes, leagueOf, leagueTable, roundLabel, type Fixture, type GameState } from './game';
import { resolveUserLineup } from './manager';
import { continentalView } from './continental';

export interface FixtureView {
  id: string;
  date: string;
  competitionId: string;
  competitionName: string;
  round: string;
  roundLabel: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  played: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  extra: string | null;
  /** Desde el punto de vista del club consultado. */
  outcome: 'W' | 'D' | 'L' | null;
}

export interface TableRowView {
  position: number;
  clubId: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: string[];
  zone: 'promotion' | 'playoff' | 'relegation' | 'continental' | null;
}

export interface DashboardView {
  date: string;
  season: string;
  club: { id: string; name: string; primary: string; secondary: string; reputation: number };
  manager: string;
  league: { id: string; name: string; position: number | null; rows: TableRowView[] } | null;
  next: FixtureView[];
  board: { confidence: number; fired: boolean };
  /** Equipaciones del próximo partido. */
  nextKits: MatchKits | null;
  last: FixtureView[];
  unread: number;
  blocking: boolean;
  pendingMatch: FixtureView | null;
  injured: { id: string; name: string; days: number }[];
  suspended: { id: string; name: string; games: number }[];
  objectives: string[];
  objectiveStatus: { label: string; state: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; progress: number }[];
  finances: { balance: number; transferBudget: number; wageBudget: number; wageBill: number };
  form: ('W' | 'D' | 'L')[];
  tiles: { id: string; visible: boolean }[];
  news: { date: string; text: string }[];
}

export interface MatchView {
  fixture: FixtureView;
  full: boolean;
  events: (MatchEvent & { playerName: string | null; otherName: string | null })[];
  stats: { home: Record<string, number>; away: Record<string, number> } | null;
  ratings: { playerId: string; name: string; side: 'home' | 'away'; position: string; rating: number; started: boolean }[];
  motm: string | null;
  attendance: number | null;
}

export interface SquadRowView {
  id: string;
  name: string;
  position: string;
  age: number;
  ca: number;
  pa: number;
  condition: number;
  sharpness: number;
  morale: number;
  injury: { type: string; days: number } | null;
  suspended: number;
  yellow: number;
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
  form: number[];
  inLineup: boolean;
}

function names(state: GameState) {
  const ix = indexes(state);
  return {
    club: (id: string) => ix.clubs.get(id)?.name ?? id,
    comp: (id: string) => ix.comps.get(id)?.name ?? id,
    player: (id: string | null) => {
      if (!id) return null;
      const p = ix.players.get(id);
      return p ? p.commonName ?? `${p.firstName} ${p.lastName}` : id;
    },
  };
}

export function fixtureView(state: GameState, f: Fixture, perspective?: string): FixtureView {
  const n = names(state);
  let outcome: FixtureView['outcome'] = null;
  if (f.result && perspective) {
    const mine = perspective === f.homeId ? f.result.homeGoals : f.result.awayGoals;
    const theirs = perspective === f.homeId ? f.result.awayGoals : f.result.homeGoals;
    if (f.result.winnerId && mine === theirs) outcome = f.result.winnerId === perspective ? 'W' : 'L';
    else outcome = mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
  }
  const extra = f.result?.penalties ? `pen. ${f.result.penalties.home}-${f.result.penalties.away}` : f.result?.extraTime ? 'prórroga' : null;
  return {
    id: f.id, date: f.date, competitionId: f.competitionId, competitionName: n.comp(f.competitionId), round: f.round,
    roundLabel: roundLabel(f.round), homeId: f.homeId, homeName: n.club(f.homeId), awayId: f.awayId, awayName: n.club(f.awayId),
    played: f.played, homeGoals: f.result?.homeGoals ?? null, awayGoals: f.result?.awayGoals ?? null, extra, outcome,
  };
}

export function tableView(state: GameState, competitionId: string): TableRowView[] {
  const comp = indexes(state).comps.get(competitionId);
  const n = names(state);
  const rows = leagueTable(state, competitionId);
  const size = rows.length;
  const pr = comp?.promotion;
  const contSpots = new Set((comp?.continentalSpots ?? []).flatMap((s) => s.positions));
  return rows.map((r) => {
    let zone: TableRowView['zone'] = null;
    const direct = pr ? pr.promoted - (pr.playoffPositions.length ? 1 : 0) : 0;
    if (pr?.upCompetitionId && !pr.randomPromotion && r.position <= direct) zone = 'promotion';
    else if (pr?.playoffPositions.includes(r.position)) zone = 'playoff';
    else if (pr?.downCompetitionId && r.position > size - pr.relegated) zone = 'relegation';
    else if (contSpots.has(r.position)) zone = 'continental';
    return {
      position: r.position, clubId: r.clubId, clubName: n.club(r.clubId), played: r.played, won: r.won, drawn: r.drawn,
      lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points, form: r.form, zone,
    };
  });
}

export function dashboardView(state: GameState): DashboardView {
  const ix = indexes(state);
  const club = ix.clubs.get(state.userClubId)!;
  const league = leagueOf(state, club.id);
  const squad = ix.squads.get(club.id) ?? [];
  const mine = state.fixtures.filter((f) => f.homeId === club.id || f.awayId === club.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = league ? tableView(state, league.id) : [];
  const pending = state.pendingUserMatchId ? ix.fixtures.get(state.pendingUserMatchId) : undefined;
  return {
    date: state.date,
    season: state.season,
    club: { id: club.id, name: club.name, primary: club.colors.primary, secondary: club.colors.secondary, reputation: club.reputation },
    manager: `${state.manager.firstName} ${state.manager.lastName}`,
    league: league ? { id: league.id, name: league.name, position: rows.find((r) => r.clubId === club.id)?.position ?? null, rows } : null,
    next: mine.filter((f) => !f.played).slice(0, 5).map((f) => fixtureView(state, f, club.id)),
    board: { confidence: Math.round(state.board.confidence), fired: state.board.fired },
    nextKits: (() => { const f = mine.find((x) => !x.played); const h = f && ix.clubs.get(f.homeId); const a = f && ix.clubs.get(f.awayId); return h && a ? matchKits(h, a) : null; })(),
    last: mine.filter((f) => f.played).slice(-5).reverse().map((f) => fixtureView(state, f, club.id)),
    unread: state.inbox.filter((m) => !m.read).length,
    blocking: hasBlocking(state),
    pendingMatch: pending && !pending.played ? fixtureView(state, pending, club.id) : null,
    injured: squad.filter((p) => p.injury).map((p) => ({ id: p.id, name: names(state).player(p.id) ?? '', days: p.injury!.daysRemaining })),
    suspended: squad.filter((p) => p.cards.suspendedMatches > 0).map((p) => ({ id: p.id, name: names(state).player(p.id) ?? '', games: p.cards.suspendedMatches })),
    objectives: club.boardObjectives.map((o) => `${o.type}${o.target !== null ? `:${o.target}` : ''}`),
    objectiveStatus: objectiveStatus(state, rows.find((r) => r.clubId === club.id)?.position ?? null, rows.length, squad),
    finances: {
      balance: club.finances.balance, transferBudget: club.finances.transferBudget, wageBudget: club.finances.wageBudget,
      wageBill: squad.reduce((a, p) => a + (p.contract?.wage ?? 0), 0),
    },
    form: mine.filter((f) => f.played).slice(-5).map((f) => fixtureView(state, f, club.id).outcome).filter((o): o is 'W' | 'D' | 'L' => !!o),
    tiles: state.ui?.dashboard ?? [],
    news: state.news.slice(0, 12),
  };
}

function objectiveStatus(state: GameState, position: number | null, size: number, squad: readonly Player[]): DashboardView['objectiveStatus'] {
  const club = indexes(state).clubs.get(state.userClubId)!;
  const played = state.fixtures.some((f) => f.played && f.stage === 'league' && (f.homeId === club.id || f.awayId === club.id));
  return club.boardObjectives.map((o) => {
    const label = t(`objective.${o.type}`, { target: o.target ?? '' });
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    if (!played && o.type !== 'cupRound' && o.type !== 'balanceBudget') return { label: cap(label), state: 'Sin empezar', tone: 'neutral', progress: 0 };
    const pos = position ?? size;
    switch (o.type) {
      case 'winLeague':
      case 'leaguePosition':
      case 'avoidRelegation':
      case 'promotion': {
        const target = o.type === 'winLeague' ? 1 : o.type === 'promotion' ? 2 : o.target ?? size;
        const tone = pos <= target ? 'good' : pos <= target + 2 ? 'warn' : 'bad';
        return { label: cap(label), state: `${pos}.º (objetivo ${target}.º)`, tone, progress: Math.round(Math.max(5, Math.min(100, ((size - pos + 1) / (size - target + 1)) * 100))) };
      }
      case 'cupRound': {
        const cup = o.competitionId ? state.cups[o.competitionId] : undefined;
        const alive = cup ? cup.alive.includes(club.id) : true;
        const done = cup?.rounds.filter((r) => r.drawn && r.ties.length).length ?? 0;
        return { label: cap(label), state: alive ? 'Sigue en competición' : 'Eliminado', tone: alive ? 'good' : 'bad', progress: alive ? Math.min(100, 20 + done * 15) : 100 };
      }
      case 'balanceBudget': {
        const bill = squad.reduce((a, p) => a + (p.contract?.wage ?? 0), 0);
        const ratio = club.finances.wageBudget ? bill / club.finances.wageBudget : 1;
        return { label: cap(label), state: ratio <= 0.95 ? 'En orden' : ratio <= 1 ? 'Ajustado' : 'Por encima del presupuesto', tone: ratio <= 0.95 ? 'good' : ratio <= 1 ? 'warn' : 'bad', progress: Math.round(Math.min(100, ratio * 100)) };
      }
      default:
        return { label: cap(label), state: '—', tone: 'neutral', progress: 50 };
    }
  });
}

export function inboxView(state: GameState): Message[] {
  return state.inbox;
}

export function competitionsList(state: GameState): { id: string; name: string; format: string; nationId: string | null; level: number; mine: boolean }[] {
  return state.world.competitions
    .filter((c) => c.format === 'league' || state.cups[c.id] || state.continental[c.id])
    .map((c) => ({ id: c.id, name: c.name, format: c.format, nationId: c.nationId, level: c.level, mine: c.teamIds.includes(state.userClubId) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.format === 'league') - Number(a.format === 'league') || (a.nationId ?? '').localeCompare(b.nationId ?? '') || a.level - b.level);
}

export function competitionView(state: GameState, competitionId: string) {
  const comp = indexes(state).comps.get(competitionId);
  if (!comp) return null;
  const fixtures = state.fixtures.filter((f) => f.competitionId === competitionId);
  const rounds = new Map<string, FixtureView[]>();
  for (const f of fixtures.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const list = rounds.get(f.round) ?? [];
    list.push(fixtureView(state, f, state.userClubId));
    rounds.set(f.round, list);
  }
  return {
    id: comp.id,
    name: comp.name,
    format: comp.format,
    table: comp.format === 'league' ? tableView(state, comp.id) : [],
    rounds: [...rounds.entries()].map(([key, list]) => ({ key, label: roundLabel(key), fixtures: list })),
    champion: state.cups[comp.id]?.championId ? names(state).club(state.cups[comp.id]!.championId!) : state.continental[comp.id]?.championId ? names(state).club(state.continental[comp.id]!.championId!) : null,
    continental: continentalView(state, comp.id),
  };
}

export function matchView(state: GameState, fixtureId: string): MatchView | null {
  const ix = indexes(state);
  const f = ix.fixtures.get(fixtureId);
  if (!f) return null;
  const n = names(state);
  const full = state.userMatches[fixtureId];
  const events = (full?.events ?? f.summary?.events ?? []).map((e) => ({ ...e, playerName: n.player(e.playerId), otherName: n.player(e.otherPlayerId) }));
  let ratings: MatchView['ratings'] = [];
  if (full?.lineups) {
    const pos = new Map<string, string>();
    for (const side of ['home', 'away'] as const) for (const l of full.lineups[side].starting) pos.set(l.playerId, l.position);
    const homeIds = new Set([...full.lineups.home.starting.map((l) => l.playerId), ...full.lineups.home.bench]);
    ratings = full.ratings.map((r) => {
      const p = ix.players.get(r.playerId);
      return {
        playerId: r.playerId, name: n.player(r.playerId) ?? '', side: homeIds.has(r.playerId) ? 'home' : 'away',
        position: pos.get(r.playerId) ?? (p ? mainPosition(p.positions) : ''), rating: r.rating, started: pos.has(r.playerId),
      };
    });
  }
  const stats = full?.stats
    ? { home: full.stats.home as unknown as Record<string, number>, away: full.stats.away as unknown as Record<string, number> }
    : f.summary
      ? { home: { shots: f.summary.shots[0], xg: f.summary.xg[0], possession: f.summary.possession[0] }, away: { shots: f.summary.shots[1], xg: f.summary.xg[1], possession: f.summary.possession[1] } }
      : null;
  return {
    fixture: fixtureView(state, f, state.userClubId),
    full: !!full,
    events,
    stats,
    ratings,
    motm: n.player(full?.playerOfMatchId ?? f.summary?.motmId ?? null),
    attendance: full?.attendance ?? f.summary?.attendance ?? null,
  };
}

export function squadView(state: GameState, clubId = state.userClubId): SquadRowView[] {
  const ix = indexes(state);
  const squad = ix.squads.get(clubId) ?? [];
  const lineup = new Set(clubId === state.userClubId ? resolveUserLineup(state).starting : []);
  const sum = (p: Player, k: 'apps' | 'goals' | 'assists') => p.seasonStats.filter((s) => s.season === state.season).reduce((a, s) => a + s[k], 0);
  return squad
    .map((p) => {
      const ss = p.seasonStats.filter((s) => s.season === state.season);
      const apps = ss.reduce((a, s) => a + s.apps, 0);
      const avg = apps ? ss.reduce((a, s) => a + s.avgRating * s.apps, 0) / apps : 0;
      return {
        id: p.id, name: p.commonName ?? `${p.firstName} ${p.lastName}`, position: mainPosition(p.positions), age: ageAt(p.birthDate, state.date),
        ca: p.ca, pa: p.pa, condition: Math.round(p.condition), sharpness: Math.round(p.matchSharpness), morale: Math.round(p.morale),
        injury: p.injury ? { type: p.injury.type, days: p.injury.daysRemaining } : null, suspended: p.cards.suspendedMatches,
        yellow: p.cards.yellow, apps, goals: sum(p, 'goals'), assists: sum(p, 'assists'), avgRating: Math.round(avg * 100) / 100,
        form: p.form, inLineup: lineup.has(p.id),
      };
    })
    .sort((a, b) => Number(b.inLineup) - Number(a.inLineup) || b.ca - a.ca);
}

export function preMatchView(state: GameState, fixtureId: string) {
  const ix = indexes(state);
  const f = ix.fixtures.get(fixtureId);
  if (!f) return null;
  const oppId = f.homeId === state.userClubId ? f.awayId : f.homeId;
  const opp = ix.clubs.get(oppId)!;
  const oppSquad = (ix.squads.get(oppId) ?? []).slice().sort((a, b) => b.ca - a.ca);
  const recent = (clubId: string) => state.fixtures.filter((x) => x.played && (x.homeId === clubId || x.awayId === clubId)).sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 5).map((x) => fixtureView(state, x, clubId).outcome);
  const league = leagueOf(state, state.userClubId);
  const table = league ? leagueTable(state, league.id) : [];
  return {
    fixture: fixtureView(state, f, state.userClubId),
    opponent: { id: opp.id, name: opp.name, reputation: opp.reputation, stadium: opp.stadium.name },
    kits: matchKits(ix.clubs.get(f.homeId)!, ix.clubs.get(f.awayId)!),
    userForm: recent(state.userClubId),
    opponentForm: recent(oppId),
    userPosition: table.find((r) => r.clubId === state.userClubId)?.position ?? null,
    opponentPosition: table.find((r) => r.clubId === oppId)?.position ?? null,
    opponentKeyPlayers: oppSquad.slice(0, 3).map((p) => ({ id: p.id, name: p.commonName ?? `${p.firstName} ${p.lastName}`, position: mainPosition(p.positions), ca: p.ca })),
    formation: state.userTactic.formation,
    familiarity: Math.round(state.tacticFamiliarity),
    lineup: squadView(state).filter((r) => r.inLineup),
    replaced: resolveUserLineup(state).replaced.map((id) => names(state).player(id) ?? id),
  };
}
