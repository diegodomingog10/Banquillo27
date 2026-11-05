/** Utilidades de fechas ISO (AAAA-MM-DD) en UTC, sin dependencias. */

export function parseIso(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1));
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function isoFromParts(y: number, m: number, d: number): string {
  return toIso(new Date(Date.UTC(y, m - 1, d)));
}

/** Edad en años cumplidos en la fecha de referencia. */
export function ageAt(birthIso: string, refIso: string): number {
  const b = parseIso(birthIso);
  const r = parseIso(refIso);
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Años (con decimales) entre dos fechas. */
export function yearsBetween(fromIso: string, toIsoDate: string): number {
  return (parseIso(toIsoDate).getTime() - parseIso(fromIso).getTime()) / (365.25 * 86400000);
}

export function isValidIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toIso(parseIso(s)) === s;
}
