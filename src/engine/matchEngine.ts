/**
 * Motor de partido por fases de posesión.
 *
 * - El campo es una cuadrícula de 5 carriles × 8 franjas vista desde el equipo que ataca
 *   (franja 0 = su área, 7 = área rival; carril 0 = banda izquierda).
 * - Cada partido tiene ~150-220 fases. En cada fase un equipo tiene el balón, con un
 *   portador, una zona y una intención (pase corto, progresivo, largo, al hueco, regate,
 *   centro, tiro). Cada acción se resuelve con p = logistic(ataque − defensa) (engineConfig).
 * - Ataque/defensa son combinaciones ponderadas de atributos EFECTIVOS: condición física
 *   (fatiga), moral, forma, posición, familiaridad táctica, campo, césped, clima, gritos…
 * - Determinista con la semilla: el modo 'fast' produce exactamente el mismo resultado que
 *   'full'; solo deja de guardar la repetición acción a acción.
 * - Se puede avanzar fase a fase (MatchSimulation.step) y enviar órdenes (cambios,
 *   tácticas, ajustes, gritos) para la vista en directo de la Fase 5.
 */
import { ATTR_GROUP_OF, type AttrKey } from '../data/attributes';
import { mainPosition } from '../data/ability';
import type { Position } from '../data/positions';
import { ROLE_BY_ID, type Duty, type RoleDef } from '../data/roles';
import type { Injury, Match, MatchEvent, Player, TeamMatchStats } from '../data/schema';
import { addDays } from './date';
import { DEFAULT_ENGINE_CONFIG, logistic, mergeConfig, type EngineConfig } from './engineConfig';
import { autoLineup, autoSetPieces, positionRating, slotScore, type Lineup } from './lineup';
import { clamp, createRng, type Rng } from './rng';
import {
  NEUTRAL_MENTAL,
  SHOUT_EFFECTS,
  TWEAK_EFFECTS,
  type Mentality,
  type ShoutId,
  type TacticSlot,
  type TeamInstructions,
  type TeamMentalState,
  type TeamTactic,
  type TweakId,
} from './tactics';

// ---------------------------------------------------------------- tipos públicos
export type Weather = 'clear' | 'rain' | 'snow' | 'wind' | 'heat';

export interface MatchTeamInput {
  clubId: string;
  name: string;
  reputation: number;
  /** Jugadores disponibles (titulares + suplentes posibles). */
  squad: Player[];
  tactic: TeamTactic;
  /** Alineación explícita; si falta se elige automáticamente. */
  lineup?: Lineup;
  /** Familiaridad con la táctica 0-100. */
  familiarity?: number;
  /** Si la IA controla al equipo (cambios y ajustes). Por defecto true. */
  ai?: boolean;
}

export interface MatchContext {
  matchId: string;
  competitionId: string;
  season: string;
  round: string;
  date: string;
  /** Si hay que decidir ganador (prórroga y penaltis). */
  decideWinner?: boolean;
  neutral?: boolean;
  weather?: Weather;
  pitchCondition?: number;
  capacity?: number;
  attendance?: number;
  /** 0-1: importancia (derbi, final…). Afecta a "partidos importantes". */
  importance?: number;
  maxSubstitutions?: number;
}

export interface MatchInput {
  seed: number;
  home: MatchTeamInput;
  away: MatchTeamInput;
  context: MatchContext;
  detail?: 'full' | 'fast';
  config?: Partial<EngineConfig>;
}

export interface PlayerMatchStats {
  playerId: string;
  side: 0 | 1;
  started: boolean;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passesCompleted: number;
  keyPasses: number;
  dribbles: number;
  dribblesAttempted: number;
  crosses: number;
  crossesCompleted: number;
  tackles: number;
  tacklesAttempted: number;
  interceptions: number;
  aerialWon: number;
  aerialLost: number;
  fouls: number;
  fouled: number;
  offsides: number;
  saves: number;
  goalsConceded: number;
  yellow: number;
  red: number;
  rating: number;
  /** Condición final 0-100. */
  condition: number;
  /** Ritmo de partido tras el encuentro 0-100. */
  sharpness: number;
}

export type MatchCommand =
  | { type: 'substitution'; outId: string; inId: string }
  | { type: 'tactic'; tactic: TeamTactic }
  | { type: 'mentality'; mentality: Mentality }
  | { type: 'tweak'; tweak: TweakId; active: boolean }
  | { type: 'shout'; shout: ShoutId };

export interface ShoutOutcome {
  side: 0 | 1;
  shout: ShoutId;
  minute: number;
  /** Cambio aplicado al estado mental. */
  delta: TeamMentalState;
  verdict: 'positive' | 'neutral' | 'negative';
}

export interface ReplayAction {
  period: number;
  minute: number;
  second: number;
  side: 0 | 1;
  kind: string;
  playerId: string;
  targetId: string | null;
  /** Coordenadas 0-1 desde la perspectiva del local. */
  x: number;
  y: number;
  x2: number;
  y2: number;
  ok: boolean;
}

export interface MatchResult {
  match: Match;
  playerStats: Record<string, PlayerMatchStats>;
  injuries: { playerId: string; injury: Injury }[];
  shouts: ShoutOutcome[];
  /** Solo en modo 'full'. */
  replay: ReplayAction[];
  /** Ganador (incluye penaltis); null = empate. */
  winner: 'home' | 'away' | null;
  /** Fases jugadas (diagnóstico). */
  phases: number;
  /** Diagnóstico de calibración. */
  diagnostics: { avgDensity: number };
}

export interface LivePlayer {
  id: string;
  name: string;
  fullName: string;
  position: Position;
  role: string;
  duty: Duty;
  slot: number;
  /** Posición base en el campo (0-1, desde la perspectiva de su equipo). */
  x: number;
  y: number;
  onPitch: boolean;
  used: boolean;
  sentOff: boolean;
  injured: boolean;
  isGk: boolean;
  condition: number;
  yellow: number;
  goals: number;
  assists: number;
  rating: number | null;
  caRef: number;
}

export interface LiveTeam {
  clubId: string;
  name: string;
  goals: number;
  stats: TeamMatchStats;
  mentality: number;
  baseMentality: number;
  instructions: TeamInstructions;
  tweaks: TweakId[];
  mental: TeamMentalState;
  subsUsed: number;
  subWindowsUsed: number;
  ai: boolean;
  players: LivePlayer[];
  onCount: number;
  avgCondition: number;
}

export interface LiveSnapshot {
  minute: number;
  second: number;
  stoppage: number;
  period: number;
  finished: boolean;
  maxSubstitutions: number;
  teams: [LiveTeam, LiveTeam];
  penalties: { home: number; away: number } | null;
}

// ---------------------------------------------------------------- calidades (atributos ponderados)
type Q = readonly (readonly [AttrKey, number])[];
const norm = (q: [AttrKey, number][]): Q => {
  const s = q.reduce((a, [, w]) => a + w, 0);
  return q.map(([a, w]) => [a, w / s] as const);
};
const Q_SHORT = norm([['passing', 3], ['firstTouch', 1], ['technique', 1], ['decisions', 1.5], ['composure', 1], ['teamwork', 0.5]]);
const Q_FWD = norm([['passing', 3], ['vision', 1.5], ['technique', 1], ['decisions', 1], ['composure', 0.5]]);
const Q_LONG = norm([['passing', 3], ['vision', 1.5], ['technique', 1.5]]);
const Q_THROUGH = norm([['vision', 3], ['passing', 2.5], ['technique', 1], ['decisions', 1]]);
const Q_RECEIVE = norm([['firstTouch', 2], ['offTheBall', 1], ['anticipation', 1], ['technique', 1], ['acceleration', 0.5]]);
const Q_RUN = norm([['offTheBall', 2.5], ['pace', 1.5], ['acceleration', 1.5], ['anticipation', 1], ['firstTouch', 1]]);
const Q_DRIBBLE = norm([['dribbling', 3], ['agility', 1.5], ['acceleration', 1], ['balance', 1], ['technique', 1], ['flair', 1], ['pace', 0.5]]);
const Q_CROSS = norm([['crossing', 3], ['technique', 1], ['vision', 0.5], ['decisions', 0.5]]);
const Q_CORNER = norm([['corners', 3], ['crossing', 1], ['technique', 1]]);
const Q_AERIAL_ATT = norm([['heading', 2.5], ['jumping', 2], ['strength', 1], ['bravery', 1], ['offTheBall', 1]]);
const Q_AERIAL_DEF = norm([['heading', 2], ['jumping', 2], ['strength', 1], ['positioning', 1.5], ['bravery', 1], ['marking', 1]]);
const Q_INTERCEPT = norm([['anticipation', 2.5], ['positioning', 2], ['concentration', 1], ['marking', 1], ['decisions', 1], ['pace', 0.5], ['workRate', 0.5]]);
const Q_TACKLE = norm([['tackling', 3], ['marking', 1.5], ['positioning', 1], ['strength', 1], ['pace', 1], ['aggression', 0.5], ['bravery', 0.5]]);
const Q_CROSS_DEF = norm([['marking', 2], ['positioning', 2], ['tackling', 1], ['pace', 1], ['concentration', 1]]);
const Q_FINISH = norm([['finishing', 3], ['composure', 2], ['technique', 1], ['decisions', 0.5]]);
const Q_LONGSHOT = norm([['longShots', 3], ['technique', 1.5], ['composure', 1]]);
const Q_HEADER = norm([['heading', 3], ['jumping', 1], ['composure', 0.5]]);
const Q_FREEKICK = norm([['freeKicks', 3], ['technique', 1], ['composure', 0.5]]);
const Q_PENALTY = norm([['penalties', 3], ['composure', 2]]);
const Q_GK = norm([['reflexes', 3], ['handling', 1.5], ['positioning', 1.5], ['agility', 1], ['concentration', 0.5]]);
const Q_GK_1V1 = norm([['oneOnOnes', 3], ['reflexes', 1.5], ['positioning', 1], ['composure', 1]]);
const Q_GK_CROSS = norm([['aerialReach', 2.5], ['communication', 1.5], ['handling', 1], ['jumping', 0.5]]);
const Q_BLOCK = norm([['positioning', 2], ['bravery', 2], ['anticipation', 1], ['concentration', 1]]);

const INJURY_TYPES = ['hamstring', 'ankleSprain', 'knee', 'groin', 'calf', 'thigh', 'concussion', 'shoulder', 'foot', 'back'] as const;

// ---------------------------------------------------------------- estado interno
interface RP {
  p: Player;
  side: 0 | 1;
  team: TS;
  slot: number;
  startSlot: number;
  pos: Position;
  role: RoleDef;
  duty: Duty;
  x: number;
  y: number;
  individual: TacticSlot['individual'];
  cond: number;
  startCond: number;
  fatPhys: number;
  /** Caché por fase/decisión (rendimiento): posiciones, participación y multiplicadores efectivos. */
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  attInv: number;
  defInv: number;
  mPhys: number;
  mTech: number;
  mMent: number;
  mOther: number;
  fatOther: number;
  mod: number;
  dayForm: number;
  onPitch: boolean;
  used: boolean;
  sentOff: boolean;
  injured: boolean;
  minuteOn: number;
  minuteOff: number | null;
  st: PlayerMatchStats;
  ratingAdj: number;
  isGkNow: boolean;
}

interface TS {
  side: 0 | 1;
  input: MatchTeamInput;
  tactic: TeamTactic;
  tweaks: Set<TweakId>;
  aiAdj: { mentality: number; defensiveLine: number; pressIntensity: number; tempo: number };
  inst: TeamInstructions;
  mentality: number;
  mental: TeamMentalState;
  players: RP[];
  byId: Map<string, RP>;
  bench: RP[];
  subsUsed: number;
  subWindows: Set<number>;
  goals: number;
  homeFactor: number;
  techMod: number;
  mentMod: number;
  compMod: number;
  actions: number;
  stats: TeamMatchStats;
  familiarity: number;
  ai: boolean;
  pending: MatchCommand[];
  takers: TeamTactic['setPieces'];
  pens: number;
  /** Caché: jugadores en el campo y frescura media (para presión). */
  onCount: number;
  freshness: number;
}

interface PhaseStart {
  side: 0 | 1;
  band: number;
  lane: number;
  carrier: RP | null;
  counter: boolean;
  counterPressed: boolean;
  /** Peligro extra de la contra: mentalidad ofensiva del que perdió el balón. */
  exposure?: number;
}

interface Period {
  period: number;
  start: number;
  length: number;
  phases: number;
  stoppage: number;
}

const emptyTeamStats = (): TeamMatchStats => ({
  goals: 0, shots: 0, shotsOnTarget: 0, xg: 0, possession: 50, passes: 0, passesCompleted: 0, fouls: 0,
  corners: 0, offsides: 0, yellow: 0, red: 0, tackles: 0, interceptions: 0,
});

const emptyPlayerStats = (id: string, side: 0 | 1, started: boolean): PlayerMatchStats => ({
  playerId: id, side, started, minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, passes: 0,
  passesCompleted: 0, keyPasses: 0, dribbles: 0, dribblesAttempted: 0, crosses: 0, crossesCompleted: 0, tackles: 0,
  tacklesAttempted: 0, interceptions: 0, aerialWon: 0, aerialLost: 0, fouls: 0, fouled: 0, offsides: 0, saves: 0,
  goalsConceded: 0, yellow: 0, red: 0, rating: 6, condition: 100, sharpness: 0,
});

/** Tablas de fatiga por condición (0,0-100,0 en pasos de 0,1). */
const FAT_PHYS = Array.from({ length: 1001 }, (_, i) => 1 - 0.6 * Math.pow(1 - i / 1000, 1.1));
const FAT_OTHER = Array.from({ length: 1001 }, (_, i) => 1 - 0.22 * Math.pow(1 - i / 1000, 1.2));
const GROUP_CODE = Object.fromEntries(
  Object.entries(ATTR_GROUP_OF).map(([a, g]) => [a, g === 'physical' ? 0 : g === 'technical' ? 1 : g === 'mental' ? 2 : 3]),
) as Record<AttrKey, 0 | 1 | 2 | 3>;

const LEFT_WIDE = new Set<Position>(['LW', 'LM']);
const RIGHT_WIDE = new Set<Position>(['RW', 'RM']);
const WIDE_DRAIN = new Set<Position>(['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW']);

// ---------------------------------------------------------------- simulación
export class MatchSimulation {
  readonly cfg: EngineConfig;
  private rng: Rng;
  private teams: [TS, TS];
  private periods: Period[] = [];
  private periodIdx = 0;
  private phaseInPeriod = 0;
  private totalPhases = 0;
  private next: PhaseStart;
  private events: MatchEvent[] = [];
  private replay: ReplayAction[] = [];
  private injuries: { playerId: string; injury: Injury }[] = [];
  private shoutLog: ShoutOutcome[] = [];
  private full: boolean;
  private finished = false;
  private lastDecisionMinute = -1;
  private curMinute = 0;
  private curSecond = 0;
  private curStoppage = 0;
  private attendance: number;
  private penalties: { home: number; away: number } | null = null;
  private wentToExtraTime = false;
  private techWeather: number;
  private physWeather: number;
  private drainWeather: number;
  private aerialWeather: number;

  constructor(readonly input: MatchInput) {
    this.cfg = mergeConfig(input.config);
    this.rng = createRng(input.seed);
    this.full = (input.detail ?? 'full') === 'full';
    const ctx = input.context;
    const capacity = ctx.capacity ?? 30000;
    const demand = clamp(0.45 + input.home.reputation / 20000 + (ctx.importance ?? 0) * 0.15 + this.rng.float(-0.05, 0.1), 0.15, 1);
    this.attendance = ctx.attendance ?? Math.round(capacity * demand);
    const weather = ctx.weather ?? 'clear';
    this.techWeather = weather === 'rain' ? 0.97 : weather === 'snow' ? 0.94 : 1;
    this.physWeather = weather === 'snow' ? 0.96 : weather === 'heat' ? 0.98 : 1;
    this.drainWeather = weather === 'heat' ? 1.2 : weather === 'snow' ? 1.08 : 1;
    this.aerialWeather = weather === 'wind' ? -0.25 : 0;
    const pitchF = 1 - (1 - (ctx.pitchCondition ?? 90) / 100) * 0.12;

    this.teams = [this.buildTeam(0, input.home), this.buildTeam(1, input.away)];
    const crowd = ctx.neutral ? 0 : 0.55 + 0.45 * Math.min(1, this.attendance / 40000);
    this.teams[0].homeFactor = 1 + this.cfg.homeAdvantage * crowd;
    this.teams[1].homeFactor = 1;
    for (const t of this.teams) {
      t.techMod = pitchF * this.techWeather;
      this.refreshTeam(t);
    }

    const tempo = (this.teams[0].inst.tempo + this.teams[1].inst.tempo) / 2;
    const n = clamp(Math.round(this.cfg.phasesBase * (1 + (tempo - 3) * 0.05) + this.rng.normal(0, 7)), 150, 225);
    const half = Math.round(n / 2);
    const perMin = n / 90;
    const st1 = this.rng.int(1, 4);
    const st2 = this.rng.int(2, 6);
    this.periods.push({ period: 1, start: 0, length: 45, phases: half, stoppage: st1 });
    this.periods.push({ period: 2, start: 45, length: 45, phases: n - half, stoppage: st2 });
    void perMin;
    this.next = { side: this.rng.chance(0.5) ? 0 : 1, band: 3, lane: 2, carrier: null, counter: false, counterPressed: false };
    this.event('kickOff', this.next.side, null, null, 3, 2);
  }

  // ------------------------------------------------ preparación
  private buildTeam(side: 0 | 1, input: MatchTeamInput): TS {
    const tactic: TeamTactic = structuredClone(input.tactic);
    const lineup = input.lineup ?? autoLineup(input.squad, tactic, 9);
    const t: TS = {
      side, input, tactic, tweaks: new Set(), aiAdj: { mentality: 0, defensiveLine: 0, pressIntensity: 0, tempo: 0 },
      inst: { ...tactic.instructions }, mentality: tactic.mentality, mental: { ...NEUTRAL_MENTAL }, players: [],
      byId: new Map(), bench: [], subsUsed: 0, subWindows: new Set(), goals: 0, homeFactor: 1, techMod: 1, mentMod: 1,
      compMod: 1, actions: 0, stats: emptyTeamStats(), familiarity: input.familiarity ?? 70, ai: input.ai ?? true, pending: [],
      takers: tactic.setPieces, pens: 0, onCount: 11, freshness: 1,
    };
    const byId = new Map(input.squad.map((p) => [p.id, p]));
    const mk = (p: Player, slot: number, started: boolean): RP => {
      const s = tactic.slots[slot];
      const consistencySd = ((21 - p.attributes.consistency) / 20) * 0.045;
      const importance = this.input.context.importance ?? 0;
      const rp: RP = {
        p, side, team: t, slot, startSlot: slot, pos: s?.position ?? mainPosition(p.positions), role: ROLE_BY_ID.get(s?.role ?? '') ?? (ROLE_BY_ID.get('centralMidfielder') as RoleDef),
        duty: s?.duty ?? 'support', x: s?.x ?? 0.5, y: s?.y ?? 0.5, individual: s?.individual ?? {},
        cond: p.condition, startCond: p.condition, fatPhys: 1, fatOther: 1, mod: 1,
        ax: 0, ay: 0, dx: 0, dy: 0, attInv: 1, defInv: 1, mPhys: 1, mTech: 1, mMent: 1, mOther: 1,
        dayForm: 1 + this.rng.normal(0, consistencySd) + importance * (p.attributes.importantMatches - 10) * 0.004,
        onPitch: started, used: started, sentOff: false, injured: false, minuteOn: 0, minuteOff: null,
        st: emptyPlayerStats(p.id, side, started), ratingAdj: 0, isGkNow: s?.position === 'GK',
      };
      this.updateFatigue(rp);
      return rp;
    };
    lineup.starting.forEach((id, i) => {
      const p = byId.get(id);
      if (p) {
        const rp = mk(p, i, true);
        t.players.push(rp);
        t.byId.set(id, rp);
      }
    });
    for (const id of lineup.bench) {
      const p = byId.get(id);
      if (!p || t.byId.has(id)) continue;
      const rp = mk(p, -1, false);
      t.players.push(rp);
      t.bench.push(rp);
      t.byId.set(id, rp);
    }
    const starters = t.players.filter((r) => r.onPitch).map((r) => r.p);
    const auto = autoSetPieces(starters);
    t.takers = {
      corners: tactic.setPieces.corners ?? auto.corners,
      freeKicks: tactic.setPieces.freeKicks ?? auto.freeKicks,
      penalties: tactic.setPieces.penalties ?? auto.penalties,
      throwIns: tactic.setPieces.throwIns ?? auto.throwIns,
      captain: tactic.setPieces.captain ?? auto.captain,
    };
    return t;
  }

  /** Recalcula instrucciones efectivas y modificadores (en cada punto de decisión). */
  private refreshTeam(t: TS): void {
    const base = t.tactic.instructions;
    const sum: Record<string, number> = { mentality: t.aiAdj.mentality, defensiveLine: t.aiAdj.defensiveLine, pressIntensity: t.aiAdj.pressIntensity, tempo: t.aiAdj.tempo };
    for (const tw of t.tweaks) for (const [k, v] of Object.entries(TWEAK_EFFECTS[tw])) sum[k] = (sum[k] ?? 0) + (v ?? 0);
    const num = (k: keyof TeamInstructions) => clamp((base[k] as number) + (sum[k] ?? 0), 1, 5);
    t.inst = {
      ...base,
      defensiveLine: num('defensiveLine'), pressLine: num('pressLine'), pressIntensity: num('pressIntensity'),
      tempo: num('tempo'), width: num('width'), passingStyle: num('passingStyle'),
    };
    t.mentality = clamp(t.tactic.mentality + (sum.mentality ?? 0), 1, 7);
    t.onCount = t.players.reduce((n, r) => n + (r.onPitch ? 1 : 0), 0);
    // La mentalidad también mueve el bloque: más defensiva = línea y presión más bajas.
    const md = t.mentality - 4;
    t.inst.defensiveLine = clamp(t.inst.defensiveLine + md * 0.4, 1, 5);
    t.inst.pressLine = clamp(t.inst.pressLine + md * 0.4, 1, 5);
    const m = t.mental;
    t.techMod = (1 - (1 - (this.input.context.pitchCondition ?? 90) / 100) * 0.12) * this.techWeather * (1 + 0.04 * m.confidence);
    t.mentMod = 1 + 0.03 * m.concentration;
    t.compMod = 1 - 0.06 * m.tension + 0.02 * m.confidence;
    const famF = 0.93 + 0.07 * (t.familiarity / 100);
    for (const rp of t.players) {
      const posF = rp.isGkNow ? (rp.pos === 'GK' && positionRating(rp.p, 'GK') >= 10 ? 1 : 0.6) : 0.72 + 0.28 * (positionRating(rp.p, rp.pos) / 20);
      const morale = 0.96 + 0.08 * (rp.p.morale / 100);
      const form = rp.p.form.length ? 1 + ((rp.p.form.reduce((a, b) => a + b, 0) / rp.p.form.length) - 6.8) * 0.012 : 1;
      const sharp = 1 - this.cfg.sharpness.attr * Math.pow(1 - rp.p.matchSharpness / 100, 1.3);
      rp.mod = posF * morale * form * famF * t.homeFactor * rp.dayForm * sharp;
      this.updateMods(rp);
      this.cachePositions(rp);
    }
  }

  private updateFatigue(rp: RP): void {
    const i = clamp(Math.round(rp.cond * 10), 0, 1000);
    rp.fatPhys = (FAT_PHYS[i] as number) * this.physWeather;
    rp.fatOther = FAT_OTHER[i] as number;
    this.updateMods(rp);
  }

  private updateMods(rp: RP): void {
    const t = rp.team;
    rp.mPhys = rp.mod * rp.fatPhys;
    rp.mOther = rp.mod * rp.fatOther;
    rp.mTech = rp.mOther * t.techMod;
    rp.mMent = rp.mOther * t.mentMod;
  }

  /** Atributo efectivo. */
  private eff(rp: RP, a: AttrKey): number {
    const g = GROUP_CODE[a];
    const m = g === 0 ? rp.mPhys : g === 1 ? rp.mTech : g === 2 ? (a === 'composure' ? rp.mMent * rp.team.compMod : rp.mMent) : rp.mOther;
    return rp.p.attributes[a] * m;
  }

  /** Posiciones con y sin balón y participación base (cambian solo en puntos de decisión). */
  private cachePositions(rp: RP): void {
    const [ax, ay] = this.attackPos(rp);
    const [dx, dy] = this.defendPos(rp);
    rp.ax = ax; rp.ay = ay; rp.dx = dx; rp.dy = dy;
    const beh = rp.role.behaviour;
    rp.attInv = (rp.duty === 'attack' ? 1.25 : rp.duty === 'defend' ? 0.75 : 1) * (0.8 + 0.2 * beh.forwardRuns);
    rp.defInv = (rp.duty === 'defend' ? 1.3 : rp.duty === 'attack' ? 0.75 : 1) * (0.75 + 0.25 * beh.press) * (0.8 + this.eff(rp, 'workRate') / 50);
  }

  private q(rp: RP, q: Q): number {
    let s = 0;
    for (const [a, w] of q) s += w * this.eff(rp, a);
    return s;
  }

  // ------------------------------------------------ utilidades de zona
  private onPitch(t: TS): RP[] {
    return t.players.filter((r) => r.onPitch);
  }

  private gk(t: TS): RP | null {
    const on = this.onPitch(t);
    return on.find((r) => r.isGkNow) ?? null;
  }

  private attackPos(rp: RP): [number, number] {
    let y = rp.y;
    if (rp.team.tweaks.has('wingersSwitchFlanks') && (LEFT_WIDE.has(rp.pos) || RIGHT_WIDE.has(rp.pos))) y = 1 - y;
    const runs = rp.individual.attackDefensiveLine ? 0.06 : rp.individual.arriveLate ? -0.04 : 0;
    const x = rp.x + (rp.role.behaviour.forwardRuns - 1) * 0.08 + (rp.team.mentality - 4) * 0.03 + 0.08 + runs;
    return [clamp(x, 0, 1), y];
  }

  private defendPos(rp: RP): [number, number] {
    const t = rp.team;
    const shift = (t.inst.defensiveLine - 3) * 0.05 + (rp.pos === 'ST' || rp.pos === 'AM' ? (t.inst.pressLine - 3) * 0.04 : 0) - 0.05
      + (t.mentality - 4) * 0.04;
    return [1 - clamp(rp.x + shift, 0, 1), 1 - rp.y];
  }

  private readonly candBuf: RP[] = new Array(16);
  private readonly wBuf: number[] = new Array(16);

  private pickByZone(t: TS, attacking: boolean, band: number, lane: number, opts: { exclude?: RP | null; allowGk?: boolean; sigma?: number; extra?: (r: RP) => number } = {}): RP | null {
    const tx = (band + 0.5) / 8;
    const ty = (lane + 0.5) / 5;
    const sigma = opts.sigma ?? 0.2;
    const cands = this.candBuf;
    const ws = this.wBuf;
    let n = 0;
    let total = 0;
    for (const r of t.players) {
      if (!r.onPitch || r === opts.exclude) continue;
      if (r.isGkNow && !opts.allowGk) continue;
      const x = attacking ? r.ax : r.dx;
      const y = attacking ? r.ay : r.dy;
      const d = (x - tx) ** 2 + ((y - ty) * 0.8) ** 2;
      const sg = sigma * (0.85 + 0.15 * r.role.behaviour.roam);
      let w = (Math.exp(-d / (2 * sg * sg)) + 0.002) * (r.isGkNow ? 1 : this.involvement(r, attacking));
      if (opts.extra) w *= opts.extra(r);
      if (w < 0) w = 0;
      cands[n] = r;
      ws[n] = w;
      total += w;
      n++;
    }
    if (n === 0) return null;
    let x = this.rng.next() * total;
    for (let i = 0; i < n; i++) {
      x -= ws[i] as number;
      if (x < 0) return cands[i] as RP;
    }
    return cands[n - 1] as RP;
  }

  /**
   * Participación según rol, deber y estado: un mediocentro defensivo con deber de
   * defensa entra en más acciones defensivas que un mediapunta; un jugador agotado
   * llega a menos balones.
   */
  private involvement(r: RP, attacking: boolean): number {
    return attacking ? r.attInv * (0.75 + 0.25 * r.fatPhys) : r.defInv * (0.7 + 0.3 * r.fatPhys);
  }

  private densSum = 0;
  private densN = 0;

  /** Densidad de defensores (sin portero) alrededor de una zona, en coordenadas del atacante. */
  private density(def: TS, band: number, lane: number): number {
    const tx = (band + 0.5) / 8;
    const ty = (lane + 0.5) / 5;
    const s2 = 2 * this.cfg.compactness.sigma ** 2;
    let dsum = 0;
    for (const r of def.players) {
      if (!r.onPitch || r.isGkNow) continue;
      const x = r.dx;
      const y = r.dy;
      dsum += Math.exp(-((x - tx) ** 2 + ((y - ty) * 0.8) ** 2) / s2) * (0.7 + 0.3 * r.fatPhys);
    }
    return dsum;
  }

  private densityTerm(def: TS, band: number, lane: number): number {
    const d = this.density(def, band, lane);
    this.densSum += d;
    this.densN++;
    return clamp((d - this.cfg.compactness.ref) * this.cfg.compactness.weight, -1.6, 1.6);
  }

  /** Tensión del momento para el equipo que defiende (0 = tranquilo, ~1,7 = máxima). */
  private tense(t: TS): number {
    const opp = this.teams[t.side === 0 ? 1 : 0];
    const diff = t.goals - opp.goals;
    const m = this.curMinute;
    let x = 0;
    if (m >= 70 && Math.abs(diff) <= 1) x += 0.5 + (m >= 85 ? 0.4 : 0) + (diff === 1 ? 0.3 : 0);
    x += (this.input.context.importance ?? 0) * 0.5 + Math.max(0, t.mental.tension) * 0.5;
    return x;
  }

  /** Carácter caliente: agresividad alta y temperamento bajo (-0,3 … 1,3). */
  private hotHead(r: RP): number {
    const a = r.p.attributes;
    return clamp((a.aggression - 10) * 0.06 + (10 - a.temperament) * 0.08, -0.3, 1.3);
  }

  private toXY(side: 0 | 1, band: number, lane: number): [number, number] {
    const x = (band + 0.5) / 8;
    const y = (lane + 0.5) / 5;
    return side === 0 ? [x, y] : [1 - x, 1 - y];
  }

  private event(type: MatchEvent['type'], side: 0 | 1 | null, rp: RP | null, other: RP | null, band: number | null, lane: number | null, extra: Partial<MatchEvent> = {}): void {
    let x: number | null = null;
    let y: number | null = null;
    if (band !== null && lane !== null && side !== null) [x, y] = this.toXY(side, band, lane);
    const period = this.periods[this.periodIdx]?.period ?? 1;
    this.events.push({
      minute: this.curMinute, second: this.curSecond, period, stoppage: this.curStoppage, type,
      teamId: side === null ? null : this.teams[side].input.clubId, playerId: rp?.p.id ?? null, otherPlayerId: other?.p.id ?? null,
      x, y, lane, band, xg: null, detail: null, ...extra,
    });
  }

  private rec(side: 0 | 1, kind: string, rp: RP, target: RP | null, b: number, l: number, b2: number, l2: number, ok: boolean): void {
    if (!this.full) return;
    const [x, y] = this.toXY(side, b, l);
    const [x2, y2] = this.toXY(side, b2, l2);
    const period = this.periods[this.periodIdx]?.period ?? 1;
    this.replay.push({ period, minute: this.curMinute, second: this.curSecond, side, kind, playerId: rp.p.id, targetId: target?.p.id ?? null, x, y, x2, y2, ok });
  }

  // ------------------------------------------------ API pública
  get minute(): number {
    return this.curMinute;
  }

  get score(): [number, number] {
    return [this.teams[0].goals, this.teams[1].goals];
  }

  isFinished(): boolean {
    return this.finished;
  }

  /** Encola una orden; se aplica antes de la siguiente fase. */
  command(side: 0 | 1, cmd: MatchCommand): void {
    this.teams[side].pending.push(cmd);
  }

  setAi(side: 0 | 1, ai: boolean): void {
    this.teams[side].ai = ai;
  }

  // ------------------------------------------------ estado en directo (vista del partido)
  get eventCount(): number {
    return this.events.length;
  }

  eventsFrom(index: number): MatchEvent[] {
    return this.events.slice(index);
  }

  get replayCount(): number {
    return this.replay.length;
  }

  replayFrom(index: number): ReplayAction[] {
    return this.replay.slice(index);
  }

  shoutsFrom(index: number): ShoutOutcome[] {
    return this.shoutLog.slice(index);
  }

  /** Foto del partido en este momento (serializable). */
  live(): LiveSnapshot {
    const per = this.periods[this.periodIdx];
    const totalActions = this.teams[0].actions + this.teams[1].actions || 1;
    const teams = this.teams.map((t) => {
      const opp = this.teams[t.side === 0 ? 1 : 0];
      const result = Math.sign(t.goals - opp.goals);
      const players = t.players.map((r) => ({
        id: r.p.id,
        name: r.p.commonName ?? r.p.lastName,
        fullName: r.p.commonName ?? `${r.p.firstName} ${r.p.lastName}`,
        position: r.pos,
        role: r.role.id,
        duty: r.duty,
        slot: r.slot,
        x: r.x,
        y: r.y,
        onPitch: r.onPitch,
        used: r.used,
        sentOff: r.sentOff,
        injured: r.injured,
        isGk: r.isGkNow,
        condition: Math.round(r.cond),
        yellow: r.st.yellow,
        goals: r.st.goals,
        assists: r.st.assists,
        rating: r.used ? this.rating(r, result, opp.goals) : null,
        caRef: r.p.ca,
      }));
      return {
        clubId: t.input.clubId,
        name: t.input.name,
        goals: t.goals,
        stats: { ...t.stats, xg: round3(t.stats.xg), possession: Math.round((t.actions / totalActions) * 100) },
        mentality: t.mentality,
        baseMentality: t.tactic.mentality,
        instructions: { ...t.inst },
        tweaks: [...t.tweaks],
        mental: { ...t.mental },
        subsUsed: t.subsUsed,
        subWindowsUsed: t.subWindows.size,
        ai: t.ai,
        players,
        onCount: t.players.filter((r) => r.onPitch).length,
        avgCondition: Math.round(t.players.filter((r) => r.onPitch && !r.isGkNow).reduce((a, r, _, arr) => a + r.cond / arr.length, 0)),
      };
    }) as [LiveTeam, LiveTeam];
    return {
      minute: this.curMinute,
      second: this.curSecond,
      stoppage: this.curStoppage,
      period: per?.period ?? 2,
      finished: this.finished,
      maxSubstitutions: this.input.context.maxSubstitutions ?? 5,
      teams,
      penalties: this.penalties,
    };
  }

  /** Simula una fase. Devuelve false si el partido ha terminado. */
  step(): boolean {
    if (this.finished) return false;
    const per = this.periods[this.periodIdx];
    if (!per) {
      this.finish();
      return false;
    }
    const perMin = per.phases / per.length;
    const total = per.phases + Math.round(per.stoppage * perMin);
    if (this.phaseInPeriod >= total) {
      this.endPeriod(per);
      return !this.finished;
    }
    // Tiempo
    if (this.phaseInPeriod < per.phases) {
      const m = per.start + (this.phaseInPeriod / per.phases) * per.length;
      // Minuto «de fútbol»: el primero es el 1'
      this.curMinute = Math.floor(m) + 1;
      this.curSecond = Math.floor((m - Math.floor(m)) * 60);
      this.curStoppage = 0;
    } else {
      const extra = (this.phaseInPeriod - per.phases) / perMin;
      this.curMinute = per.start + per.length;
      this.curStoppage = Math.floor(extra) + 1;
      this.curSecond = Math.floor((extra - Math.floor(extra)) * 60);
      if (this.phaseInPeriod === per.phases) this.event('addedTime', null, null, null, null, null, { detail: String(per.stoppage) });
    }
    const absMinute = this.curMinute + this.curStoppage;
    if (absMinute >= this.lastDecisionMinute + 5 || this.teams.some((t) => t.pending.length > 0)) {
      if (absMinute >= this.lastDecisionMinute + 5) this.lastDecisionMinute = absMinute - (absMinute % 5);
      this.decisionPoint();
    }
    this.playPhase();
    this.drain();
    this.phaseInPeriod++;
    this.totalPhases++;
    return true;
  }

  runToMinute(minute: number): void {
    while (!this.finished && this.curMinute + this.curStoppage < minute) this.step();
  }

  run(): MatchResult {
    while (this.step()) { /* simular */ }
    return this.result();
  }

  // ------------------------------------------------ periodos
  private endPeriod(per: Period): void {
    if (per.period === 1 || per.period === 3) {
      this.event('halfTime', null, null, null, null, null, { detail: String(per.period) });
      for (const t of this.teams) for (const r of t.players) {
        if (r.onPitch) { r.cond = Math.min(r.startCond, r.cond + 4 + r.p.attributes.naturalFitness * 0.15); this.updateFatigue(r); }
      }
      this.periodIdx++;
      this.phaseInPeriod = 0;
      const kickoffSide: 0 | 1 = per.period === 1 ? (this.events.find((e) => e.type === 'kickOff')?.teamId === this.teams[0].input.clubId ? 1 : 0) : 0;
      this.next = { side: kickoffSide, band: 3, lane: 2, carrier: null, counter: false, counterPressed: false };
      return;
    }
    if (per.period === 2 && this.input.context.decideWinner && this.teams[0].goals === this.teams[1].goals) {
      this.wentToExtraTime = true;
      const n = Math.round((this.periods[0]?.phases ?? 93) / 3);
      this.periods.push({ period: 3, start: 90, length: 15, phases: n, stoppage: this.rng.int(0, 2) });
      this.periods.push({ period: 4, start: 105, length: 15, phases: n, stoppage: this.rng.int(1, 3) });
      this.event('extraTimeStart', null, null, null, null, null);
      this.periodIdx++;
      this.phaseInPeriod = 0;
      this.next = { side: 0, band: 3, lane: 2, carrier: null, counter: false, counterPressed: false };
      return;
    }
    if (per.period === 4 && this.teams[0].goals === this.teams[1].goals) this.shootout();
    this.finish();
  }

  private shootout(): void {
    this.event('penaltyShootout', null, null, null, null, null);
    const order = (t: TS) => this.onPitch(t).slice().sort((a, b) => this.q(b, Q_PENALTY) - this.q(a, Q_PENALTY));
    const lists = [order(this.teams[0]), order(this.teams[1])];
    const score = [0, 0];
    const kick = (side: 0 | 1, idx: number) => {
      const t = this.teams[side];
      const list = lists[side] as RP[];
      const taker = list[idx % list.length] as RP;
      const gk = this.gk(this.teams[side === 0 ? 1 : 0]);
      const gq = gk ? this.q(gk, Q_GK) : 4;
      const p = clamp(0.75 * Math.exp((this.q(taker, Q_PENALTY) - 10) * 0.035) * Math.exp((10 - gq) * 0.02) * (1 - t.mental.tension * 0.05), 0.4, 0.95);
      const scored = this.rng.chance(p);
      if (scored) score[side]!++;
      this.event(scored ? 'goal' : 'penaltyMissed', side, taker, gk, 7, 2, { detail: 'shootout' });
    };
    for (let i = 0; i < 5; i++) {
      kick(0, i);
      if (score[0]! > score[1]! + (5 - i)) break;
      kick(1, i);
      if (score[1]! > score[0]! + (4 - i) || score[0]! > score[1]! + (4 - i)) break;
    }
    let i = 5;
    while (score[0] === score[1] && i < 40) {
      kick(0, i);
      kick(1, i);
      i++;
    }
    this.penalties = { home: score[0] as number, away: score[1] as number };
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.event('fullTime', null, null, null, null, null);
  }

  // ------------------------------------------------ decisiones (IA y órdenes)
  private decisionPoint(): void {
    const minute = this.curMinute + this.curStoppage;
    for (const t of this.teams) {
      // Decaimiento del estado mental
      for (const k of ['confidence', 'concentration', 'aggression', 'tension'] as const) t.mental[k] *= 0.85;
      for (const cmd of t.pending.splice(0)) this.applyCommand(t, cmd);
      if (t.ai) this.aiDecide(t, minute);
      this.refreshTeam(t);
    }
  }

  private applyCommand(t: TS, cmd: MatchCommand): void {
    switch (cmd.type) {
      case 'substitution': {
        const out = t.byId.get(cmd.outId);
        const inn = t.byId.get(cmd.inId);
        if (out && inn) this.substitute(t, out, inn);
        break;
      }
      case 'tactic': {
        const keep = t.tactic.slots;
        t.tactic = structuredClone(cmd.tactic);
        // reasignar slots a quienes están en el campo, por orden
        const on = this.onPitch(t).sort((a, b) => a.slot - b.slot);
        on.forEach((rp, i) => {
          const s = t.tactic.slots[i] ?? keep[i];
          if (!s) return;
          rp.slot = i; rp.pos = s.position; rp.x = s.x; rp.y = s.y; rp.duty = s.duty; rp.individual = s.individual;
          rp.role = ROLE_BY_ID.get(s.role) ?? rp.role;
          rp.isGkNow = s.position === 'GK';
        });
        this.event('tacticChange', t.side, null, null, null, null, { detail: `formation:${t.tactic.formation}` });
        break;
      }
      case 'mentality':
        t.tactic.mentality = cmd.mentality;
        this.event('tacticChange', t.side, null, null, null, null, { detail: `mentality:${cmd.mentality}` });
        break;
      case 'tweak':
        if (cmd.active) t.tweaks.add(cmd.tweak);
        else t.tweaks.delete(cmd.tweak);
        this.event('tacticChange', t.side, null, null, null, null, { detail: `tweak:${cmd.tweak}:${cmd.active ? 'on' : 'off'}` });
        break;
      case 'shout':
        this.applyShout(t, cmd.shout);
        break;
    }
  }

  /** Grito: el efecto depende de la personalidad del equipo y del marcador. */
  private applyShout(t: TS, shout: ShoutId): ShoutOutcome {
    const on = this.onPitch(t);
    const avg = (a: AttrKey) => on.reduce((s, r) => s + r.p.attributes[a], 0) / Math.max(1, on.length);
    const det = avg('determination');
    const tem = avg('temperament');
    const pro = avg('professionalism');
    const diff = t.goals - this.teams[t.side === 0 ? 1 : 0].goals;
    const responsiveness = clamp(0.7 + (det - 10) * 0.03 + (pro - 10) * 0.02, 0.3, 1.3);
    const base = SHOUT_EFFECTS[shout];
    const delta: TeamMentalState = { confidence: base.confidence, concentration: base.concentration, aggression: base.aggression, tension: base.tension };
    if (shout === 'demandMore' && diff > 0) { delta.confidence -= 0.15; delta.tension += 0.1; }
    if (shout === 'encourage' && diff < 0) delta.confidence += 0.1;
    if (shout === 'praise' && diff < 0) { delta.concentration -= 0.1; delta.confidence -= 0.1; }
    if (shout === 'fireUp' && tem < 9) delta.aggression += 0.15;
    if (shout === 'calmDown' && diff < 0) delta.concentration -= 0.05;
    for (const k of ['confidence', 'concentration', 'aggression', 'tension'] as const) {
      delta[k] = Math.round(delta[k] * responsiveness * 100) / 100;
      t.mental[k] = clamp(t.mental[k] + delta[k], -1, 1);
    }
    const score = delta.confidence + delta.concentration - delta.tension * 0.8 - Math.max(0, delta.aggression - 0.2);
    const outcome: ShoutOutcome = {
      side: t.side, shout, minute: this.curMinute, delta,
      verdict: score > 0.12 ? 'positive' : score < -0.05 ? 'negative' : 'neutral',
    };
    this.shoutLog.push(outcome);
    this.event('shout', t.side, null, null, null, null, { detail: `${shout}:${outcome.verdict}` });
    return outcome;
  }

  private aiDecide(t: TS, minute: number): void {
    const opp = this.teams[t.side === 0 ? 1 : 0];
    const diff = t.goals - opp.goals;
    const prev = { ...t.aiAdj };
    const adj = { mentality: 0, defensiveLine: 0, pressIntensity: 0, tempo: 0 };
    if (diff < 0 && minute >= 55) {
      adj.mentality = (diff <= -2 ? 2 : 1) + (minute >= 78 ? 1 : 0);
      adj.defensiveLine = 1;
      adj.pressIntensity = 1;
      adj.tempo = 1;
    } else if (diff > 0 && minute >= 68) {
      adj.mentality = diff === 1 && minute >= 82 ? -2 : -1;
      adj.defensiveLine = -1;
      adj.tempo = -1;
    } else if (diff === 0 && minute >= 70 && this.cfg.drawAversion > 0) {
      const push = this.cfg.drawAversion * (minute >= 82 ? 2.4 : 1.4);
      adj.mentality = Math.round(push);
      adj.tempo = push >= 1 ? 1 : 0;
    }
    if (adj.mentality !== prev.mentality || adj.defensiveLine !== prev.defensiveLine) {
      t.aiAdj = adj;
      if (minute > 0) this.event('tacticChange', t.side, null, null, null, null, { detail: `mentality:${clamp(t.tactic.mentality + adj.mentality, 1, 7)}` });
    } else t.aiAdj = adj;

    // Gritos sencillos
    if (minute === 45 || minute === 60 || minute === 75) {
      if (diff < 0) this.applyShout(t, minute === 75 ? 'demandMore' : 'encourage');
      else if (diff > 0 && minute === 75) this.applyShout(t, 'focus');
    }

    // Cambios
    const maxSubs = this.input.context.maxSubstitutions ?? 5;
    if (minute < 46 || minute > 88 || t.subsUsed >= maxSubs) return;
    const windowOpen = t.subWindows.has(minute) || t.subWindows.size < 3;
    if (!windowOpen) return;
    const on = this.onPitch(t).filter((r) => !r.isGkNow);
    const threshold = minute >= 75 ? 78 : minute >= 60 ? 70 : 60;
    const tired = on.filter((r) => r.cond < threshold).sort((a, b) => a.cond - b.cond);
    const plan = minute >= 60 ? (minute >= 70 ? 2 : 1) : 0;
    let made = 0;
    for (const out of tired) {
      if (made >= Math.max(1, plan) || t.subsUsed >= maxSubs) break;
      const slot = t.tactic.slots[out.slot];
      if (!slot) continue;
      const cands = t.bench.filter((b) => !b.used && !b.injured);
      if (cands.length === 0) break;
      let best = cands[0] as RP;
      let bestS = -Infinity;
      for (const c of cands) {
        let s = slotScore(c.p, slot);
        if (diff < 0 && (slot.position === 'ST' || slot.position === 'AM')) s *= 1.05;
        if (s > bestS) { bestS = s; best = c; }
      }
      if (bestS < slotScore(out.p, slot) * (out.cond / 100) * 0.9 && out.cond > 55) continue;
      this.substitute(t, out, best);
      made++;
    }
  }

  private substitute(t: TS, out: RP, inn: RP, reason: 'tactical' | 'injury' = 'tactical'): boolean {
    const maxSubs = this.input.context.maxSubstitutions ?? 5;
    if (!out.onPitch || inn.used || t.subsUsed >= maxSubs) return false;
    const minute = this.curMinute + this.curStoppage;
    out.onPitch = false;
    out.minuteOff = minute;
    inn.onPitch = true;
    inn.used = true;
    inn.minuteOn = minute;
    inn.slot = out.slot;
    inn.pos = out.pos;
    inn.role = out.role;
    inn.duty = out.duty;
    inn.x = out.x;
    inn.y = out.y;
    inn.individual = out.individual;
    inn.isGkNow = out.isGkNow;
    t.subsUsed++;
    t.subWindows.add(this.curMinute);
    this.event('substitution', t.side, inn, out, null, null, { detail: reason });
    this.refreshTeam(t);
    return true;
  }

  private removePlayer(rp: RP, reason: 'red' | 'injury'): void {
    const t = rp.team;
    if (reason === 'injury') {
      const cands = t.bench.filter((b) => !b.used);
      const slot = t.tactic.slots[rp.slot];
      if (cands.length && slot && t.subsUsed < (this.input.context.maxSubstitutions ?? 5) && (t.ai || true)) {
        const pick = rp.isGkNow
          ? cands.find((c) => positionRating(c.p, 'GK') >= 15) ?? cands[0]
          : cands.slice().sort((a, b) => slotScore(b.p, slot) - slotScore(a.p, slot))[0];
        if (pick && this.substitute(t, rp, pick, 'injury')) return;
      }
    }
    rp.onPitch = false;
    rp.minuteOff = this.curMinute + this.curStoppage;
    if (rp.isGkNow) {
      // Si se va el portero sin cambio posible, otro jugador se pone los guantes
      const repl = this.onPitch(t).sort((a, b) => b.p.attributes.handling - a.p.attributes.handling)[0];
      if (repl) { repl.isGkNow = true; repl.pos = 'GK'; repl.x = 0.04; repl.y = 0.5; }
    }
    this.refreshTeam(t);
  }

  // ------------------------------------------------ fatiga
  private drain(): void {
    for (const t of this.teams) {
      const press = 1 + (t.inst.pressIntensity - 3) * 0.08 + (t.inst.tempo - 3) * 0.04 + (t.inst.counterPress ? 0.04 : 0);
      let on = 0;
      let fresh = 0;
      let outfield = 0;
      for (const r of t.players) {
        if (!r.onPitch) continue;
        on++;
        if (!r.isGkNow) { fresh += r.fatPhys; outfield++; }
        const stam = 1.35 - r.p.attributes.stamina * 0.035;
        const pos = r.isGkNow ? 0.25 : WIDE_DRAIN.has(r.pos) ? 1.12 : 1;
        const sharp = 1 + (1 - r.p.matchSharpness / 100) * this.cfg.sharpness.drain;
        const d = this.cfg.drainPerPhase * r.role.behaviour.workload * pos * press * stam * sharp * this.drainWeather * (1 - (r.p.attributes.naturalFitness - 10) * 0.012);
        r.cond = Math.max(5, r.cond - d);
        this.updateFatigue(r);
      }
      t.onCount = on;
      t.freshness = outfield ? fresh / outfield : 1;
    }
  }

  private sprint(r: RP, amount = 0.06): void {
    r.cond = Math.max(5, r.cond - amount * (1.3 - r.p.attributes.stamina * 0.03));
  }

  // ------------------------------------------------ fase de posesión
  private pressBonus(def: TS, band: number): number {
    let b = 0;
    if (band <= def.inst.pressLine + 1) {
      // Un equipo cansado presiona peor
      const fresh = def.freshness;
      b += ((def.inst.pressIntensity - 3) * 0.3 + 0.1) * (fresh * fresh);
    }
    if (band >= 5) b += (3 - def.inst.defensiveLine) * 0.22;
    return b;
  }

  private numbers(att: TS, def: TS): number {
    return (def.onCount - att.onCount) * this.cfg.numbersWeight;
  }

  private turnover(att: TS, def: TS, winner: RP | null, band: number, lane: number, allowCounter = true): void {
    let counter = false;
    if (allowCounter && winner && band >= 2) {
      const p = 0.1 + (band >= 4 ? 0.12 : 0) + (def.inst.counterAttack ? 0.18 : 0) - (att.inst.regroup ? 0.08 : 0) + (att.mentality - 4) * this.cfg.counterExposure;
      counter = this.rng.chance(clamp(p, 0, 0.65));
    }
    const counterPressed = att.inst.counterPress && this.rng.chance(0.5);
    const exposure = Math.max(0, att.mentality - 4) * 0.25;
    this.next = { side: def.side, band: clamp(7 - band, 0, 7), lane: clamp(4 - lane, 0, 4), carrier: winner, counter, counterPressed, exposure };
  }

  private playPhase(): void {
    const start = this.next;
    const att = this.teams[start.side];
    const def = this.teams[start.side === 0 ? 1 : 0];
    let b = start.band;
    let l = start.lane;
    let carrier = start.carrier && start.carrier.onPitch ? start.carrier : null;
    if (!carrier) carrier = b <= 0 ? this.gk(att) ?? this.pickByZone(att, true, b, l) : this.pickByZone(att, true, b, l);
    if (!carrier) { this.turnover(att, def, null, b, l, false); return; }
    let counter = start.counter;
    let counterPressed = start.counterPressed;
    let lastPasser: RP | null = null;
    let oneOnOne = false;
    const urgency = this.urgency(att);
    const exposure = start.exposure ?? 0;
    const boxCrowd = Math.max(0, this.density(def, 7, 2) - this.cfg.compactness.ref);

    for (let stepN = 0; stepN < 12; stepN++) {
      att.actions++;
      // Términos situacionales (presión, compacidad, superioridad, contras…), escalados para no depender de k
      const defBonus = this.cfg.situationalWeight * (this.pressBonus(def, b) + this.numbers(att, def) + this.densityTerm(def, b, l)
        + (counter && stepN < 3 ? -1.1 - exposure : 0) + (counterPressed && stepN === 0 ? 0.9 : 0)
        + def.mental.aggression * 0.2 - this.lateOpenness());
      const intent = oneOnOne ? 'shoot' : this.chooseIntent(att, carrier, b, l, counter, urgency, boxCrowd);

      if (intent === 'shoot') {
        const k = oneOnOne ? 'oneOnOne' : b <= 5 ? 'longshot' : 'open';
        this.shot(att, def, carrier, k, lastPasser, b, l, counter);
        return;
      }

      if (intent === 'cross') {
        const r = this.cross(att, def, carrier, b, l, defBonus, false);
        if (r === 'continue') continue;
        return;
      }

      if (intent === 'dribble') {
        const defender = this.pickByZone(def, false, b, l, { sigma: 0.17 });
        carrier.st.dribblesAttempted++;
        if (!defender) { b = Math.min(7, b + 1); continue; }
        defender.st.tacklesAttempted++;
        const p = logistic(this.q(carrier, Q_DRIBBLE) + this.paceEdge(carrier, defender), this.q(defender, Q_TACKLE) + defBonus, this.cfg.k, this.cfg.bias.dribble);
        const ok = this.rng.next() < p;
        this.sprint(carrier);
        this.sprint(defender);
        this.injuryCheck(carrier, defender);
        this.injuryCheck(defender, carrier);
        const nb = ok ? Math.min(7, b + 1) : b;
        const nl = ok ? clamp(l + (l < 2 ? 1 : l > 2 ? -1 : 0) * (this.rng.chance(0.5) ? 1 : 0), 0, 4) : l;
        this.rec(att.side, 'dribble', carrier, defender, b, l, nb, nl, ok);
        const aggr = this.aggressionFactor(defender);
        if (ok) {
          carrier.st.dribbles++;
          if (this.rng.chance(this.cfg.foulOnBeaten * aggr * (b === 7 && l >= 1 && l <= 3 ? 0.1 : b >= 6 ? 1.1 : 1))) {
            const r = this.foul(att, def, defender, carrier, b, l, counter);
            if (r === 'continue') { lastPasser = null; continue; }
            return;
          }
          b = nb;
          l = nl;
          continue;
        }
        if (this.rng.chance(this.cfg.foulOnTackle * aggr * (b === 7 && l >= 1 && l <= 3 ? 0.15 : 1))) {
          const r = this.foul(att, def, defender, carrier, b, l, counter);
          if (r === 'continue') continue;
          return;
        }
        defender.st.tackles++;
        def.stats.tackles++;
        if (b >= 6 && (l === 0 || l === 4 || b === 7) && this.rng.chance(0.12)) { this.corner(att, def, l); return; }
        this.turnover(att, def, defender, b, l);
        return;
      }

      // Pases
      let nb = b;
      let nl = l;
      let qp: Q = Q_SHORT;
      let bias = this.cfg.bias.shortPass;
      const widthPull = (att.inst.width - 3) * 0.25;
      const drift = () => {
        let d = this.rng.pick([-1, 0, 0, 1] as const);
        if (b >= 3 && b <= 6 && this.rng.chance(Math.abs(widthPull))) d = (widthPull > 0 ? (l <= 2 ? -1 : 1) : (l < 2 ? 1 : l > 2 ? -1 : 0)) as -1 | 0 | 1;
        return clamp(l + d, 0, 4);
      };
      if (intent === 'short') {
        nb = clamp(b + this.rng.pick([-1, 0, 0, 0, 1] as const), 0, 7);
        nl = drift();
      } else if (intent === 'forward') {
        nb = Math.min(7, b + (this.rng.chance(0.28) ? 2 : 1));
        nl = drift();
        qp = Q_FWD;
        bias = this.cfg.bias.forwardPass;
      } else if (intent === 'long') {
        nb = Math.min(7, b + this.rng.int(2, 4));
        nl = this.rng.int(0, 4);
        qp = Q_LONG;
        bias = this.cfg.bias.longPass + this.aerialWeather;
      } else if (intent === 'through') {
        nb = b >= 5 ? 7 : 6;
        nl = clamp(l + this.rng.int(-1, 1), 1, 3);
        qp = Q_THROUGH;
        bias = this.cfg.bias.throughBall;
      }
      const receiver = this.pickByZone(att, true, nb, nl, {
        exclude: carrier,
        allowGk: nb <= 1,
        sigma: intent === 'long' ? 0.24 : 0.19,
        extra: intent === 'through'
          ? (r) => r.role.behaviour.forwardRuns * (r.individual.attackDefensiveLine ? 1.5 : 1) * (this.eff(r, 'pace') / 10)
          : undefined,
      });
      if (!receiver) { this.turnover(att, def, null, b, l, false); return; }
      const interceptor = this.pickByZone(def, false, intent === 'short' ? b : nb, nl, { sigma: 0.2 });
      if (interceptor && intent !== 'long' && this.rng.chance(this.cfg.foulOnPass * this.aggressionFactor(interceptor) * (nb === 7 && nl >= 1 && nl <= 3 ? 0.06 : 1))) {
        const r = this.foul(att, def, interceptor, receiver, nb, nl, counter);
        if (r === 'continue') { carrier = receiver; b = nb; l = nl; continue; }
        return;
      }
      carrier.st.passes++;
      att.stats.passes++;
      const attack = 0.65 * this.q(carrier, qp) + 0.35 * this.q(receiver, intent === 'through' ? Q_RUN : Q_RECEIVE)
        + (intent === 'through' && interceptor ? this.paceEdge(receiver, interceptor) * 0.6 : 0);
      const defence = interceptor ? this.q(interceptor, Q_INTERCEPT) + defBonus : 5;
      const p = logistic(attack, defence, this.cfg.k, bias + (counter && intent !== 'short' ? 0.3 : 0));
      const ok = this.rng.next() < p;
      this.rec(att.side, `pass:${intent}`, carrier, receiver, b, l, nb, nl, ok);
      if (intent === 'through' || intent === 'long') this.sprint(receiver, 0.05);
      if (ok) {
        carrier.st.passesCompleted++;
        att.stats.passesCompleted++;
        lastPasser = carrier;
        carrier = receiver;
        b = nb;
        l = nl;
        if (intent === 'through') {
          oneOnOne = this.rng.chance(0.35);
          if (!oneOnOne) b = 7;
        }
        continue;
      }
      // Fallo
      if (intent === 'through' && this.rng.chance(this.cfg.offsideOnThrough * (0.6 + def.inst.defensiveLine * 0.15) * (1.4 - this.eff(receiver, 'anticipation') / 25))) {
        receiver.st.offsides++;
        att.stats.offsides++;
        this.event('offside', att.side, receiver, carrier, nb, nl);
        this.next = { side: def.side, band: clamp(7 - nb, 0, 7), lane: 4 - nl, carrier: null, counter: false, counterPressed: false };
        return;
      }
      if (interceptor) {
        interceptor.st.interceptions++;
        def.stats.interceptions++;
      }
      const lostAt = intent === 'short' ? b : nb;
      this.turnover(att, def, interceptor, lostAt, nl, intent !== 'long');
      return;
    }
    // Demasiadas acciones sin progreso: pérdida
    this.turnover(att, def, this.pickByZone(def, false, b, l), b, l);
  }

  /** Urgencia por marcador/tiempo (multiplica el riesgo). */
  private urgency(t: TS): number {
    const opp = this.teams[t.side === 0 ? 1 : 0];
    const minute = this.curMinute;
    if (t.goals < opp.goals && minute >= 70) return 1.15 + (minute >= 85 ? 0.15 : 0);
    if (t.goals === opp.goals && minute >= 65 && this.cfg.drawAversion > 0 && !this.wentToExtraTime) {
      return 1 + this.cfg.drawAversion * (minute >= 80 ? 1.2 : 0.6);
    }
    return 1;
  }

  /** Apertura defensiva cuando ambos arriesgan con empate al final (aversión al empate). */
  private lateOpenness(): number {
    const [h, a] = this.teams;
    if (h.goals !== a.goals || this.curMinute < 65 || this.wentToExtraTime) return 0;
    return this.cfg.drawAversion * (this.curMinute >= 80 ? 1.6 : 0.8);
  }

  /** Ventaja de velocidad y aceleración efectivas (incluye fatiga): piernas frescas contra rival cansado. */
  private paceEdge(a: RP, d: RP): number {
    const sa = (this.eff(a, 'pace') + this.eff(a, 'acceleration')) / 2;
    const sd = (this.eff(d, 'pace') + this.eff(d, 'acceleration')) / 2;
    return this.cfg.paceDuel * this.cfg.situationalWeight * (sa - sd);
  }

  private aggressionFactor(r: RP): number {
    const a = r.p.attributes;
    // Amonestado: se corta, salvo los de temperamento bajo
    const booked = r.st.yellow > 0 ? 0.45 + clamp((10 - a.temperament) * 0.03, 0, 0.2) : 1;
    const tension = Math.max(0.5, 1 + this.tense(r.team) * this.hotHead(r) * this.cfg.tension.foul);
    return clamp(1 + (a.aggression - 10) * 0.025 + (10 - a.temperament) * 0.015 + r.team.mental.aggression * 0.5 + (r.team.inst.pressIntensity - 3) * 0.08, 0.4, 2.2) * booked * tension;
  }

  private chooseIntent(att: TS, c: RP, b: number, l: number, counter: boolean, urgency: number, boxCrowd = 0): 'shoot' | 'cross' | 'dribble' | 'short' | 'forward' | 'long' | 'through' {
    const cfg = this.cfg.intent;
    const beh = c.role.behaviour;
    const ind = c.individual;
    const m = att.mentality;
    const inst = att.inst;
    if (c.isGkNow) {
      const longP = inst.goalkeeperDistribution === 'long' ? 0.7 : inst.goalkeeperDistribution === 'short' ? 0.15 : 0.4;
      return this.rng.chance(longP) ? 'long' : 'short';
    }
    const mf = 0.72 + 0.07 * m;
    let shoot = 0;
    if (b >= 5) {
      const laneF = b >= 6 ? (l === 2 ? 1.15 : l === 1 || l === 3 ? 1 : 0.28) : l === 0 || l === 4 ? 0.4 : 0.9;
      // Área cerrada: se prueba más desde fuera
      const fromDistance = b <= 6 ? 1 + boxCrowd * this.cfg.compactness.shootFromDistance : 1;
      shoot = (cfg.shoot[b - 5] ?? 0) * beh.shoot * laneF * mf * (ind.shootMore ? 1.5 : 1) * urgency * fromDistance * (0.7 + this.eff(c, b === 5 ? 'longShots' : 'finishing') / 33);
    }
    let cross = 0;
    if (b >= 5) {
      const widthF = 0.7 + inst.width * 0.12;
      if (l === 0 || l === 4) cross = cfg.cross * beh.cross * widthF * (ind.crossFromByline ? 1.3 : 1) * (1 + boxCrowd * 0.3);
      else if (l === 1 || l === 3) cross = cfg.cross * 0.2 * beh.cross;
    }
    const dribble = cfg.dribble * beh.dribble * (this.eff(c, 'dribbling') / 12) * (ind.dribbleMore ? 1.6 : 1) * (b >= 3 ? 1 : 0.4);
    const tempoF = 0.8 + 0.1 * inst.tempo;
    let forward = b < 7 ? cfg.forward * tempoF * (0.7 + 0.1 * m) * urgency : 0;
    let short = cfg.short * (1.35 - 0.12 * inst.passingStyle) * (1.4 - 0.1 * m) * (b >= 6 ? 1.2 : 1);
    const long = b <= 4 ? cfg.long * Math.pow(inst.passingStyle / 3, 1.5) * (b <= 2 ? 1.5 : 0.7) * (ind.moreDirectPasses ? 1.4 : 1) : 0;
    const through = b >= 3 && b <= 6
      ? cfg.through * beh.passRisk * (this.eff(c, 'vision') / 12) * (0.8 + 0.08 * m) * (ind.moreDirectPasses ? 1.2 : 1) * (counter ? 1.6 : 1)
      : 0;
    if (counter) { forward *= 1.4; short *= 0.5; }
    const opts = ['shoot', 'cross', 'dribble', 'short', 'forward', 'long', 'through'] as const;
    return this.rng.weighted(opts, [shoot, cross, dribble, short, forward, long, through]);
  }

  // ------------------------------------------------ centros y balón parado
  private cross(att: TS, def: TS, crosser: RP, b: number, l: number, defBonus: number, setPiece: boolean): 'end' | 'continue' {
    const marker = setPiece ? null : this.pickByZone(def, false, b, l, { sigma: 0.16 });
    crosser.st.crosses++;
    const qc = this.q(crosser, setPiece ? Q_CORNER : Q_CROSS);
    const accurate = this.rng.next() < logistic(qc, marker ? this.q(marker, Q_CROSS_DEF) + defBonus * 0.5 : 10, this.cfg.k, this.cfg.bias.cross + this.aerialWeather + (setPiece ? 0.25 : 0));
    const target = this.pickByZone(att, true, 7, 2, {
      exclude: crosser,
      sigma: 0.15,
      allowGk: setPiece && att.tweaks.has('goalkeeperUpForSetPieces'),
      extra: (r) => (this.eff(r, 'heading') + this.eff(r, 'jumping') + r.p.heightCm / 10 - 17) / 10 + 0.05,
    });
    this.rec(att.side, setPiece ? 'corner' : 'cross', crosser, target, b, l, 7, 2, accurate);
    if (!accurate || !target) {
      if (this.rng.chance(this.cfg.cornerAfterCross) && !setPiece) return this.corner(att, def, l);
      this.turnover(att, def, this.pickByZone(def, false, 7, 2), 7, 2);
      return 'end';
    }
    crosser.st.crossesCompleted++;
    const gk = this.gk(def);
    if (gk && this.rng.chance(clamp(0.1 + (this.q(gk, Q_GK_CROSS) - 10) * 0.012, 0.02, 0.25))) {
      this.next = { side: def.side, band: 0, lane: 2, carrier: gk, counter: this.rng.chance(0.15), counterPressed: false };
      return 'end';
    }
    const defender = this.pickByZone(def, false, 7, 2, { sigma: 0.14, extra: (r) => (this.eff(r, 'heading') + this.eff(r, 'jumping')) / 20 });
    const won = !defender || this.rng.next() < logistic(this.q(target, Q_AERIAL_ATT), this.q(defender, Q_AERIAL_DEF) + defBonus * 0.5, this.cfg.k, this.cfg.bias.aerialDuel);
    if (won) {
      target.st.aerialWon++;
      if (defender) defender.st.aerialLost++;
      this.shot(att, def, target, setPiece ? 'cornerHeader' : 'header', crosser, 7, 2, false);
      return 'end';
    }
    target.st.aerialLost++;
    if (defender) defender.st.aerialWon++;
    if (this.rng.chance(0.15)) return this.corner(att, def, l);
    this.turnover(att, def, defender, 7, 2);
    return 'end';
  }

  private taker(t: TS, kind: 'corners' | 'freeKicks' | 'penalties'): RP {
    const id = t.takers[kind];
    const r = id ? t.byId.get(id) : undefined;
    if (r && r.onPitch) return r;
    const q = kind === 'corners' ? Q_CORNER : kind === 'freeKicks' ? Q_FREEKICK : Q_PENALTY;
    return this.onPitch(t).filter((x) => !x.isGkNow).sort((a, b) => this.q(b, q) - this.q(a, q))[0] ?? (this.onPitch(t)[0] as RP);
  }

  private corner(att: TS, def: TS, lane: number): 'end' {
    att.stats.corners++;
    const side = lane <= 2 ? 0 : 4;
    const taker = this.taker(att, 'corners');
    this.event('corner', att.side, taker, null, 7, side);
    if (this.rng.chance(0.15)) {
      // córner en corto: sigue la jugada
      this.next = { side: att.side, band: 6, lane: side, carrier: taker, counter: false, counterPressed: false };
      return 'end';
    }
    this.cross(att, def, taker, 7, side, 0, true);
    return 'end';
  }

  private foul(att: TS, def: TS, fouler: RP, fouled: RP, b: number, l: number, counter: boolean): 'end' | 'continue' {
    fouler.st.fouls++;
    fouled.st.fouled++;
    def.stats.fouls++;
    this.event('foul', def.side, fouler, fouled, 7 - b, 4 - l);
    this.card(def, fouler, b, l, counter);
    const box = b === 7 && l >= 1 && l <= 3;
    if (box) {
      this.event('penalty', att.side, fouled, fouler, b, l);
      this.shot(att, def, this.taker(att, 'penalties'), 'penalty', null, 7, 2, false);
      return 'end';
    }
    if (b >= 6 && l >= 1 && l <= 3 && this.rng.chance(0.5)) {
      this.event('freeKick', att.side, this.taker(att, 'freeKicks'), null, b, l);
      this.shot(att, def, this.taker(att, 'freeKicks'), 'freeKick', null, b, l, false);
      return 'end';
    }
    if (b >= 5 && this.rng.chance(0.55)) {
      this.event('freeKick', att.side, this.taker(att, 'freeKicks'), null, b, l);
      this.cross(att, def, this.taker(att, 'freeKicks'), b, l, 0, true);
      return 'end';
    }
    return 'continue';
  }

  private card(def: TS, fouler: RP, b: number, l: number, counter: boolean): void {
    const a = fouler.p.attributes;
    const tension = Math.max(0.5, 1 + this.tense(def) * this.hotHead(fouler) * this.cfg.tension.card);
    const factor = clamp(1 + (a.aggression - 10) * 0.01 + (10 - a.temperament) * 0.015, 0.7, 1.4) * (b >= 5 ? 1.3 : 1) * (counter ? 1.8 : 1) * (1 + def.mental.aggression * 0.5) * tension;
    const lastMan = counter && b >= 6 && l >= 1 && l <= 3;
    if (this.rng.chance(this.cfg.redPerFoul * factor + (lastMan ? 0.04 : 0))) {
      this.sendOff(def, fouler, 'red');
      return;
    }
    if (this.rng.chance(this.cfg.yellowPerFoul * factor * (fouler.st.yellow > 0 ? 0.5 + clamp((10 - a.temperament) * 0.02, 0, 0.14) : 1))) {
      fouler.st.yellow++;
      def.stats.yellow++;
      if (fouler.st.yellow >= 2) {
        this.event('secondYellow', def.side, fouler, null, null, null);
        this.sendOff(def, fouler, 'secondYellow');
      } else this.event('yellow', def.side, fouler, null, null, null);
    }
  }

  private sendOff(t: TS, rp: RP, kind: 'red' | 'secondYellow'): void {
    rp.st.red++;
    rp.sentOff = true;
    t.stats.red++;
    if (kind === 'red') this.event('red', t.side, rp, null, null, null);
    this.removePlayer(rp, 'red');
  }

  private injuryCheck(rp: RP, other: RP): void {
    if (!rp.onPitch) return;
    const a = rp.p.attributes;
    const p = this.cfg.injuryPerDuel * (0.5 + a.injuryProneness / 20) * (1 + 1.5 * (1 - rp.cond / 100)) * (1 + (other.p.attributes.aggression - 10) * 0.03)
      * (1 + (1 - rp.p.matchSharpness / 100) * this.cfg.sharpness.injury);
    if (!this.rng.chance(p)) return;
    const r = this.rng.next();
    const severity: Injury['severity'] = r < 0.6 ? 'minor' : r < 0.88 ? 'moderate' : r < 0.98 ? 'serious' : 'severe';
    const days = severity === 'minor' ? this.rng.int(2, 10) : severity === 'moderate' ? this.rng.int(10, 35) : severity === 'serious' ? this.rng.int(35, 120) : this.rng.int(120, 270);
    const injury: Injury = { type: this.rng.pick(INJURY_TYPES), severity, startDate: this.input.context.date, daysOut: days, daysRemaining: days };
    rp.injured = true;
    this.injuries.push({ playerId: rp.p.id, injury });
    this.event('injury', rp.side, rp, null, null, null, { detail: `${injury.type}:${severity}:${days}` });
    this.removePlayer(rp, 'injury');
  }

  // ------------------------------------------------ tiros
  private shot(att: TS, def: TS, shooter: RP, kind: 'open' | 'longshot' | 'header' | 'cornerHeader' | 'oneOnOne' | 'freeKick' | 'penalty', assist: RP | null, b: number, l: number, counter: boolean): void {
    const x = this.cfg.xg;
    let base: number;
    let qs: Q;
    switch (kind) {
      case 'penalty': base = x.penalty; qs = Q_PENALTY; break;
      case 'freeKick': base = x.directFreeKick; qs = Q_FREEKICK; break;
      case 'header': base = x.header; qs = Q_HEADER; break;
      case 'cornerHeader': base = x.cornerHeader; qs = Q_HEADER; break;
      case 'oneOnOne': base = x.oneOnOne; qs = Q_FINISH; break;
      case 'longshot': base = x.band5; qs = Q_LONGSHOT; break;
      default:
        qs = Q_FINISH;
        base = b >= 7 ? (l === 2 ? x.band7Centre : l === 1 || l === 3 ? x.band7Mid : x.band7Wide)
          : (l === 2 ? x.band6Centre : l === 1 || l === 3 ? x.band6Mid : x.band6Wide);
    }
    const sq = this.q(shooter, qs);
    const gk = this.gk(def);
    const gq = gk ? this.q(gk, kind === 'oneOnOne' ? Q_GK_1V1 : Q_GK) : 3;
    // xG: zona, ángulo y tipo de ocasión (base) × calidad del finalizador × portero rival.
    // Defensores cerca: peor ángulo y más presión (no afecta a penaltis ni faltas directas)
    const crowdable = kind === 'open' || kind === 'longshot' || kind === 'header' || kind === 'cornerHeader';
    const dens = crowdable ? this.density(def, b, l) - this.cfg.compactness.ref : 0;
    const crowd = clamp(1 - dens * this.cfg.compactness.xg, 0.7, 1.25);
    const sqw = this.cfg.shotQuality;
    const chance = base * Math.exp((sq - 10) * (kind === 'penalty' ? 0.02 : sqw.finisher)) * (counter ? x.counterBonus : 1) * crowd;
    const pGoal = clamp(chance * Math.exp((10 - gq) * (kind === 'penalty' ? 0.025 : sqw.keeper)), 0.005, 0.97);
    const xg = pGoal;
    const pOnTarget = clamp(0.29 + (sq - 10) * 0.014 + chance * 0.55, pGoal + 0.02, 0.92);
    const blockable = kind === 'open' || kind === 'longshot';
    const pBlock = blockable ? clamp((kind === 'longshot' ? 0.3 : 0.2) + dens * this.cfg.compactness.block, 0.05, 0.5) : 0;

    shooter.st.shots++;
    shooter.st.xg += xg;
    att.stats.shots++;
    att.stats.xg += xg;
    if (assist) assist.st.keyPasses++;
    this.sprint(shooter, 0.04);

    const r = this.rng.next();
    if (r < pGoal) {
      shooter.st.goals++;
      shooter.st.shotsOnTarget++;
      att.stats.shotsOnTarget++;
      att.goals++;
      att.stats.goals++;
      if (assist && assist !== shooter) assist.st.assists++;
      if (gk) gk.st.goalsConceded++;
      for (const d of this.onPitch(def)) if (!d.isGkNow && (d.pos === 'CB' || d.pos === 'LB' || d.pos === 'RB' || d.pos === 'LWB' || d.pos === 'RWB')) d.ratingAdj -= 0.12;
      this.event('goal', att.side, shooter, assist && assist !== shooter ? assist : null, b, l, { xg: round3(xg), detail: kind });
      this.rec(att.side, 'goal', shooter, null, b, l, 7, 2, true);
      att.mental.confidence = clamp(att.mental.confidence + 0.15, -1, 1);
      def.mental.tension = clamp(def.mental.tension + 0.1, -1, 1);
      this.next = { side: def.side, band: 3, lane: 2, carrier: null, counter: false, counterPressed: false };
      return;
    }
    if (r < pOnTarget) {
      shooter.st.shotsOnTarget++;
      att.stats.shotsOnTarget++;
      if (gk) gk.st.saves++;
      this.event('save', def.side, gk, shooter, 7 - b, 4 - l, { xg: round3(xg), detail: kind });
      this.rec(att.side, 'shot', shooter, gk, b, l, 7, 2, false);
      if (kind === 'penalty') this.event('penaltyMissed', att.side, shooter, gk, b, l);
      if (this.rng.chance(this.cfg.cornerAfterSave)) { this.corner(att, def, l); return; }
      this.next = { side: def.side, band: 0, lane: 2, carrier: gk, counter: this.rng.chance(0.1), counterPressed: false };
      return;
    }
    if (this.rng.chance(pBlock)) {
      const blocker = this.pickByZone(def, false, b, l, { sigma: 0.15, extra: (d) => this.q(d, Q_BLOCK) / 10 });
      this.event('shot', att.side, shooter, blocker, b, l, { xg: round3(xg), detail: `blocked:${kind}` });
      this.rec(att.side, 'shot', shooter, blocker, b, l, b, l, false);
      if (this.rng.chance(this.cfg.cornerAfterBlock)) { this.corner(att, def, l); return; }
      this.turnover(att, def, blocker, b, l);
      return;
    }
    const woodwork = this.rng.chance(0.06);
    this.event(woodwork ? 'woodwork' : 'shot', att.side, shooter, null, b, l, { xg: round3(xg), detail: `offTarget:${kind}` });
    if (kind === 'penalty') this.event('penaltyMissed', att.side, shooter, null, b, l);
    this.rec(att.side, 'shot', shooter, null, b, l, 7, 2, false);
    this.next = { side: def.side, band: 0, lane: 2, carrier: gk, counter: false, counterPressed: false };
  }

  // ------------------------------------------------ resultado
  result(): MatchResult {
    const [home, away] = this.teams;
    const totalActions = home.actions + away.actions || 1;
    home.stats.possession = Math.round((home.actions / totalActions) * 100);
    away.stats.possession = 100 - home.stats.possession;
    const endMinute = this.wentToExtraTime ? 120 : 90;
    const playerStats: Record<string, PlayerMatchStats> = {};
    const ratings: { playerId: string; rating: number }[] = [];
    for (const t of this.teams) {
      const opp = this.teams[t.side === 0 ? 1 : 0];
      const result = t.goals > opp.goals ? 1 : t.goals < opp.goals ? -1 : 0;
      for (const r of t.players) {
        if (!r.used) continue;
        const st = r.st;
        st.minutes = Math.max(0, Math.min(endMinute, r.minuteOff ?? endMinute) - r.minuteOn);
        st.condition = Math.round(r.cond);
        st.sharpness = Math.round(clamp(r.p.matchSharpness + (st.minutes / 90) * 10, 0, 100));
        st.xg = round3(st.xg);
        st.rating = this.rating(r, result, opp.goals);
        playerStats[r.p.id] = st;
        ratings.push({ playerId: r.p.id, rating: st.rating });
      }
    }
    const motm = ratings.slice().sort((a, b) => b.rating - a.rating)[0]?.playerId ?? null;
    if (motm) playerStats[motm]!.rating = Math.min(10, playerStats[motm]!.rating);
    home.stats.xg = round3(home.stats.xg);
    away.stats.xg = round3(away.stats.xg);
    let winner: MatchResult['winner'] = home.goals > away.goals ? 'home' : away.goals > home.goals ? 'away' : null;
    if (!winner && this.penalties) winner = this.penalties.home > this.penalties.away ? 'home' : 'away';
    const lineupOf = (t: TS) => ({
      starting: t.players.filter((r) => r.st.started).sort((a, b) => a.startSlot - b.startSlot).map((r) => {
        const s = t.input.tactic.slots[r.startSlot];
        return { playerId: r.p.id, position: s?.position ?? r.pos, role: s?.role ?? r.role.id, duty: s?.duty ?? r.duty };
      }),
      bench: t.bench.map((r) => r.p.id),
    });
    const ctx = this.input.context;
    const match: Match = {
      id: ctx.matchId,
      competitionId: ctx.competitionId,
      season: ctx.season,
      round: ctx.round,
      date: ctx.date,
      homeId: home.input.clubId,
      awayId: away.input.clubId,
      played: true,
      seed: this.input.seed,
      lineups: { home: lineupOf(home), away: lineupOf(away) },
      events: this.events,
      stats: { home: home.stats, away: away.stats },
      ratings,
      playerOfMatchId: motm,
      attendance: this.attendance,
      result: { homeGoals: home.goals, awayGoals: away.goals, extraTime: this.wentToExtraTime, penalties: this.penalties },
    };
    return {
      match, playerStats, injuries: this.injuries, shouts: this.shoutLog, replay: this.replay, winner, phases: this.totalPhases,
      diagnostics: { avgDensity: this.densN ? this.densSum / this.densN : 0 },
    };
  }

  private rating(r: RP, result: number, conceded: number): number {
    const s = r.st;
    const def = r.pos === 'CB' || r.pos === 'LB' || r.pos === 'RB' || r.pos === 'LWB' || r.pos === 'RWB';
    let v = 6.2;
    v += s.goals * 1.0 + s.assists * 0.6 + s.keyPasses * 0.12 + s.shotsOnTarget * 0.06 - (s.shots - s.shotsOnTarget) * 0.03;
    v += s.passesCompleted * 0.01 - (s.passes - s.passesCompleted) * 0.035;
    v += s.dribbles * 0.06 - (s.dribblesAttempted - s.dribbles) * 0.02 + s.crossesCompleted * 0.04;
    v += s.tackles * 0.09 + s.interceptions * 0.07 + s.aerialWon * 0.05 - s.aerialLost * 0.03;
    v += s.saves * 0.22 - s.goalsConceded * 0.28;
    if (r.isGkNow || def) v += conceded === 0 && s.minutes >= 60 ? 0.45 : -0.05 * conceded;
    v -= s.fouls * 0.05 + s.yellow * 0.25 + s.red * 1.6 + s.offsides * 0.03;
    v += r.ratingAdj + result * 0.25;
    const weight = clamp(s.minutes / 60, 0.35, 1);
    v = 6.3 + (v - 6.3) * weight;
    return Math.round(clamp(v, 1, 10) * 10) / 10;
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Simula un partido completo de una vez. */
export function simulateMatch(input: MatchInput): MatchResult {
  return new MatchSimulation(input).run();
}

/** Fecha de vuelta de un jugador lesionado (ayuda para la Fase 3). */
export function injuryReturnDate(injury: Injury): string {
  return addDays(injury.startDate, injury.daysRemaining);
}

export { DEFAULT_ENGINE_CONFIG };
