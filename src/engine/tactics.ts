/**
 * Tácticas: formaciones, mentalidad, instrucciones de equipo e individuales,
 * ajustes rápidos (Tactical Tweaks) y gritos (Shouts).
 * Módulo puro: sin React, usable desde el motor y desde la interfaz.
 */
import type { Duty } from '../data/roles';
import type { Position } from '../data/positions';

// ---------------------------------------------------------------- formaciones
export interface FormationSlot {
  position: Position;
  role: string;
  duty: Duty;
  /** Posición base: x 0 = propia portería → 1 = portería rival; y 0 = banda izquierda → 1 = derecha. */
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  slots: readonly FormationSlot[];
}

const S = (position: Position, role: string, duty: Duty, x: number, y: number): FormationSlot => ({ position, role, duty, x, y });
const GK = S('GK', 'goalkeeper', 'defend', 0.04, 0.5);
const back4 = [
  S('LB', 'fullBack', 'support', 0.22, 0.1), S('CB', 'centralDefender', 'defend', 0.18, 0.37),
  S('CB', 'centralDefender', 'defend', 0.18, 0.63), S('RB', 'fullBack', 'support', 0.22, 0.9),
];
const back3 = [
  S('CB', 'centralDefender', 'defend', 0.18, 0.25), S('CB', 'centralDefender', 'defend', 0.16, 0.5),
  S('CB', 'centralDefender', 'defend', 0.18, 0.75),
];
const back5 = [
  S('LWB', 'wingBack', 'support', 0.28, 0.07), S('CB', 'centralDefender', 'defend', 0.18, 0.28),
  S('CB', 'centralDefender', 'defend', 0.16, 0.5), S('CB', 'centralDefender', 'defend', 0.18, 0.72),
  S('RWB', 'wingBack', 'support', 0.28, 0.93),
];

export const FORMATIONS: Record<string, Formation> = {
  '4-4-2': { id: '4-4-2', slots: [GK, ...back4,
    S('LM', 'wideMidfielder', 'support', 0.5, 0.12), S('CM', 'centralMidfielder', 'defend', 0.45, 0.38),
    S('CM', 'boxToBoxMidfielder', 'support', 0.47, 0.62), S('RM', 'wideMidfielder', 'support', 0.5, 0.88),
    S('ST', 'advancedForward', 'attack', 0.78, 0.38), S('ST', 'targetForward', 'support', 0.75, 0.62)] },
  '4-3-3': { id: '4-3-3', slots: [GK, ...back4,
    S('DM', 'defensiveMidfielder', 'defend', 0.35, 0.5), S('CM', 'centralMidfielder', 'support', 0.48, 0.32),
    S('CM', 'mezzala', 'attack', 0.5, 0.68), S('LW', 'insideForward', 'attack', 0.74, 0.12),
    S('RW', 'winger', 'attack', 0.74, 0.88), S('ST', 'advancedForward', 'attack', 0.82, 0.5)] },
  '4-2-3-1': { id: '4-2-3-1', slots: [GK, ...back4,
    S('DM', 'deepLyingPlaymaker', 'support', 0.36, 0.38), S('DM', 'ballWinningMidfielder', 'defend', 0.36, 0.62),
    S('LW', 'invertedWinger', 'support', 0.66, 0.12), S('AM', 'attackingMidfielder', 'attack', 0.62, 0.5),
    S('RW', 'winger', 'attack', 0.66, 0.88), S('ST', 'advancedForward', 'attack', 0.82, 0.5)] },
  '4-1-4-1': { id: '4-1-4-1', slots: [GK, ...back4,
    S('DM', 'anchor', 'defend', 0.34, 0.5), S('LM', 'winger', 'support', 0.55, 0.12),
    S('CM', 'boxToBoxMidfielder', 'support', 0.5, 0.36), S('CM', 'advancedPlaymaker', 'attack', 0.52, 0.64),
    S('RM', 'winger', 'attack', 0.55, 0.88), S('ST', 'completeForward', 'attack', 0.8, 0.5)] },
  '4-4-1-1': { id: '4-4-1-1', slots: [GK, ...back4,
    S('LM', 'wideMidfielder', 'support', 0.5, 0.12), S('CM', 'centralMidfielder', 'defend', 0.44, 0.38),
    S('CM', 'boxToBoxMidfielder', 'support', 0.46, 0.62), S('RM', 'wideMidfielder', 'support', 0.5, 0.88),
    S('AM', 'shadowStriker', 'attack', 0.66, 0.5), S('ST', 'targetForward', 'support', 0.8, 0.5)] },
  '4-3-1-2': { id: '4-3-1-2', slots: [GK, ...back4,
    S('DM', 'defensiveMidfielder', 'defend', 0.34, 0.5), S('CM', 'carrilero', 'support', 0.46, 0.28),
    S('CM', 'carrilero', 'support', 0.46, 0.72), S('AM', 'advancedPlaymaker', 'attack', 0.62, 0.5),
    S('ST', 'advancedForward', 'attack', 0.8, 0.38), S('ST', 'deepLyingForward', 'support', 0.76, 0.62)] },
  '4-5-1': { id: '4-5-1', slots: [GK, ...back4,
    S('LM', 'wideMidfielder', 'support', 0.48, 0.12), S('CM', 'centralMidfielder', 'defend', 0.42, 0.32),
    S('CM', 'deepLyingPlaymaker', 'support', 0.4, 0.5), S('CM', 'boxToBoxMidfielder', 'support', 0.45, 0.68),
    S('RM', 'wideMidfielder', 'support', 0.48, 0.88), S('ST', 'completeForward', 'support', 0.78, 0.5)] },
  '3-5-2': { id: '3-5-2', slots: [GK, ...back3,
    S('LWB', 'wingBack', 'support', 0.4, 0.07), S('DM', 'defensiveMidfielder', 'defend', 0.36, 0.5),
    S('CM', 'boxToBoxMidfielder', 'support', 0.5, 0.33), S('CM', 'advancedPlaymaker', 'support', 0.5, 0.67),
    S('RWB', 'wingBack', 'support', 0.4, 0.93),
    S('ST', 'advancedForward', 'attack', 0.8, 0.38), S('ST', 'deepLyingForward', 'support', 0.76, 0.62)] },
  '3-4-3': { id: '3-4-3', slots: [GK, ...back3,
    S('LWB', 'wingBack', 'support', 0.42, 0.07), S('CM', 'centralMidfielder', 'defend', 0.44, 0.38),
    S('CM', 'boxToBoxMidfielder', 'support', 0.46, 0.62), S('RWB', 'wingBack', 'support', 0.42, 0.93),
    S('LW', 'insideForward', 'attack', 0.74, 0.18), S('ST', 'advancedForward', 'attack', 0.82, 0.5),
    S('RW', 'insideForward', 'attack', 0.74, 0.82)] },
  '3-4-2-1': { id: '3-4-2-1', slots: [GK, ...back3,
    S('LWB', 'wingBack', 'support', 0.42, 0.07), S('CM', 'deepLyingPlaymaker', 'defend', 0.42, 0.38),
    S('CM', 'boxToBoxMidfielder', 'support', 0.45, 0.62), S('RWB', 'wingBack', 'support', 0.42, 0.93),
    S('AM', 'shadowStriker', 'attack', 0.66, 0.35), S('AM', 'attackingMidfielder', 'support', 0.66, 0.65),
    S('ST', 'completeForward', 'attack', 0.82, 0.5)] },
  '5-3-2': { id: '5-3-2', slots: [GK, ...back5,
    S('CM', 'centralMidfielder', 'defend', 0.42, 0.3), S('CM', 'deepLyingPlaymaker', 'support', 0.4, 0.5),
    S('CM', 'boxToBoxMidfielder', 'support', 0.44, 0.7),
    S('ST', 'advancedForward', 'attack', 0.78, 0.38), S('ST', 'targetForward', 'support', 0.75, 0.62)] },
  '5-4-1': { id: '5-4-1', slots: [GK, ...back5,
    S('LM', 'wideMidfielder', 'defend', 0.46, 0.14), S('CM', 'centralMidfielder', 'defend', 0.4, 0.38),
    S('CM', 'boxToBoxMidfielder', 'support', 0.42, 0.62), S('RM', 'wideMidfielder', 'defend', 0.46, 0.86),
    S('ST', 'targetForward', 'support', 0.76, 0.5)] },
};

export const FORMATION_IDS = Object.keys(FORMATIONS);

// ---------------------------------------------------------------- instrucciones
/** Mentalidad 1 (muy defensiva) … 7 (muy ofensiva). 4 = equilibrada. */
export type Mentality = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const MENTALITY_IDS = ['veryDefensive', 'defensive', 'cautious', 'balanced', 'positive', 'attacking', 'veryAttacking'] as const;

export interface TeamInstructions {
  /** Altura de la línea defensiva 1 (muy baja) – 5 (muy alta). */
  defensiveLine: number;
  /** Línea de presión 1 (bloque bajo) – 5 (presión alta). */
  pressLine: number;
  /** Intensidad de presión 1-5. */
  pressIntensity: number;
  /** Ritmo 1 (lento) – 5 (muy rápido). */
  tempo: number;
  /** Anchura en ataque 1 (estrecha) – 5 (muy amplia). */
  width: number;
  /** Estilo de pase 1 (muy corto) – 5 (muy directo). */
  passingStyle: number;
  counterAttack: boolean;
  counterPress: boolean;
  regroup: boolean;
  goalkeeperDistribution: 'short' | 'mixed' | 'long';
}

export const DEFAULT_INSTRUCTIONS: TeamInstructions = {
  defensiveLine: 3, pressLine: 3, pressIntensity: 3, tempo: 3, width: 3, passingStyle: 3,
  counterAttack: false, counterPress: false, regroup: false, goalkeeperDistribution: 'mixed',
};

export interface IndividualInstructions {
  moreDirectPasses?: boolean;
  dribbleMore?: boolean;
  shootMore?: boolean;
  crossFromByline?: boolean;
  arriveLate?: boolean;
  attackDefensiveLine?: boolean;
  runs?: 'nearPost' | 'farPost' | 'centre';
}

export interface TacticSlot extends FormationSlot {
  individual: IndividualInstructions;
}

export interface SetPieceTakers {
  corners: string | null;
  freeKicks: string | null;
  penalties: string | null;
  throwIns: string | null;
  captain: string | null;
}

export interface TeamTactic {
  formation: string;
  mentality: Mentality;
  instructions: TeamInstructions;
  slots: TacticSlot[];
  setPieces: SetPieceTakers;
}

export function tacticFromFormation(formationId: string, mentality: Mentality = 4, instructions: Partial<TeamInstructions> = {}): TeamTactic {
  const f = FORMATIONS[formationId] ?? (FORMATIONS['4-4-2'] as Formation);
  return {
    formation: f.id,
    mentality,
    instructions: { ...DEFAULT_INSTRUCTIONS, ...instructions },
    slots: f.slots.map((s) => ({ ...s, individual: {} })),
    setPieces: { corners: null, freeKicks: null, penalties: null, throwIns: null, captain: null },
  };
}

// ---------------------------------------------------------------- ajustes rápidos (Tactical Tweaks)
export const TWEAK_IDS = [
  'moreUrgency',
  'longerPasses',
  'shorterPasses',
  'useWidth',
  'playNarrower',
  'reducePressing',
  'pressHigher',
  'dropDeeper',
  'pushLineUp',
  'slowDown',
  'counterMore',
  'wingersSwitchFlanks',
  'goalkeeperUpForSetPieces',
] as const;
export type TweakId = (typeof TWEAK_IDS)[number];

/** Efecto de cada ajuste sobre las instrucciones (se suman; los contradictorios se anulan). */
export const TWEAK_EFFECTS: Record<TweakId, Partial<Record<keyof TeamInstructions | 'mentality', number>>> = {
  moreUrgency: { tempo: 1, mentality: 1, passingStyle: 0.5 },
  longerPasses: { passingStyle: 1 },
  shorterPasses: { passingStyle: -1 },
  useWidth: { width: 1 },
  playNarrower: { width: -1 },
  reducePressing: { pressIntensity: -1, pressLine: -0.5 },
  pressHigher: { pressIntensity: 1, pressLine: 1 },
  dropDeeper: { defensiveLine: -1, pressLine: -0.5 },
  pushLineUp: { defensiveLine: 1 },
  slowDown: { tempo: -1, mentality: -0.5 },
  counterMore: { passingStyle: 0.5, tempo: 0.5 },
  wingersSwitchFlanks: {},
  goalkeeperUpForSetPieces: {},
};

// ---------------------------------------------------------------- gritos (Shouts)
export const SHOUT_IDS = ['encourage', 'demandMore', 'praise', 'focus', 'calmDown', 'fireUp', 'showPassion', 'noPressure'] as const;
export type ShoutId = (typeof SHOUT_IDS)[number];

/** Estado mental colectivo (cada valor de -1 a 1; 0 = neutro). */
export interface TeamMentalState {
  confidence: number;
  concentration: number;
  aggression: number;
  tension: number;
}

/**
 * Efecto base de cada grito. El resultado real depende de la personalidad media del
 * equipo (determinación, temperamento, profesionalidad) y del marcador: exigir más
 * cuando se va ganando molesta; animar cuando se va perdiendo funciona mejor.
 */
export const SHOUT_EFFECTS: Record<ShoutId, TeamMentalState> = {
  encourage: { confidence: 0.25, concentration: 0.05, aggression: 0, tension: -0.1 },
  demandMore: { confidence: -0.05, concentration: 0.15, aggression: 0.1, tension: 0.2 },
  praise: { confidence: 0.3, concentration: -0.1, aggression: -0.05, tension: -0.15 },
  focus: { confidence: 0, concentration: 0.3, aggression: -0.05, tension: 0.05 },
  calmDown: { confidence: 0.05, concentration: 0.1, aggression: -0.3, tension: -0.25 },
  fireUp: { confidence: 0.1, concentration: -0.05, aggression: 0.3, tension: 0.15 },
  showPassion: { confidence: 0.15, concentration: 0, aggression: 0.15, tension: 0.05 },
  noPressure: { confidence: 0.1, concentration: -0.1, aggression: -0.1, tension: -0.35 },
};

export const NEUTRAL_MENTAL: TeamMentalState = { confidence: 0, concentration: 0, aggression: 0, tension: 0 };
