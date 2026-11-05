/**
 * Clasificación de una liga a partir de los resultados, con los criterios de
 * desempate de la competición (puntos, diferencia, goles, enfrentamiento directo…).
 */
import type { Competition } from '../data/schema';
import { hashString } from './rng';

export interface ResultLike {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SideRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
}

export interface StandingRow extends SideRecord {
  clubId: string;
  position: number;
  gd: number;
  points: number;
  /** Últimos 5 resultados, el más reciente al final. */
  form: ('W' | 'D' | 'L')[];
  home: SideRecord;
  away: SideRecord;
}

const emptySide = (): SideRecord => ({ played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });

function addResult(s: SideRecord, gf: number, ga: number): void {
  s.played++;
  s.gf += gf;
  s.ga += ga;
  if (gf > ga) s.won++;
  else if (gf === ga) s.drawn++;
  else s.lost++;
}

export function computeStandings(
  teamIds: readonly string[],
  results: readonly ResultLike[],
  rules: Pick<Competition['rules'], 'pointsForWin' | 'pointsForDraw' | 'tiebreakers'>,
  salt = '',
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, { clubId: id, position: 0, gd: 0, points: 0, form: [], home: emptySide(), away: emptySide(), ...emptySide() });
  }
  const pts = (gf: number, ga: number) => (gf > ga ? rules.pointsForWin : gf === ga ? rules.pointsForDraw : 0);
  for (const r of results) {
    const h = rows.get(r.homeId);
    const a = rows.get(r.awayId);
    if (!h || !a) continue;
    addResult(h, r.homeGoals, r.awayGoals);
    addResult(h.home, r.homeGoals, r.awayGoals);
    addResult(a, r.awayGoals, r.homeGoals);
    addResult(a.away, r.awayGoals, r.homeGoals);
    h.points += pts(r.homeGoals, r.awayGoals);
    a.points += pts(r.awayGoals, r.homeGoals);
    h.form.push(r.homeGoals > r.awayGoals ? 'W' : r.homeGoals === r.awayGoals ? 'D' : 'L');
    a.form.push(r.awayGoals > r.homeGoals ? 'W' : r.homeGoals === r.awayGoals ? 'D' : 'L');
  }
  for (const r of rows.values()) {
    r.gd = r.gf - r.ga;
    r.form = r.form.slice(-5);
  }

  // Mini-liga entre empatados para criterios de enfrentamiento directo
  const h2h = (ids: Set<string>) => {
    const m = new Map<string, { points: number; gd: number; gf: number }>();
    for (const id of ids) m.set(id, { points: 0, gd: 0, gf: 0 });
    for (const r of results) {
      if (!ids.has(r.homeId) || !ids.has(r.awayId)) continue;
      const h = m.get(r.homeId)!;
      const a = m.get(r.awayId)!;
      h.points += pts(r.homeGoals, r.awayGoals);
      a.points += pts(r.awayGoals, r.homeGoals);
      h.gd += r.homeGoals - r.awayGoals;
      a.gd += r.awayGoals - r.homeGoals;
      h.gf += r.homeGoals;
      a.gf += r.awayGoals;
    }
    return m;
  };

  const sorted = [...rows.values()].sort((a, b) => b.points - a.points);
  // Ordenar dentro de cada grupo de empatados a puntos aplicando los criterios en orden
  const keyFor = (row: StandingRow, crit: string, mini: Map<string, { points: number; gd: number; gf: number }> | null): number => {
    switch (crit) {
      case 'points': return row.points;
      case 'goalDifference': return row.gd;
      case 'goalsFor': return row.gf;
      case 'wins': return row.won;
      case 'awayGoalsFor': return row.away.gf;
      case 'headToHeadPoints': return mini?.get(row.clubId)?.points ?? 0;
      case 'headToHeadGoalDifference': return mini?.get(row.clubId)?.gd ?? 0;
      case 'drawingLots': return hashString(`${salt}:${row.clubId}`);
      default: return 0;
    }
  };
  const crits = [...rules.tiebreakers.filter((c) => c !== 'points' && c !== 'fairPlay'), 'drawingLots'];
  const out: StandingRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && (sorted[j] as StandingRow).points === (sorted[i] as StandingRow).points) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      const mini = h2h(new Set(group.map((g) => g.clubId)));
      group.sort((a, b) => {
        for (const c of crits) {
          const d = keyFor(b, c, mini) - keyFor(a, c, mini);
          if (d !== 0) return d;
        }
        return a.clubId < b.clubId ? -1 : 1;
      });
    }
    out.push(...group);
    i = j;
  }
  out.forEach((r, k) => { r.position = k + 1; });
  return out;
}
