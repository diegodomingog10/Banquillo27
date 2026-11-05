/**
 * Esquema de datos de Banquillo (validado con Zod).
 *
 * Este archivo es el CONTRATO entre la base de datos y el motor. El motor solo
 * conoce estos tipos; cualquier fuente (generador, CSV, JSON, tu base real) debe
 * producir un `WorldDatabase` válido. Ver DATA_GUIDE.md para el formato de entrada.
 */
import { z } from 'zod';
import { ALL_ATTRS, ABILITY_MAX, ABILITY_MIN, ATTR_MAX, ATTR_MIN, type AttrKey } from './attributes';
import { POSITIONS } from './positions';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- primitivas
export const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'id con caracteres no permitidos');
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha con formato AAAA-MM-DD');
export const Attr = z.number().int().min(ATTR_MIN).max(ATTR_MAX);
export const Ability = z.number().int().min(ABILITY_MIN).max(ABILITY_MAX);
export const Percent = z.number().min(0).max(100);
export const Money = z.number().finite(); // en euros, puede ser negativo (saldo)
export const PositiveMoney = z.number().finite().min(0);
export const PositionCode = z.enum(POSITIONS);

// ---------------------------------------------------------------- atributos
const attrShape = Object.fromEntries(ALL_ATTRS.map((k) => [k, Attr])) as Record<AttrKey, typeof Attr>;
/** Atributos en forma plana. Grupos (técnico/mental/físico/portero/oculto) en attributes.ts. */
export const Attributes = z.object(attrShape).strict();

// ---------------------------------------------------------------- jugador
export const PreferredFoot = z.enum(['left', 'right', 'either']);

export const PersonalityType = z.enum([
  'modelCitizen', // Ciudadano modelo
  'modelProfessional', // Profesional modelo
  'perfectionist', // Perfeccionista
  'resolute', // Resuelto
  'determined', // Decidido
  'ambitious', // Ambicioso
  'driven', // Motivado
  'loyal', // Leal
  'jovial', // Jovial
  'balanced', // Equilibrado
  'temperamental', // Temperamental
  'unambitious', // Poco ambicioso
  'casual', // Despreocupado
  'lowDetermination', // Poco decidido
  'mercenary', // Mercenario
]);

export const Contract = z.object({
  /** Salario semanal bruto en euros. */
  wage: PositiveMoney,
  /** Fecha de fin de contrato. */
  expires: IsoDate,
  /** Cláusula de rescisión (null = no tiene). */
  releaseClause: PositiveMoney.nullable(),
  bonuses: z.object({
    appearance: PositiveMoney.default(0),
    goal: PositiveMoney.default(0),
    cleanSheet: PositiveMoney.default(0),
    signing: PositiveMoney.default(0),
    loyalty: PositiveMoney.default(0),
  }),
  type: z.enum(['full', 'youth', 'loan']).default('full'),
  /** Si está cedido: club propietario. */
  loanFromClubId: Id.nullable().default(null),
});

export const Injury = z.object({
  type: z.string().min(1),
  severity: z.enum(['minor', 'moderate', 'serious', 'severe']),
  startDate: IsoDate,
  /** Días totales de baja estimados. */
  daysOut: z.number().int().min(0),
  /** Días que faltan. */
  daysRemaining: z.number().int().min(0),
});

export const SeasonStats = z.object({
  season: z.string().min(4), // "2026/27"
  clubId: Id.nullable(),
  competitionId: Id.nullable(),
  apps: z.number().int().min(0).default(0),
  starts: z.number().int().min(0).default(0),
  minutes: z.number().int().min(0).default(0),
  goals: z.number().int().min(0).default(0),
  assists: z.number().int().min(0).default(0),
  xg: z.number().min(0).default(0),
  xa: z.number().min(0).default(0),
  shots: z.number().int().min(0).default(0),
  passesCompleted: z.number().int().min(0).default(0),
  tackles: z.number().int().min(0).default(0),
  yellow: z.number().int().min(0).default(0),
  red: z.number().int().min(0).default(0),
  cleanSheets: z.number().int().min(0).default(0),
  avgRating: z.number().min(0).max(10).default(0),
  playerOfMatch: z.number().int().min(0).default(0),
});

export const ClubHistoryEntry = z.object({
  clubId: Id.nullable(),
  clubName: z.string(),
  from: IsoDate,
  to: IsoDate.nullable(),
  fee: PositiveMoney.default(0),
  loan: z.boolean().default(false),
});

export const PositionRating = z.object({
  position: PositionCode,
  /** Competencia en la posición, 1-20 (20 = natural). */
  rating: Attr,
});

export const Player = z.object({
  id: Id,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** Nombre corto para mostrar (opcional). */
  commonName: z.string().nullable().default(null),
  birthDate: IsoDate,
  /** Ids de nación; la primera es la principal (selección). */
  nationalities: z.array(Id).min(1),
  heightCm: z.number().int().min(140).max(220),
  weightKg: z.number().int().min(45).max(130),
  foot: z.object({ left: Attr, right: Attr }),
  preferredFoot: PreferredFoot,
  positions: z.array(PositionRating).min(1),
  clubId: Id.nullable(),
  contract: Contract.nullable(),
  marketValue: PositiveMoney,
  ca: Ability,
  pa: Ability,
  personality: PersonalityType,
  attributes: Attributes,
  /** Condición física 0-100. */
  condition: Percent.default(100),
  /** Ritmo de partido 0-100. */
  matchSharpness: Percent.default(70),
  /** Moral 0-100 (50 = normal). */
  morale: Percent.default(60),
  /** Forma: últimas notas (1-10), la más reciente al final. */
  form: z.array(z.number().min(1).max(10)).max(10).default([]),
  injury: Injury.nullable().default(null),
  cards: z
    .object({
      yellow: z.number().int().min(0).default(0),
      red: z.number().int().min(0).default(0),
      suspendedMatches: z.number().int().min(0).default(0),
    })
    .default({ yellow: 0, red: 0, suspendedMatches: 0 }),
  seasonStats: z.array(SeasonStats).default([]),
  careerStats: z.array(SeasonStats).default([]),
  history: z.array(ClubHistoryEntry).default([]),
  /** Rutas de campos estimados (no venían en la fuente), p. ej. ["birthDate","attributes.pace"]. */
  estimated: z.array(z.string()).default([]),
  source: z.enum(['generated', 'imported']).default('generated'),
  /** Id externo de la fuente original (para reimportaciones). */
  externalId: z.string().nullable().default(null),
});

// ---------------------------------------------------------------- staff
export const StaffRole = z.enum([
  'manager',
  'assistantManager',
  'coach',
  'goalkeepingCoach',
  'fitnessCoach',
  'scout',
  'chiefScout',
  'physio',
  'doctor',
  'analyst',
  'youthCoach',
  'directorOfFootball',
]);

export const STAFF_ATTRS = [
  // Coaching por área
  'attacking',
  'defending',
  'tactical',
  'technical',
  'mentalCoaching',
  'fitness',
  'goalkeeping',
  'workingWithYouth',
  // Ojeo
  'judgingAbility',
  'judgingPotential',
  'negotiating',
  // Médico
  'physiotherapy',
  'sportsScience',
  // Análisis
  'analysing',
  // Mentales / gestión
  'tacticalKnowledge',
  'determination',
  'motivating',
  'manManagement',
  'discipline',
  'adaptability',
] as const;
export type StaffAttr = (typeof STAFF_ATTRS)[number];

export const StaffAttributes = z
  .object(Object.fromEntries(STAFF_ATTRS.map((k) => [k, Attr])) as Record<StaffAttr, typeof Attr>)
  .strict();

export const Staff = z.object({
  id: Id,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: IsoDate,
  nationality: Id,
  clubId: Id.nullable(),
  role: StaffRole,
  attributes: StaffAttributes,
  /** Ids de nación que el ojeador conoce bien (conocimiento de zona). */
  regionalKnowledge: z.array(Id).default([]),
  preferredFormation: z.string().nullable().default(null),
  reputation: z.number().int().min(0).max(10000),
  contract: Contract.nullable(),
  estimated: z.array(z.string()).default([]),
  source: z.enum(['generated', 'imported']).default('generated'),
});

// ---------------------------------------------------------------- nación
export const Nation = z.object({
  id: Id,
  name: z.string().min(1),
  /** Código de 3 letras (inventado para datos ficticios). */
  code: z.string().min(2).max(4),
  continent: z.string().min(1),
  reputation: z.number().int().min(0).max(10000),
  /** Fuerza media de la liga principal 0-100 (se usa al convertir estadísticas). */
  leagueStrength: z.number().min(0).max(100),
  /** Si los contratos llevan cláusula de rescisión obligatoria. */
  mandatoryReleaseClause: z.boolean().default(false),
});

// ---------------------------------------------------------------- club
export const BoardObjective = z.object({
  type: z.enum([
    'winLeague',
    'leaguePosition', // terminar en posición <= target
    'avoidRelegation',
    'promotion',
    'cupRound', // alcanzar ronda target
    'continentalRound',
    'balanceBudget',
    'developYouth',
    'playStyle',
  ]),
  competitionId: Id.nullable().default(null),
  target: z.number().int().nullable().default(null),
  importance: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export const Club = z.object({
  id: Id,
  name: z.string().min(1),
  shortName: z.string().min(1).max(20),
  nationId: Id,
  city: z.string().min(1),
  /** Reputación 0-10000 (estilo FM). */
  reputation: z.number().int().min(0).max(10000),
  colors: z.object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  founded: z.number().int().min(1800).max(2100).nullable().default(null),
  stadium: z.object({
    name: z.string().min(1),
    capacity: z.number().int().min(500).max(150000),
    /** Estado del césped 0-100. */
    pitchCondition: Percent,
    /** Tamaño del campo en metros (afecta ligeramente al motor). */
    length: z.number().int().min(90).max(120).default(105),
    width: z.number().int().min(45).max(90).default(68),
  }),
  facilities: z.object({
    training: Attr,
    youth: Attr,
    youthRecruitment: Attr,
    /** Calidad de la cantera (nivel de los juveniles que salen). */
    juniorCoaching: Attr,
  }),
  finances: z.object({
    balance: Money,
    transferBudget: PositiveMoney,
    /** Presupuesto salarial semanal. */
    wageBudget: PositiveMoney,
    debt: PositiveMoney.default(0),
    /** Ingresos anuales estimados por concepto. */
    seasonIncome: z.object({
      tickets: PositiveMoney,
      tv: PositiveMoney,
      sponsorship: PositiveMoney,
      merchandising: PositiveMoney,
      prizes: PositiveMoney.default(0),
      transfers: PositiveMoney.default(0),
    }),
    ticketPrice: PositiveMoney,
    seasonTicketHolders: z.number().int().min(0),
  }),
  /** Ids de staff contratado. La plantilla se deriva de Player.clubId. */
  staffIds: z.array(Id).default([]),
  boardObjectives: z.array(BoardObjective).default([]),
  philosophy: z
    .array(
      z.enum([
        'attackingFootball',
        'possession',
        'counterAttack',
        'highPress',
        'youthDevelopment',
        'signYoungPlayers',
        'signDomesticPlayers',
        'physicalFootball',
        'financialPrudence',
      ]),
    )
    .default([]),
  rivals: z.array(Id).default([]),
  /** Club filial / afiliado (opcional). */
  affiliateIds: z.array(Id).default([]),
  estimated: z.array(z.string()).default([]),
  source: z.enum(['generated', 'imported']).default('generated'),
  externalId: z.string().nullable().default(null),
});

// ---------------------------------------------------------------- competición
export const Tiebreaker = z.enum([
  'points',
  'goalDifference',
  'goalsFor',
  'headToHeadPoints',
  'headToHeadGoalDifference',
  'awayGoalsFor',
  'wins',
  'fairPlay',
  'drawingLots',
]);

export const Competition = z.object({
  id: Id,
  name: z.string().min(1),
  shortName: z.string().min(1).max(20),
  /** null = competición continental / internacional. */
  nationId: Id.nullable(),
  continent: z.string().nullable().default(null),
  format: z.enum(['league', 'cup', 'groupCup', 'playoff']),
  /** Nivel en la pirámide (1 = primera división). Las copas usan 0. */
  level: z.number().int().min(0).max(10),
  reputation: z.number().int().min(0).max(10000),
  /**
   * Fuerza de la liga 0-100 para convertir estadísticas en atributos.
   * null = se deriva de Nation.leagueStrength y del nivel (ver statsToAttributes).
   */
  strength: z.number().min(0).max(100).nullable().default(null),
  teamIds: z.array(Id),
  rules: z.object({
    pointsForWin: z.number().int().default(3),
    pointsForDraw: z.number().int().default(1),
    /** Vueltas en liga (2 = ida y vuelta). */
    roundRobinLegs: z.number().int().min(1).max(4).default(2),
    tiebreakers: z.array(Tiebreaker).default(['points', 'goalDifference', 'goalsFor', 'headToHeadPoints']),
    /** Eliminatorias: partidos por ronda (1 o 2) y prórroga/penaltis. */
    knockoutLegs: z.number().int().min(1).max(2).default(1),
    finalLegs: z.number().int().min(1).max(2).default(1),
    extraTime: z.boolean().default(true),
    penalties: z.boolean().default(true),
    awayGoalsRule: z.boolean().default(false),
    groups: z
      .object({
        count: z.number().int().min(1),
        size: z.number().int().min(2),
        qualifiersPerGroup: z.number().int().min(1),
        /** Evitar equipos del mismo país en el mismo grupo. */
        avoidSameNation: z.boolean().default(true),
      })
      .nullable()
      .default(null),
    maxSubstitutions: z.number().int().min(0).max(10).default(5),
    benchSize: z.number().int().min(0).max(15).default(9),
    maxForeignPlayers: z.number().int().min(0).nullable().default(null),
  }),
  schedule: z.object({
    /** Fecha del primer partido. */
    startDate: IsoDate,
    endDate: IsoDate,
    /** Día de la semana preferido (0 = domingo). */
    preferredWeekday: z.number().int().min(0).max(6).default(6),
    /** Fechas en que no se juega (pausas). */
    breaks: z.array(z.object({ from: IsoDate, to: IsoDate })).default([]),
  }),
  prizes: z.object({
    perWin: PositiveMoney.default(0),
    perDraw: PositiveMoney.default(0),
    /** Premio por posición final (índice 0 = campeón). */
    byPosition: z.array(PositiveMoney).default([]),
    /** Premio por ronda alcanzada en copas. */
    byRound: z.array(PositiveMoney).default([]),
    tvPerTeam: PositiveMoney.default(0),
  }),
  promotion: z
    .object({
      /** Competición a la que ascienden / descienden. */
      upCompetitionId: Id.nullable().default(null),
      downCompetitionId: Id.nullable().default(null),
      promoted: z.number().int().min(0).default(0),
      relegated: z.number().int().min(0).default(0),
      /** Posiciones que juegan playoff de ascenso (p. ej. [3,4,5,6]). */
      playoffPositions: z.array(z.number().int().min(1)).default([]),
    })
    .nullable()
    .default(null),
  /** Plazas continentales: posiciones -> competición destino. */
  continentalSpots: z
    .array(z.object({ competitionId: Id, positions: z.array(z.number().int().min(1)) }))
    .default([]),
  estimated: z.array(z.string()).default([]),
  source: z.enum(['generated', 'imported']).default('generated'),
});

// ---------------------------------------------------------------- partido
export const MatchEventType = z.enum([
  'kickOff',
  'goal',
  'ownGoal',
  'shot',
  'shotOnTarget',
  'save',
  'woodwork',
  'foul',
  'yellow',
  'secondYellow',
  'red',
  'offside',
  'corner',
  'freeKick',
  'penalty',
  'penaltyMissed',
  'injury',
  'substitution',
  'halfTime',
  'fullTime',
  'addedTime',
  'extraTimeStart',
  'penaltyShootout',
  'tacticChange',
  'shout',
  'var',
]);

export const MatchEvent = z.object({
  minute: z.number().int().min(0).max(150),
  second: z.number().int().min(0).max(59).default(0),
  /** 1-2 = partes, 3-4 = prórroga, 5 = penaltis. */
  period: z.number().int().min(1).max(5).default(1),
  /** Minutos de descuento en el momento del evento (para mostrar 45+2). */
  stoppage: z.number().int().min(0).max(20).default(0),
  type: MatchEventType,
  teamId: Id.nullable(),
  playerId: Id.nullable().default(null),
  /** Segundo jugador implicado (asistente, sustituto, falta recibida...). */
  otherPlayerId: Id.nullable().default(null),
  /** Coordenadas normalizadas 0-1 (x = largo del campo hacia la portería rival del equipo local). */
  x: z.number().min(0).max(1).nullable().default(null),
  y: z.number().min(0).max(1).nullable().default(null),
  /** Zona de la cuadrícula: carril 0-4, franja 0-7. */
  lane: z.number().int().min(0).max(4).nullable().default(null),
  band: z.number().int().min(0).max(7).nullable().default(null),
  xg: z.number().min(0).max(1).nullable().default(null),
  detail: z.string().nullable().default(null),
});

export const TeamMatchStats = z.object({
  goals: z.number().int().min(0),
  shots: z.number().int().min(0),
  shotsOnTarget: z.number().int().min(0),
  xg: z.number().min(0),
  possession: Percent,
  passes: z.number().int().min(0),
  passesCompleted: z.number().int().min(0),
  fouls: z.number().int().min(0),
  corners: z.number().int().min(0),
  offsides: z.number().int().min(0),
  yellow: z.number().int().min(0),
  red: z.number().int().min(0),
  tackles: z.number().int().min(0),
  interceptions: z.number().int().min(0),
});

export const LineupEntry = z.object({
  playerId: Id,
  position: PositionCode,
  role: z.string().min(1),
  duty: z.enum(['defend', 'support', 'attack', 'automatic']),
});

export const Match = z.object({
  id: Id,
  competitionId: Id,
  season: z.string(),
  round: z.string(),
  date: IsoDate,
  homeId: Id,
  awayId: Id,
  played: z.boolean().default(false),
  seed: z.number().int().nullable().default(null),
  lineups: z
    .object({
      home: z.object({ starting: z.array(LineupEntry), bench: z.array(Id) }),
      away: z.object({ starting: z.array(LineupEntry), bench: z.array(Id) }),
    })
    .nullable()
    .default(null),
  events: z.array(MatchEvent).default([]),
  stats: z.object({ home: TeamMatchStats, away: TeamMatchStats }).nullable().default(null),
  ratings: z.array(z.object({ playerId: Id, rating: z.number().min(1).max(10) })).default([]),
  playerOfMatchId: Id.nullable().default(null),
  attendance: z.number().int().min(0).nullable().default(null),
  result: z
    .object({
      homeGoals: z.number().int().min(0),
      awayGoals: z.number().int().min(0),
      extraTime: z.boolean().default(false),
      penalties: z.object({ home: z.number().int().min(0), away: z.number().int().min(0) }).nullable().default(null),
    })
    .nullable()
    .default(null),
});

// ---------------------------------------------------------------- mensajes
export const MessageAction = z.object({
  id: z.string().min(1),
  kind: z.enum(['accept', 'reject', 'reply', 'open', 'negotiate', 'dismiss']),
  /** Clave i18n de la etiqueta. */
  labelKey: z.string(),
  /** Datos para el manejador de la acción. */
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const Message = z.object({
  id: Id,
  date: IsoDate,
  type: z.enum([
    'board',
    'transfer',
    'contract',
    'injury',
    'match',
    'scouting',
    'staff',
    'player',
    'competition',
    'media',
    'finance',
    'youth',
    'news',
  ]),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  sender: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  read: z.boolean().default(false),
  /** Si detiene el avance del tiempo hasta que se resuelva. */
  blocking: z.boolean().default(false),
  actions: z.array(MessageAction).default([]),
  related: z
    .object({
      playerId: Id.nullable().default(null),
      clubId: Id.nullable().default(null),
      matchId: Id.nullable().default(null),
      competitionId: Id.nullable().default(null),
    })
    .default({ playerId: null, clubId: null, matchId: null, competitionId: null }),
  resolvedActionId: z.string().nullable().default(null),
  /** Plantilla i18n (msg.<key>.subject / .body) para volver a traducir el mensaje. */
  template: z
    .object({ key: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) })
    .nullable()
    .default(null),
});

// ---------------------------------------------------------------- base de datos completa
export const WorldDatabase = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: z.object({
    name: z.string(),
    source: z.enum(['generated', 'imported', 'mixed']),
    seed: z.number().int().nullable().default(null),
    createdAt: z.string(),
    /** Fecha de inicio de partida (día 1 de la pretemporada). */
    startDate: IsoDate,
    /** Temporada inicial, p. ej. "2026/27". */
    season: z.string(),
  }),
  nations: z.array(Nation),
  clubs: z.array(Club),
  players: z.array(Player),
  staff: z.array(Staff),
  competitions: z.array(Competition),
});

export type Attributes = z.infer<typeof Attributes>;
export type Contract = z.infer<typeof Contract>;
export type Injury = z.infer<typeof Injury>;
export type SeasonStats = z.infer<typeof SeasonStats>;
export type PositionRating = z.infer<typeof PositionRating>;
export type PersonalityType = z.infer<typeof PersonalityType>;
export type Player = z.infer<typeof Player>;
export type StaffRole = z.infer<typeof StaffRole>;
export type StaffAttributes = z.infer<typeof StaffAttributes>;
export type Staff = z.infer<typeof Staff>;
export type Nation = z.infer<typeof Nation>;
export type BoardObjective = z.infer<typeof BoardObjective>;
export type Club = z.infer<typeof Club>;
export type Competition = z.infer<typeof Competition>;
export type MatchEvent = z.infer<typeof MatchEvent>;
export type TeamMatchStats = z.infer<typeof TeamMatchStats>;
export type Match = z.infer<typeof Match>;
export type Message = z.infer<typeof Message>;
export type WorldDatabase = z.infer<typeof WorldDatabase>;

/** Tipos de entrada (antes de aplicar valores por defecto de Zod). */
export type PlayerInput = z.input<typeof Player>;
export type ClubInput = z.input<typeof Club>;
export type CompetitionInput = z.input<typeof Competition>;
