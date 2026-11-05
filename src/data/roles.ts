/**
 * Roles tácticos y sus pesos de atributos.
 *
 * - `positions`: posiciones en las que se puede asignar el rol.
 * - `duties`: deberes disponibles (defensa / apoyo / ataque).
 * - `key` / `preferable`: atributos clave (peso 3) y preferibles (peso 1.5) para
 *   calcular la idoneidad del jugador al rol (0-20) y su rendimiento en el motor.
 * - `behaviour`: tendencias que el motor de partido aplica (multiplicadores ~0.5-1.5)
 *   sobre la probabilidad de cada intención en las fases de posesión. Fase 2.
 */
import type { FlatAttributes, VisibleAttr } from './attributes';
import type { Position } from './positions';

export type Duty = 'defend' | 'support' | 'attack';

export interface RoleBehaviour {
  /** Tendencia a subir al ataque / quedarse. */
  forwardRuns: number;
  /** Tendencia a regatear frente a pasar. */
  dribble: number;
  /** Riesgo en el pase (pases clave / pases largos). */
  passRisk: number;
  /** Tendencia a tirar. */
  shoot: number;
  /** Tendencia a centrar. */
  cross: number;
  /** Intensidad de presión sin balón. */
  press: number;
  /** Libertad de movimiento (abandonar la posición). */
  roam: number;
  /** Desgaste físico relativo (afecta a la fatiga). */
  workload: number;
}

export interface RoleDef {
  id: string;
  positions: readonly Position[];
  duties: readonly Duty[];
  key: readonly VisibleAttr[];
  preferable: readonly VisibleAttr[];
  behaviour: RoleBehaviour;
}

const B = (b: Partial<RoleBehaviour>): RoleBehaviour => ({
  forwardRuns: 1, dribble: 1, passRisk: 1, shoot: 1, cross: 1, press: 1, roam: 1, workload: 1, ...b,
});

export const ROLES: readonly RoleDef[] = [
  // Porteros
  { id: 'goalkeeper', positions: ['GK'], duties: ['defend'],
    key: ['reflexes', 'handling', 'oneOnOnes', 'positioning', 'concentration'],
    preferable: ['aerialReach', 'communication', 'kicking', 'agility', 'decisions'],
    behaviour: B({ forwardRuns: 0, roam: 0.2, workload: 0.3 }) },
  { id: 'sweeperKeeper', positions: ['GK'], duties: ['defend', 'support', 'attack'],
    key: ['reflexes', 'oneOnOnes', 'playWithFeet', 'anticipation', 'composure'],
    preferable: ['kicking', 'handling', 'acceleration', 'decisions', 'passing', 'vision'],
    behaviour: B({ forwardRuns: 0.2, roam: 0.6, passRisk: 1.2, workload: 0.4 }) },
  // Defensas centrales
  { id: 'centralDefender', positions: ['CB'], duties: ['defend', 'support'],
    key: ['marking', 'tackling', 'heading', 'positioning', 'jumping', 'strength'],
    preferable: ['anticipation', 'concentration', 'decisions', 'bravery', 'composure', 'pace'],
    behaviour: B({ forwardRuns: 0.2, dribble: 0.3, passRisk: 0.6, shoot: 0.2, cross: 0.1, roam: 0.3, workload: 0.8 }) },
  { id: 'ballPlayingDefender', positions: ['CB'], duties: ['defend', 'support'],
    key: ['marking', 'tackling', 'passing', 'composure', 'positioning'],
    preferable: ['firstTouch', 'technique', 'vision', 'decisions', 'heading', 'anticipation'],
    behaviour: B({ forwardRuns: 0.3, dribble: 0.5, passRisk: 1.3, shoot: 0.2, cross: 0.1, roam: 0.4, workload: 0.85 }) },
  { id: 'noNonsenseDefender', positions: ['CB'], duties: ['defend'],
    key: ['marking', 'tackling', 'heading', 'strength', 'bravery'],
    preferable: ['jumping', 'positioning', 'aggression', 'concentration'],
    behaviour: B({ forwardRuns: 0.1, dribble: 0.1, passRisk: 0.3, shoot: 0.1, cross: 0.05, roam: 0.2, workload: 0.8 }) },
  { id: 'libero', positions: ['CB'], duties: ['support', 'attack'],
    key: ['marking', 'tackling', 'passing', 'firstTouch', 'composure', 'vision', 'decisions'],
    preferable: ['technique', 'dribbling', 'anticipation', 'positioning', 'teamwork', 'stamina'],
    behaviour: B({ forwardRuns: 0.9, dribble: 0.9, passRisk: 1.3, shoot: 0.5, roam: 1.2, workload: 1.1 }) },
  { id: 'wideCentreBack', positions: ['CB'], duties: ['defend', 'support', 'attack'],
    key: ['marking', 'tackling', 'positioning', 'pace', 'stamina'],
    preferable: ['crossing', 'dribbling', 'passing', 'workRate', 'decisions'],
    behaviour: B({ forwardRuns: 0.7, dribble: 0.7, cross: 0.7, roam: 0.6, workload: 1.1 }) },
  // Laterales y carrileros
  { id: 'fullBack', positions: ['LB', 'RB'], duties: ['defend', 'support', 'attack'],
    key: ['marking', 'tackling', 'positioning', 'anticipation', 'concentration'],
    preferable: ['crossing', 'pace', 'stamina', 'teamwork', 'workRate', 'passing'],
    behaviour: B({ forwardRuns: 0.8, dribble: 0.6, cross: 1, workload: 1.2 }) },
  { id: 'wingBack', positions: ['LB', 'RB', 'LWB', 'RWB'], duties: ['defend', 'support', 'attack'],
    key: ['crossing', 'dribbling', 'stamina', 'workRate', 'pace', 'teamwork'],
    preferable: ['tackling', 'marking', 'acceleration', 'offTheBall', 'technique', 'agility'],
    behaviour: B({ forwardRuns: 1.3, dribble: 1, cross: 1.4, press: 1.1, workload: 1.45 }) },
  { id: 'invertedFullBack', positions: ['LB', 'RB'], duties: ['defend', 'support'],
    key: ['passing', 'tackling', 'positioning', 'composure', 'decisions'],
    preferable: ['firstTouch', 'technique', 'anticipation', 'teamwork', 'marking'],
    behaviour: B({ forwardRuns: 0.5, dribble: 0.5, passRisk: 1.1, cross: 0.3, roam: 0.8, workload: 1.05 }) },
  { id: 'invertedWingBack', positions: ['LB', 'RB', 'LWB', 'RWB'], duties: ['defend', 'support', 'attack'],
    key: ['passing', 'firstTouch', 'technique', 'decisions', 'composure', 'stamina'],
    preferable: ['vision', 'dribbling', 'tackling', 'workRate', 'teamwork'],
    behaviour: B({ forwardRuns: 1, passRisk: 1.25, cross: 0.4, roam: 1.1, workload: 1.3 }) },
  { id: 'completeWingBack', positions: ['LWB', 'RWB'], duties: ['support', 'attack'],
    key: ['crossing', 'dribbling', 'technique', 'flair', 'offTheBall', 'stamina', 'workRate'],
    preferable: ['firstTouch', 'passing', 'pace', 'acceleration', 'agility', 'teamwork'],
    behaviour: B({ forwardRuns: 1.5, dribble: 1.3, cross: 1.5, roam: 1.3, workload: 1.5 }) },
  // Mediocentros defensivos
  { id: 'defensiveMidfielder', positions: ['DM'], duties: ['defend', 'support'],
    key: ['tackling', 'positioning', 'anticipation', 'concentration', 'teamwork'],
    preferable: ['marking', 'passing', 'decisions', 'workRate', 'stamina', 'strength'],
    behaviour: B({ forwardRuns: 0.3, dribble: 0.4, passRisk: 0.7, shoot: 0.4, cross: 0.2, roam: 0.4, workload: 1.1 }) },
  { id: 'anchor', positions: ['DM'], duties: ['defend'],
    key: ['positioning', 'marking', 'tackling', 'concentration', 'anticipation', 'decisions'],
    preferable: ['strength', 'teamwork', 'composure'],
    behaviour: B({ forwardRuns: 0.1, dribble: 0.3, passRisk: 0.5, shoot: 0.3, cross: 0.1, roam: 0.2, press: 0.8, workload: 0.95 }) },
  { id: 'deepLyingPlaymaker', positions: ['DM', 'CM'], duties: ['defend', 'support'],
    key: ['passing', 'vision', 'firstTouch', 'technique', 'composure', 'decisions'],
    preferable: ['anticipation', 'teamwork', 'positioning', 'balance'],
    behaviour: B({ forwardRuns: 0.4, dribble: 0.6, passRisk: 1.5, shoot: 0.6, cross: 0.4, roam: 0.6, workload: 0.95 }) },
  { id: 'regista', positions: ['DM'], duties: ['support'],
    key: ['passing', 'vision', 'technique', 'firstTouch', 'flair', 'composure', 'decisions'],
    preferable: ['dribbling', 'longShots', 'anticipation', 'offTheBall', 'balance'],
    behaviour: B({ forwardRuns: 0.6, dribble: 0.8, passRisk: 1.7, roam: 1.3, workload: 0.95 }) },
  { id: 'ballWinningMidfielder', positions: ['DM', 'CM'], duties: ['defend', 'support'],
    key: ['tackling', 'aggression', 'workRate', 'stamina', 'teamwork'],
    preferable: ['marking', 'anticipation', 'bravery', 'positioning', 'strength', 'agility'],
    behaviour: B({ forwardRuns: 0.5, dribble: 0.5, passRisk: 0.6, shoot: 0.5, press: 1.6, roam: 0.9, workload: 1.4 }) },
  // Mediocentros
  { id: 'centralMidfielder', positions: ['CM'], duties: ['defend', 'support', 'attack'],
    key: ['passing', 'decisions', 'teamwork', 'firstTouch', 'tackling'],
    preferable: ['vision', 'technique', 'workRate', 'stamina', 'anticipation', 'composure', 'offTheBall'],
    behaviour: B({ workload: 1.1 }) },
  { id: 'boxToBoxMidfielder', positions: ['CM'], duties: ['support'],
    key: ['passing', 'tackling', 'offTheBall', 'workRate', 'stamina', 'teamwork'],
    preferable: ['dribbling', 'finishing', 'longShots', 'acceleration', 'pace', 'strength', 'decisions'],
    behaviour: B({ forwardRuns: 1.3, shoot: 1.2, press: 1.2, roam: 1.1, workload: 1.5 }) },
  { id: 'advancedPlaymaker', positions: ['CM', 'AM', 'LM', 'RM'], duties: ['support', 'attack'],
    key: ['passing', 'vision', 'technique', 'firstTouch', 'decisions', 'flair', 'composure'],
    preferable: ['dribbling', 'offTheBall', 'teamwork', 'agility', 'anticipation'],
    behaviour: B({ forwardRuns: 1.1, dribble: 1.1, passRisk: 1.6, roam: 1.3, workload: 1 }) },
  { id: 'mezzala', positions: ['CM'], duties: ['support', 'attack'],
    key: ['passing', 'dribbling', 'technique', 'offTheBall', 'decisions', 'vision'],
    preferable: ['firstTouch', 'longShots', 'flair', 'acceleration', 'workRate', 'balance'],
    behaviour: B({ forwardRuns: 1.3, dribble: 1.3, passRisk: 1.3, shoot: 1.2, roam: 1.3, workload: 1.25 }) },
  { id: 'carrilero', positions: ['CM'], duties: ['support'],
    key: ['passing', 'tackling', 'positioning', 'teamwork', 'stamina', 'workRate'],
    preferable: ['firstTouch', 'technique', 'decisions', 'anticipation', 'concentration'],
    behaviour: B({ forwardRuns: 0.8, dribble: 0.6, cross: 0.4, press: 1.1, roam: 0.6, workload: 1.35 }) },
  // Bandas
  { id: 'wideMidfielder', positions: ['LM', 'RM'], duties: ['defend', 'support', 'attack'],
    key: ['passing', 'crossing', 'teamwork', 'workRate', 'decisions'],
    preferable: ['tackling', 'technique', 'stamina', 'positioning', 'concentration', 'offTheBall'],
    behaviour: B({ cross: 1.2, workload: 1.25 }) },
  { id: 'winger', positions: ['LM', 'RM', 'LW', 'RW'], duties: ['support', 'attack'],
    key: ['crossing', 'dribbling', 'technique', 'pace', 'acceleration', 'agility'],
    preferable: ['firstTouch', 'flair', 'offTheBall', 'passing', 'workRate', 'stamina', 'balance'],
    behaviour: B({ forwardRuns: 1.2, dribble: 1.4, cross: 1.6, shoot: 0.8, workload: 1.35 }) },
  { id: 'invertedWinger', positions: ['LM', 'RM', 'LW', 'RW'], duties: ['support', 'attack'],
    key: ['dribbling', 'passing', 'technique', 'acceleration', 'agility', 'vision'],
    preferable: ['firstTouch', 'longShots', 'flair', 'offTheBall', 'decisions', 'composure'],
    behaviour: B({ forwardRuns: 1.1, dribble: 1.4, passRisk: 1.3, shoot: 1.2, cross: 0.6, roam: 1.1, workload: 1.3 }) },
  { id: 'insideForward', positions: ['LW', 'RW'], duties: ['support', 'attack'],
    key: ['dribbling', 'finishing', 'firstTouch', 'technique', 'offTheBall', 'acceleration', 'composure'],
    preferable: ['pace', 'agility', 'flair', 'longShots', 'anticipation', 'balance'],
    behaviour: B({ forwardRuns: 1.5, dribble: 1.4, shoot: 1.6, cross: 0.4, roam: 1.2, workload: 1.3 }) },
  { id: 'defensiveWinger', positions: ['LM', 'RM'], duties: ['defend', 'support'],
    key: ['workRate', 'stamina', 'teamwork', 'tackling', 'positioning', 'crossing'],
    preferable: ['marking', 'technique', 'concentration', 'decisions', 'aggression'],
    behaviour: B({ forwardRuns: 0.7, cross: 1, press: 1.4, workload: 1.45 }) },
  { id: 'widePlaymaker', positions: ['LM', 'RM', 'LW', 'RW'], duties: ['support', 'attack'],
    key: ['passing', 'vision', 'technique', 'firstTouch', 'decisions', 'composure'],
    preferable: ['dribbling', 'flair', 'teamwork', 'agility', 'offTheBall'],
    behaviour: B({ dribble: 1.1, passRisk: 1.5, cross: 0.7, roam: 1.3 }) },
  { id: 'invertedForward', positions: ['LW', 'RW'], duties: ['attack'],
    key: ['finishing', 'offTheBall', 'dribbling', 'composure', 'acceleration'],
    preferable: ['firstTouch', 'technique', 'heading', 'anticipation', 'pace'],
    behaviour: B({ forwardRuns: 1.6, dribble: 1.2, shoot: 1.8, cross: 0.3, roam: 1.1, workload: 1.2 }) },
  // Mediapuntas
  { id: 'attackingMidfielder', positions: ['AM'], duties: ['support', 'attack'],
    key: ['passing', 'firstTouch', 'technique', 'offTheBall', 'decisions', 'flair'],
    preferable: ['dribbling', 'longShots', 'vision', 'anticipation', 'composure', 'agility', 'finishing'],
    behaviour: B({ forwardRuns: 1.3, dribble: 1.2, passRisk: 1.3, shoot: 1.3, roam: 1.1 }) },
  { id: 'shadowStriker', positions: ['AM'], duties: ['attack'],
    key: ['finishing', 'offTheBall', 'firstTouch', 'anticipation', 'composure', 'acceleration'],
    preferable: ['dribbling', 'technique', 'passing', 'workRate', 'pace', 'balance'],
    behaviour: B({ forwardRuns: 1.7, shoot: 1.6, roam: 1.1, workload: 1.2 }) },
  { id: 'enganche', positions: ['AM'], duties: ['support'],
    key: ['passing', 'vision', 'technique', 'firstTouch', 'composure', 'decisions'],
    preferable: ['dribbling', 'flair', 'anticipation', 'agility', 'teamwork'],
    behaviour: B({ forwardRuns: 0.6, dribble: 1, passRisk: 1.7, roam: 0.7, press: 0.4, workload: 0.7 }) },
  { id: 'trequartista', positions: ['AM', 'ST'], duties: ['attack'],
    key: ['passing', 'vision', 'technique', 'flair', 'dribbling', 'firstTouch', 'composure'],
    preferable: ['finishing', 'offTheBall', 'acceleration', 'agility', 'decisions', 'balance'],
    behaviour: B({ forwardRuns: 1.2, dribble: 1.5, passRisk: 1.6, shoot: 1.3, roam: 1.7, press: 0.4, workload: 0.8 }) },
  // Delanteros
  { id: 'advancedForward', positions: ['ST'], duties: ['attack'],
    key: ['finishing', 'offTheBall', 'acceleration', 'pace', 'composure', 'firstTouch'],
    preferable: ['dribbling', 'technique', 'anticipation', 'workRate', 'agility', 'balance'],
    behaviour: B({ forwardRuns: 1.7, shoot: 1.5, press: 0.9, workload: 1.15 }) },
  { id: 'targetForward', positions: ['ST'], duties: ['support', 'attack'],
    key: ['heading', 'strength', 'jumping', 'bravery', 'finishing', 'balance'],
    preferable: ['firstTouch', 'composure', 'offTheBall', 'teamwork', 'aggression', 'anticipation'],
    behaviour: B({ forwardRuns: 1, dribble: 0.5, shoot: 1.2, roam: 0.5, workload: 1.1 }) },
  { id: 'poacher', positions: ['ST'], duties: ['attack'],
    key: ['finishing', 'offTheBall', 'anticipation', 'composure', 'acceleration'],
    preferable: ['firstTouch', 'heading', 'technique', 'decisions', 'pace'],
    behaviour: B({ forwardRuns: 1.8, dribble: 0.6, passRisk: 0.6, shoot: 1.8, press: 0.5, roam: 0.4, workload: 0.85 }) },
  { id: 'deepLyingForward', positions: ['ST'], duties: ['support', 'attack'],
    key: ['passing', 'firstTouch', 'technique', 'composure', 'decisions', 'offTheBall', 'teamwork'],
    preferable: ['finishing', 'vision', 'strength', 'anticipation', 'balance', 'flair'],
    behaviour: B({ forwardRuns: 0.9, passRisk: 1.3, shoot: 1.1, roam: 1.1 }) },
  { id: 'falseNine', positions: ['ST'], duties: ['support'],
    key: ['passing', 'vision', 'technique', 'firstTouch', 'dribbling', 'composure', 'decisions', 'offTheBall'],
    preferable: ['finishing', 'flair', 'acceleration', 'agility', 'teamwork', 'anticipation'],
    behaviour: B({ forwardRuns: 0.6, dribble: 1.3, passRisk: 1.5, shoot: 1, roam: 1.6, workload: 1.05 }) },
  { id: 'pressingForward', positions: ['ST'], duties: ['defend', 'support', 'attack'],
    key: ['workRate', 'stamina', 'aggression', 'anticipation', 'acceleration', 'teamwork'],
    preferable: ['finishing', 'firstTouch', 'bravery', 'strength', 'offTheBall', 'decisions'],
    behaviour: B({ forwardRuns: 1.2, shoot: 1.1, press: 1.8, workload: 1.5 }) },
  { id: 'completeForward', positions: ['ST'], duties: ['support', 'attack'],
    key: ['finishing', 'heading', 'firstTouch', 'technique', 'dribbling', 'passing', 'composure', 'offTheBall', 'strength'],
    preferable: ['vision', 'acceleration', 'pace', 'agility', 'anticipation', 'decisions', 'workRate'],
    behaviour: B({ forwardRuns: 1.3, dribble: 1.2, passRisk: 1.2, shoot: 1.4, roam: 1.2, workload: 1.15 }) },
];

export const ROLE_BY_ID: ReadonlyMap<string, RoleDef> = new Map(ROLES.map((r) => [r.id, r]));

export function rolesForPosition(pos: Position): RoleDef[] {
  return ROLES.filter((r) => r.positions.includes(pos));
}

/** Idoneidad 0-20 de un jugador para un rol (media ponderada clave×3 + preferibles×1.5). */
export function roleSuitability(attrs: FlatAttributes, role: RoleDef): number {
  let num = 0;
  let den = 0;
  for (const a of role.key) {
    num += attrs[a] * 3;
    den += 3;
  }
  for (const a of role.preferable) {
    num += attrs[a] * 1.5;
    den += 1.5;
  }
  return den === 0 ? 0 : num / den;
}

/** Mejor rol para una posición. */
export function bestRoleFor(attrs: FlatAttributes, pos: Position): { role: RoleDef; score: number } | null {
  let best: { role: RoleDef; score: number } | null = null;
  for (const r of rolesForPosition(pos)) {
    const s = roleSuitability(attrs, r);
    if (!best || s > best.score) best = { role: r, score: s };
  }
  return best;
}
