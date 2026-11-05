/**
 * Generador de mundo ficticio completo y determinista (misma semilla => mismo mundo).
 *
 * Por defecto: 8 naciones × 2 divisiones × 20 clubes × 25 jugadores (+ agentes libres),
 * staff completo por club, copa nacional por país y dos torneos continentales.
 */
import { clamp, createRng, type Rng } from '../../engine/rng';
import { isoFromParts } from '../../engine/date';
import { roundMoney } from '../ability';
import type { Position } from '../positions';
import {
  SCHEMA_VERSION,
  STAFF_ATTRS,
  type BoardObjective,
  type Club,
  type Competition,
  type Nation,
  type Player,
  type Staff,
  type StaffAttributes,
  type StaffRole,
  type WorldDatabase,
} from '../schema';
import { CONTINENT, NATION_SEEDS, type NationSeed } from './nations';
import { NAME_STYLES, cityName, fill, firstName, lastName, type NameStyle } from './nameStyles';
import { generatePlayer } from './generatePlayer';

export interface WorldGenOptions {
  seed: number;
  /** Número de naciones (1-8). */
  nations?: number;
  divisions?: 1 | 2;
  clubsPerLeague?: number;
  squadSize?: number;
  freeAgents?: number;
  startYear?: number;
}

export type Tier = 'starter' | 'rotation' | 'backup' | 'youth';
export const TIER_OFFSET: Record<Tier, number> = { starter: 0, rotation: -9, backup: -17, youth: -38 };

/** Plantilla de 25: posición y nivel dentro del club. */
export const SQUAD_TEMPLATE: readonly [Position, Tier][] = [
  ['GK', 'starter'], ['GK', 'backup'], ['GK', 'youth'],
  ['CB', 'starter'], ['CB', 'starter'], ['CB', 'rotation'], ['CB', 'backup'],
  ['LB', 'starter'], ['LB', 'backup'],
  ['RB', 'starter'], ['RB', 'rotation'],
  ['DM', 'starter'], ['DM', 'rotation'],
  ['CM', 'starter'], ['CM', 'starter'], ['CM', 'rotation'], ['CM', 'youth'],
  ['LW', 'starter'], ['RW', 'starter'], ['LM', 'rotation'], ['RM', 'backup'],
  ['AM', 'rotation'],
  ['ST', 'starter'], ['ST', 'rotation'], ['ST', 'youth'],
];

const COLORS = [
  '#c8102e', '#1d428a', '#ffffff', '#000000', '#f2c200', '#006a4e', '#6cace4', '#7a263a',
  '#ff6a13', '#4b2e83', '#00843d', '#a7a8aa', '#003087', '#e4002b', '#8a1538', '#ffd100',
];
const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '5-3-2', '3-4-3', '4-1-4-1', '4-4-1-1'];
const PHILOSOPHIES: Club['philosophy'] = [
  'attackingFootball', 'possession', 'counterAttack', 'highPress', 'youthDevelopment',
  'signYoungPlayers', 'signDomesticPlayers', 'physicalFootball', 'financialPrudence',
];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Nivel de CA medio de los titulares de un club según su reputación. */
export function clubLevel(reputation: number): number {
  return 60 + (reputation / 10000) * 105;
}

/** Ingresos anuales estimados según reputación. */
export function annualRevenue(reputation: number): number {
  return 2_000_000 * Math.exp(reputation / 1600);
}

export function ageForTier(rng: Rng, tier: Tier): number {
  if (tier === 'youth') return rng.int(17, 19);
  if (tier === 'backup') return clamp(Math.round(rng.normal(27, 5)), 19, 36);
  return clamp(Math.round(rng.normal(26, 3.8)), 19, 35);
}

function staffAttrs(rng: Rng, level: number, focus: readonly (keyof StaffAttributes)[]): StaffAttributes {
  const out = {} as StaffAttributes;
  for (const k of STAFF_ATTRS) {
    const boost = focus.includes(k) ? 3.5 : 0;
    out[k] = clamp(Math.round(rng.normal(level + boost, 2.5)), 1, 20);
  }
  return out;
}

const STAFF_PLAN: readonly [StaffRole, number, readonly (keyof StaffAttributes)[]][] = [
  ['manager', 1, ['tactical', 'tacticalKnowledge', 'manManagement', 'motivating', 'determination']],
  ['assistantManager', 1, ['tacticalKnowledge', 'manManagement', 'judgingAbility']],
  ['coach', 3, ['attacking', 'defending', 'tactical', 'technical', 'mentalCoaching', 'fitness']],
  ['goalkeepingCoach', 1, ['goalkeeping']],
  ['fitnessCoach', 1, ['fitness', 'sportsScience']],
  ['youthCoach', 1, ['workingWithYouth', 'technical', 'mentalCoaching']],
  ['chiefScout', 1, ['judgingAbility', 'judgingPotential']],
  ['scout', 2, ['judgingAbility', 'judgingPotential']],
  ['physio', 2, ['physiotherapy', 'sportsScience']],
  ['doctor', 1, ['physiotherapy', 'sportsScience']],
  ['analyst', 1, ['analysing', 'tacticalKnowledge']],
];

interface Ctx {
  rng: Rng;
  refDate: string;
  refYear: number;
  players: Player[];
  staff: Staff[];
  playerSeq: number;
  staffSeq: number;
  nations: Nation[];
}

function boardObjectives(level: number, rank: number, size: number, leagueId: string, cupId: string): BoardObjective[] {
  const out: BoardObjective[] = [];
  if (level === 1) {
    if (rank <= 1) out.push({ type: 'winLeague', competitionId: leagueId, target: 1, importance: 'critical' });
    else if (rank <= 5) out.push({ type: 'leaguePosition', competitionId: leagueId, target: 4, importance: 'high' });
    else if (rank <= Math.floor(size * 0.6)) out.push({ type: 'leaguePosition', competitionId: leagueId, target: 10, importance: 'medium' });
    else out.push({ type: 'avoidRelegation', competitionId: leagueId, target: size - 3, importance: 'high' });
    out.push({ type: 'cupRound', competitionId: cupId, target: rank <= 3 ? 5 : 3, importance: 'low' });
  } else {
    if (rank <= 3) out.push({ type: 'promotion', competitionId: leagueId, target: 2, importance: 'high' });
    else if (rank <= 9) out.push({ type: 'leaguePosition', competitionId: leagueId, target: 6, importance: 'medium' });
    else out.push({ type: 'leaguePosition', competitionId: leagueId, target: 15, importance: 'medium' });
    out.push({ type: 'cupRound', competitionId: cupId, target: 2, importance: 'low' });
  }
  out.push({ type: 'balanceBudget', competitionId: null, target: null, importance: 'medium' });
  return out;
}

function makeClub(
  ctx: Ctx,
  seed: NationSeed,
  style: NameStyle,
  id: string,
  reputation: number,
  usedNames: Set<string>,
): Club {
  const { rng } = ctx;
  let city = cityName(rng, style);
  let name = fill(rng.pick(style.clubPatterns), { c: city });
  let guard = 0;
  while (usedNames.has(name) && guard++ < 50) {
    city = cityName(rng, style);
    name = fill(rng.pick(style.clubPatterns), { c: city });
  }
  usedNames.add(name);
  const revenue = annualRevenue(reputation);
  const capacity = clamp(Math.round((4000 + reputation * 6.5 * rng.float(0.75, 1.25)) / 100) * 100, 1500, 99000);
  const ticketPrice = Math.round(10 + reputation / 250);
  const primary = rng.pick(COLORS);
  let secondary = rng.pick(COLORS);
  if (secondary === primary) secondary = primary === '#ffffff' ? '#000000' : '#ffffff';
  const philosophy = rng.shuffle(PHILOSOPHIES).slice(0, rng.int(1, 3));
  const fac = (base: number) => clamp(Math.round(rng.normal(base, 2)), 1, 20);
  const facBase = 3 + (reputation / 10000) * 16;

  return {
    id,
    name,
    shortName: city.slice(0, 20),
    nationId: seed.id,
    city,
    reputation,
    colors: { primary, secondary },
    founded: rng.int(1870, 1990),
    stadium: {
      name: fill(rng.pick(style.stadiumPatterns), { c: city, s: lastName(rng, style) }),
      capacity,
      pitchCondition: rng.int(65, 98),
      length: rng.int(100, 110),
      width: rng.int(64, 72),
    },
    facilities: { training: fac(facBase), youth: fac(facBase), youthRecruitment: fac(facBase - 1), juniorCoaching: fac(facBase - 1) },
    finances: {
      balance: roundMoney(revenue * rng.float(-0.05, 0.4)),
      transferBudget: roundMoney(revenue * rng.float(0.05, 0.22)),
      wageBudget: 0, // se calcula tras generar la plantilla
      debt: rng.chance(0.3) ? roundMoney(revenue * rng.float(0.1, 0.8)) : 0,
      seasonIncome: {
        tickets: roundMoney(revenue * 0.2),
        tv: roundMoney(revenue * 0.45),
        sponsorship: roundMoney(revenue * 0.25),
        merchandising: roundMoney(revenue * 0.1),
        prizes: 0,
        transfers: 0,
      },
      ticketPrice,
      seasonTicketHolders: Math.round(capacity * rng.float(0.25, 0.6)),
    },
    staffIds: [],
    boardObjectives: [],
    philosophy,
    rivals: [],
    affiliateIds: [],
    estimated: [],
    source: 'generated',
    externalId: null,
  };
}

function populateSquad(ctx: Ctx, club: Club, seed: NationSeed, style: NameStyle, squadSize: number): void {
  const { rng } = ctx;
  const level = clubLevel(club.reputation);
  const template = SQUAD_TEMPLATE.slice(0, squadSize);
  while (template.length < squadSize) template.push([rng.pick(['CB', 'CM', 'ST', 'LB', 'RW'] as const), 'backup']);
  let wageTotal = 0;
  for (const [position, tier] of template) {
    const age = ageForTier(rng, tier);
    let target = level + TIER_OFFSET[tier] + rng.normal(0, 7);
    if (tier !== 'youth' && rng.chance(0.07)) target += 12; // figura
    target = clamp(target, 25, 195);
    const foreign = rng.chance(0.15 + club.reputation / 40000);
    const nat = foreign ? rng.pick(ctx.nations).id : seed.id;
    const nationStyle = foreign
      ? NAME_STYLES[NATION_SEEDS.find((n) => n.id === nat)?.style ?? style.id] ?? style
      : style;
    const second = !foreign && rng.chance(0.05) ? rng.pick(ctx.nations).id : foreign && rng.chance(0.3) ? seed.id : null;
    const id = `p_${pad(++ctx.playerSeq, 6)}`;
    const p = generatePlayer(rng.fork(id), {
      id,
      position,
      targetCA: target,
      age,
      refDate: ctx.refDate,
      nationId: nat,
      secondNationId: second,
      style: nationStyle,
      clubId: club.id,
      clubName: club.name,
      clubReputation: club.reputation,
      mandatoryReleaseClause: seed.mandatoryReleaseClause,
      youth: tier === 'youth',
    });
    wageTotal += p.contract?.wage ?? 0;
    ctx.players.push(p);
  }
  club.finances.wageBudget = roundMoney(wageTotal * rng.float(1.05, 1.25));
}

/**
 * Genera el cuerpo técnico completo de un club. Exportado para que el importador
 * pueda completar clubes reales que llegan sin staff.
 */
export function generateClubStaff(
  rng: Rng,
  club: Club,
  nations: readonly Nation[],
  style: NameStyle,
  refYear: number,
  nextId: () => string,
): Staff[] {
  const out: Staff[] = [];
  const level = 4 + (club.reputation / 10000) * 11;
  for (const [role, count, focus] of STAFF_PLAN) {
    for (let k = 0; k < count; k++) {
      const id = nextId();
      const r = rng.fork(id);
      const age = r.int(30, 66);
      const scouting = role === 'scout' || role === 'chiefScout';
      const others = nations.filter((n) => n.id !== club.nationId);
      const regional = scouting ? [club.nationId, ...r.shuffle(others).slice(0, r.int(1, 3)).map((n) => n.id)] : [club.nationId];
      const wage = roundMoney((role === 'manager' ? 3 : 1) * 400 * Math.exp(club.reputation / 2500) * r.float(0.8, 1.2));
      out.push({
        id,
        firstName: firstName(r, style),
        lastName: lastName(r, style),
        birthDate: isoFromParts(refYear - age, r.int(1, 12), r.int(1, 28)),
        nationality: club.nationId,
        clubId: club.id,
        role,
        attributes: staffAttrs(r, level, focus),
        regionalKnowledge: regional,
        preferredFormation: role === 'manager' || role === 'assistantManager' ? r.pick(FORMATIONS) : null,
        reputation: clamp(Math.round(club.reputation * r.float(0.6, 1.1)), 0, 10000),
        contract: {
          wage,
          expires: isoFromParts(refYear + r.int(1, 3), 6, 30),
          releaseClause: null,
          bonuses: { appearance: 0, goal: 0, cleanSheet: 0, signing: 0, loyalty: 0 },
          type: 'full',
          loanFromClubId: null,
        },
        estimated: [],
        source: 'generated',
      });
    }
  }
  return out;
}

function populateStaff(ctx: Ctx, club: Club, style: NameStyle): void {
  const staff = generateClubStaff(ctx.rng, club, ctx.nations, style, ctx.refYear, () => `s_${pad(++ctx.staffSeq, 5)}`);
  ctx.staff.push(...staff);
  club.staffIds.push(...staff.map((s) => s.id));
}

export function generateWorld(opts: WorldGenOptions): WorldDatabase {
  const nationsCount = clamp(opts.nations ?? 8, 1, NATION_SEEDS.length);
  const divisions = opts.divisions ?? 2;
  const clubsPerLeague = opts.clubsPerLeague ?? 20;
  const squadSize = opts.squadSize ?? 25;
  const startYear = opts.startYear ?? 2026;
  const rng = createRng(opts.seed);
  const refDate = isoFromParts(startYear, 7, 1);
  const season = `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;

  const seeds = NATION_SEEDS.slice(0, nationsCount);
  const nations: Nation[] = seeds.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    continent: CONTINENT,
    reputation: s.reputation,
    leagueStrength: s.leagueStrength,
    mandatoryReleaseClause: s.mandatoryReleaseClause,
  }));

  const ctx: Ctx = { rng, refDate, refYear: startYear, players: [], staff: [], playerSeq: 0, staffSeq: 0, nations };
  const clubs: Club[] = [];
  const competitions: Competition[] = [];
  const usedNames = new Set<string>();
  /** Clubes de primera por nación ordenados por reputación (para plazas continentales). */
  const topClubsByNation = new Map<string, Club[]>();

  const leagueStart = isoFromParts(startYear, 8, 15);
  const leagueEnd = isoFromParts(startYear + 1, 5, 30);

  for (const seed of seeds) {
    const style = NAME_STYLES[seed.style];
    if (!style) throw new Error(`Estilo de nombres desconocido: ${seed.style}`);
    const code = seed.code.toLowerCase();
    const cupId = `c_${code}_cup`;
    const nationClubs: Club[] = [];
    const leagueIds: string[] = [];

    for (let div = 1; div <= divisions; div++) {
      const leagueId = `c_${code}_${div}`;
      leagueIds.push(leagueId);
      const leagueClubs: Club[] = [];
      for (let i = 0; i < clubsPerLeague; i++) {
        const t = clubsPerLeague === 1 ? 0 : i / (clubsPerLeague - 1);
        const base = div === 1 ? seed.reputation * (0.6 + 0.4 * Math.pow(1 - t, 1.4)) : seed.reputation * (0.25 + 0.3 * (1 - t));
        const rep = clamp(Math.round(base + rng.normal(0, 180)), 200, 10000);
        const club = makeClub(ctx, seed, style, `cl_${code}_${div}${pad(i + 1, 2)}`, rep, usedNames);
        club.boardObjectives = boardObjectives(div, i + 1, clubsPerLeague, leagueId, cupId);
        populateSquad(ctx, club, seed, style, squadSize);
        populateStaff(ctx, club, style);
        leagueClubs.push(club);
      }
      // Rivales: 1-2 clubes de la misma división
      for (const c of leagueClubs) {
        const others = leagueClubs.filter((o) => o.id !== c.id);
        c.rivals = rng.shuffle(others).slice(0, rng.int(1, 2)).map((o) => o.id);
      }
      nationClubs.push(...leagueClubs);
      if (div === 1) topClubsByNation.set(seed.id, leagueClubs.slice().sort((a, b) => b.reputation - a.reputation));

      const strengthFactor = seed.reputation / 10000;
      competitions.push({
        id: leagueId,
        name: seed.leagueNames[div - 1] ?? `${seed.name} División ${div}`,
        shortName: `${seed.code} ${div}`,
        nationId: seed.id,
        continent: CONTINENT,
        format: 'league',
        level: div,
        reputation: Math.round(seed.reputation * (div === 1 ? 1 : 0.45)),
        strength: null,
        teamIds: leagueClubs.map((c) => c.id),
        rules: {
          pointsForWin: 3,
          pointsForDraw: 1,
          roundRobinLegs: 2,
          tiebreakers: ['points', 'goalDifference', 'goalsFor', 'headToHeadPoints'],
          knockoutLegs: 2,
          finalLegs: 1,
          extraTime: true,
          penalties: true,
          awayGoalsRule: false,
          groups: null,
          maxSubstitutions: 5,
          benchSize: 9,
          maxForeignPlayers: null,
        },
        schedule: {
          startDate: leagueStart,
          endDate: leagueEnd,
          preferredWeekday: 6,
          breaks: seed.winterBreak ? [{ from: isoFromParts(startYear, 12, 23), to: isoFromParts(startYear + 1, 1, 6) }] : [],
        },
        prizes: {
          perWin: roundMoney(400_000 * strengthFactor * (div === 1 ? 1 : 0.15)),
          perDraw: roundMoney(130_000 * strengthFactor * (div === 1 ? 1 : 0.15)),
          byPosition: Array.from({ length: clubsPerLeague }, (_, k) =>
            roundMoney(30_000_000 * strengthFactor * (div === 1 ? 1 : 0.1) * (1 - k / clubsPerLeague))),
          byRound: [],
          tvPerTeam: roundMoney(60_000_000 * Math.pow(strengthFactor, 2) * (div === 1 ? 1 : 0.12)),
        },
        promotion:
          div === 1
            ? { upCompetitionId: null, downCompetitionId: divisions > 1 ? `c_${code}_2` : null, promoted: 0, relegated: divisions > 1 ? 3 : 0, playoffPositions: [] }
            : { upCompetitionId: `c_${code}_1`, downCompetitionId: null, promoted: 3, relegated: 0, playoffPositions: [3, 4, 5, 6] },
        continentalSpots: [],
        estimated: [],
        source: 'generated',
      });
    }
    clubs.push(...nationClubs);

    competitions.push({
      id: cupId,
      name: seed.cupName,
      shortName: `Copa ${seed.code}`,
      nationId: seed.id,
      continent: CONTINENT,
      format: 'cup',
      level: 0,
      reputation: Math.round(seed.reputation * 0.6),
      strength: null,
      teamIds: nationClubs.map((c) => c.id),
      rules: {
        pointsForWin: 3, pointsForDraw: 1, roundRobinLegs: 1,
        tiebreakers: ['points', 'goalDifference', 'goalsFor'],
        knockoutLegs: 1, finalLegs: 1, extraTime: true, penalties: true, awayGoalsRule: false,
        groups: null, maxSubstitutions: 5, benchSize: 9, maxForeignPlayers: null,
      },
      schedule: { startDate: isoFromParts(startYear, 10, 28), endDate: isoFromParts(startYear + 1, 5, 20), preferredWeekday: 3, breaks: [] },
      prizes: {
        perWin: 0, perDraw: 0, byPosition: [],
        byRound: [50_000, 100_000, 250_000, 600_000, 1_500_000, 4_000_000].map((v) => roundMoney(v * (seed.reputation / 8000))),
        tvPerTeam: 0,
      },
      promotion: null,
      continentalSpots: [],
      estimated: [],
      source: 'generated',
    });
    void leagueIds;
  }

  // ------------------------------------------------ torneos continentales
  const ranked = seeds.slice().sort((a, b) => b.reputation - a.reputation);
  const championsSpots = [5, 5, 4, 4, 4, 4, 3, 3];
  const trophySpots = [4, 4, 4, 4, 4, 4, 4, 4];
  const championsTeams: string[] = [];
  const trophyTeams: string[] = [];
  ranked.forEach((seed, idx) => {
    const top = topClubsByNation.get(seed.id) ?? [];
    const cs = Math.min(championsSpots[idx] ?? 2, top.length);
    const ts = Math.min(trophySpots[idx] ?? 2, Math.max(0, top.length - cs));
    championsTeams.push(...top.slice(0, cs).map((c) => c.id));
    trophyTeams.push(...top.slice(cs, cs + ts).map((c) => c.id));
    const league = competitions.find((c) => c.id === `c_${seed.code.toLowerCase()}_1`);
    if (league) {
      league.continentalSpots = [
        { competitionId: 'c_aur_champ', positions: Array.from({ length: cs }, (_, k) => k + 1) },
        { competitionId: 'c_aur_trophy', positions: Array.from({ length: ts }, (_, k) => cs + k + 1) },
      ].filter((s) => s.positions.length > 0);
    }
  });

  const continental = (id: string, name: string, shortName: string, teams: string[], rep: number, money: number): Competition => {
    const groupsCount = Math.max(1, Math.floor(teams.length / 4));
    return {
      id, name, shortName, nationId: null, continent: CONTINENT, format: 'groupCup', level: 0, reputation: rep, strength: null,
      teamIds: teams,
      rules: {
        pointsForWin: 3, pointsForDraw: 1, roundRobinLegs: 2,
        tiebreakers: ['points', 'headToHeadPoints', 'headToHeadGoalDifference', 'goalDifference', 'goalsFor'],
        knockoutLegs: 2, finalLegs: 1, extraTime: true, penalties: true, awayGoalsRule: false,
        groups: { count: groupsCount, size: 4, qualifiersPerGroup: 2, avoidSameNation: true },
        maxSubstitutions: 5, benchSize: 12, maxForeignPlayers: null,
      },
      schedule: { startDate: isoFromParts(startYear, 9, 16), endDate: isoFromParts(startYear + 1, 5, 29), preferredWeekday: 2, breaks: [] },
      prizes: {
        perWin: roundMoney(money * 0.1), perDraw: roundMoney(money * 0.033), byPosition: [],
        byRound: [money, money * 1.5, money * 2.5, money * 4, money * 7].map(roundMoney), tvPerTeam: roundMoney(money * 0.8),
      },
      promotion: null,
      continentalSpots: [],
      estimated: [],
      source: 'generated',
    };
  };
  if (championsTeams.length >= 4) {
    competitions.push(continental('c_aur_champ', 'Copa de Campeones de Aurelia', 'Campeones', championsTeams, 9500, 3_000_000));
  }
  if (trophyTeams.length >= 4) {
    competitions.push(continental('c_aur_trophy', 'Trofeo Continental de Aurelia', 'Trofeo', trophyTeams, 7000, 900_000));
  }

  // ------------------------------------------------ agentes libres
  const freeAgents = opts.freeAgents ?? Math.round(15 * nationsCount);
  const freePositions: Position[] = ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'LW', 'RW', 'AM', 'ST', 'ST'];
  for (let k = 0; k < freeAgents; k++) {
    const seed = rng.pick(seeds);
    const style = NAME_STYLES[seed.style] as NameStyle;
    const id = `p_${pad(++ctx.playerSeq, 6)}`;
    ctx.players.push(
      generatePlayer(rng.fork(id), {
        id,
        position: rng.pick(freePositions),
        targetCA: clamp(rng.normal(80, 22), 30, 150),
        age: rng.int(19, 34),
        refDate,
        nationId: seed.id,
        style,
        clubId: null,
        clubName: '',
        clubReputation: 0,
        mandatoryReleaseClause: false,
      }),
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: `Mundo ficticio (semilla ${opts.seed})`,
      source: 'generated',
      seed: opts.seed,
      createdAt: `${refDate}T00:00:00.000Z`,
      startDate: refDate,
      season,
    },
    nations,
    clubs,
    players: ctx.players,
    staff: ctx.staff,
    competitions,
  };
}

/** Genera la siguiente hornada de canteranos de un club (se usará en la Fase 7). */
export function generateYouthIntake(
  rng: Rng,
  club: Club,
  nation: Nation,
  refDate: string,
  firstId: number,
  count = 8,
): Player[] {
  const seed = NATION_SEEDS.find((n) => n.id === nation.id);
  const style = NAME_STYLES[seed?.style ?? 'iberico'] as NameStyle;
  const positions: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'LW', 'RW', 'AM', 'ST'];
  const quality = (club.facilities.youth + club.facilities.juniorCoaching + club.facilities.youthRecruitment) / 3;
  const out: Player[] = [];
  for (let k = 0; k < count; k++) {
    const id = `p_${pad(firstId + k, 6)}`;
    const age = rng.int(15, 16);
    const ca = clamp(rng.normal(25 + quality * 1.5, 8), 15, 90);
    const pa = clamp(Math.round(ca + rng.normal(40 + quality * 2.5, 22)), Math.round(ca) + 5, 200);
    out.push(
      generatePlayer(rng.fork(id), {
        id, position: rng.pick(positions), targetCA: ca, targetPA: pa, age, refDate,
        nationId: nation.id, style, clubId: club.id, clubName: club.name, clubReputation: club.reputation,
        mandatoryReleaseClause: nation.mandatoryReleaseClause, youth: true,
      }),
    );
  }
  return out;
}
