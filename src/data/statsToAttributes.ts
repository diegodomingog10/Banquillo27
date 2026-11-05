/**
 * Conversor de estadísticas reales a atributos 1-20.
 *
 * Algoritmo (documentado también en DATA_GUIDE.md):
 *  1. Para cada estadística se calcula el PERCENTIL del jugador dentro de su cohorte
 *     (misma liga + mismo grupo posicional). Si la cohorte tiene menos de
 *     `minCohortSize` jugadores con ese dato, se usa el mismo grupo posicional en
 *     todas las ligas. Si incluso así es pequeña, el percentil se acerca a 0,5 en
 *     proporción a su tamaño (nunca se compara un central con delanteros).
 *  2. Estadísticas "inversas" (higherIsBetter = false) usan 1 - percentil.
 *  3. Cada atributo es la media ponderada de los percentiles de sus estadísticas según
 *     statsMapping.json. Si falta alguna, sus pesos se renormalizan con las que haya.
 *  4. Fiabilidad por minutos: el percentil se "encoge" hacia 0,5 de forma lineal entre
 *     `minMinutes` y `fullReliabilityMinutes` (pocos minutos = dato poco fiable). Por
 *     debajo de `minMinutes` no se convierte nada (todo queda como estimado).
 *  5. El percentil se pasa a puntuación z (inversa de la normal, acotada a ±maxZ) y se
 *     mapea a 1-20 con la media y desviación de la liga (`leagueScale`, interpolada
 *     según la fuerza de la liga) más el desplazamiento típico del atributo en esa
 *     posición. Así, el mejor pasador de una liga débil no recibe un 20, y un central
 *     con buen % de tiros no recibe una finalización de delantero.
 *  6. Salto y fuerza se combinan ligeramente con altura y peso.
 */
import { z } from 'zod';
import { clamp } from '../engine/rng';
import { positionOffset } from './ability';
import type { VisibleAttr } from './attributes';
import { VISIBLE_ATTRS } from './attributes';
import type { PositionGroup } from './positions';
import defaultMappingJson from './statsMapping.json';

// ---------------------------------------------------------------- tabla de pesos
export const StatsMappingSchema = z.object({
  version: z.number(),
  description: z.string().optional(),
  settings: z.object({
    minCohortSize: z.number().int().min(1),
    fullReliabilityMinutes: z.number().min(1),
    minMinutes: z.number().min(0),
    maxZ: z.number().min(0.5).max(4),
    positionOffsetSpread: z.number().min(0),
    defaultLeagueStrength: z.number().min(0).max(100),
    lowerDivisionFactor: z.number().min(0).max(1),
    leagueScale: z
      .array(z.object({ strength: z.number().min(0).max(100), mean: z.number(), sd: z.number().min(0) }))
      .min(1),
  }),
  stats: z.record(z.string(), z.object({ label: z.string(), higherIsBetter: z.boolean() })),
  attributes: z.record(
    z.string(),
    z.object({
      outfield: z.record(z.string(), z.number().min(0)).optional(),
      GK: z.record(z.string(), z.number().min(0)).optional(),
      note: z.string().optional(),
    }),
  ),
});
export type StatsMapping = z.infer<typeof StatsMappingSchema>;

/** Valida una tabla (por ejemplo, una versión editada por el usuario). */
export function loadStatsMapping(json: unknown): StatsMapping {
  const m = StatsMappingSchema.parse(json);
  const visible = new Set<string>(VISIBLE_ATTRS);
  for (const [attr, def] of Object.entries(m.attributes)) {
    if (!visible.has(attr)) throw new Error(`statsMapping: atributo desconocido "${attr}"`);
    for (const weights of [def.outfield, def.GK]) {
      for (const stat of Object.keys(weights ?? {})) {
        if (!m.stats[stat]) throw new Error(`statsMapping: el atributo "${attr}" usa la estadística no declarada "${stat}"`);
      }
    }
  }
  return m;
}

export const DEFAULT_STATS_MAPPING: StatsMapping = loadStatsMapping(defaultMappingJson);

/** Nombres de estadística reconocidos (columnas válidas en CSV). */
export function knownStats(mapping: StatsMapping = DEFAULT_STATS_MAPPING): string[] {
  return Object.keys(mapping.stats);
}

// ---------------------------------------------------------------- utilidades
/** Inversa de la CDF normal estándar (aproximación de Acklam, error < 1e-9). */
export function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const q = (arr: number[], i: number) => arr[i] as number;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const t = Math.sqrt(-2 * Math.log(p));
    return (((((q(c, 0) * t + q(c, 1)) * t + q(c, 2)) * t + q(c, 3)) * t + q(c, 4)) * t + q(c, 5)) /
      ((((q(d, 0) * t + q(d, 1)) * t + q(d, 2)) * t + q(d, 3)) * t + 1);
  }
  if (p > 1 - pl) {
    const t = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((q(c, 0) * t + q(c, 1)) * t + q(c, 2)) * t + q(c, 3)) * t + q(c, 4)) * t + q(c, 5)) /
      ((((q(d, 0) * t + q(d, 1)) * t + q(d, 2)) * t + q(d, 3)) * t + 1);
  }
  const t = p - 0.5;
  const r = t * t;
  return ((((((q(a, 0) * r + q(a, 1)) * r + q(a, 2)) * r + q(a, 3)) * r + q(a, 4)) * r + q(a, 5)) * t) /
    (((((q(b, 0) * r + q(b, 1)) * r + q(b, 2)) * r + q(b, 3)) * r + q(b, 4)) * r + 1);
}

/** Percentil "medio" (empates cuentan la mitad) de v en un array ordenado. */
export function percentileIn(sorted: readonly number[], v: number): number {
  const n = sorted.length;
  if (n === 0) return 0.5;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  const less = lo;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  const equal = lo - less;
  return (less + 0.5 * equal) / n;
}

/** Media y desviación de la escala para una fuerza de liga (interpolación lineal). */
export function leagueScaleFor(strength: number, mapping: StatsMapping = DEFAULT_STATS_MAPPING): { mean: number; sd: number } {
  const pts = mapping.settings.leagueScale.slice().sort((x, y) => x.strength - y.strength);
  const first = pts[0] as (typeof pts)[number];
  const last = pts[pts.length - 1] as (typeof pts)[number];
  if (strength <= first.strength) return { mean: first.mean, sd: first.sd };
  if (strength >= last.strength) return { mean: last.mean, sd: last.sd };
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i] as (typeof pts)[number];
    const a = pts[i - 1] as (typeof pts)[number];
    if (strength <= b.strength) {
      const t = (strength - a.strength) / (b.strength - a.strength || 1);
      return { mean: a.mean + t * (b.mean - a.mean), sd: a.sd + t * (b.sd - a.sd) };
    }
  }
  return { mean: last.mean, sd: last.sd };
}

/** Fuerza de una liga: la explícita, o la de su nación reducida por nivel. */
export function resolveLeagueStrength(
  explicit: number | null | undefined,
  nationStrength: number | null | undefined,
  level: number | null | undefined,
  mapping: StatsMapping = DEFAULT_STATS_MAPPING,
): number {
  if (typeof explicit === 'number') return clamp(explicit, 0, 100);
  const base = typeof nationStrength === 'number' ? nationStrength : mapping.settings.defaultLeagueStrength;
  const lvl = Math.max(1, level ?? 1);
  return clamp(base * Math.pow(mapping.settings.lowerDivisionFactor, lvl - 1), 0, 100);
}

// ---------------------------------------------------------------- conversión
export interface StatsPlayer {
  /** Clave única (id del jugador). */
  key: string;
  group: PositionGroup;
  /** Identificador de liga/competición para la cohorte (null = sin liga). */
  cohort: string | null;
  leagueStrength: number;
  /** Minutos jugados en la muestra. */
  minutes: number;
  /** Estadísticas por nombre (las desconocidas se ignoran). */
  stats: Record<string, number>;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface StatsConversion {
  attributes: Partial<Record<VisibleAttr, number>>;
  /** Percentil final (tras fiabilidad) usado para cada atributo, 0-1. */
  percentiles: Partial<Record<VisibleAttr, number>>;
  /** Fiabilidad aplicada por minutos (0-1). */
  reliability: number;
  /** Estadísticas que no se encuentran en la tabla (para avisar al usuario). */
  unknownStats: string[];
}

export function convertStatsToAttributes(
  players: readonly StatsPlayer[],
  mapping: StatsMapping = DEFAULT_STATS_MAPPING,
): Map<string, StatsConversion> {
  const s = mapping.settings;
  // Índices: stat -> clave de cohorte -> valores ordenados
  const index = new Map<string, Map<string, number[]>>();
  const push = (stat: string, key: string, v: number) => {
    let m = index.get(stat);
    if (!m) index.set(stat, (m = new Map()));
    let arr = m.get(key);
    if (!arr) m.set(key, (arr = []));
    arr.push(v);
  };
  for (const p of players) {
    if (p.minutes < s.minMinutes) continue;
    for (const [stat, v] of Object.entries(p.stats)) {
      if (!mapping.stats[stat] || !Number.isFinite(v)) continue;
      push(stat, `${p.cohort ?? '-'}|${p.group}`, v);
      push(stat, `*|${p.group}`, v);
    }
  }
  for (const m of index.values()) for (const arr of m.values()) arr.sort((a, b) => a - b);

  const out = new Map<string, StatsConversion>();
  for (const p of players) {
    const unknownStats = Object.keys(p.stats).filter((k) => !mapping.stats[k]);
    const result: StatsConversion = { attributes: {}, percentiles: {}, reliability: 0, unknownStats };
    out.set(p.key, result);
    if (p.minutes < s.minMinutes) continue;
    const reliability = clamp((p.minutes - s.minMinutes) / Math.max(1, s.fullReliabilityMinutes - s.minMinutes), 0, 1);
    result.reliability = reliability;
    const scale = leagueScaleFor(p.leagueStrength, mapping);
    const statPct = (stat: string, v: number): number => {
      const m = index.get(stat);
      if (!m) return 0.5;
      // Preferimos comparar con la misma posición: primero en la liga, luego en todas.
      const league = m.get(`${p.cohort ?? '-'}|${p.group}`);
      const arr = league && league.length >= s.minCohortSize ? league : m.get(`*|${p.group}`) ?? [];
      const pct = percentileIn(arr, v);
      // Cohortes pequeñas: el percentil se acerca a 0,5 en proporción al tamaño.
      const sizeFactor = Math.min(1, Math.max(0, arr.length - 1) / s.minCohortSize);
      const shrunk = 0.5 + (pct - 0.5) * sizeFactor;
      return mapping.stats[stat]?.higherIsBetter === false ? 1 - shrunk : shrunk;
    };

    for (const [attr, def] of Object.entries(mapping.attributes)) {
      const weights = p.group === 'GK' ? def.GK : def.outfield;
      if (!weights) continue;
      let num = 0;
      let den = 0;
      let total = 0;
      for (const [stat, w] of Object.entries(weights)) {
        total += w;
        const v = p.stats[stat];
        if (v === undefined || !Number.isFinite(v)) continue;
        num += w * statPct(stat, v);
        den += w;
      }
      if (den === 0) continue;
      const coverage = den / (total || 1);
      const pRaw = num / den;
      const pAdj = 0.5 + (pRaw - 0.5) * reliability * (0.5 + 0.5 * coverage);
      const zScore = clamp(probit(clamp(pAdj, 0.0005, 0.9995)), -s.maxZ, s.maxZ);
      let value = scale.mean + positionOffset(p.group, attr as VisibleAttr, s.positionOffsetSpread) + zScore * scale.sd;
      if (attr === 'jumping' && p.heightCm) value += (p.heightCm - 181) / 8;
      if (attr === 'strength' && p.weightKg) value += (p.weightKg - 76) / 10;
      result.attributes[attr as VisibleAttr] = clamp(Math.round(value), 1, 20);
      result.percentiles[attr as VisibleAttr] = pAdj;
    }
  }
  return out;
}
