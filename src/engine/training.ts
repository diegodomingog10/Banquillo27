/**
 * Entrenamiento: plan semanal por áreas (táctico, técnico, físico, balón parado,
 * porteros) con intensidad, entrenamiento individual (grupo de atributos o posición
 * nueva) y calidad de los entrenadores por área. La carga de trabajo afecta a la
 * recuperación física y al riesgo de lesión; el cuerpo médico, a la prevención y a la
 * duración de las lesiones.
 */
import { mainPosition } from '../data/ability';
import type { Position } from '../data/positions';
import type { Club, Injury, Player, Staff } from '../data/schema';
import { t } from '../i18n';
import { ageAt } from './date';
import { addMessage, indexes, type GameState } from './game';
import { clamp, createRng, hashString } from './rng';
import { staffById } from './economy';

export const TRAINING_AREAS = ['tactical', 'technical', 'physical', 'setPieces', 'goalkeeping'] as const;
export type TrainingArea = (typeof TRAINING_AREAS)[number];
export const AREA_LABEL: Record<TrainingArea, string> = { tactical: 'Táctico', technical: 'Técnico', physical: 'Físico', setPieces: 'Balón parado', goalkeeping: 'Porteros' };

export type Intensity = 'low' | 'normal' | 'high';
export const INTENSITY_LABEL: Record<Intensity, string> = { low: 'Suave', normal: 'Normal', high: 'Intensa' };

/** Focos de entrenamiento individual (grupos de atributos). */
export const INDIVIDUAL_FOCUS = ['none', 'finishing', 'creativity', 'defending', 'aerial', 'physical', 'mental', 'setPieces', 'goalkeeping'] as const;
export type IndividualFocus = (typeof INDIVIDUAL_FOCUS)[number];
export const FOCUS_LABEL: Record<IndividualFocus, string> = {
  none: 'General', finishing: 'Definición', creativity: 'Creación', defending: 'Defensa', aerial: 'Juego aéreo',
  physical: 'Físico', mental: 'Mentalidad', setPieces: 'Balón parado', goalkeeping: 'Portería',
};
export const FOCUS_ATTRS: Record<Exclude<IndividualFocus, 'none'>, string[]> = {
  finishing: ['finishing', 'composure', 'offTheBall', 'firstTouch', 'longShots'],
  creativity: ['passing', 'vision', 'technique', 'flair', 'dribbling', 'firstTouch'],
  defending: ['tackling', 'marking', 'positioning', 'anticipation', 'concentration'],
  aerial: ['heading', 'jumping', 'strength', 'bravery'],
  physical: ['pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance'],
  mental: ['decisions', 'composure', 'concentration', 'determination', 'teamwork', 'workRate'],
  setPieces: ['corners', 'freeKicks', 'penalties', 'longThrows', 'crossing'],
  goalkeeping: ['handling', 'reflexes', 'oneOnOnes', 'aerialReach', 'communication', 'kicking', 'playWithFeet'],
};

/** Qué atributos trabaja cada área del plan. */
export const AREA_ATTRS: Record<TrainingArea, string[]> = {
  tactical: ['decisions', 'positioning', 'anticipation', 'teamwork', 'offTheBall', 'concentration', 'vision', 'workRate'],
  technical: ['passing', 'firstTouch', 'technique', 'dribbling', 'finishing', 'crossing', 'tackling', 'marking', 'heading', 'longShots', 'composure', 'flair'],
  physical: ['pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance', 'jumping'],
  setPieces: ['corners', 'freeKicks', 'penalties', 'longThrows', 'heading'],
  goalkeeping: ['handling', 'reflexes', 'oneOnOnes', 'aerialReach', 'communication', 'kicking', 'playWithFeet'],
};

export interface TrainingPlan {
  /** Peso de cada área (0-100); se normaliza. */
  focus: Record<TrainingArea, number>;
  intensity: Intensity;
}

export interface TrainingState {
  plan: TrainingPlan;
  individual: Record<string, { focus: IndividualFocus; position: Position | null }>;
  /** Lesiones en los entrenamientos (para el informe). */
  log: { date: string; playerId: string; text: string }[];
}

export const PRESETS: { id: string; label: string; plan: TrainingPlan }[] = [
  { id: 'balanced', label: 'Equilibrado', plan: { focus: { tactical: 25, technical: 30, physical: 25, setPieces: 10, goalkeeping: 10 }, intensity: 'normal' } },
  { id: 'preseason', label: 'Pretemporada', plan: { focus: { tactical: 15, technical: 20, physical: 50, setPieces: 5, goalkeeping: 10 }, intensity: 'high' } },
  { id: 'tactical', label: 'Táctico', plan: { focus: { tactical: 45, technical: 25, physical: 15, setPieces: 10, goalkeeping: 5 }, intensity: 'normal' } },
  { id: 'technical', label: 'Técnico', plan: { focus: { tactical: 15, technical: 50, physical: 15, setPieces: 10, goalkeeping: 10 }, intensity: 'normal' } },
  { id: 'recovery', label: 'Recuperación', plan: { focus: { tactical: 30, technical: 30, physical: 10, setPieces: 20, goalkeeping: 10 }, intensity: 'low' } },
];

export function initTraining(state: GameState): TrainingState {
  return (state.training = { plan: structuredClone(PRESETS[0]!.plan), individual: {}, log: [] });
}

export function planFor(state: GameState, clubId: string): TrainingPlan {
  if (clubId === state.userClubId) return state.training.plan;
  return PRESETS[0]!.plan;
}

function clubStaff(state: GameState, club: Club): Staff[] {
  const idx = staffById(state);
  return club.staffIds.map((id) => idx.get(id)).filter((s): s is Staff => !!s);
}

const COACH_ROLES = new Set(['manager', 'assistantManager', 'coach', 'goalkeepingCoach', 'fitnessCoach', 'youthCoach']);
const AREA_STAFF_ATTRS: Record<TrainingArea, (keyof Staff['attributes'])[]> = {
  tactical: ['tactical', 'tacticalKnowledge'],
  technical: ['technical', 'attacking', 'defending'],
  physical: ['fitness', 'sportsScience'],
  setPieces: ['technical', 'tactical'],
  goalkeeping: ['goalkeeping'],
};

/** Calidad (1-20) de los entrenadores del club en cada área: media de los dos mejores. */
export function coachQuality(state: GameState, clubId: string): Record<TrainingArea, number> & { mental: number; youth: number; medical: number } {
  const club = indexes(state).clubs.get(clubId);
  const staff = club ? clubStaff(state, club) : [];
  const coaches = staff.filter((s) => COACH_ROLES.has(s.role));
  const best = (attrs: (keyof Staff['attributes'])[], pool = coaches) => {
    const vals = pool.map((s) => attrs.reduce((a, k) => a + s.attributes[k], 0) / attrs.length).sort((a, b) => b - a);
    if (!vals.length) return 6;
    return (vals[0]! * 0.65 + (vals[1] ?? vals[0]!) * 0.35);
  };
  const out = {} as Record<TrainingArea, number> & { mental: number; youth: number; medical: number };
  for (const a of TRAINING_AREAS) out[a] = best(AREA_STAFF_ATTRS[a]);
  out.mental = best(['mentalCoaching', 'motivating']);
  out.youth = best(['workingWithYouth']);
  out.medical = best(['physiotherapy', 'sportsScience'], staff.filter((s) => s.role === 'physio' || s.role === 'doctor' || s.role === 'fitnessCoach'));
  return out;
}

/** Factor de entrenamiento (0,6-1,4) para un atributo según plan, entrenadores, instalaciones y foco individual. */
export function trainingFactor(state: GameState, p: Player, attr: string, q: ReturnType<typeof coachQuality>, facilities: number): number {
  const plan = planFor(state, p.clubId ?? '');
  const total = TRAINING_AREAS.reduce((a, k) => a + plan.focus[k], 0) || 1;
  let w = 0;
  let quality = 0;
  let hits = 0;
  for (const area of TRAINING_AREAS) {
    if (!AREA_ATTRS[area].includes(attr)) continue;
    const share = plan.focus[area] / total;
    w += share;
    quality += q[area];
    hits++;
  }
  const coach = hits ? quality / hits : (q.mental + q.technical) / 2;
  // Atributos que ningún área trabaja (mentales "de carácter") avanzan con el entrenamiento mental
  const planBoost = hits ? 0.75 + w * 1.6 : 0.95;
  let f = planBoost * (0.75 + coach / 40) * (0.85 + facilities / 66);
  const ind = p.clubId === state.userClubId ? state.training.individual[p.id] : undefined;
  if (ind && ind.focus !== 'none' && FOCUS_ATTRS[ind.focus].includes(attr)) f *= 1.6;
  else if (ind && ind.focus !== 'none') f *= 0.9;
  const intensity = plan.intensity === 'high' ? 1.15 : plan.intensity === 'low' ? 0.85 : 1;
  return clamp(f * intensity, 0.4, 2);
}

// ---------------------------------------------------------------- carga física y lesiones
/** Multiplicador de la recuperación diaria de condición física. */
export function recoveryFactor(state: GameState, clubId: string | null): number {
  if (!clubId) return 1;
  const plan = planFor(state, clubId);
  return plan.intensity === 'high' ? 0.82 : plan.intensity === 'low' ? 1.18 : 1;
}

const TRAINING_INJURIES = ['hamstring', 'ankleSprain', 'calf', 'groin', 'thigh', 'back', 'knee'];

/** Ajusta la duración de una lesión según el cuerpo médico del club (fisios y médicos). */
export function medicalDays(state: GameState, clubId: string | null, days: number): number {
  if (!clubId) return days;
  const q = coachQuality(state, clubId).medical;
  return Math.max(1, Math.round(days * (1.18 - q / 55)));
}

/** Entrenamiento diario del club del usuario: lesiones por carga (la IA, con riesgo base). */
export function trainingDay(state: GameState, trainedToday: Set<string>): void {
  const d = state.date;
  // Domingo, descanso
  if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) return;
  const rng = createRng(hashString(`train:${state.seed}:${d}`));
  const ix = indexes(state);
  const userQ = coachQuality(state, state.userClubId);
  for (const club of state.world.clubs) {
    const user = club.id === state.userClubId;
    const plan = planFor(state, club.id);
    const load = plan.intensity === 'high' ? 2.1 : plan.intensity === 'low' ? 0.5 : 1;
    const medical = user ? userQ.medical : 10;
    for (const p of ix.squads.get(club.id) ?? []) {
      if (p.injury || trainedToday.has(p.id)) continue;
      if (user && plan.intensity === 'high') p.condition = clamp(p.condition - 0.6, 0, 100);
      const risk = 0.00045 * load * (0.5 + p.attributes.injuryProneness / 20) * (1 + Math.max(0, 85 - p.condition) / 40) * (1.25 - medical / 40)
        * (ageAt(p.birthDate, d) >= 31 ? 1.25 : 1);
      if (!rng.chance(risk)) continue;
      const r = rng.next();
      const severity: Injury['severity'] = r < 0.75 ? 'minor' : r < 0.95 ? 'moderate' : 'serious';
      const raw = severity === 'minor' ? rng.int(2, 9) : severity === 'moderate' ? rng.int(10, 28) : rng.int(30, 80);
      const days = medicalDays(state, club.id, raw);
      p.injury = { type: rng.pick(TRAINING_INJURIES), severity, startDate: d, daysOut: days, daysRemaining: days };
      if (user) {
        state.training.log.unshift({ date: d, playerId: p.id, text: `${t(`injury.${p.injury.type}`)} (${days} días)` });
        if (state.training.log.length > 40) state.training.log.length = 40;
        addMessage(state, {
          type: 'injury', priority: severity === 'minor' ? 'normal' : 'high', key: 'trainingInjury', sender: 'Servicios médicos',
          params: { player: p.commonName ?? `${p.firstName} ${p.lastName}`, injury: t(`injury.${p.injury.type}`), days, load: t(`intensity.${plan.intensity}`) },
          related: { playerId: p.id },
        });
      }
    }
  }
}

// ---------------------------------------------------------------- acciones y vista
export function setTrainingPlan(state: GameState, plan: TrainingPlan): void {
  for (const a of TRAINING_AREAS) if (!(plan.focus[a] >= 0 && plan.focus[a] <= 100)) throw new Error('Peso de área no válido');
  if (!['low', 'normal', 'high'].includes(plan.intensity)) throw new Error('Intensidad no válida');
  state.training.plan = { focus: { ...plan.focus }, intensity: plan.intensity };
}

export function setIndividualTraining(state: GameState, playerId: string, focus: IndividualFocus, position: Position | null): void {
  const p = indexes(state).players.get(playerId);
  if (!p || p.clubId !== state.userClubId) throw new Error('Solo puedes entrenar a jugadores de tu club');
  if (!INDIVIDUAL_FOCUS.includes(focus)) throw new Error('Foco no válido');
  if (focus === 'none' && !position) delete state.training.individual[playerId];
  else state.training.individual[playerId] = { focus, position };
}

/** Riesgo de lesión estimado de un jugador (bajo / medio / alto) con el plan actual. */
export function injuryRiskLevel(state: GameState, p: Player): 'low' | 'medium' | 'high' {
  const plan = planFor(state, p.clubId ?? '');
  const load = plan.intensity === 'high' ? 2.1 : plan.intensity === 'low' ? 0.5 : 1;
  const r = load * (0.5 + p.attributes.injuryProneness / 20) * (1 + Math.max(0, 85 - p.condition) / 40);
  return r < 1.1 ? 'low' : r < 1.9 ? 'medium' : 'high';
}

export function mainPos(p: Player): Position {
  return mainPosition(p.positions);
}
