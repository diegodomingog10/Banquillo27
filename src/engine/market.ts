/**
 * Búsqueda de jugadores en el mercado con lo que sabe el club (ojeo): nunca se ordena
 * ni se filtra por datos reales que el usuario no conoce, solo por estimaciones.
 */
import { mainPosition } from '../data/ability';
import { GROUP_OF_POSITION } from '../data/positions';
import { ageAt } from './date';
import { indexes, leagueOf, type GameState } from './game';
import { knowledgeOf, recommendation, scoutedAbility } from './scouting';

export interface MarketFilter {
  q?: string;
  /** reported: jugadores de los que tus ojeadores tienen informe. */
  scope?: 'all' | 'shortlist' | 'free' | 'known' | 'league' | 'listed' | 'reported';
  /** Recomendación mínima de los ojeadores (A la mejor). */
  minRec?: 'A' | 'B' | 'C' | null;
  group?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  maxValue?: number | null;
  nationId?: string | null;
  sort?: 'ability' | 'potential' | 'value' | 'age' | 'recommendation' | 'recent';
  limit?: number;
}

function scoutNameOf(state: GameState, id: string): string {
  const s = state.world.staff.find((x) => x.id === id);
  return s ? `${s.firstName} ${s.lastName}` : '';
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function marketSearch(state: GameState, f: MarketFilter) {
  const ix = indexes(state);
  const userBest = Math.max(1, ...(ix.squads.get(state.userClubId) ?? []).map((x) => x.ca));
  const shortlist = new Set(state.ui.shortlist);
  const league = leagueOf(state, state.userClubId);
  const leagueClubs = new Set(league?.teamIds ?? []);
  const q = f.q ? norm(f.q.trim()) : '';
  const scoutName = (id: string) => scoutNameOf(state, id);
  const rows = [];
  for (const p of state.world.players) {
    if (p.clubId === state.userClubId) continue;
    if (f.scope === 'shortlist' && !shortlist.has(p.id)) continue;
    if (f.scope === 'free' && p.clubId) continue;
    if (f.scope === 'league' && (!p.clubId || !leagueClubs.has(p.clubId))) continue;
    const age = ageAt(p.birthDate, state.date);
    if (f.minAge && age < f.minAge) continue;
    if (f.maxAge && age > f.maxAge) continue;
    if (f.maxValue && p.marketValue > f.maxValue) continue;
    if (f.nationId && p.nationalities[0] !== f.nationId) continue;
    const pos = mainPosition(p.positions);
    if (f.group && GROUP_OF_POSITION[pos] !== f.group) continue;
    const name = p.commonName ?? `${p.firstName} ${p.lastName}`;
    if (q && !norm(name).includes(q)) continue;
    const report = state.scouting.knowledge[p.id];
    if (f.scope === 'reported' && !report) continue;
    const k = knowledgeOf(state, p);
    if (f.scope === 'known' && k.level < 40) continue;
    const rec = k.level >= 40 ? recommendation(state, p) : null;
    if (f.minRec && (!rec || rec > f.minRec)) continue;
    const ab = scoutedAbility(state, p, userBest);
    const club = p.clubId ? ix.clubs.get(p.clubId) : undefined;
    rows.push({
      id: p.id, name, age, position: pos, club: club?.name ?? 'Libre', clubId: club?.id ?? null,
      nation: state.world.nations.find((n) => n.id === p.nationalities[0])?.name ?? '',
      value: p.marketValue, wage: p.contract?.wage ?? 0, expires: p.contract?.expires ?? null, loan: p.contract?.type === 'loan',
      knowledge: k.level, ca: ab.ca, pa: ab.pa, caMid: (ab.ca[0] + ab.ca[1]) / 2, paMid: (ab.pa[0] + ab.pa[1]) / 2,
      rec, shortlisted: shortlist.has(p.id),
      /** Fecha del último informe de tus ojeadores y quién lo hizo (null si no hay). */
      reportDate: report?.updated ?? null,
      reportBy: report?.scoutId ? scoutName(report.scoutId) : null,
    });
  }
  const sort = f.sort ?? 'ability';
  const recRank = (r: string | null) => (r ? r.charCodeAt(0) : 90);
  rows.sort((a, b) => sort === 'value' ? b.value - a.value : sort === 'age' ? a.age - b.age
    : sort === 'potential' ? b.paMid - a.paMid || b.knowledge - a.knowledge
    : sort === 'recommendation' ? recRank(a.rec) - recRank(b.rec) || b.caMid - a.caMid
    : sort === 'recent' ? (b.reportDate ?? '').localeCompare(a.reportDate ?? '') || recRank(a.rec) - recRank(b.rec)
    : b.caMid - a.caMid || b.knowledge - a.knowledge);
  // Informes en camino (encargados a un ojeador y aún sin entregar)
  const pending = state.scouting.requests.map((r) => {
    const p = ix.players.get(r.playerId);
    return { id: r.playerId, name: p ? p.commonName ?? `${p.firstName} ${p.lastName}` : r.playerId, due: r.due, by: scoutName(r.scoutId) };
  });
  return { total: rows.length, rows: rows.slice(0, f.limit ?? (f.scope === 'reported' ? 300 : 80)), pending };
}
