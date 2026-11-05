/**
 * Ciclo de vida de la temporada: premios de cada liga, retiradas y nueva generación de
 * canteranos (con calidad según instalaciones, captación y formación de la cantera).
 */
import { mainPosition, roundMoney } from '../data/ability';
import { generatePlayer } from '../data/generator/generatePlayer';
import { NAME_STYLES } from '../data/generator/nameStyles';
import { NATION_SEEDS } from '../data/generator/nations';
import { GROUP_OF_POSITION, type Position } from '../data/positions';
import type { Player } from '../data/schema';
import { ageAt } from './date';
import { addMessage, indexes, invalidate, type GameState } from './game';
import { clamp, createRng, hashString } from './rng';

export interface SeasonAwards {
  season: string;
  competitionId: string;
  playerOfSeason: string | null;
  topScorer: { playerId: string; goals: number } | null;
  young: string | null;
  goalkeeper: string | null;
  team: string[];
}

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

/** Premios de cada liga (se llaman con las estadísticas de la temporada aún abiertas). */
export function seasonAwards(state: GameState): SeasonAwards[] {
  const ix = indexes(state);
  const out: SeasonAwards[] = [];
  for (const comp of state.world.competitions) {
    if (comp.format !== 'league') continue;
    const rows: { p: Player; apps: number; goals: number; rating: number; clean: number }[] = [];
    for (const p of state.world.players) {
      const ss = p.seasonStats.filter((s) => s.season === state.season && s.competitionId === comp.id);
      const apps = ss.reduce((a, s) => a + s.apps, 0);
      if (!apps) continue;
      rows.push({ p, apps, goals: ss.reduce((a, s) => a + s.goals, 0), rating: ss.reduce((a, s) => a + s.avgRating * s.apps, 0) / apps, clean: ss.reduce((a, s) => a + s.cleanSheets, 0) });
    }
    if (!rows.length) continue;
    const maxApps = Math.max(...rows.map((r) => r.apps));
    const regular = rows.filter((r) => r.apps >= Math.max(8, maxApps * 0.5));
    const byRating = regular.slice().sort((a, b) => b.rating - a.rating);
    const top = rows.slice().sort((a, b) => b.goals - a.goals || b.rating - a.rating)[0];
    const young = byRating.find((r) => ageAt(r.p.birthDate, state.date) <= 21);
    const gk = regular.filter((r) => mainPosition(r.p.positions) === 'GK').sort((a, b) => b.clean - a.clean || b.rating - a.rating)[0];
    // Once ideal 4-4-2
    const need: [string[], number][] = [[['GK'], 1], [['CB'], 2], [['FB'], 2], [['DM', 'CM', 'WIDE', 'AM'], 4], [['ST'], 2]];
    const team: string[] = [];
    for (const [groups, n] of need) {
      for (const r of byRating) {
        if (team.length && team.includes(r.p.id)) continue;
        if (!groups.includes(GROUP_OF_POSITION[mainPosition(r.p.positions)])) continue;
        team.push(r.p.id);
        if (team.filter((id) => groups.includes(GROUP_OF_POSITION[mainPosition(ix.players.get(id)!.positions)])).length >= n) break;
      }
    }
    const a: SeasonAwards = {
      season: state.season, competitionId: comp.id,
      playerOfSeason: byRating[0]?.p.id ?? null,
      topScorer: top && top.goals > 0 ? { playerId: top.p.id, goals: top.goals } : null,
      young: young?.p.id ?? null,
      goalkeeper: gk?.p.id ?? null,
      team,
    };
    out.push(a);
    // Moral y noticias
    for (const id of [a.playerOfSeason, a.topScorer?.playerId, a.young, a.goalkeeper]) {
      const p = id ? ix.players.get(id) : undefined;
      if (p) p.morale = clamp(p.morale + 10, 5, 100);
    }
    const pos = a.playerOfSeason ? ix.players.get(a.playerOfSeason) : undefined;
    if (pos) state.news.unshift({ date: state.date, type: 'award', text: `${nameOf(pos)}, mejor jugador de la ${comp.name}` });
    const userLeague = comp.teamIds.includes(state.userClubId);
    if (userLeague) {
      const label = (id: string | null) => { const p = id ? ix.players.get(id) : undefined; return p ? `${nameOf(p)} (${ix.clubs.get(p.clubId ?? '')?.name ?? 'libre'})` : '—'; };
      addMessage(state, {
        type: 'competition', priority: 'normal', key: 'awards', sender: comp.name,
        params: {
          league: comp.name, best: label(a.playerOfSeason), scorer: a.topScorer ? `${label(a.topScorer.playerId)}, ${a.topScorer.goals} goles` : '—',
          young: label(a.young), gk: label(a.goalkeeper),
          mine: team.filter((id) => ix.players.get(id)?.clubId === state.userClubId).map((id) => nameOf(ix.players.get(id)!)).join(', ') || 'ninguno',
        },
      });
    }
  }
  (state.awards ??= []).push(...out);
  if (state.awards.length > 120) state.awards.splice(0, state.awards.length - 120);
  return out;
}

/** Retiradas al final de la temporada. Devuelve los ids retirados. */
export function retirements(state: GameState, refDate: string): string[] {
  const ix = indexes(state);
  const gone: Player[] = [];
  for (const p of state.world.players) {
    const age = ageAt(p.birthDate, refDate);
    // Sin equipo: los veteranos se retiran y muchos jóvenes descartados dejan el fútbol profesional
    if (!p.clubId && age < 33) {
      const quit = age >= 27 ? 0.65 : age <= 21 ? 0.7 : 0.5;
      if (hashString(`quit:${p.id}:${refDate}`) % 1000 < quit * 1000) gone.push(p);
      continue;
    }
    if (age < 33) continue;
    let chance = age >= 40 ? 1 : 0.07 * Math.pow(age - 32, 1.35);
    if (p.ca < 70) chance += 0.12;
    if (!p.clubId) chance += 0.5;
    chance *= 1.15 - p.attributes.professionalism / 40;
    if (hashString(`retire:${p.id}:${refDate}`) % 1000 < chance * 1000) gone.push(p);
  }
  if (!gone.length) return [];
  const ids = new Set(gone.map((p) => p.id));
  const mine = gone.filter((p) => p.clubId === state.userClubId);
  if (mine.length) addMessage(state, { type: 'player', priority: 'normal', key: 'retirements', params: { names: mine.map(nameOf).join(', ') } });
  for (const p of gone.filter((x) => x.ca >= 130).slice(0, 5)) state.news.unshift({ date: state.date, type: 'retirement', text: `${nameOf(p)} anuncia su retirada (${ageAt(p.birthDate, refDate)} años)` });
  removePlayers(state, ids);
  void ix;
  return [...ids];
}

/** Quita jugadores del mundo y de todas las referencias de la partida. */
export function removePlayers(state: GameState, ids: Set<string>): void {
  state.world.players = state.world.players.filter((p) => !ids.has(p.id));
  for (const id of ids) {
    delete state.scouting.knowledge[id];
    delete state.transfers.roles[id];
    delete state.transfers.listed[id];
    delete state.transfers.sellOn[id];
    delete state.training.individual[id];
    delete state.progression.acc[id];
    delete state.progression.minutes[id];
    delete state.progression.changes[id];
    delete state.dressing.happiness[id];
  }
  state.ui.shortlist = state.ui.shortlist.filter((id) => !ids.has(id));
  state.scouting.requests = state.scouting.requests.filter((r) => !ids.has(r.playerId));
  state.transfers.loans = state.transfers.loans.filter((l) => !ids.has(l.playerId));
  state.transfers.bonuses = state.transfers.bonuses.filter((b) => !ids.has(b.playerId));
  for (const d of state.transfers.deals) if (ids.has(d.playerId) && !['completed', 'rejected', 'collapsed', 'withdrawn'].includes(d.status)) d.status = 'withdrawn';
  state.dressing.promises = state.dressing.promises.filter((p) => !ids.has(p.playerId));
  if (state.userLineup && [...state.userLineup.starting, ...state.userLineup.bench].some((id) => ids.has(id))) state.userLineup = null;
  invalidate(state);
}

const POSITIONS_POOL: Position[] = ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'AM', 'LW', 'RW', 'LM', 'RM', 'ST', 'ST'];

/** Nueva generación de canteranos en cada club. */
export function youthIntake(state: GameState, refDate: string): void {
  const ix = indexes(state);
  const year = Number(refDate.slice(0, 4));
  const intake: Player[] = [];
  for (const club of state.world.clubs) {
    const rng = createRng(hashString(`youth:${state.seed}:${club.id}:${year}`));
    const f = club.facilities;
    const n = clamp(1 + Math.round(f.youthRecruitment / 8) + rng.int(0, 2), 2, 5);
    const nation = state.world.nations.find((x) => x.id === club.nationId);
    const seed = NATION_SEEDS.find((x) => x.id === club.nationId);
    const style = NAME_STYLES[seed?.style ?? 'anglo'] ?? Object.values(NAME_STYLES)[0]!;
    for (let i = 0; i < n; i++) {
      const age = rng.int(15, 17);
      const position = rng.pick(POSITIONS_POOL);
      const ca = clamp(Math.round(30 + f.juniorCoaching * 1.6 + f.youth * 0.9 + club.reputation / 10000 * 22 + rng.normal(0, 8)), 25, 120);
      const gem = rng.chance(0.03 + f.youthRecruitment / 600);
      const pa = clamp(Math.round(ca + rng.float(22, 62) * (0.75 + f.youth / 45) + (gem ? rng.int(25, 45) : 0)), ca + 5, 200);
      const id = `y${year}_${club.id}_${i}`;
      const p = generatePlayer(rng.fork(id), {
        id, position, targetCA: ca, targetPA: pa, age, refDate, nationId: rng.chance(0.88) ? club.nationId : (rng.pick(state.world.nations).id ?? club.nationId),
        style, clubId: club.id, clubName: club.name, clubReputation: club.reputation, mandatoryReleaseClause: !!nation?.mandatoryReleaseClause, youth: true,
      });
      if (p.contract) { p.contract.wage = roundMoney(Math.max(150, p.contract.wage * 0.5)); p.contract.expires = `${year + 3}-06-30`; p.contract.type = 'youth'; }
      p.history = [{ clubId: club.id, clubName: club.name, from: refDate, to: null, fee: 0, loan: false }];
      intake.push(p);
    }
  }
  state.world.players.push(...intake);
  invalidate(state);
  const mine = intake.filter((p) => p.clubId === state.userClubId).sort((a, b) => b.pa - a.pa);
  if (mine.length) {
    state.youthIntake = { date: refDate, ids: mine.map((p) => p.id) };
    addMessage(state, {
      type: 'youth', priority: 'high', key: 'youthIntake', sender: 'Cantera',
      params: { count: mine.length, names: mine.map((p) => `${nameOf(p)} (${mainPosition(p.positions)}, ${ageAt(p.birthDate, refDate)})`).join(', ') },
    });
  }
  void ix;
}

/** La IA se deshace de lo que le sobra (plantillas de más de 27). */
export function trimAiSquads(state: GameState): void {
  const ix = indexes(state);
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId) continue;
    const squad = (ix.squads.get(club.id) ?? []).slice();
    if (squad.length <= 27) continue;
    // Primero los juveniles con menos futuro y los veteranos con menos nivel
    const score = (p: Player) => (ageAt(p.birthDate, state.date) <= 19 ? p.pa : p.ca) - Math.max(0, ageAt(p.birthDate, state.date) - 30) * 6;
    const out = squad.sort((a, b) => score(a) - score(b)).slice(0, squad.length - 27);
    for (const p of out) {
      const last = p.history[p.history.length - 1];
      if (last && last.to === null) last.to = state.date;
      p.clubId = null;
      p.contract = null;
    }
  }
  invalidate(state);
}
