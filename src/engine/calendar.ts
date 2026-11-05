/**
 * Calendario de temporada: fechas clave (mercado, parones internacionales, fin de
 * temporada), emparejamientos de liga (método del círculo) y asignación de fechas.
 */
import { addDays, isoFromParts, parseIso } from './date';
import type { Rng } from './rng';

export interface DateRange {
  from: string;
  to: string;
}

export interface SeasonCalendar {
  season: string;
  year: number;
  start: string;
  end: string;
  /** Día de cambio de temporada (inicio de la siguiente). */
  nextStart: string;
  windows: { id: 'summer' | 'winter'; open: string; deadline: string }[];
  internationalBreaks: DateRange[];
  /** Fecha en que se procesa el fin de temporada (tras ligas y playoffs). */
  seasonEndProcessing: string;
}

export function seasonLabel(year: number): string {
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

export function weekday(iso: string): number {
  return parseIso(iso).getUTCDay();
}

/** n-ésimo día de la semana (0 = domingo) de un mes; n = -1 → el último. */
export function nthWeekday(year: number, month: number, wd: number, n: number): string {
  if (n > 0) {
    let d = isoFromParts(year, month, 1);
    while (weekday(d) !== wd) d = addDays(d, 1);
    return addDays(d, 7 * (n - 1));
  }
  let d = addDays(isoFromParts(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  while (weekday(d) !== wd) d = addDays(d, -1);
  return d;
}

export function inRanges(iso: string, ranges: readonly DateRange[]): boolean {
  return ranges.some((r) => iso >= r.from && iso <= r.to);
}

export function buildSeasonCalendar(year: number): SeasonCalendar {
  // Parón internacional: del lunes anterior al martes posterior al fin de semana elegido
  const breakAround = (sat: string): DateRange => ({ from: addDays(sat, -5), to: addDays(sat, 3) });
  return {
    season: seasonLabel(year),
    year,
    start: isoFromParts(year, 7, 1),
    end: isoFromParts(year + 1, 6, 30),
    nextStart: isoFromParts(year + 1, 7, 1),
    windows: [
      { id: 'summer', open: isoFromParts(year, 7, 1), deadline: isoFromParts(year, 9, 1) },
      { id: 'winter', open: isoFromParts(year + 1, 1, 1), deadline: isoFromParts(year + 1, 1, 31) },
    ],
    internationalBreaks: [
      breakAround(nthWeekday(year, 9, 6, 2)),
      breakAround(nthWeekday(year, 10, 6, 2)),
      breakAround(nthWeekday(year, 11, 6, 3)),
      breakAround(nthWeekday(year + 1, 3, 6, -1)),
    ],
    seasonEndProcessing: isoFromParts(year + 1, 6, 15),
  };
}

/** Emparejamientos todos contra todos (método del círculo), con ida y vuelta. */
export function roundRobin(teamIds: readonly string[], legs: number, rng: Rng): [string, string][][] {
  const BYE = '__bye__';
  const teams = rng.shuffle(teamIds);
  if (teams.length % 2 === 1) teams.push(BYE);
  const n = teams.length;
  const arr = teams.slice();
  const first: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i] as string;
      const b = arr[n - 1 - i] as string;
      if (a === BYE || b === BYE) continue;
      const homeFirst = i === 0 ? r % 2 === 0 : (i + r) % 2 === 0;
      pairs.push(homeFirst ? [a, b] : [b, a]);
    }
    first.push(pairs);
    // rotación manteniendo fijo el primero
    arr.splice(1, 0, arr.pop() as string);
  }
  const rounds = first.slice();
  for (let leg = 1; leg < legs; leg++) {
    for (const r of first) rounds.push(r.map(([h, a]) => (leg % 2 === 1 ? [a, h] : [h, a]) as [string, string]));
  }
  return rounds;
}

/** Reparte índices de forma uniforme: k elementos de entre n (incluye primero y último). */
function spread(n: number, k: number): number[] {
  if (k <= 0) return [];
  if (k === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(Math.round((i * (n - 1)) / (k - 1)));
  return [...new Set(out)];
}

/**
 * Fechas para `rounds` jornadas entre start y end en el día preferido, evitando los
 * rangos bloqueados. Si no caben, añade jornadas entre semana (miércoles) evitando las
 * fechas reservadas (copas).
 */
export function leagueDates(
  start: string,
  end: string,
  rounds: number,
  preferredWeekday: number,
  blocked: readonly DateRange[],
  reserved: ReadonlySet<string> = new Set(),
): string[] {
  let d = start;
  while (weekday(d) !== preferredWeekday) d = addDays(d, 1);
  const weekends: string[] = [];
  for (; d <= end; d = addDays(d, 7)) if (!inRanges(d, blocked)) weekends.push(d);
  if (weekends.length >= rounds) return spread(weekends.length, rounds).map((i) => weekends[i] as string);
  const need = rounds - weekends.length;
  const midweek: string[] = [];
  let w = addDays(start, 21);
  while (weekday(w) !== 3) w = addDays(w, 1);
  const near = (x: string) => [-1, 0, 1].some((k) => reserved.has(addDays(x, k)));
  for (; w <= addDays(end, -10); w = addDays(w, 7)) if (!inRanges(w, blocked) && !near(w)) midweek.push(w);
  const picked = spread(midweek.length, Math.min(need, midweek.length)).map((i) => midweek[i] as string);
  const all = [...weekends, ...picked].sort();
  // Si aun así no caben, se apilan al final (no debería ocurrir con calendarios normales)
  let extra = addDays(end, 3);
  while (all.length < rounds) { all.push(extra); extra = addDays(extra, 3); }
  return all;
}

/** Miércoles disponibles (para copas) entre dos fechas, fuera de parones. */
export function midweekDates(from: string, to: string, blocked: readonly DateRange[]): string[] {
  let d = from;
  while (weekday(d) !== 3) d = addDays(d, 1);
  const out: string[] = [];
  for (; d <= to; d = addDays(d, 7)) if (!inRanges(d, blocked)) out.push(d);
  return out;
}

export function pickSpread<T>(items: readonly T[], k: number): T[] {
  return spread(items.length, Math.min(k, items.length)).map((i) => items[i] as T);
}
