/**
 * Partida: estado completo del juego y bucle de tiempo ("Continuar").
 *
 * - El tiempo avanza día a día. `continueGame` se detiene ante un evento relevante:
 *   partido del usuario, mensaje importante o bloqueante, sorteo de copa en el que
 *   participa, último día de mercado, fin o inicio de temporada.
 * - Los partidos de los demás se simulan con el mismo motor en modo rápido.
 * - Todo es determinista: la semilla de cada partido se deriva de la semilla de la
 *   partida y del id del partido.
 * - Módulo puro (sin React): se ejecuta en un Web Worker.
 */
import { mainPosition, roundMoney } from '../data/ability';
import type { BoardObjective, Club, Competition, Match, MatchEvent, Message, Player, SeasonStats, WorldDatabase } from '../data/schema';
import { t } from '../i18n';
import { buildSeasonCalendar, inRanges, leagueDates, midweekDates, pickSpread, roundRobin, seasonLabel, type SeasonCalendar } from './calendar';
import { addDays, ageAt, isoFromParts } from './date';
import { autoLineup, isAvailable, slotScore } from './lineup';
import { simulateMatch, type MatchResult, type MatchTeamInput, type Weather } from './matchEngine';
import { clamp, createRng, hashString } from './rng';
import { computeStandings, type StandingRow } from './standings';
import { FORMATIONS, FORMATION_IDS, tacticFromFormation, type Mentality, type TeamTactic } from './tactics';
import { DEFAULT_UI, growFamiliarity, resolveUserLineup, type UiPrefs } from './manager';
import { buildPostMatch, type PostMatchState } from './postMatch';
import { cupPrize, economyDay, initEconomy, rolloverFinances, seasonEndFinances, seasonResult, type EconomyState } from './economy';
import { initScouting, scoutingDay, type ScoutingState } from './scouting';
import { initTransfers, rolloverContracts, transfersDay, type TransfersState } from './transfers';
import { boardAfterMatch, boardDay, boardSeasonEnd, initBoard, type BoardState } from './board';
import { initTraining, medicalDays, recoveryFactor, trainingDay, type TrainingState } from './training';
import { initProgression, progressionDay, recordMinutes, seasonProgressReport, type ProgressionState } from './progression';
import { dressingAfterMatch, dressingDay, initDressing, type DressingState } from './dressingRoom';
import { retirements, seasonAwards, trimAiSquads, youthIntake, type SeasonAwards } from './seasonLife';
import { aiClubsDay, type CoreEntry, type DeadlineState, type ManagerMove } from './aiClubs';
import { initInternational, internationalDay, type InternationalState } from './international';
import { afterContinentalFixture, aggregateFor, continentalDay, planContinental, qualifyContinental, roundName, type ContinentalState } from './continental';

export const GAME_STATE_VERSION = 1;

// ---------------------------------------------------------------- tipos
export interface Fixture {
  id: string;
  competitionId: string;
  season: string;
  /** Clave de ronda: "md:5", "cup:qf", "po:sf"... */
  round: string;
  stage: 'league' | 'cup' | 'playoff' | 'continental';
  /** Grupo (torneos continentales). */
  group?: string;
  /** Vuelta de una eliminatoria: id del partido de ida. */
  firstLegId?: string;
  /** Campo neutral (finales continentales). */
  neutral?: boolean;
  date: string;
  homeId: string;
  awayId: string;
  played: boolean;
  /** Eliminatoria: se decide ganador (prórroga y penaltis). */
  decideWinner: boolean;
  result: {
    homeGoals: number;
    awayGoals: number;
    extraTime: boolean;
    penalties: { home: number; away: number } | null;
    winnerId: string | null;
  } | null;
  /** Resumen (para partidos de la IA): eventos clave y estadísticas básicas. */
  summary: {
    events: MatchEvent[];
    shots: [number, number];
    xg: [number, number];
    possession: [number, number];
    attendance: number;
    motmId: string | null;
  } | null;
}

export interface CupRoundState {
  key: string;
  date: string;
  drawDate: string;
  drawn: boolean;
  /** Equipos exentos que entran directamente en esta ronda. */
  byes: string[];
  ties: { homeId: string; awayId: string; fixtureId: string }[];
}

export interface CupState {
  competitionId: string;
  rounds: CupRoundState[];
  /** Equipos todavía vivos (incluye exentos aún no incorporados). */
  alive: string[];
  championId: string | null;
}

export interface PlayoffState {
  competitionId: string;
  created: boolean;
  semis: string[];
  finalId: string | null;
  winnerId: string | null;
}

export interface SeasonRecord {
  season: string;
  competitionId: string;
  championId: string | null;
  table: { clubId: string; position: number; points: number }[];
}

export interface Manager {
  firstName: string;
  lastName: string;
  nationality: string | null;
}

export interface Career {
  clubs: { clubId: string; name: string; from: string; to: string | null; matches: number; wins: number; draws: number; losses: number }[];
  trophies: { season: string; competitionId: string; name: string; clubId: string }[];
}

/** Anota un título del usuario en su carrera. */
export function recordTrophy(state: GameState, competitionId: string, clubId: string): void {
  if (clubId !== state.userClubId) return;
  const name = indexes(state).comps.get(competitionId)?.name ?? competitionId;
  if (state.career.trophies.some((t) => t.season === state.season && t.competitionId === competitionId)) return;
  state.career.trophies.push({ season: state.season, competitionId, name, clubId });
  addMessage(state, { type: 'competition', priority: 'high', key: 'trophy', params: { cup: name } });
}

export interface GameState {
  version: number;
  id: string;
  name: string;
  seed: number;
  createdAt: string;
  date: string;
  season: string;
  seasonYear: number;
  /** Año de la temporada inicial (las fechas de las competiciones se desplazan desde él). */
  baseYear: number;
  userClubId: string;
  manager: Manager;
  world: WorldDatabase;
  calendar: SeasonCalendar;
  fixtures: Fixture[];
  cups: Record<string, CupState>;
  /** Torneos continentales de la temporada. */
  continental: Record<string, ContinentalState>;
  playoffs: Record<string, PlayoffState>;
  /** Partidos completos del usuario (eventos, alineaciones, estadísticas, notas). */
  userMatches: Record<string, Match>;
  userTactic: TeamTactic;
  /** Alineación elegida por el usuario (null = la decide el asistente). */
  userLineup: { starting: string[]; bench: string[] } | null;
  /** Familiaridad con la táctica actual (0-100). */
  tacticFamiliarity: number;
  /** Preferencias de interfaz guardadas con la partida (panel, vistas, lista de seguimiento). */
  ui: UiPrefs;
  /** Post-partido del último partido del usuario (informe, moral, rueda de prensa). */
  postMatch: PostMatchState | null;
  inbox: Message[];
  news: { date: string; text: string; type: string }[];
  history: SeasonRecord[];
  /** Movimientos de ascenso/descenso pendientes para la próxima temporada. */
  pendingMoves: { clubId: string; from: string; to: string }[];
  /** Último partido jugado por jugador (para ritmo de partido). */
  lastPlayed: Record<string, string>;
  /** Marcas de eventos ya procesados (idempotencia del bucle diario). */
  processed: Record<string, true>;
  pendingUserMatchId: string | null;
  /** Economía de todos los clubes (libros, pagos aplazados, juego limpio financiero). */
  economy: EconomyState;
  /** Ojeo del club del usuario. */
  scouting: ScoutingState;
  /** Mercado: operaciones, cesiones, reventas, jugadores en venta. */
  transfers: TransfersState;
  /** Directiva del club del usuario. */
  board: BoardState;
  /** Entrenamiento del club del usuario. */
  training: TrainingState;
  /** Progresión de jugadores (acumuladores, minutos recientes, cambios). */
  progression: ProgressionState;
  /** Vestuario del usuario: preocupaciones, promesas, reuniones. */
  dressing: DressingState;
  /** Premios de cada temporada y liga. */
  awards: SeasonAwards[];
  /** Última hornada de canteranos del usuario. */
  youthIntake: { date: string; ids: string[] } | null;
  /** Selecciones: convocatorias, internacionalidades, resultados. */
  international: InternationalState;
  /** Cambios de entrenador en los clubes de la IA. */
  managerMoves: ManagerMove[];
  /** Carrera del entrenador del usuario. */
  career: Career;
  /** Día de cierre del mercado en curso (por horas). */
  deadline?: DeadlineState;
  /** Núcleo de cada club de la IA al cerrar el último mercado (para detectar bajas). */
  aiCores?: Record<string, CoreEntry[]>;
  /** Ventas forzadas por deudas (club:jugador). */
  debtSales?: string[];
  seq: number;
}

export type StopReason = 'userMatch' | 'blocking' | 'message' | 'draw' | 'deadlineDay' | 'seasonEnd' | 'newSeason' | 'limit';

export interface ContinueResult {
  stop: StopReason;
  date: string;
  fixtureId?: string;
  messageIds: string[];
  daysAdvanced: number;
}

export interface NewGameSetup {
  world: WorldDatabase;
  userClubId: string;
  manager: Manager;
  seed: number;
  name?: string;
}

// ---------------------------------------------------------------- índices (no se guardan)
interface Indexes {
  players: Map<string, Player>;
  clubs: Map<string, Club>;
  comps: Map<string, Competition>;
  squads: Map<string, Player[]>;
  fixtures: Map<string, Fixture>;
  byDate: Map<string, Fixture[]>;
}
const INDEX = new WeakMap<GameState, Indexes>();

export function indexes(state: GameState): Indexes {
  let ix = INDEX.get(state);
  if (!ix) {
    ix = buildIndexes(state);
    INDEX.set(state, ix);
  }
  return ix;
}

export function invalidate(state: GameState): void {
  INDEX.delete(state);
}

function buildIndexes(state: GameState): Indexes {
  const squads = new Map<string, Player[]>();
  for (const p of state.world.players) if (p.clubId) (squads.get(p.clubId) ?? squads.set(p.clubId, []).get(p.clubId)!).push(p);
  const byDate = new Map<string, Fixture[]>();
  for (const f of state.fixtures) (byDate.get(f.date) ?? byDate.set(f.date, []).get(f.date)!).push(f);
  return {
    players: new Map(state.world.players.map((p) => [p.id, p])),
    clubs: new Map(state.world.clubs.map((c) => [c.id, c])),
    comps: new Map(state.world.competitions.map((c) => [c.id, c])),
    squads,
    fixtures: new Map(state.fixtures.map((f) => [f.id, f])),
    byDate,
  };
}

export function addFixture(state: GameState, f: Fixture): void {
  state.fixtures.push(f);
  const ix = INDEX.get(state);
  if (ix) {
    ix.fixtures.set(f.id, f);
    (ix.byDate.get(f.date) ?? ix.byDate.set(f.date, []).get(f.date)!).push(f);
  }
}

// ---------------------------------------------------------------- utilidades
export const nextId = (state: GameState, prefix: string) => `${prefix}${(++state.seq).toString(36)}`;
export const rngFor = (state: GameState, label: string) => createRng(hashString(`${state.seed}:${label}`));

function clubName(state: GameState, id: string): string {
  return indexes(state).clubs.get(id)?.name ?? id;
}

function playerName(p: Player): string {
  return p.commonName ?? `${p.firstName} ${p.lastName}`;
}

export function roundLabel(round: string): string {
  const [kind, k] = round.split(':');
  if (kind === 'md') return t('round.md', { n: Number(k) });
  if (kind === 'po') return t(k === 'sf' ? 'round.posf' : 'round.pofinal');
  if (kind === 'gs') return `Fase de grupos · jornada ${k}`;
  if (kind === 'ko') { const leg = round.split(':')[2]; return `${roundName(k ?? '')}${leg ? (leg === '1' ? ' (ida)' : ' (vuelta)') : ''}`; }
  return t(`round.${k}`);
}

/** Desplaza una fecha AAAA-MM-DD del año base al año de la temporada indicada. */
function shiftYear(iso: string, delta: number): string {
  return `${Number(iso.slice(0, 4)) + delta}${iso.slice(4)}`;
}

function isLeague(c: Competition): boolean {
  return c.format === 'league';
}

export function leagueOf(state: GameState, clubId: string): Competition | undefined {
  return state.world.competitions.find((c) => c.format === 'league' && c.teamIds.includes(clubId));
}

// ---------------------------------------------------------------- mensajes
export interface MessageInput {
  type: Message['type'];
  priority: Message['priority'];
  key: string;
  params: Record<string, string | number>;
  sender?: string;
  blocking?: boolean;
  actions?: Message['actions'];
  related?: Partial<Message['related']>;
}

export function addMessage(state: GameState, m: MessageInput): Message {
  const msg: Message = {
    id: nextId(state, 'msg'),
    date: state.date,
    type: m.type,
    priority: m.priority,
    sender: m.sender ?? t('app.title'),
    subject: t(`msg.${m.key}.subject`, m.params),
    body: t(`msg.${m.key}.body`, m.params),
    read: false,
    blocking: m.blocking ?? false,
    actions: m.actions ?? [],
    related: { playerId: null, clubId: null, matchId: null, competitionId: null, ...m.related },
    resolvedActionId: null,
    template: { key: m.key, params: m.params },
  };
  state.inbox.unshift(msg);
  if (state.inbox.length > 600) state.inbox.length = 600;
  return msg;
}

export function resolveMessage(state: GameState, messageId: string, actionId: string | null): void {
  const m = state.inbox.find((x) => x.id === messageId);
  if (!m) return;
  m.read = true;
  if (m.blocking || m.actions.length) m.resolvedActionId = actionId ?? 'dismiss';
}

export function markRead(state: GameState, messageId: string): void {
  const m = state.inbox.find((x) => x.id === messageId);
  if (m) m.read = true;
}

function news(state: GameState, type: string, text: string): void {
  state.news.unshift({ date: state.date, type, text });
  if (state.news.length > 300) state.news.length = 300;
}

function objectivesText(state: GameState, club: Club): string {
  return club.boardObjectives
    .filter((o) => o.type !== 'balanceBudget')
    .map((o) => t(`objective.${o.type}`, { target: o.target ?? '' }))
    .join(', ') || t('objective.balanceBudget');
}

// ---------------------------------------------------------------- nueva partida
export function newGame(setup: NewGameSetup): GameState {
  const world: WorldDatabase = structuredClone(setup.world);
  const startYear = Number(world.meta.startDate.slice(0, 4));
  const club = world.clubs.find((c) => c.id === setup.userClubId);
  if (!club) throw new Error(`Club inexistente: ${setup.userClubId}`);
  const state: GameState = {
    version: GAME_STATE_VERSION,
    id: `g${setup.seed.toString(36)}${hashString(setup.userClubId).toString(36)}`,
    name: setup.name ?? `${club.name} · ${setup.manager.lastName}`,
    seed: setup.seed,
    createdAt: world.meta.createdAt,
    date: world.meta.startDate,
    season: seasonLabel(startYear),
    seasonYear: startYear,
    baseYear: startYear,
    userClubId: setup.userClubId,
    manager: setup.manager,
    world,
    calendar: buildSeasonCalendar(startYear),
    fixtures: [],
    cups: {},
    continental: {},
    playoffs: {},
    userMatches: {},
    userTactic: tacticFromFormation('4-4-2'),
    userLineup: null,
    tacticFamiliarity: 80,
    ui: structuredClone(DEFAULT_UI),
    postMatch: null,
    inbox: [],
    news: [],
    history: [],
    pendingMoves: [],
    lastPlayed: {},
    processed: {},
    pendingUserMatchId: null,
    economy: null as unknown as EconomyState,
    scouting: null as unknown as ScoutingState,
    transfers: null as unknown as TransfersState,
    board: null as unknown as BoardState,
    training: null as unknown as TrainingState,
    progression: null as unknown as ProgressionState,
    dressing: null as unknown as DressingState,
    awards: [],
    youthIntake: null,
    international: null as unknown as InternationalState,
    managerMoves: [],
    career: { clubs: [{ clubId: club.id, name: club.name, from: world.meta.startDate, to: null, matches: 0, wins: 0, draws: 0, losses: 0 }], trophies: [] },
    seq: 0,
  };
  setupSeason(state, startYear);
  initEconomy(state);
  initScouting(state);
  initTransfers(state);
  initBoard(state);
  initTraining(state);
  initDressing(state);
  initProgression(state);
  initInternational(state);
  state.userTactic = bestTacticFor(indexes(state).squads.get(club.id) ?? []);
  addMessage(state, {
    type: 'board', priority: 'urgent', key: 'welcome', sender: `Directiva de ${club.name}`,
    params: { club: club.name, objectives: objectivesText(state, club) },
    blocking: true,
    actions: [{ id: 'ok', kind: 'accept', labelKey: 'common.understood', payload: {} }],
    related: { clubId: club.id },
  });
  return state;
}

/** Formación que mejor encaja con la plantilla (suma de idoneidad de la alineación automática). */
export function bestTacticFor(squad: readonly Player[]): TeamTactic {
  let best = tacticFromFormation('4-4-2');
  let bestScore = -Infinity;
  for (const id of FORMATION_IDS) {
    const tac = tacticFromFormation(id);
    const l = autoLineup(squad, tac);
    const byId = new Map(squad.map((p) => [p.id, p]));
    let s = 0;
    l.starting.forEach((pid, i) => {
      const p = byId.get(pid);
      const slot = tac.slots[i];
      if (p && slot) s += slotScore(p, slot);
    });
    if (s > bestScore) { bestScore = s; best = tac; }
  }
  return best;
}

// ---------------------------------------------------------------- temporada
function setupSeason(state: GameState, year: number): void {
  state.calendar = buildSeasonCalendar(year);
  state.season = seasonLabel(year);
  state.seasonYear = year;
  state.world.meta.season = state.season;
  const cal = state.calendar;
  const delta = year - state.baseYear;
  const blocked = cal.internationalBreaks;

  // Torneos continentales y copas nacionales: fechas reservadas entre semana
  const reserved = new Set<string>();
  state.continental = {};
  for (const comp of state.world.competitions) {
    if (comp.format !== 'groupCup') continue;
    const cs = planContinental(state, comp, year, reserved);
    if (cs) state.continental[comp.id] = cs;
  }
  const cupDates = midweekDates(isoFromParts(year, 9, 20), isoFromParts(year + 1, 5, 19), blocked);
  for (const comp of state.world.competitions) {
    if (comp.format !== 'cup') continue;
    const cup = planCup(state, comp, cupDates, year);
    state.cups[comp.id] = cup;
    for (const r of cup.rounds) reserved.add(r.date);
  }

  // Ligas
  for (const comp of state.world.competitions) {
    if (!isLeague(comp)) continue;
    const rng = rngFor(state, `rr:${comp.id}:${year}`);
    const rounds = roundRobin(comp.teamIds, comp.rules.roundRobinLegs, rng);
    const compBreaks = comp.schedule.breaks.map((b) => ({ from: shiftYear(b.from, delta), to: shiftYear(b.to, delta) }));
    const start = shiftYear(comp.schedule.startDate, delta);
    const end = shiftYear(comp.schedule.endDate, delta);
    const dates = leagueDates(start, end, rounds.length, comp.schedule.preferredWeekday, [...blocked, ...compBreaks], reserved);
    rounds.forEach((pairs, r) => {
      for (const [homeId, awayId] of pairs) {
        addFixture(state, {
          id: nextId(state, 'f'), competitionId: comp.id, season: state.season, round: `md:${r + 1}`, stage: 'league',
          date: dates[r] as string, homeId, awayId, played: false, decideWinner: false, result: null, summary: null,
        });
      }
    });
    if (comp.promotion && comp.promotion.playoffPositions.length >= 2) {
      state.playoffs[comp.id] = { competitionId: comp.id, created: false, semis: [], finalId: null, winnerId: null };
    }
  }
}

function planCup(state: GameState, comp: Competition, dates: string[], year: number): CupState {
  const clubs = indexes(state).clubs;
  const teams = comp.teamIds.filter((id) => clubs.has(id));
  const n = teams.length;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  const keys: string[] = [];
  if (n > p) keys.push('prelim');
  const sizeKey: Record<number, string> = { 128: 'r128', 64: 'r64', 32: 'r32', 16: 'r16', 8: 'qf', 4: 'sf', 2: 'final' };
  for (let s = p; s >= 2; s /= 2) keys.push(sizeKey[s] ?? `r${s}`);
  const roundDates = pickSpread(dates, keys.length);
  // Exentos: los de más reputación
  const byRep = teams.slice().sort((a, b) => (clubs.get(b)?.reputation ?? 0) - (clubs.get(a)?.reputation ?? 0));
  const prelimCount = n > p ? 2 * (n - p) : 0;
  const byes = byRep.slice(0, n - prelimCount);
  const rounds: CupRoundState[] = keys.map((key, i) => {
    const date = roundDates[i] ?? isoFromParts(year + 1, 5, 20);
    return { key, date, drawDate: addDays(date, -12), drawn: false, byes: i === 1 && prelimCount > 0 ? byes : [], ties: [] };
  });
  if (prelimCount === 0 && rounds[0]) rounds[0].byes = teams.slice();
  return { competitionId: comp.id, rounds, alive: teams.slice(), championId: null };
}

// ---------------------------------------------------------------- bucle
const STOP_PRIORITIES = new Set<Message['priority']>(['high', 'urgent']);

export function hasBlocking(state: GameState): boolean {
  return state.inbox.some((m) => m.blocking && !m.resolvedActionId);
}

export function continueGame(state: GameState, maxDays = 400): ContinueResult {
  const startDate = state.date;
  const before = new Set(state.inbox.map((m) => m.id));
  const result = (stop: StopReason, fixtureId?: string): ContinueResult => ({
    stop, date: state.date, fixtureId, daysAdvanced: daysBetween(startDate, state.date),
    messageIds: state.inbox.filter((m) => !before.has(m.id)).map((m) => m.id),
  });
  if (hasBlocking(state) || state.board?.fired) return result('blocking');
  if (state.pendingUserMatchId) {
    const f = indexes(state).fixtures.get(state.pendingUserMatchId);
    if (f && !f.played) return result('userMatch', f.id);
    state.pendingUserMatchId = null;
  }
  for (let d = 0; d < maxDays; d++) {
    const stop = advanceDay(state);
    if (stop) return result(stop.reason, stop.fixtureId);
    const fresh = state.inbox.filter((m) => !before.has(m.id));
    if (fresh.some((m) => m.blocking && !m.resolvedActionId) || state.board.fired) return result('blocking');
    if (fresh.some((m) => STOP_PRIORITIES.has(m.priority))) return result('message');
  }
  return result('limit');
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Traslado a un estadio nuevo cuando termina su construcción. Los ingresos de taquilla
 * previstos y los abonados crecen con el aforo; la asistencia de cada partido ya depende del aforo.
 */
function openNewStadiums(state: GameState): void {
  for (const club of state.world.clubs) {
    const next = club.futureStadium;
    if (!next || state.date < next.opens) continue;
    const old = club.stadium;
    const ratio = next.capacity / Math.max(1, old.capacity);
    club.stadium = { ...old, name: next.name, capacity: next.capacity, pitchCondition: 100 };
    club.futureStadium = null;
    club.finances.seasonIncome.tickets = roundMoney(club.finances.seasonIncome.tickets * ratio);
    club.finances.seasonTicketHolders = Math.min(next.capacity, Math.round(club.finances.seasonTicketHolders * ratio));
    if (club.id === state.userClubId) {
      addMessage(state, {
        type: 'board', priority: 'high', key: 'stadiumOpened', sender: `Directiva de ${club.name}`,
        params: { club: club.name, stadium: next.name, capacity: next.capacity.toLocaleString('es'), old: old.name },
        related: { clubId: club.id },
      });
    }
  }
}

/** Procesa el día actual. Devuelve un motivo de parada (sin avanzar) o null (día completado). */
function advanceDay(state: GameState): { reason: StopReason; fixtureId?: string } | null {
  const d = state.date;
  const cal = state.calendar;
  const once = (key: string) => {
    if (state.processed[key]) return false;
    state.processed[key] = true;
    return true;
  };

  // 1. Cambio de temporada y fin de temporada
  if (d === cal.nextStart && once(`rollover:${cal.year}`)) {
    rollover(state);
    return { reason: 'newSeason' };
  }
  if (d === cal.seasonEndProcessing && once(`seasonEnd:${cal.year}`)) {
    processSeasonEnd(state);
    return { reason: 'seasonEnd' };
  }

  openNewStadiums(state);

  // 2. Mercado y parones
  for (const w of cal.windows) {
    if (d === w.open && once(`win:${w.id}:open:${cal.year}`)) {
      addMessage(state, { type: 'transfer', priority: 'normal', key: 'windowOpen', params: { window: t(`window.${w.id}`), deadline: w.deadline } });
    }
    if (d === w.deadline && once(`win:${w.id}:deadline:${cal.year}`)) {
      addMessage(state, { type: 'transfer', priority: 'normal', key: 'deadlineDay', params: { window: t(`window.${w.id}`) } });
      return { reason: 'deadlineDay' };
    }
    if (d === addDays(w.deadline, 1) && once(`win:${w.id}:closed:${cal.year}`)) {
      addMessage(state, { type: 'transfer', priority: 'low', key: 'windowClosed', params: { window: t(`window.${w.id}`) } });
    }
  }
  for (const b of cal.internationalBreaks) {
    if (d === b.from && once(`ib:${b.from}`)) addMessage(state, { type: 'competition', priority: 'low', key: 'internationalBreak', params: { to: b.to } });
  }

  // 3. Sorteos de copa
  let drawStop = false;
  for (const cup of Object.values(state.cups)) {
    if (drawCupRoundIfDue(state, cup)) drawStop = true;
  }
  if (continentalDay(state)) drawStop = true;
  if (drawStop && once(`drawstop:${d}`)) return { reason: 'draw' };

  // 4. Playoffs (cuando termina la liga regular)
  for (const po of Object.values(state.playoffs)) createPlayoffIfDue(state, po);

  // 5. Partidos del día
  const today = (indexes(state).byDate.get(d) ?? []).filter((f) => !f.played);
  const user = today.find((f) => f.homeId === state.userClubId || f.awayId === state.userClubId);
  if (user) {
    state.pendingUserMatchId = user.id;
    return { reason: 'userMatch', fixtureId: user.id };
  }
  const playedToday = new Set<string>();
  for (const f of today) playFixture(state, f, 'fast', playedToday);
  for (const f of today) afterFixture(state, f);

  // 6. Actualización diaria
  dailyUpdate(state, playedToday);
  state.date = addDays(d, 1);
  return null;
}

// ---------------------------------------------------------------- partidos
function strength(squad: readonly Player[]): number {
  const cas = squad.filter(isAvailable).map((p) => p.ca).sort((a, b) => b - a).slice(0, 11);
  return cas.length ? cas.reduce((a, b) => a + b, 0) / cas.length : 50;
}

/** Táctica de la IA: formación preferida del entrenador y mentalidad según la diferencia de nivel. */
/**
 * Nivel táctico (1-20) de quien decide en el banquillo: media de «táctica» y «conocimiento táctico» del
 * entrenador (o del segundo entrenador, en el equipo del usuario con el asistente). 11 si no hay nadie.
 */
export function benchSkill(state: GameState, clubId: string, role: 'manager' | 'assistantManager' = 'manager'): number {
  const s = state.world.staff.find((x) => x.clubId === clubId && x.role === role)
    ?? (role === 'assistantManager' ? state.world.staff.find((x) => x.clubId === clubId && x.role === 'manager') : undefined);
  if (!s) return 11;
  const a = s.attributes as Record<string, number>;
  return Math.round(((a.tactical ?? 11) + (a.tacticalKnowledge ?? 11)) / 2);
}

const formationCache = new WeakMap<GameState, Map<string, { date: string; formation: string }>>();

/**
 * Formación de un club de la IA: la que mejor encaja con su plantilla disponible (suma de la idoneidad de
 * cada titular para su puesto y rol), con ventaja para la preferida del entrenador. Se revisa cada semana.
 * Un entrenador de poco nivel táctico es más terco con su sistema y se equivoca más al valorar los demás.
 */
export function aiFormation(state: GameState, club: Club, squad: readonly Player[]): string {
  let cache = formationCache.get(state);
  if (!cache) formationCache.set(state, (cache = new Map()));
  const hit = cache.get(club.id);
  if (hit && hit.date <= state.date && state.date < addDays(hit.date, 7)) return hit.formation;
  const manager = state.world.staff.find((s) => s.clubId === club.id && s.role === 'manager');
  const preferred = manager?.preferredFormation && FORMATIONS[manager.preferredFormation] ? manager.preferredFormation : '4-4-2';
  const byId = new Map(squad.map((p) => [p.id, p]));
  const skill = benchSkill(state, club.id);
  const stubborn = 1.01 + (20 - skill) * 0.003; // nivel 5 → 5,5 %; nivel 18 → 1,6 %
  const misjudge = 0.004 + (20 - skill) * 0.0025; // error al valorar cada sistema: nivel 5 → ±4 %; nivel 18 → ±1 %
  const rng = rngFor(state, `formacion:${club.id}:${state.date}`);
  let best = preferred;
  let bestScore = -Infinity;
  for (const id of FORMATION_IDS) {
    const t = tacticFromFormation(id, 4, {});
    const l = autoLineup(squad, t, 0);
    let sc = 0;
    l.starting.forEach((pid, i) => { const p = byId.get(pid); const slot = t.slots[i]; if (p && slot) sc += slotScore(p, slot); });
    sc *= 1 + rng.float(-1, 1) * misjudge;
    if (id === preferred) sc *= stubborn;
    if (sc > bestScore) { bestScore = sc; best = id; }
  }
  cache.set(club.id, { date: state.date, formation: best });
  return best;
}

export function aiTactic(state: GameState, club: Club, squad: readonly Player[], opponentStrength: number, home: boolean): TeamTactic {
  const formation = aiFormation(state, club, squad);
  const diff = strength(squad) - opponentStrength + (home ? 4 : -4);
  // Un entrenador flojo lee peor el partido: a veces sale más (o menos) atrevido de lo que toca
  const skill = benchSkill(state, club.id);
  const rng = rngFor(state, `mentalidad:${club.id}:${state.date}`);
  const misread = rng.chance((20 - skill) * 0.025) ? (rng.chance(0.5) ? 1 : -1) : 0;
  const mentality = clamp(Math.round(4 + diff / 14) + misread, 2, 6) as Mentality;
  const counter = diff < -8;
  return tacticFromFormation(formation, mentality, { counterAttack: counter, pressIntensity: diff > 10 ? 4 : 3 });
}

function weatherFor(state: GameState, f: Fixture): Weather {
  const r = rngFor(state, `w:${f.id}`).next();
  const month = Number(f.date.slice(5, 7));
  if (month === 7 || month === 8) return r < 0.15 ? 'heat' : r < 0.25 ? 'rain' : 'clear';
  if (month >= 11 || month <= 2) return r < 0.06 ? 'snow' : r < 0.3 ? 'rain' : r < 0.36 ? 'wind' : 'clear';
  return r < 0.2 ? 'rain' : r < 0.26 ? 'wind' : 'clear';
}

function teamInput(state: GameState, club: Club, opponentStrength: number, home: boolean): MatchTeamInput {
  const squad = indexes(state).squads.get(club.id) ?? [];
  const isUser = club.id === state.userClubId;
  return {
    clubId: club.id,
    name: club.name,
    reputation: club.reputation,
    squad,
    tactic: isUser ? state.userTactic : aiTactic(state, club, squad, opponentStrength, home),
    lineup: isUser ? resolveUserLineup(state) : undefined,
    familiarity: isUser ? Math.round(state.tacticFamiliarity) : 80,
    ai: true,
    managerSkill: benchSkill(state, club.id, isUser ? 'assistantManager' : 'manager'),
  };
}

export function buildMatchInput(state: GameState, f: Fixture, detail: 'fast' | 'full') {
  const ix = indexes(state);
  const home = ix.clubs.get(f.homeId) as Club;
  const away = ix.clubs.get(f.awayId) as Club;
  const sh = strength(ix.squads.get(home.id) ?? []);
  const sa = strength(ix.squads.get(away.id) ?? []);
  const comp = ix.comps.get(f.competitionId);
  const derby = home.rivals.includes(away.id) || away.rivals.includes(home.id);
  const importance = f.round === 'cup:final' || f.round === 'po:final' ? 1 : f.stage === 'playoff' ? 0.8 : derby ? 0.5 : f.stage === 'cup' ? 0.3 : 0.1;
  return {
    seed: hashString(`${state.seed}:${f.id}`),
    home: teamInput(state, home, sa, true),
    away: teamInput(state, away, sh, false),
    detail,
    context: {
      matchId: f.id, competitionId: f.competitionId, season: f.season, round: f.round, date: f.date,
      decideWinner: f.decideWinner, aggregate: aggregateFor(state, f), neutral: f.neutral ?? false, weather: weatherFor(state, f), pitchCondition: home.stadium.pitchCondition,
      capacity: home.stadium.capacity, importance, maxSubstitutions: comp?.rules.maxSubstitutions ?? 5,
    },
  };
}

const KEY_EVENTS = new Set<MatchEvent['type']>(['goal', 'yellow', 'secondYellow', 'red', 'substitution', 'injury', 'penaltyMissed', 'penalty']);

/** Simula un partido y aplica todas sus consecuencias. */
function playFixture(state: GameState, f: Fixture, detail: 'fast' | 'full', playedToday: Set<string>, precomputed?: MatchResult): MatchResult {
  const ix = indexes(state);
  // Sancionados antes del partido (cumplen sanción con este partido)
  const suspendedBefore = [f.homeId, f.awayId].flatMap((c) => (ix.squads.get(c) ?? []).filter((p) => p.cards.suspendedMatches > 0));
  const r = precomputed ?? simulateMatch(buildMatchInput(state, f, detail));
  const res = r.match.result!;
  const winnerId = r.winner === 'home' ? f.homeId : r.winner === 'away' ? f.awayId : null;
  f.played = true;
  f.result = { homeGoals: res.homeGoals, awayGoals: res.awayGoals, extraTime: res.extraTime, penalties: res.penalties, winnerId };
  const s = r.match.stats!;
  f.summary = {
    events: r.match.events.filter((e) => KEY_EVENTS.has(e.type)),
    shots: [s.home.shots, s.away.shots],
    xg: [s.home.xg, s.away.xg],
    possession: [s.home.possession, s.away.possession],
    attendance: r.match.attendance ?? 0,
    motmId: r.match.playerOfMatchId,
  };
  if (f.homeId === state.userClubId || f.awayId === state.userClubId) {
    state.userMatches[f.id] = r.match;
    growFamiliarity(state, 2.5);
    boardAfterMatch(state, f);
    const stint = state.career.clubs.at(-1);
    if (stint && f.result) {
      const my = f.homeId === state.userClubId ? f.result.homeGoals : f.result.awayGoals;
      const their = f.homeId === state.userClubId ? f.result.awayGoals : f.result.homeGoals;
      stint.matches++;
      if (f.result.winnerId ? f.result.winnerId === state.userClubId : my > their) stint.wins++;
      else if (my === their && !f.result.winnerId) stint.draws++;
      else stint.losses++;
    }
    dressingAfterMatch(state, f, r);
  }
  for (const p of suspendedBefore) p.cards.suspendedMatches = Math.max(0, p.cards.suspendedMatches - 1);
  applyPlayerResults(state, f, r, playedToday);
  return r;
}

function applyPlayerResults(state: GameState, f: Fixture, r: MatchResult, playedToday: Set<string>): void {
  const ix = indexes(state);
  const isUserMatch = f.homeId === state.userClubId || f.awayId === state.userClubId;
  const reds = new Map<string, 'red' | 'secondYellow'>();
  for (const e of r.match.events) if ((e.type === 'red' || e.type === 'secondYellow') && e.playerId) reds.set(e.playerId, e.type);
  for (const st of Object.values(r.playerStats)) {
    const p = ix.players.get(st.playerId);
    if (!p) continue;
    playedToday.add(p.id);
    const clubId = st.side === 0 ? f.homeId : f.awayId;
    const conceded = st.side === 0 ? f.result!.awayGoals : f.result!.homeGoals;
    const won = st.side === 0 ? f.result!.homeGoals > f.result!.awayGoals : f.result!.awayGoals > f.result!.homeGoals;
    const lost = st.side === 0 ? f.result!.homeGoals < f.result!.awayGoals : f.result!.awayGoals < f.result!.homeGoals;
    if (st.minutes > 0) {
      p.condition = st.condition;
      p.matchSharpness = st.sharpness;
      state.lastPlayed[p.id] = f.date;
      recordMinutes(state, p.id, st.minutes);
      p.form = [...p.form, st.rating].slice(-5);
      p.morale = clamp(p.morale + (won ? 4 : lost ? -4 : 0) + (st.rating >= 7.5 ? 3 : st.rating < 6 ? -2 : 0), 5, 100);
      // Estadísticas de temporada por competición
      let ss = p.seasonStats.find((x) => x.season === f.season && x.competitionId === f.competitionId && x.clubId === clubId);
      if (!ss) {
        ss = emptySeasonStats(f.season, clubId, f.competitionId);
        p.seasonStats.push(ss);
      }
      ss.apps++;
      if (st.started) ss.starts++;
      ss.minutes += st.minutes;
      ss.goals += st.goals;
      ss.assists += st.assists;
      ss.xg = Math.round((ss.xg + st.xg) * 100) / 100;
      ss.shots += st.shots;
      ss.passesCompleted += st.passesCompleted;
      ss.tackles += st.tackles;
      ss.yellow += st.yellow;
      ss.red += st.red;
      if (conceded === 0 && st.minutes >= 60 && (mainPosition(p.positions) === 'GK' || ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(mainPosition(p.positions)))) ss.cleanSheets++;
      ss.avgRating = Math.round(((ss.avgRating * (ss.apps - 1) + st.rating) / ss.apps) * 100) / 100;
      if (r.match.playerOfMatchId === p.id) ss.playerOfMatch++;
    }
    // Tarjetas y sanciones
    const red = reds.get(p.id);
    if (red) {
      const games = red === 'red' ? 2 : 1;
      p.cards.red++;
      p.cards.suspendedMatches += games;
      if (isUserMatch && clubId === state.userClubId) {
        addMessage(state, { type: 'player', priority: 'normal', key: 'suspension', params: { player: playerName(p), games, reason: t(`suspensionReason.${red}`) }, related: { playerId: p.id } });
      }
    } else if (st.yellow > 0) {
      p.cards.yellow += st.yellow;
      if (p.cards.yellow % 5 === 0) {
        p.cards.suspendedMatches += 1;
        if (clubId === state.userClubId) {
          addMessage(state, { type: 'player', priority: 'normal', key: 'suspension', params: { player: playerName(p), games: 1, reason: t('suspensionReason.yellows') }, related: { playerId: p.id } });
        }
      }
    }
  }
  for (const inj of r.injuries) {
    const p = ix.players.get(inj.playerId);
    if (!p) continue;
    const days = medicalDays(state, p.clubId, inj.injury.daysOut);
    p.injury = { ...inj.injury, daysOut: days, daysRemaining: days };
    inj.injury = p.injury;
    if (p.clubId === state.userClubId) {
      addMessage(state, {
        type: 'injury', priority: inj.injury.severity === 'minor' ? 'normal' : 'high', key: 'injury', sender: 'Servicios médicos',
        params: { player: playerName(p), injury: t(`injury.${inj.injury.type}`), severity: t(`injurySeverity.${inj.injury.severity}`).toLowerCase(), days: inj.injury.daysOut },
        related: { playerId: p.id },
      });
    }
  }
  if (isUserMatch) {
    const comp = ix.comps.get(f.competitionId);
    const motm = r.match.playerOfMatchId ? ix.players.get(r.match.playerOfMatchId) : undefined;
    addMessage(state, {
      type: 'match', priority: 'low', key: 'matchResult', sender: comp?.name ?? '',
      params: {
        home: clubName(state, f.homeId), away: clubName(state, f.awayId), hg: f.result!.homeGoals, ag: f.result!.awayGoals,
        competition: comp?.name ?? '', round: roundLabel(f.round), motm: motm ? playerName(motm) : '—',
      },
      related: { matchId: f.id, competitionId: f.competitionId },
    });
  }
}

function emptySeasonStats(season: string, clubId: string | null, competitionId: string | null): SeasonStats {
  return {
    season, clubId, competitionId, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0,
    passesCompleted: 0, tackles: 0, yellow: 0, red: 0, cleanSheets: 0, avgRating: 0, playerOfMatch: 0,
  };
}

/** Juega el partido pendiente del usuario (modo completo) y el resto de partidos del día. */
export function pendingUserFixture(state: GameState): Fixture {
  const id = state.pendingUserMatchId;
  const f = id ? indexes(state).fixtures.get(id) : undefined;
  if (!f || f.played) throw new Error('No hay partido pendiente del usuario');
  return f;
}

/** Entrada del motor para el partido del usuario (para jugarlo en directo). */
export function prepareUserMatch(state: GameState) {
  const f = pendingUserFixture(state);
  const input = buildMatchInput(state, f, 'full');
  return { fixture: f, input, userSide: (f.homeId === state.userClubId ? 0 : 1) as 0 | 1 };
}

/**
 * Juega el partido pendiente del usuario y el resto de partidos del día. Con `precomputed`
 * se usa el resultado del partido jugado en directo.
 */
export function playUserMatch(state: GameState, precomputed?: MatchResult): { fixture: Fixture; result: MatchResult } {
  const f = pendingUserFixture(state);
  const playedToday = new Set<string>();
  const moraleBefore = new Map((indexes(state).squads.get(state.userClubId) ?? []).map((p) => [p.id, p.morale]));
  const result = playFixture(state, f, 'full', playedToday, precomputed);
  state.postMatch = buildPostMatch(state, f, result, moraleBefore);
  const others = (indexes(state).byDate.get(f.date) ?? []).filter((x) => !x.played);
  for (const o of others) playFixture(state, o, 'fast', playedToday);
  for (const x of indexes(state).byDate.get(f.date) ?? []) afterFixture(state, x);
  dailyUpdate(state, playedToday);
  state.pendingUserMatchId = null;
  state.date = addDays(f.date, 1);
  return { fixture: f, result };
}

/** Consecuencias en copas y playoffs tras un partido (idempotente). */
function afterFixture(state: GameState, f: Fixture): void {
  if (!f.played || !f.result || state.processed[`after:${f.id}`]) return;
  state.processed[`after:${f.id}`] = true;
  if (f.stage === 'continental') { afterContinentalFixture(state, f); return; }
  if (f.stage === 'cup') {
    const cup = state.cups[f.competitionId];
    if (!cup) return;
    const loser = f.result.winnerId === f.homeId ? f.awayId : f.homeId;
    cup.alive = cup.alive.filter((c) => c !== loser);
    if (f.result.winnerId) cupPrize(state, f.result.winnerId, f.round);
    if (loser === state.userClubId) {
      const comp = indexes(state).comps.get(f.competitionId);
      addMessage(state, {
        type: 'competition', priority: 'normal', key: 'cupOut',
        params: { cup: comp?.name ?? '', club: clubName(state, loser), round: roundLabel(f.round).toLowerCase(), opponent: clubName(state, f.result.winnerId ?? '') },
      });
    }
    if (f.round === 'cup:final') {
      cup.championId = f.result.winnerId;
      if (f.result.winnerId) recordTrophy(state, f.competitionId, f.result.winnerId);
      const comp = indexes(state).comps.get(f.competitionId);
      news(state, 'cup', `${clubName(state, f.result.winnerId ?? '')} gana la ${comp?.name ?? 'copa'}`);
    }
  }
  if (f.stage === 'playoff') {
    const po = state.playoffs[f.competitionId];
    if (!po) return;
    if (f.round === 'po:final') {
      po.winnerId = f.result.winnerId;
    } else if (po.semis.every((id) => indexes(state).fixtures.get(id)?.played) && !po.finalId) {
      const [a, b] = po.semis.map((id) => indexes(state).fixtures.get(id)!.result!.winnerId!) as [string, string];
      const fin: Fixture = {
        id: nextId(state, 'f'), competitionId: po.competitionId, season: state.season, round: 'po:final', stage: 'playoff',
        date: addDays(f.date, 4), homeId: a, awayId: b, played: false, decideWinner: true, result: null, summary: null,
      };
      po.finalId = fin.id;
      addFixture(state, fin);
    }
  }
}

// ---------------------------------------------------------------- copas
function drawCupRoundIfDue(state: GameState, cup: CupState): boolean {
  const idx = cup.rounds.findIndex((r) => !r.drawn);
  if (idx < 0) return false;
  const round = cup.rounds[idx] as CupRoundState;
  if (state.date < round.drawDate) return false;
  const prev = idx > 0 ? cup.rounds[idx - 1] : undefined;
  const ix = indexes(state);
  if (prev && prev.ties.some((tie) => !ix.fixtures.get(tie.fixtureId)?.played)) return false;
  // Participantes: exentos + ganadores de la ronda anterior
  const winners = prev ? prev.ties.map((tie) => ix.fixtures.get(tie.fixtureId)!.result!.winnerId!) : [];
  let teams = [...round.byes, ...winners];
  if (idx === 0 && round.key === 'prelim') {
    const all = new Set(cup.alive);
    const byesNext = new Set(cup.rounds[1]?.byes ?? []);
    teams = [...all].filter((c) => !byesNext.has(c));
  }
  const rng = rngFor(state, `draw:${cup.competitionId}:${state.season}:${round.key}`);
  const order = rng.shuffle(teams);
  const date = round.date < state.date ? addDays(state.date, 3) : round.date;
  round.ties = [];
  for (let i = 0; i + 1 < order.length; i += 2) {
    let homeId = order[i] as string;
    let awayId = order[i + 1] as string;
    // En copa, el de menor categoría juega en casa (como en muchas copas reales)
    const lh = leagueOf(state, homeId)?.level ?? 1;
    const la = leagueOf(state, awayId)?.level ?? 1;
    if (la > lh) [homeId, awayId] = [awayId, homeId];
    const fx: Fixture = {
      id: nextId(state, 'f'), competitionId: cup.competitionId, season: state.season, round: `cup:${round.key}`, stage: 'cup',
      date, homeId, awayId, played: false, decideWinner: true, result: null, summary: null,
    };
    addFixture(state, fx);
    round.ties.push({ homeId, awayId, fixtureId: fx.id });
  }
  round.drawn = true;
  const mine = round.ties.find((x) => x.homeId === state.userClubId || x.awayId === state.userClubId);
  if (!mine) return false;
  const comp = ix.comps.get(cup.competitionId);
  const home = mine.homeId === state.userClubId;
  addMessage(state, {
    type: 'competition', priority: 'normal', key: 'cupDraw', sender: comp?.name ?? '',
    params: {
      cup: comp?.name ?? '', round: roundLabel(`cup:${round.key}`), club: clubName(state, state.userClubId),
      opponent: clubName(state, home ? mine.awayId : mine.homeId), venue: t(home ? 'venue.home' : 'venue.away'), date,
      pairings: round.ties.map((x) => `${clubName(state, x.homeId)} - ${clubName(state, x.awayId)}`).join('\n'),
    },
    related: { competitionId: cup.competitionId },
  });
  return true;
}

// ---------------------------------------------------------------- playoffs
function createPlayoffIfDue(state: GameState, po: PlayoffState): void {
  if (po.created) return;
  const comp = indexes(state).comps.get(po.competitionId);
  if (!comp?.promotion) return;
  const league = state.fixtures.filter((f) => f.competitionId === comp.id && f.stage === 'league' && f.season === state.season);
  if (league.length === 0 || league.some((f) => !f.played)) return;
  const table = leagueTable(state, comp.id);
  const pos = comp.promotion.playoffPositions;
  const seeds = pos.map((p) => table[p - 1]?.clubId).filter((x): x is string => !!x);
  if (seeds.length < 2) { po.created = true; return; }
  const lastDate = league.reduce((m, f) => (f.date > m ? f.date : m), '');
  const date = addDays(lastDate, 4);
  const pairs: [string, string][] = seeds.length >= 4 ? [[seeds[0]!, seeds[3]!], [seeds[1]!, seeds[2]!]] : [[seeds[0]!, seeds[1]!]];
  for (const [h, a] of pairs) {
    const f: Fixture = {
      id: nextId(state, 'f'), competitionId: comp.id, season: state.season, round: pairs.length === 1 ? 'po:final' : 'po:sf', stage: 'playoff',
      date, homeId: h, awayId: a, played: false, decideWinner: true, result: null, summary: null,
    };
    addFixture(state, f);
    if (pairs.length === 1) po.finalId = f.id;
    else po.semis.push(f.id);
  }
  po.created = true;
}

// ---------------------------------------------------------------- clasificación
export function leagueTable(state: GameState, competitionId: string, season = state.season): StandingRow[] {
  const comp = indexes(state).comps.get(competitionId);
  if (!comp) return [];
  const results = state.fixtures
    .filter((f) => f.competitionId === competitionId && f.stage === 'league' && f.season === season && f.played && f.result)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((f) => ({ homeId: f.homeId, awayId: f.awayId, homeGoals: f.result!.homeGoals, awayGoals: f.result!.awayGoals }));
  return computeStandings(comp.teamIds, results, comp.rules, `${competitionId}:${season}`);
}

// ---------------------------------------------------------------- día a día
function dailyUpdate(state: GameState, playedToday: Set<string>): void {
  growFamiliarity(state, 0.5 * (0.6 + state.training.plan.focus.tactical / 60));
  const recovery = new Map<string, number>();
  for (const p of state.world.players) {
    if (!playedToday.has(p.id)) {
      const nf = p.attributes.naturalFitness;
      const k = p.clubId ? recovery.get(p.clubId) ?? recovery.set(p.clubId, recoveryFactor(state, p.clubId)).get(p.clubId)! : 1;
      p.condition = clamp(Math.round((p.condition + (100 - p.condition) * (0.2 + nf * 0.007) * k) * 10) / 10, 0, 100);
      const last = state.lastPlayed[p.id];
      if (!last || daysBetween(last, state.date) > 6) p.matchSharpness = clamp(p.matchSharpness - 0.5, 15, 100);
    }
    if (p.injury) {
      p.injury.daysRemaining = Math.max(0, p.injury.daysRemaining - 1);
      p.condition = Math.min(p.condition, 60);
      if (p.injury.daysRemaining === 0) {
        p.injury = null;
        p.condition = 75;
        if (p.clubId === state.userClubId) {
          addMessage(state, { type: 'injury', priority: 'low', key: 'injuryReturn', sender: 'Servicios médicos', params: { player: playerName(p), condition: 75 }, related: { playerId: p.id } });
        }
      }
    }
    // Moral: vuelve poco a poco a su nivel normal
    p.morale = p.morale + (60 - p.morale) * 0.01;
  }
  internationalDay(state);
  aiClubsDay(state);
  trainingDay(state, playedToday);
  progressionDay(state);
  dressingDay(state);
  economyDay(state);
  scoutingDay(state);
  transfersDay(state);
  boardDay(state);
}

// ---------------------------------------------------------------- fin de temporada
function objectiveMet(o: BoardObjective, position: number, promoted: boolean): boolean {
  switch (o.type) {
    case 'winLeague': return position === 1;
    case 'leaguePosition': return position <= (o.target ?? 99);
    case 'avoidRelegation': return position <= (o.target ?? 17);
    case 'promotion': return promoted;
    default: return true;
  }
}

function processSeasonEnd(state: GameState): void {
  const moves: GameState['pendingMoves'] = [];
  const ix = indexes(state);
  for (const comp of state.world.competitions) {
    if (!isLeague(comp)) continue;
    const table = leagueTable(state, comp.id);
    if (table.length === 0) continue;
    const champion = table[0]!;
    recordTrophy(state, comp.id, champion.clubId);
    state.history.push({ season: state.season, competitionId: comp.id, championId: champion.clubId, table: table.map((r) => ({ clubId: r.clubId, position: r.position, points: r.points })) });
    news(state, 'champion', t('msg.champion.subject', { club: clubName(state, champion.clubId), league: comp.name }));
    if (comp.nationId === ix.clubs.get(state.userClubId)?.nationId) {
      addMessage(state, { type: 'news', priority: 'low', key: 'champion', params: { club: clubName(state, champion.clubId), league: comp.name, points: champion.points } });
    }
    const pr = comp.promotion;
    if (pr?.downCompetitionId && pr.relegated > 0) {
      for (const r of table.slice(-pr.relegated)) moves.push({ clubId: r.clubId, from: comp.id, to: pr.downCompetitionId });
    }
    if (pr?.upCompetitionId && pr.promoted > 0 && pr.randomPromotion) {
      const drawn = rngFor(state, `ascenso:${comp.id}:${state.season}`).shuffle(table).slice(0, pr.promoted);
      for (const r of drawn) moves.push({ clubId: r.clubId, from: comp.id, to: pr.upCompetitionId });
      const up = ix.comps.get(pr.upCompetitionId);
      const list = drawn.map((r) => clubName(state, r.clubId)).join(', ');
      news(state, 'promotionDraw', t('msg.promotionDraw.subject', { league: comp.name }));
      if (comp.nationId === ix.clubs.get(state.userClubId)?.nationId) {
        addMessage(state, { type: 'news', priority: drawn.some((r) => r.clubId === state.userClubId) ? 'high' : 'normal', key: 'promotionDraw', params: { league: comp.name, up: up?.name ?? '', clubs: list } });
      }
    } else if (pr?.upCompetitionId && pr.promoted > 0) {
      const po = state.playoffs[comp.id];
      const direct = po?.winnerId ? pr.promoted - 1 : pr.promoted;
      for (const r of table.slice(0, direct)) moves.push({ clubId: r.clubId, from: comp.id, to: pr.upCompetitionId });
      if (po?.winnerId) moves.push({ clubId: po.winnerId, from: comp.id, to: pr.upCompetitionId });
    }
  }
  state.pendingMoves = moves;
  seasonEndFinances(state);
  seasonAwards(state);
  // Mensaje al usuario
  const userLeague = leagueOf(state, state.userClubId);
  const club = ix.clubs.get(state.userClubId);
  if (userLeague && club) {
    const row = leagueTable(state, userLeague.id).find((r) => r.clubId === state.userClubId);
    const move = moves.find((m) => m.clubId === club.id);
    const main = club.boardObjectives.find((o) => o.competitionId === userLeague.id) ?? club.boardObjectives[0];
    const promoted = move?.to === userLeague.promotion?.upCompetitionId;
    const met = main ? objectiveMet(main, row?.position ?? 99, !!promoted) : true;
    boardSeasonEnd(state, club.boardObjectives
      .filter((o) => o.type !== 'cupRound')
      .map((o) => ({ objective: o, met: o.type === 'balanceBudget' ? seasonResult(state, club.id) >= 0 || club.finances.balance > 0 : objectiveMet(o, row?.position ?? 99, !!promoted) })));
    addMessage(state, {
      type: 'board', priority: 'high', key: 'seasonEnd', sender: `Directiva de ${club.name}`,
      params: {
        league: userLeague.name, club: club.name, position: row?.position ?? '—',
        objective: main ? t(`objective.${main.type}`, { target: main.target ?? '' }) : '—', verdict: t(met ? 'verdict.met' : 'verdict.missed'),
      },
    });
    if (move) {
      const to = ix.comps.get(move.to);
      addMessage(state, { type: 'competition', priority: 'high', key: promoted ? 'promoted' : 'relegated', params: { club: club.name, league: to?.name ?? '' } });
    }
  }
}

function rollover(state: GameState): void {
  const ix = indexes(state);
  // Ascensos y descensos (cambio de nivel: negativo = sube)
  const levelChange = new Map<string, number>();
  for (const m of state.pendingMoves) {
    const a = ix.comps.get(m.from)?.level ?? 1;
    const b = ix.comps.get(m.to)?.level ?? 1;
    levelChange.set(m.clubId, b - a);
  }
  for (const m of state.pendingMoves) {
    const from = ix.comps.get(m.from);
    const to = ix.comps.get(m.to);
    if (!from || !to) continue;
    from.teamIds = from.teamIds.filter((id) => id !== m.clubId);
    if (!to.teamIds.includes(m.clubId)) to.teamIds.push(m.clubId);
  }
  state.pendingMoves = [];
  // Estadísticas: la temporada pasa a la carrera; tarjetas a cero
  const nextYear = state.seasonYear + 1;
  const newStart = isoFromParts(nextYear, 7, 1);
  for (const p of state.world.players) {
    if (p.seasonStats.length) {
      p.careerStats.push(...p.seasonStats);
      p.seasonStats = [];
    }
    p.cards = { yellow: 0, red: 0, suspendedMatches: 0 };
    p.matchSharpness = clamp(p.matchSharpness * 0.6, 20, 100);
  }
  // Retiradas, cesiones que terminan, contratos vencidos y nueva generación de canteranos
  retirements(state, newStart);
  rolloverContracts(state, newStart, nextYear);
  youthIntake(state, newStart);
  trimAiSquads(state);
  rolloverFinances(state, levelChange);
  // Objetivos de la directiva para la nueva categoría
  for (const club of state.world.clubs) refreshObjectives(state, club);
  // Limpieza: se conserva el historial resumido, no los partidos
  const keepSeason = state.season;
  qualifyContinental(state, new Map(state.history.filter((h) => h.season === keepSeason).map((h) => [h.competitionId, h.table])));
  state.fixtures = [];
  state.cups = {};
  state.playoffs = {};
  state.userMatches = {};
  for (const k of Object.keys(state.processed)) if (k.startsWith('after:')) delete state.processed[k];
  invalidate(state);
  setupSeason(state, nextYear);
  void keepSeason;
  const club = indexes(state).clubs.get(state.userClubId);
  if (club) {
    addMessage(state, { type: 'board', priority: 'high', key: 'newSeason', sender: `Directiva de ${club.name}`, params: { season: state.season, objectives: objectivesText(state, club) } });
    seasonProgressReport(state);
  }
}

function refreshObjectives(state: GameState, club: Club): void {
  const league = leagueOf(state, club.id);
  if (!league) return;
  const ranked = league.teamIds.map((id) => indexes(state).clubs.get(id)).filter((c): c is Club => !!c).sort((a, b) => b.reputation - a.reputation);
  const rank = ranked.findIndex((c) => c.id === club.id) + 1;
  const n = ranked.length;
  const cup = state.world.competitions.find((c) => c.format === 'cup' && c.teamIds.includes(club.id));
  const objectives: BoardObjective[] = [];
  if (league.level <= 1) {
    if (rank <= 1) objectives.push({ type: 'winLeague', competitionId: league.id, target: 1, importance: 'critical' });
    else if (rank <= 5) objectives.push({ type: 'leaguePosition', competitionId: league.id, target: 4, importance: 'high' });
    else if (rank <= Math.floor(n * 0.6)) objectives.push({ type: 'leaguePosition', competitionId: league.id, target: Math.ceil(n / 2), importance: 'medium' });
    else objectives.push({ type: 'avoidRelegation', competitionId: league.id, target: n - (league.promotion?.relegated ?? 3), importance: 'high' });
  } else {
    if (rank <= 3) objectives.push({ type: 'promotion', competitionId: league.id, target: 2, importance: 'high' });
    else objectives.push({ type: 'leaguePosition', competitionId: league.id, target: Math.ceil(n * (rank <= 9 ? 0.3 : 0.75)), importance: 'medium' });
  }
  if (cup) objectives.push({ type: 'cupRound', competitionId: cup.id, target: league.level <= 1 && rank <= 3 ? 5 : 2, importance: 'low' });
  objectives.push({ type: 'balanceBudget', competitionId: null, target: null, importance: 'medium' });
  club.boardObjectives = objectives;
}

// ---------------------------------------------------------------- consultas para la interfaz
export function upcomingFixtures(state: GameState, clubId: string, limit = 5): Fixture[] {
  return state.fixtures.filter((f) => !f.played && (f.homeId === clubId || f.awayId === clubId)).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, limit);
}

export function recentFixtures(state: GameState, clubId: string, limit = 5): Fixture[] {
  return state.fixtures.filter((f) => f.played && (f.homeId === clubId || f.awayId === clubId)).sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, limit);
}

export function userAge(state: GameState, p: Player): number {
  return ageAt(p.birthDate, state.date);
}

export { inRanges };
