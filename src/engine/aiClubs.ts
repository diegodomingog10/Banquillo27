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
import { debit, playerWageBill, revenueOf } from './economy';
const debitWages = (state: GameState, clubId: string, amount: number) => debit(state, clubId, 'wages', amount);
import { addMessage, indexes, invalidate, leagueOf, leagueTable, type GameState } from './game';
import { createRng, hashString } from './rng';
import { aiFillSquads, aiTransfer, askingPrice, emptyTerms, expectedRole, playerInterest, rankIn, squadOf, windowOpen } from './transfers';

/** Plantilla mínima deseada por grupo de posición. */
const NEED: Record<PositionGroup, number> = { GK: 2, CB: 3, FB: 2, DM: 1, CM: 3, WIDE: 2, AM: 1, ST: 2 };

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

function level(squad: readonly Player[]): number {
  const top = squad.map((p) => p.ca).sort((a, b) => b - a).slice(0, 11);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
}

/** Huecos en número: grupos de posición con menos jugadores de los necesarios. */
export function squadNeeds(squad: readonly Player[]): { group: PositionGroup; score: number }[] {
  const by = new Map<PositionGroup, Player[]>();
  for (const p of squad) {
    if (p.injury && p.injury.daysRemaining > 60) continue;
    const g = GROUP_OF_POSITION[mainPosition(p.positions)];
    by.set(g, [...(by.get(g) ?? []), p]);
  }
  return (Object.keys(NEED) as PositionGroup[]).map((g) => {
    const list = by.get(g) ?? [];
    return { group: g, score: Math.max(0, NEED[g] - list.length) * 12 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

export interface CoreEntry { id: string; ca: number; group: PositionGroup }

/** Foto del núcleo (16 mejores) de cada club: referencia para saber a quién ha perdido. */
export function snapshotCores(state: GameState): void {
  const cores: Record<string, CoreEntry[]> = {};
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId) continue;
    cores[club.id] = squadOf(state, club.id).slice().sort((a, b) => b.ca - a.ca).slice(0, 16)
      .map((p) => ({ id: p.id, ca: p.ca, group: GROUP_OF_POSITION[mainPosition(p.positions)] }));
  }
  state.aiCores = cores;
}

interface Need { group: PositionGroup; score: number; minCa: number; maxCa: number; replacing: boolean }

/**
 * Necesidades reales del club: titulares que se le han ido desde el último mercado
 * (vendidos, libres, retirados o con lesión larga) y aún sin sustituto, y huecos en número.
 */
export function realNeeds(state: GameState, club: Club, squad: readonly Player[], windowStart: string): Need[] {
  const ix = indexes(state);
  const lvl = level(squad);
  const here = new Set(squad.map((p) => p.id));
  const end = state.calendar.end;
  const lost = (state.aiCores?.[club.id] ?? []).filter((c) => {
    if (!here.has(c.id)) return true;
    const p = ix.players.get(c.id);
    if (!p) return true;
    if (p.injury && p.injury.daysRemaining > 90) return true;
    // Se irá: contrato que vence sin renovar o veterano a punto de retirarse
    if (p.contract && p.contract.type !== 'loan' && p.contract.expires <= end && ageAt(p.birthDate, state.date) >= 32) return true;
    return ageAt(p.birthDate, state.date) >= 34;
  });
  // Llegadas de este mercado que ya cubren alguna baja
  const arrivals = state.transfers.history.filter((h) => h.toId === club.id && h.date >= windowStart).map((h) => ix.players.get(h.playerId)).filter((p): p is Player => !!p && p.clubId === club.id);
  const used = new Set<string>();
  const needs: Need[] = [];
  for (const c of lost.sort((a, b) => b.ca - a.ca)) {
    const cover = arrivals.find((p) => !used.has(p.id) && GROUP_OF_POSITION[mainPosition(p.positions)] === c.group && p.ca >= c.ca - 10);
    if (cover) { used.add(cover.id); continue; }
    needs.push({ group: c.group, score: 20 + (c.ca - lvl) / 4, minCa: c.ca - 8, maxCa: c.ca + 20, replacing: true });
  }
  for (const g of squadNeeds(squad)) {
    if (needs.some((n) => n.group === g.group)) continue;
    needs.push({ group: g.group, score: g.score, minCa: lvl - 14, maxCa: lvl + 15, replacing: false });
  }
  return needs.sort((a, b) => b.score - a.score);
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
  if (club.finances.balance < -revenueOf(club) * 0.05) return false;
  const windowStart = state.calendar.windows.find((w) => state.date >= w.open && state.date <= w.deadline)?.open ?? state.date;
  // Solo se ficha para cubrir huecos reales (sin tope fijo de fichajes)
  const need = realNeeds(state, club, squad, windowStart)[0];
  if (!need) return false;
  // Plantilla llena: primero se hace sitio (ceder un joven o dar la baja a un sobrante)
  if (squad.length >= (need.replacing ? 28 : 26) && !makeRoom(state, club, squad, need.group, rng)) return false;
  const lvl = level(squad);
  const budget = club.finances.transferBudget;
  const wageRoom = club.finances.wageBudget - playerWageBill(state, club.id);
  const young = club.philosophy.includes('signYoungPlayers') || club.philosophy.includes('youthDevelopment');
  const domestic = club.philosophy.includes('signDomesticPlayers');
  const prudent = club.philosophy.includes('financialPrudence');
  const pool = pools.byGroup.get(need.group) ?? [];
  const maxCa = need.maxCa;
  let best: { p: Player; fee: number; score: number } | null = null;
  // Si no hay nadie del nivel buscado, se conforma con alguien algo peor
  for (const minCa of [need.minCa - (deadline ? 4 : 0), need.minCa - 14]) {
  if (best) break;
  let checked = 0;
  for (const p of pool) {
    if (p.ca > maxCa) continue;
    if (p.ca < minCa) break;
    if (p.clubId === club.id || p.injury) continue;
    // Se ha movido hace poco (traspaso, baja o cesión): no cambia otra vez de club en unos meses
    if (movedRecently(state, p)) continue;
    if (state.transfers.deals.some((d) => d.playerId === p.id && ['pendingUser', 'agreed', 'negotiating', 'pendingClub'].includes(d.status))) continue;
    const age = ageAt(p.birthDate, state.date);
    if (age >= 33) continue;
    if (++checked > 60) break;
    const seller = p.clubId ? ix.clubs.get(p.clubId) : undefined;
    // Los clubes no se venden a rivales más modestos a sus figuras
    if (seller && seller.reputation > club.reputation + 1500 && rankIn(p, squadOf(state, seller.id)) <= 14) continue;
    // El vendedor no deja salir a más de dos titulares en el mismo mercado
    if (seller && seller.id !== state.userClubId && rankIn(p, squadOf(state, seller.id)) <= 16 && coreSoldThisWindow(state, seller.id, windowStart) >= 2) continue;
    const fee = seller ? askingPrice(state, p, club.id) * (seller.finances.balance < 0 ? 0.85 : 1) : 0;
    if (fee > budget * (prudent ? 0.6 : 0.9) || fee > Math.max(0, club.finances.balance) * 0.8 + budget * 0.2) continue;
    const wage = estimateWage(p.ca, club.reputation, age);
    if (wage > wageRoom * 1.05 && !(wage < (p.contract?.wage ?? 0))) continue;
    let score = (p.ca - lvl) * 1.2 + (age <= 23 ? (p.pa - p.ca) * (young ? 0.5 : 0.25) : 0) - age * 0.15 - (fee / Math.max(1, budget)) * 10;
    if (domestic && p.nationalities[0] === club.nationId) score += 6;
    if (!seller) score += 4;
    if (score > (best?.score ?? -Infinity)) best = { p, fee, score };
  }
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

/** Hace sitio en una plantilla llena: cede a un joven con futuro o da la baja al sobrante menos útil. */
function makeRoom(state: GameState, club: Club, squad: readonly Player[], needGroup: PositionGroup, rng: ReturnType<typeof createRng>): boolean {
  const count = new Map<PositionGroup, number>();
  for (const p of squad) { const g = GROUP_OF_POSITION[mainPosition(p.positions)]; count.set(g, (count.get(g) ?? 0) + 1); }
  const surplus = squad.filter((p) => {
    const g = GROUP_OF_POSITION[mainPosition(p.positions)];
    return g !== needGroup && (count.get(g) ?? 0) > NEED[g] && rankIn(p, squad) > 14 && p.contract?.type !== 'loan' && !movedRecently(state, p);
  });
  if (!surplus.length) return false;
  const age = (p: Player) => ageAt(p.birthDate, state.date);
  const value = (p: Player) => (age(p) <= 21 ? p.pa : p.ca) - Math.max(0, age(p) - 29) * 5;
  const out = surplus.slice().sort((a, b) => value(a) - value(b))[0]!;
  // Joven con futuro: cedido a un club de menor nivel; si no, baja
  if (age(out) <= 21 && out.pa >= out.ca + 15) {
    const takers = state.world.clubs.filter((c) => c.id !== club.id && c.id !== state.userClubId && c.reputation < club.reputation && squadOf(state, c.id).length < 25);
    if (takers.length) { aiTransfer(state, out.id, rng.pick(takers).id, 0, { loan: true }); return true; }
  }
  const last = out.history[out.history.length - 1];
  if (last && last.to === null) last.to = state.date;
  out.clubId = null;
  out.contract = null;
  state.transfers.history.unshift({ date: state.date, playerId: out.id, name: nameOf(out), fromId: club.id, toId: null, fee: 0, loan: false });
  invalidate(state);
  return true;
}

function offerToUser(state: GameState, club: Club, p: Player, fee: number, rng: ReturnType<typeof createRng>, force = false): boolean {
  if (state.transfers.deals.filter((d) => d.status === 'pendingUser').length >= 3) return false;
  if (!force && !rng.chance(0.35)) return false;
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

/** Titulares (del núcleo al cerrar el último mercado) que el club ha vendido en este mercado. */
function coreSoldThisWindow(state: GameState, clubId: string, windowStart: string): number {
  const core = new Set((state.aiCores?.[clubId] ?? []).map((c) => c.id));
  return state.transfers.history.filter((h) => h.fromId === clubId && h.toId && !h.loan && h.date >= windowStart && core.has(h.playerId)).length;
}

/** ¿Ha cambiado de club (traspaso, baja, cesión) en los últimos 150 días? */
export function movedRecently(state: GameState, p: Player, days = 150): boolean {
  const last = p.history[p.history.length - 1];
  const fromHistory = last ? last.from : null;
  const fromMarket = state.transfers.history.find((h) => h.playerId === p.id)?.date ?? null;
  const latest = [fromHistory, fromMarket, last?.to ?? null].filter((x): x is string => !!x).sort().at(-1);
  return !!latest && (Date.parse(state.date) - Date.parse(latest)) / 86400000 < days;
}

function addDaysIso(iso: string, n: number): string {
  return isoAddDays(iso, n);
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
  // Foto del núcleo de cada plantilla al empezar y al día siguiente de cerrar cada mercado
  if (!state.aiCores || state.calendar.windows.some((w) => addDaysIso(w.deadline, 1) === state.date)) snapshotCores(state);
  // El día de cierre se juega por horas desde la pantalla de fichajes; si ya se jugó, no se repite
  if (deadline && state.deadline?.date === state.date && state.deadline.hour >= DEADLINE_END) return;
  if (deadline && state.deadline?.date === state.date) { while (state.deadline.hour < DEADLINE_END) deadlineStep(state); return; }
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
    debtWageCuts(state);
  }
  if (open) debtSales(state, deadline);
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

// ---------------------------------------------------------------- día de cierre
export const DEADLINE_START = 9;
export const DEADLINE_END = 23;

export interface DeadlineState { date: string; hour: number; feed: { hour: number; text: string }[] }

/** Empieza el día de cierre (si toca hoy). */
export function startDeadline(state: GameState): DeadlineState | null {
  const today = state.calendar.windows.find((w) => w.deadline === state.date);
  if (!today) return null;
  if (state.deadline?.date !== state.date) state.deadline = { date: state.date, hour: DEADLINE_START, feed: [] };
  return state.deadline;
}

/** Avanza dos horas del día de cierre: actúa una parte de los clubes y pueden llegar ofertas de última hora. */
export function deadlineStep(state: GameState): DeadlineState {
  const dl = startDeadline(state);
  if (!dl) throw new Error('Hoy no es el día de cierre del mercado');
  if (dl.hour >= DEADLINE_END) return dl;
  const steps = (DEADLINE_END - DEADLINE_START) / 2;
  const step = (dl.hour - DEADLINE_START) / 2;
  const before = state.transfers.history.length;
  const pools = buildPools(state);
  const rng = createRng(hashString(`deadline:${state.seed}:${state.date}:${dl.hour}`));
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId) continue;
    if (hashString(`dl:${club.id}`) % steps !== step) continue;
    for (let k = 0; k < 2; k++) if (!clubBuys(state, club, pools, rng, true)) break;
    clubLoansOut(state, club, rng);
  }
  // Ofertas de última hora por jugadores del usuario
  const user = squadOf(state, state.userClubId);
  if (user.length && rng.chance(0.35)) {
    const p = rng.pick(user.filter((x) => x.contract?.type !== 'loan' && !state.transfers.deals.some((d) => d.playerId === x.id && d.status === 'pendingUser')));
    const buyer = p ? state.world.clubs.filter((c) => c.id !== state.userClubId && c.finances.transferBudget > p.marketValue && expectedRole(state, p, c.id) !== 'backup') : [];
    if (p && buyer.length) { const b = rng.pick(buyer); offerToUser(state, b, p, askingPrice(state, p, b.id), rng, true); }
  }
  const ix = indexes(state);
  const club = (id: string | null) => (id ? ix.clubs.get(id)?.name ?? '' : 'libre');
  for (const h of state.transfers.history.slice(0, state.transfers.history.length - before).reverse()) {
    dl.feed.unshift({ hour: dl.hour, text: `${h.name}: ${club(h.fromId)} → ${club(h.toId)} (${h.loan ? 'cedido' : h.fee ? (h.fee >= 1e6 ? `${(h.fee / 1e6).toFixed(1).replace('.', ',')} M€` : `${Math.round(h.fee / 1e3)} k€`) : 'libre'})` });
  }
  if (dl.feed.length > 120) dl.feed.length = 120;
  dl.hour += 2;
  return dl;
}

export function deadlineView(state: GameState) {
  const today = state.calendar.windows.find((w) => w.deadline === state.date);
  if (!today) return null;
  const dl = state.deadline?.date === state.date ? state.deadline : { date: state.date, hour: DEADLINE_START, feed: [] };
  return { ...dl, end: DEADLINE_END, done: dl.hour >= DEADLINE_END, pending: state.transfers.deals.filter((d) => d.status === 'pendingUser').length };
}

// ---------------------------------------------------------------- plan de viabilidad
/** Club muy endeudado: saldo por debajo del −10 % de sus ingresos anuales. */
export function inDebtCrisis(club: Club): boolean {
  return club.finances.balance < -revenueOf(club) * 0.1;
}

/** Durante el mercado, un club en crisis vende a su jugador más caro a quien pueda pagarlo (uno por mercado). */
function debtSales(state: GameState, deadline: boolean): void {
  const ix = indexes(state);
  const windowStart = state.calendar.windows.find((w) => state.date >= w.open && state.date <= w.deadline)?.open ?? state.date;
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId || !inDebtCrisis(club)) continue;
    if (!deadline && hashString(`debt:${club.id}:${state.date}`) % 6 !== 0) continue;
    const already = state.transfers.history.some((h) => h.fromId === club.id && h.toId && !h.loan && h.date >= windowStart && h.fee > 0 && state.debtSales?.includes(`${club.id}:${h.playerId}`));
    if (already || coreSoldThisWindow(state, club.id, windowStart) >= 2) continue;
    const squad = squadOf(state, club.id);
    if (squad.length <= 20) continue;
    const forSale = squad.filter((p) => p.contract?.type !== 'loan' && !p.injury && !movedRecently(state, p) && ageAt(p.birthDate, state.date) <= 31).sort((a, b) => b.marketValue - a.marketValue);
    for (const p of forSale.slice(0, 3)) {
      const fee = roundMoney(askingPrice(state, p, club.id) * 0.85);
      const buyers = state.world.clubs.filter((c) => {
        if (c.id === club.id || c.id === state.userClubId || inDebtCrisis(c)) return false;
        if (c.finances.transferBudget < fee || c.finances.balance < fee * 0.5) return false;
        const sq = squadOf(state, c.id);
        return sq.length < 28 && p.ca >= level(sq) - 5;
      }).filter((c) => playerInterest(state, p, c.id) >= 35).sort((a, b) => b.reputation - a.reputation);
      const buyer = buyers[0];
      if (!buyer) continue;
      aiTransfer(state, p.id, buyer.id, fee, { installments: fee > buyer.finances.transferBudget * 0.5 ? 12 : 0 });
      (state.debtSales ??= []).push(`${club.id}:${p.id}`);
      if (state.debtSales.length > 300) state.debtSales.splice(0, state.debtSales.length - 300);
      state.news.unshift({ date: state.date, type: 'transfer', text: `${club.name} vende a ${nameOf(p)} a ${buyer.name} para aliviar sus deudas` });
      break;
    }
    void ix;
  }
}

/** Cada mes, un club en crisis rescinde el contrato de un veterano caro que no es titular. */
function debtWageCuts(state: GameState): void {
  for (const club of state.world.clubs) {
    if (club.id === state.userClubId || !inDebtCrisis(club)) continue;
    club.finances.transferBudget = 0;
    const squad = squadOf(state, club.id);
    if (squad.length <= 22) continue;
    const cand = squad.filter((p) => rankIn(p, squad) > 16 && ageAt(p.birthDate, state.date) >= 28 && p.contract && p.contract.type !== 'loan' && !movedRecently(state, p))
      .sort((a, b) => (b.contract?.wage ?? 0) - (a.contract?.wage ?? 0));
    const out = cand[0];
    if (!out?.contract) continue;
    // Rescisión pactada: se le pagan tres meses de sueldo
    debitWages(state, club.id, out.contract.wage * 13);
    const last = out.history[out.history.length - 1];
    if (last && last.to === null) last.to = state.date;
    out.clubId = null;
    out.contract = null;
    state.transfers.history.unshift({ date: state.date, playerId: out.id, name: nameOf(out), fromId: club.id, toId: null, fee: 0, loan: false });
  }
  invalidate(state);
}
