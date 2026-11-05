/**
 * Generador de números pseudoaleatorios con semilla (mulberry32).
 *
 * Regla del proyecto: NUNCA usar Math.random(). Todo lo aleatorio pasa por un Rng
 * para que partidos, mundos generados y temporadas sean reproducibles.
 */

export interface Rng {
  /** Número en [0, 1). */
  next(): number;
  /** Entero en [min, max] (ambos incluidos). */
  int(min: number, max: number): number;
  /** Real en [min, max). */
  float(min: number, max: number): number;
  /** true con probabilidad p. */
  chance(p: number): boolean;
  /** Elemento aleatorio de un array no vacío. */
  pick<T>(items: readonly T[]): T;
  /** Elemento aleatorio ponderado. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Normal (Box-Muller) con media y desviación. */
  normal(mean?: number, sd?: number): number;
  /** Copia barajada (Fisher-Yates) del array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Crea un Rng hijo independiente y determinista a partir de una etiqueta. */
  fork(label: string | number): Rng;
  /** Estado interno (para guardar/restaurar). */
  getState(): number;
}

/** Hash de cadena a entero de 32 bits (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare: number | null = null;

  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) throw new RangeError(`int: max (${max}) < min (${min})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick: array vacío');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted(items, weights) {
      if (items.length === 0 || items.length !== weights.length) {
        throw new RangeError('weighted: arrays inválidos');
      }
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mean + sd * mag * Math.cos(2 * Math.PI * v);
    },
    shuffle(items) {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = a[i] as (typeof a)[number];
        a[i] = a[j] as (typeof a)[number];
        a[j] = tmp;
      }
      return a;
    },
    fork(label) {
      return createRng((hashString(String(label)) ^ Math.imul(state, 0x85ebca6b)) >>> 0);
    },
    getState() {
      return state;
    },
  };
  return rng;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
