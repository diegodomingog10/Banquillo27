/**
 * IA de los clubes: durante el mercado cada club revisa sus necesidades (huecos por
 * posición y nivel del once), su presupuesto y su filosofía, y ficha en consecuencia.
 * Los grandes compran a los mejores de los pequeños; los endeudados venden. Fuera del
 * mercado fichan agentes libres si se quedan cortos, renuevan a los que cuentan y los
 * entrenadores son despedidos y contratados según los resultados.
 */
import { estimateWage, mainPosition, roundMoney } from '../data/ability';
import { GROUP_OF_POSITION, type PositionGroup } from '../data/positions';
import type { Club, Player, Staff } from '../data/schema';
import { ageAt, isoFromParts } from './date';
import { playerWageBill, revenueOf } from './economy';
import { addMessage, indexes, leagueOf, leagueTable, type GameState } from './game';
import { createRng, hashString } from './rng';
import { aiFillSquads, aiTransfer, askingPrice, emptyTerms, expectedRole, playerInterest, rankIn, squadOf, windowOpen } from './transfers';

/** Plantilla mínima deseada por grupo de posición. */
const NEED: Record<PositionGroup, number> = { GK: 3, CB: 4, FB: 4, DM: 2, CM: 4, WIDE: 4, AM: 2, ST: 3 };

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

function level(squad: readonly Player[]): number {
  const top = squad.map((p) => p.ca).sort((a, b) => b - a).slice(0, 11);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
}

/** Grupo con más necesidad: hueco en número o titular claramente por debajo del nivel del equipo. */
export function squadNeeds(squad: readonly Player[]): { group: PositionGroup; score: number }[] {
  const lvl = level(squad);
  const by = new Map<PositionGroup, Player[]>();
  for (const p of squad) {
    if (p.injury && p.injury.daysRemaining > 60) continue;
    const g = GROUP_OF_POSITION[mainPosition(p.positions)];
    by.set(g, [...(by.get(g) ?? []), p]);
  }
  return (Object.keys(NEED) as PositionGroup[]).map((g) => {
    const list = (by.get(g) ?? []).sort((a, b) => b.ca - a.ca);
    const gap = Math.max(0, NEED[g] - list.length) * 12;
    const best = list[0]?.ca ?? 0;
    const quality = Math.max(0, lvl - best - 4);
    return { group: g, score: gap + quality };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

interface Pools { byGroup: Map<PositionGroup, Player[]> }

function buildPools(state: GameState): Pools {
  const byGroup = new Map<PositionGroup, Player[]>();
  for (const p of state.world.players) {
    if (p.contract?.type === 'loan') continue;
    const g = GROUP_OF_POSITION[mainPosition(p.positions)];
    const list = byGroup.get(g) ?? [];
    list.push(p);
    byGroup.set(g, list);
  }
  for (const list of byGroup.values()) list.sort((a, b) => b.ca - a.ca);
  return { byGroup };
}

/** Un club de la IA intenta un fichaje. Devuelve true si cerró alguno. */
function clubBuys(state: GameState, club: Club, pools: Pools, rng: ReturnType<typeof createRng>, deadline: boolean): boolean {
  const ix = indexes(state);
  const squad = squadOf(state, club.id);
  if (squad.length >= 26) return false;
  // Como mucho tres llegadas por ventana
  const windowStart = state.calendar.windows.find((w) => state.date >= w.open && state.date <= w.deadline)?.open ?? state.date;
  const arrivals = state.transfers.history.filter((h) => h.toId === club.id && h.date >= windowStart && !h.loan).length;
  if (arrivals >= 3) return false;
  if (club.finances.balance < -revenueOf(club) * 0.05) return false;
  const needs = squadNeeds(squad);
  const need = needs[0];
  if (!need || need.score < (deadline ? 5 : 8)) return false;
  const groupBest = squad.filter((p) => GROUP_OF_POSITION[mainPosition(p.positions)] === need.group).reduce((m, p) => Math.max(m, p.ca), 0);
  const fillGap = need.score >= 12;
  const lvl = level(squad);
  const budget = club.finances.transferBudget;
  const wageRoom = club.finances.wageBudget - playerWageBill(state, club.id);
  const young = club.philosophy.includes('signYoungPlayers') || club.philosophy.includes('youthDevelopment');
  const domestic = club.philosophy.includes('signDomesticPlayers');
  const prudent = club.philosophy.includes('financialPrudence');
  const pool = pools.byGroup.get(need.group) ?? [];
  const minCa = fillGap ? lvl - 14 : Math.max(lvl - 2, groupBest + 3);
  const maxCa = lvl + 22;
  let best: { p: Player; fee: number; score: number } | null = null;
  let checked = 0;
  for (const p of pool) {
    if (p.ca > maxCa) continue;
    if (p.ca < minCa) break;
    if (p.clubId === club.id || p.injury) continue;
    // Recién fichado: no se mueve otra vez en unos meses
    const last = p.history[p.history.length - 1];
    if (last && (Date.parse(state.date) - Date.parse(last.from)) / 86400000 < 150) continue;
    if (state.transfers.deals.some((d) => d.playerId === p.id && ['pendingUser', 'agreed', 'negotiating', 'pendingClub'].includes(d.status))) continue;
    const age = ageAt(p.birthDate, state.date);
    if (age >= 33) continue;
    if (++checked > 60) break;
    const seller = p.clubId ? ix.clubs.get(p.clubId) : undefined;
    // Los clubes no se venden a rivales más modestos a sus figuras
    if (seller && seller.reputation > club.reputation + 1500 && rankIn(p, squadOf(state, seller.id)) <= 14) continue;
    const fee = seller ? askingPrice(state, p, club.id) * (seller.finances.balance < 0 ? 0.85 : 1) : 0;
    if (fee > budget * (prudent ? 0.6 : 0.9) || fee > Math.max(0, club.finances.balance) * 0.8 + budget * 0.2) continue;
    const wage = estimateWage(p.ca, club.reputation, age);
    if (wage > wageRoom * 1.05 && !(wage < (p.contract?.wage ?? 0))) continue;
    let score = (p.ca - lvl) * 1.2 + (age <= 23 ? (p.pa - p.ca) * (young ? 0.5 : 0.25) : 0) - age * 0.15 - (fee / Math.max(1, budget)) * 10;
    if (domestic && p.nationalities[0] === club.nationId) score += 6;
    if (!seller) score += 4;
    if (score > (best?.score ?? -Infinity)) best = { p, fee, score };
  }
  if (!best) return false;
  const p = best.p;
  // Si el jugador es del usuario, se le manda una oferta (como hasta ahora)
  if (p.clubId === state.userClubId) return offerToUser(state, club, p, best.fee, rng);
  if (playerInterest(state, p, club.id) < (deadline ? 30 : 38)) return false;
  const fee = p.clubId ? roundMoney(best.fee * rng.float(0.95, 1.1)) : 0;
  aiTransfer(state, p.id, club.id, fee, { installments: fee > budget * 0.5 ? rng.pick([12, 24]) : 0 });
  return true;
}

function offerToUser(state: GameState, club: Club, p: Player, fee: number, rng: ReturnType<typeof createRng>): boolean {
  if (state.transfers.deals.filter((d) => d.status === 'pendingUser').length >= 3) return false;
  if (!rng.chance(0.35)) return false;
  const price = roundMoney(fee * rng.float(0.8, 1.05));
  state.transfers.deals.unshift({
    id: `deal${(++state.transfers.seq).toString(36)}`, kind: 'transfer', playerId: p.id, buyerId: club.id, sellerId: state.userClubId,
    terms: { ...emptyTerms(), fee: price, installments: rng.chance(0.4) ? 12 : 0 }, counter: null, status: 'pendingUser', created: state.date,
    respondOn: isoAddDays(state.date, 4), patience: 2, demands: null, contract: null, completeOn: null, log: [{ date: state.date, text: `${club.name} hace una oferta.` }], rounds: 0,
  });
  const deal = state.transfers.deals[0]!;
  addMessage(state, {
    type: 'transfer', priority: 'high', key: 'incomingBid', sender: club.name,
    params: { player: nameOf(p), club: club.name, fee: price >= 1e6 ? `${(price / 1e6).toFixed(1).replace('.', ',')} M€` : `${Math.round(price / 1e3)} k€`, extra: deal.terms.installments ? ` (en ${deal.terms.installments} plazos)` : '' },
    actions: [
      { id: 'accept', kind: 'accept', labelKey: 'common.accept', payload: { dealId: deal.id } },
      { id: 'reject', kind: 'reject', labelKey: 'common.reject', payload: { dealId: deal.id } },
      { id: 'negotiate', kind: 'negotiate', labelKey: 'common.negotiate', payload: { dealId: deal.id } },
    ],
    related: { playerId: p.id, clubId: club.id },
  });
  return true;
}

function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Cedidos: los grandes ceden a jóvenes con futuro que no juegan a clubes de menor nivel. */
function clubLoansOut(state: GameState, club: Club, rng: ReturnType<typeof createRng>): void {
  if (club.reputation < 5000) return;
  const squad = squadOf(state, club.id);
  const cand = squad.filter((p) => ageAt(p.birthDate, state.date) <= 21 && p.pa >= p.ca + 15 && rankIn(p, squad) > 18 && p.contract?.type !== 'loan');
  if (!cand.length || !rng.chance(0.4)) return;
  const p = rng.pick(cand);
  const takers = state.world.clubs.filter((c) => c.id !== club.id && c.id !== state.userClubId && c.reputation < club.reputation * 0.7 && squadOf(state, c.id).length < 27 && expectedRole(state, p, c.id) !== 'backup');
  if (!takers.length) return;
  aiTransfer(state, p.id, rng.pick(takers).id, 0, { loan: true });
}

// ---------------------------------------------------------------- día a día
export function aiClubsDay(state: GameState): void {
  const ix = indexes(state);
  const open = windowOpen(state);
  const deadline = state.calendar.windows.some((w) => w.deadline === state.date);
  if (open) {
    const pools = buildPools(state);
    const rng = createRng(hashString(`ai:${state.seed}:${state.date}`));
    for (const club of state.world.clubs) {
      if (club.id === state.userClubId) continue;
      // Cada club actúa cada pocos días (todos el último día de mercado)
      if (!deadline && hashString(`${club.id}:${state.date}`) % 5 !== 0) continue;
      const tries = deadline ? 2 : 1;
      for (let k = 0; k < tries; k++) if (!clubBuys(state, club, pools, rng, deadline)) break;
      if (state.date.endsWith('-15') || deadline) clubLoansOut(state, club, rng);
    }
  } else if (state.date.endsWith('-01') || state.date.endsWith('-15')) {
    // Fuera del mercado: solo agentes libres si se quedan cortos
    aiFillSquads(state, 20);
  }
  if (state.date.endsWith('-01')) {
    aiRenewals(state);
    managerCarousel(state);
  }
  void ix;
}

/** Renovaciones de la IA: los que cuentan y tienen contrato que vence esta temporada. */
function aiRenewals(state: GameState): void {
  const end = state.calendar.end;
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId) continue;
    const squad = squadOf(state, club.id);
    for (const p of squad) {
      if (!p.contract || p.contract.type === 'loan' || p.contract.expires > end) continue;
      const age = ageAt(p.birthDate, state.date);
      const rank = rankIn(p, squad);
      if (!((rank <= 16 && age <= 31) || (age <= 22 && p.pa > p.ca + 12 && rank <= 26))) continue;
      if (hashString(`airenew:${p.id}:${state.date}`) % 3 !== 0) continue; // no todos el mismo mes
      const years = age <= 24 ? 4 : age <= 28 ? 3 : 2;
      p.contract.expires = isoFromParts(state.seasonYear + 1 + years - 1, 6, 30);
      p.contract.wage = roundMoney(Math.max(p.contract.wage * 1.08, estimateWage(p.ca, club.reputation, age) * 0.95));
    }
  }
}

// ---------------------------------------------------------------- entrenadores
export interface ManagerMove { date: string; clubId: string; outId: string | null; inId: string | null; reason: 'sacked' | 'hired' }

function managerOf(state: GameState, club: Club): Staff | undefined {
  const ids = new Set(club.staffIds);
  return state.world.staff.find((s) => ids.has(s.id) && s.role === 'manager');
}

/** Cada mes, entre octubre y abril, las directivas de la IA valoran a su entrenador. */
function managerCarousel(state: GameState): void {
  const month = Number(state.date.slice(5, 7));
  if (!(month >= 10 || month <= 4)) return;
  const ix = indexes(state);
  const rng = createRng(hashString(`carousel:${state.seed}:${state.date}`));
  for (const league of state.world.competitions) {
    if (league.format !== 'league') continue;
    const table = leagueTable(state, league.id);
    if (!table.length || (table[0]?.played ?? 0) < 8) continue;
    const byRep = league.teamIds.slice().sort((a, b) => (ix.clubs.get(b)?.reputation ?? 0) - (ix.clubs.get(a)?.reputation ?? 0));
    const n = table.length;
    for (const row of table) {
      const club = ix.clubs.get(row.clubId);
      if (!club || club.id === state.userClubId) continue;
      const expected = byRep.indexOf(club.id) + 1;
      const margin = Math.max(4, Math.round(n * 0.3));
      const relegation = league.promotion?.relegated ? row.position > n - league.promotion.relegated && expected <= n - league.promotion.relegated - 2 : false;
      if (row.position <= expected + margin && !relegation) continue;
      if (!rng.chance(relegation ? 0.35 : 0.22)) continue;
      replaceManager(state, club, rng);
    }
  }
}

export function replaceManager(state: GameState, club: Club, rng: ReturnType<typeof createRng>): void {
  const ix = indexes(state);
  const old = managerOf(state, club);
  if (old) {
    old.clubId = null;
    old.contract = null;
    club.staffIds = club.staffIds.filter((id) => id !== old.id);
  }
  // Libres con reputación adecuada; si no hay, asciende el segundo
  const free = state.world.staff.filter((s) => s.role === 'manager' && !s.clubId && s.reputation <= club.reputation * 1.3 && s.id !== old?.id)
    .sort((a, b) => b.reputation - a.reputation);
  let hired = free.length ? free[rng.int(0, Math.min(2, free.length - 1))] ?? null : null;
  if (!hired) {
    const ids = new Set(club.staffIds);
    hired = state.world.staff.find((s) => ids.has(s.id) && s.role === 'assistantManager') ?? null;
    if (hired) hired.role = 'manager';
  }
  if (hired) {
    hired.clubId = club.id;
    hired.contract = { wage: roundMoney(400 * 3 * Math.exp(club.reputation / 2500)), expires: isoFromParts(state.seasonYear + 2, 6, 30), releaseClause: null, bonuses: { appearance: 0, goal: 0, cleanSheet: 0, signing: 0, loyalty: 0 }, type: 'full', loanFromClubId: null };
    if (!club.staffIds.includes(hired.id)) club.staffIds.push(hired.id);
  }
  const moves = (state.managerMoves ??= []);
  moves.unshift({ date: state.date, clubId: club.id, outId: old?.id ?? null, inId: hired?.id ?? null, reason: 'sacked' });
  if (moves.length > 120) moves.length = 120;
  const sameLeague = leagueOf(state, club.id)?.teamIds.includes(state.userClubId);
  const text = `${club.name} destituye a ${old ? `${old.firstName} ${old.lastName}` : 'su entrenador'}${hired ? `; le sustituye ${hired.firstName} ${hired.lastName}` : ''}`;
  state.news.unshift({ date: state.date, type: 'manager', text });
  if (sameLeague) addMessage(state, { type: 'news', priority: 'low', key: 'managerSacked', params: { text } });
  void ix;
}
