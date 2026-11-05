/**
 * Cálculo de habilidad actual (CA), potencial (PA), personalidad y valores económicos
 * a partir de los atributos. Lo usan tanto el generador como el importador, de modo
 * que CA y atributos siempre son coherentes entre sí.
 *
 * CA (1-200) = 10 × media ponderada de atributos visibles con los pesos del grupo
 * posicional del jugador. Un jugador con todo a 10 tiene CA ≈ 100; con sus atributos
 * clave a 18 ronda 175-185. Escala lineal: fácil de razonar y de invertir.
 */
import { clamp } from '../engine/rng';
import { VISIBLE_ATTRS, GOALKEEPING_ATTRS, type FlatAttributes, type VisibleAttr } from './attributes';
import { GROUP_OF_POSITION, type Position, type PositionGroup } from './positions';
import type { PersonalityType } from './schema';

type Weights = Partial<Record<VisibleAttr, number>>;

/** Peso base de cualquier atributo de campo para jugadores de campo. */
const OUTFIELD_BASE = 0.6;
/** Peso base para porteros de los atributos de campo (mentales y físicos). */
const GK_BASE = 0.35;

/** Pesos adicionales por grupo posicional. Editables; se documentan en DATA_GUIDE.md. */
export const POSITION_WEIGHTS: Record<PositionGroup, Weights> = {
  GK: {
    reflexes: 6, handling: 5, oneOnOnes: 4, aerialReach: 4, communication: 3, kicking: 2,
    playWithFeet: 2, positioning: 4, concentration: 3, decisions: 3, composure: 2,
    anticipation: 2, agility: 4, jumping: 1, bravery: 1,
  },
  CB: {
    marking: 5, tackling: 5, heading: 5, positioning: 5, jumping: 4, strength: 4,
    anticipation: 3, concentration: 3, decisions: 3, bravery: 3, composure: 2, pace: 2,
    passing: 1, aggression: 1, firstTouch: 1,
  },
  FB: {
    tackling: 3, marking: 3, positioning: 3, crossing: 3, pace: 4, acceleration: 4,
    stamina: 4, workRate: 3, teamwork: 2, concentration: 2, decisions: 2, passing: 2,
    dribbling: 1, anticipation: 2, agility: 1, firstTouch: 1, technique: 1, offTheBall: 1,
  },
  DM: {
    tackling: 4, positioning: 4, anticipation: 4, passing: 3, decisions: 4, concentration: 3,
    teamwork: 3, workRate: 3, marking: 3, composure: 2, firstTouch: 2, stamina: 3,
    strength: 2, aggression: 1, vision: 1,
  },
  CM: {
    passing: 5, firstTouch: 3, technique: 3, vision: 4, decisions: 4, composure: 3,
    teamwork: 3, workRate: 3, stamina: 3, anticipation: 2, offTheBall: 2, tackling: 2,
    longShots: 1, dribbling: 1, positioning: 1,
  },
  WIDE: {
    dribbling: 4, crossing: 4, pace: 5, acceleration: 5, technique: 3, firstTouch: 3,
    flair: 2, offTheBall: 3, agility: 3, passing: 2, finishing: 2, decisions: 2,
    stamina: 2, workRate: 2, composure: 1, vision: 1,
  },
  AM: {
    passing: 4, vision: 5, technique: 4, firstTouch: 4, flair: 3, decisions: 3, composure: 3,
    dribbling: 3, offTheBall: 3, longShots: 2, finishing: 2, anticipation: 2, agility: 2,
    acceleration: 1, balance: 1,
  },
  ST: {
    finishing: 6, offTheBall: 4, composure: 4, firstTouch: 3, acceleration: 3, pace: 3,
    heading: 2, technique: 2, dribbling: 2, anticipation: 3, decisions: 2, strength: 2,
    jumping: 1, agility: 1, balance: 1,
  },
};

const GK_SET = new Set<string>(GOALKEEPING_ATTRS);

const MAX_SPECIFIC: Record<PositionGroup, number> = Object.fromEntries(
  (Object.keys(POSITION_WEIGHTS) as PositionGroup[]).map((g) => [
    g,
    Math.max(...Object.values(POSITION_WEIGHTS[g]).map((v) => v ?? 0)),
  ]),
) as Record<PositionGroup, number>;

/**
 * Desplazamiento típico (en puntos de atributo) de un atributo respecto al nivel medio
 * del jugador según su posición: los atributos clave de la posición quedan por encima
 * y los irrelevantes por debajo. Lo comparten el generador y el conversor de
 * estadísticas para que ambos produzcan perfiles con la misma forma.
 */
export function positionOffset(group: PositionGroup, attr: VisibleAttr, spread = 4.2): number {
  const imp = (POSITION_WEIGHTS[group][attr] ?? 0) / MAX_SPECIFIC[group];
  return (imp - 0.3) * spread;
}

/** Pesos completos (base + específicos) de un grupo posicional. */
export function fullWeights(group: PositionGroup): Record<VisibleAttr, number> {
  const out = {} as Record<VisibleAttr, number>;
  const specific = POSITION_WEIGHTS[group];
  for (const a of VISIBLE_ATTRS) {
    const isGkAttr = GK_SET.has(a);
    let base: number;
    if (group === 'GK') base = isGkAttr ? 0 : GK_BASE;
    else base = isGkAttr ? 0 : OUTFIELD_BASE;
    out[a] = base + (specific[a] ?? 0);
  }
  return out;
}

const WEIGHT_CACHE = new Map<PositionGroup, Record<VisibleAttr, number>>();
function cachedWeights(group: PositionGroup): Record<VisibleAttr, number> {
  let w = WEIGHT_CACHE.get(group);
  if (!w) {
    w = fullWeights(group);
    WEIGHT_CACHE.set(group, w);
  }
  return w;
}

/** CA sin redondear para un grupo. */
export function rawAbilityForGroup(attrs: FlatAttributes, group: PositionGroup): number {
  const w = cachedWeights(group);
  let num = 0;
  let den = 0;
  for (const a of VISIBLE_ATTRS) {
    const wi = w[a];
    if (wi === 0) continue;
    num += wi * attrs[a];
    den += wi;
  }
  return (num / den) * 10;
}

/** CA (1-200) del jugador en su posición principal. */
export function computeCA(attrs: FlatAttributes, mainPosition: Position): number {
  return clamp(Math.round(rawAbilityForGroup(attrs, GROUP_OF_POSITION[mainPosition])), 1, 200);
}

/** Posición con mejor nivel. */
export function mainPosition(positions: readonly { position: Position; rating: number }[]): Position {
  let best = positions[0];
  for (const p of positions) if (best === undefined || p.rating > best.rating) best = p;
  return best?.position ?? 'CM';
}

export interface PotentialInput {
  ca: number;
  age: number;
  /** Fuerza de la liga 0-100. */
  leagueStrength: number;
  professionalism: number;
  determination: number;
  ambition: number;
}

/**
 * PA estimada de forma determinista. Margen de crecimiento por año hasta los 24,
 * ajustado por personalidad (profesionalidad/determinación/ambición) y por la liga:
 * un joven que ya rinde en una liga fuerte tiene más techo que uno en una liga débil.
 */
export function estimatePA(i: PotentialInput): number {
  const yearsToPeak = clamp(24 - i.age, 0, 8);
  const mentality = (i.professionalism + i.determination + i.ambition) / 3; // 1-20
  const perYear = 5 + (mentality - 10) * 0.45 + (i.leagueStrength - 50) * 0.04;
  const late = i.age >= 24 && i.age < 28 ? 3 : 0;
  const headroom = Math.max(0, yearsToPeak * perYear) + late;
  return clamp(Math.round(i.ca + headroom), i.ca, 200);
}

/** Personalidad derivada (simplificación de las reglas tipo FM). */
export function derivePersonality(a: FlatAttributes): PersonalityType {
  const { professionalism: pro, determination: det, ambition: amb, loyalty: loy, temperament: tem } = a;
  if (pro >= 18 && det >= 16 && amb >= 14 && loy >= 14 && tem >= 14) return 'modelCitizen';
  if (pro >= 18 && tem >= 14) return 'modelProfessional';
  if (det >= 16 && amb >= 16 && pro >= 14 && tem <= 10) return 'perfectionist';
  if (loy <= 4 && amb >= 15) return 'mercenary';
  if (pro >= 16) return 'resolute';
  if (det >= 17) return 'determined';
  if (amb >= 17) return 'ambitious';
  if (det >= 14 && amb >= 14) return 'driven';
  if (loy >= 17) return 'loyal';
  if (tem <= 5) return 'temperamental';
  if (amb <= 5) return 'unambitious';
  if (pro <= 5) return 'casual';
  if (det <= 5) return 'lowDetermination';
  if (tem >= 15 && pro >= 10) return 'jovial';
  return 'balanced';
}

/** Redondeo "comercial" para importes. */
export function roundMoney(v: number): number {
  if (v <= 0) return 0;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return Math.round(v / mag) * mag;
}

export interface ValueInput {
  ca: number;
  pa: number;
  age: number;
  /** Años de contrato restantes (0 = libre). */
  contractYears: number;
  /** Reputación del club 0-10000. */
  clubReputation: number;
}

/** Valor de mercado estimado en euros. */
export function estimateMarketValue(i: ValueInput): number {
  let v = 1000 * Math.exp(i.ca / 16);
  if (i.age <= 23) v *= 1 + Math.max(0, i.pa - i.ca) / 55;
  if (i.age >= 30) v *= Math.pow(0.78, i.age - 29);
  v *= clamp(0.35 + 0.22 * i.contractYears, 0.35, 1.1);
  v *= 0.75 + (i.clubReputation / 10000) * 0.5;
  return roundMoney(v);
}

/** Salario semanal estimado en euros. */
export function estimateWage(ca: number, clubReputation: number, age: number): number {
  let w = 55 * Math.exp(ca / 22);
  w *= 0.4 + (clubReputation / 10000) * 1.2;
  if (age < 19) w *= 0.35;
  return roundMoney(Math.max(150, w));
}
