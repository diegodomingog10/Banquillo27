/**
 * Mercado de fichajes: ofertas a clubes (importe, plazos, bonus por partidos, porcentaje
 * de reventa, intercambio), cesiones con o sin opción de compra, cláusulas de rescisión,
 * negociación de contratos con el jugador y su agente, renovaciones, ofertas de otros
 * clubes por jugadores del usuario y fin de contratos.
 *
 * Cada jugador decide según su ambición, la reputación del club, los minutos que espera
 * (rol en la plantilla), el proyecto (categoría), el salario y su personalidad.
 */
import { estimateWage, mainPosition, roundMoney } from '../data/ability';
import type { Club, Contract, Player } from '../data/schema';
import { addDays, ageAt, isoFromParts, yearsBetween } from './date';
import { credit, debit, payTransferFee, schedulePayment, transferCash, transferEmbargo, playerWageBill } from './economy';
import { addMessage, indexes, invalidate, leagueOf, type GameState } from './game';
import { clamp, createRng, hashString } from './rng';
import { addConcern } from './dressingRoom';

export const SQUAD_ROLES = ['star', 'important', 'rotation', 'backup', 'youth'] as const;
export type SquadRole = (typeof SQUAD_ROLES)[number];
export const ROLE_LABEL: Record<SquadRole, string> = { star: 'Estrella', important: 'Importante', rotation: 'Rotación', backup: 'Suplente', youth: 'Promesa' };
const ROLE_RANK: Record<SquadRole, number> = { star: 0, important: 1, rotation: 2, backup: 3, youth: 3 };

export interface ContractTerms {
  /** Salario semanal. */
  wage: number;
  years: number;
  signingBonus: number;
  agentFee: number;
  releaseClause: number | null;
  role: SquadRole;
  goalBonus: number;
}

export interface OfferTerms {
  fee: number;
  /** Plazos mensuales para el 60 % restante (0 = todo al contado). */
  installments: number;
  /** Porcentaje de una futura venta para el club vendedor. */
  sellOnPct: number;
  /** Bonus por partidos: importe que se paga al llegar a `apps` partidos. */
  bonus: { amount: number; apps: number } | null;
  /** Jugador del comprador que entra en la operación. */
  swapPlayerId: string | null;
  loan: { wageShare: number; fee: number; buyOption: number | null } | null;
}

export type DealStatus =
  | 'pendingClub' // esperando respuesta del club vendedor
  | 'countered' // el vendedor pide otra cosa
  | 'pendingUser' // oferta de la IA por un jugador del usuario
  | 'negotiating' // negociando contrato con el jugador
  | 'agreed' // todo cerrado, falta que abra el mercado
  | 'completed'
  | 'rejected'
  | 'collapsed'
  | 'withdrawn';

export interface Deal {
  id: string;
  kind: 'transfer' | 'loan' | 'free' | 'renewal';
  playerId: string;
  buyerId: string;
  sellerId: string | null;
  terms: OfferTerms;
  counter: OfferTerms | null;
  status: DealStatus;
  created: string;
  respondOn: string | null;
  /** Rondas restantes de la negociación con el jugador. */
  patience: number;
  demands: ContractTerms | null;
  contract: ContractTerms | null;
  completeOn: string | null;
  log: { date: string; text: string }[];
  rounds: number;
}

export interface LoanRecord {
  playerId: string;
  ownerId: string;
  borrowerId: string;
  until: string;
  buyOption: number | null;
  original: Contract;
}

export interface TransfersState {
  deals: Deal[];
  sellOn: Record<string, { clubId: string; pct: number }[]>;
  bonuses: { playerId: string; fromClubId: string; toClubId: string; amount: number; apps: number; since: string }[];
  loans: LoanRecord[];
  /** Jugadores del usuario en venta o cedibles (precio pedido). */
  listed: Record<string, { asking: number | null; loan: boolean }>;
  /** Rol prometido a cada jugador del usuario. */
  roles: Record<string, SquadRole>;
  history: { date: string; playerId: string; name: string; fromId: string | null; toId: string | null; fee: number; loan: boolean }[];
  seq: number;
}

export function initTransfers(state: GameState): TransfersState {
  return (state.transfers = { deals: [], sellOn: {}, bonuses: [], loans: [], listed: {}, roles: {}, history: [], seq: 0 });
}

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
const CURRENT_REP_FREE = 1500;

// ---------------------------------------------------------------- mercado y fechas
export function windowOpen(state: GameState, date = state.date): boolean {
  return state.calendar.windows.some((w) => date >= w.open && date <= w.deadline);
}

export function nextWindowOpen(state: GameState): string {
  const upcoming = state.calendar.windows.map((w) => w.open).filter((d) => d > state.date).sort()[0];
  return upcoming ?? state.calendar.nextStart;
}

function squadOf(state: GameState, clubId: string): Player[] {
  return indexes(state).squads.get(clubId) ?? [];
}

/** Puesto (1 = mejor) del jugador por nivel en una plantilla (excluyéndole). */
function rankIn(p: Player, squad: readonly Player[]): number {
  return squad.filter((x) => x.id !== p.id && x.ca > p.ca).length + 1;
}

export function expectedRole(state: GameState, p: Player, clubId: string): SquadRole {
  const r = rankIn(p, squadOf(state, clubId));
  const age = ageAt(p.birthDate, state.date);
  if (r <= 2) return 'star';
  if (r <= 11) return 'important';
  if (age <= 20) return 'youth';
  if (r <= 16) return 'rotation';
  return 'backup';
}

function contractYearsLeft(state: GameState, p: Player): number {
  return p.contract ? Math.max(0, yearsBetween(state.date, p.contract.expires)) : 0;
}

// ---------------------------------------------------------------- valoración del club vendedor
export function askingPrice(state: GameState, p: Player, buyerId: string): number {
  const ix = indexes(state);
  const seller = p.clubId ? ix.clubs.get(p.clubId) : undefined;
  if (!seller) return 0;
  const buyer = ix.clubs.get(buyerId);
  const r = rankIn(p, squadOf(state, seller.id));
  let f = r <= 3 ? 1.7 : r <= 11 ? 1.35 : r <= 18 ? 1.05 : 0.85;
  const years = contractYearsLeft(state, p);
  if (years <= 1) f *= 0.65;
  else if (years <= 2) f *= 0.9;
  if (ageAt(p.birthDate, state.date) >= 31) f *= 0.85;
  if (buyer && seller.rivals.includes(buyer.id)) f *= 1.35;
  if (buyer && seller.reputation > buyer.reputation + 2500 && r <= 11) f *= 1.5;
  const listed = p.clubId === state.userClubId ? state.transfers.listed[p.id] : undefined;
  if (listed?.asking) return listed.asking;
  return roundMoney(Math.max(p.marketValue, 25000) * f);
}

/** Lo que vale una oferta para el vendedor (los plazos y la reventa cuentan menos). */
function offerWorth(state: GameState, t: OfferTerms, sellerId: string): number {
  let w = t.fee * (1 - (t.installments / 12) * 0.04) + t.fee * (t.sellOnPct / 100) * 0.3 + (t.bonus ? t.bonus.amount * 0.45 : 0);
  if (t.swapPlayerId) {
    const sp = indexes(state).players.get(t.swapPlayerId);
    if (sp) {
      const squad = squadOf(state, sellerId);
      const avg = squad.map((x) => x.ca).sort((a, b) => b - a).slice(0, 16).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(16, squad.length));
      w += sp.marketValue * (sp.ca >= avg - 5 ? 0.9 : 0.3);
    }
  }
  return w;
}

function isKey(state: GameState, p: Player): boolean {
  return !!p.clubId && rankIn(p, squadOf(state, p.clubId)) <= 14;
}

// ---------------------------------------------------------------- decisión del jugador
/** Interés (0-100) del jugador por fichar por un club. */
export function playerInterest(state: GameState, p: Player, clubId: string, role?: SquadRole): number {
  const ix = indexes(state);
  const buyer = ix.clubs.get(clubId);
  if (!buyer) return 0;
  if (p.clubId === clubId) {
    // Renovación: moral, minutos y lealtad
    const r = role ?? expectedRole(state, p, clubId);
    return clamp(40 + (p.morale - 50) * 0.6 + p.attributes.loyalty * 1.4 - (ROLE_RANK[r] - ROLE_RANK[expectedRole(state, p, clubId)]) * 8, 0, 100);
  }
  const current = p.clubId ? ix.clubs.get(p.clubId) : undefined;
  const repDiff = (buyer.reputation - (current?.reputation ?? CURRENT_REP_FREE)) / 1000;
  const age = ageAt(p.birthDate, state.date);
  const a = p.attributes.ambition;
  const mercenary = p.personality === 'mercenary';
  let interest = 55 + repDiff * (3 + a * 0.45) * (age >= 31 ? 0.5 : 1) * (mercenary ? 0.6 : 1);
  // Proyecto: categoría y posición en la tabla
  const league = leagueOf(state, clubId);
  if (league) interest += league.level <= 1 ? 5 : -4 * (league.level - 1);
  // Minutos que espera
  const exp = expectedRole(state, p, clubId);
  if (role) interest -= Math.max(0, ROLE_RANK[role] - ROLE_RANK[exp]) * 9;
  if (exp === 'backup' && age >= 22) interest -= 12;
  // Apego al club actual
  if (current) interest -= p.attributes.loyalty * 0.7 * (p.morale >= 55 ? 1 : 0.4);
  if (!current) interest += 15;
  return clamp(Math.round(interest), 0, 100);
}

export function playerDemands(state: GameState, deal: Deal): ContractTerms {
  const ix = indexes(state);
  const p = ix.players.get(deal.playerId)!;
  const buyer = ix.clubs.get(deal.buyerId)!;
  const age = ageAt(p.birthDate, state.date);
  const role = deal.contract?.role ?? expectedRole(state, p, buyer.id);
  const interest = playerInterest(state, p, buyer.id, role);
  const premium = clamp((60 - interest) / 100, -0.1, 0.45) + (p.personality === 'mercenary' ? 0.15 : 0);
  const roleK = role === 'star' ? 1.3 : role === 'important' ? 1.1 : role === 'rotation' ? 1 : 0.9;
  const current = p.contract?.wage ?? 0;
  const renewal = deal.kind === 'renewal';
  const market = estimateWage(p.ca, buyer.reputation, age);
  const base = renewal ? Math.max(current * (p.form.length && avg(p.form) >= 7 ? 1.2 : 1.05), market * 0.9) : Math.max(current * 1.1, market);
  const wage = roundMoney(base * roleK * (1 + premium));
  const years = age <= 23 ? 5 : age <= 28 ? 4 : age <= 31 ? 3 : age <= 33 ? 2 : 1;
  const fee = deal.terms.fee;
  return {
    wage,
    years,
    signingBonus: roundMoney(wage * (deal.kind === 'free' ? 20 : renewal ? 2 : 4)),
    agentFee: roundMoney(deal.kind === 'transfer' ? fee * 0.06 + wage * 4 : deal.kind === 'free' ? wage * 26 : wage * 6),
    releaseClause: p.attributes.ambition >= 14 && buyer.reputation < 7000 ? roundMoney(Math.max(p.marketValue * 2.5, 500000)) : null,
    role,
    goalBonus: ['ST', 'AM', 'LW', 'RW'].includes(mainPosition(p.positions)) ? roundMoney(wage * 0.2) : 0,
  };
}

const avg = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function deficit(offer: ContractTerms, d: ContractTerms): number {
  let x = Math.max(0, 1 - offer.wage / d.wage);
  x -= Math.min(0.12, Math.max(0, offer.wage / d.wage - 1) * 0.7);
  x += Math.max(0, 1 - offer.signingBonus / Math.max(1, d.signingBonus)) * 0.12;
  x += Math.max(0, 1 - offer.agentFee / Math.max(1, d.agentFee)) * 0.15;
  x += Math.abs(offer.years - d.years) * 0.025;
  x += Math.max(0, ROLE_RANK[offer.role] - ROLE_RANK[d.role]) * 0.09;
  if (d.releaseClause && (!offer.releaseClause || offer.releaseClause > d.releaseClause * 1.6)) x += 0.06;
  x += Math.max(0, 1 - offer.goalBonus / Math.max(1, d.goalBonus)) * 0.03 * (d.goalBonus > 0 ? 1 : 0);
  return x;
}

// ---------------------------------------------------------------- acciones del usuario
function newDeal(state: GameState, d: Omit<Deal, 'id' | 'created' | 'log' | 'counter' | 'demands' | 'contract' | 'completeOn' | 'rounds'>): Deal {
  const deal: Deal = { ...d, id: `deal${(++state.transfers.seq).toString(36)}`, created: state.date, log: [], counter: null, demands: null, contract: null, completeOn: null, rounds: 0 };
  state.transfers.deals.unshift(deal);
  if (state.transfers.deals.length > 300) state.transfers.deals.length = 300;
  return deal;
}

const note = (state: GameState, d: Deal, text: string) => d.log.push({ date: state.date, text });

function activeDealFor(state: GameState, playerId: string, buyerId: string): Deal | undefined {
  return state.transfers.deals.find((d) => d.playerId === playerId && d.buyerId === buyerId && ['pendingClub', 'countered', 'negotiating', 'agreed', 'pendingUser'].includes(d.status));
}

export function validateOffer(state: GameState, p: Player, t: OfferTerms): void {
  const club = indexes(state).clubs.get(state.userClubId)!;
  if (p.clubId === state.userClubId) throw new Error('Ya es jugador de tu club');
  if (transferEmbargo(state)) throw new Error('Tienes prohibido fichar por sanción del juego limpio financiero');
  if (t.loan) {
    if (t.loan.wageShare < 0 || t.loan.wageShare > 100) throw new Error('El porcentaje de salario debe estar entre 0 y 100');
    if (t.loan.fee > club.finances.transferBudget) throw new Error('No tienes presupuesto para la cuota de cesión');
    return;
  }
  if (t.fee < 0) throw new Error('Importe no válido');
  if (t.fee + (t.bonus?.amount ?? 0) > club.finances.transferBudget) throw new Error('La oferta supera tu presupuesto de fichajes');
  if (t.sellOnPct < 0 || t.sellOnPct > 50) throw new Error('El porcentaje de reventa debe estar entre 0 y 50');
  if (t.installments < 0 || t.installments > 36) throw new Error('Los plazos van de 0 a 36 meses');
  if (t.swapPlayerId) {
    const sp = indexes(state).players.get(t.swapPlayerId);
    if (!sp || sp.clubId !== state.userClubId) throw new Error('El jugador del intercambio debe ser de tu club');
  }
}

/** Oferta del usuario por un jugador de otro club (traspaso o cesión) o libre. */
export function makeOffer(state: GameState, playerId: string, terms: OfferTerms): Deal {
  const ix = indexes(state);
  const p = ix.players.get(playerId);
  if (!p) throw new Error('Jugador inexistente');
  validateOffer(state, p, terms);
  const existing = activeDealFor(state, playerId, state.userClubId);
  if (existing && existing.status !== 'countered') throw new Error('Ya hay una negociación en marcha por este jugador');
  if (existing) existing.status = 'withdrawn';
  if (!p.clubId) {
    // Libre: se negocia directamente con el jugador
    const deal = newDeal(state, { kind: 'free', playerId, buyerId: state.userClubId, sellerId: null, terms: { ...terms, fee: 0, loan: null }, status: 'negotiating', respondOn: null, patience: 3 });
    openNegotiation(state, deal);
    return deal;
  }
  const deal = newDeal(state, {
    kind: terms.loan ? 'loan' : 'transfer', playerId, buyerId: state.userClubId, sellerId: p.clubId, terms,
    status: 'pendingClub', respondOn: addDays(state.date, 1), patience: 3,
  });
  note(state, deal, terms.loan ? 'Oferta de cesión enviada.' : 'Oferta enviada.');
  // Cláusula de rescisión: el club no puede negarse
  if (!terms.loan && p.contract?.releaseClause && terms.fee >= p.contract.releaseClause && terms.installments === 0) {
    deal.status = 'negotiating';
    deal.respondOn = null;
    note(state, deal, 'Se paga la cláusula de rescisión: el club no puede negarse.');
    openNegotiation(state, deal);
  }
  return deal;
}

function openNegotiation(state: GameState, deal: Deal): void {
  const p = indexes(state).players.get(deal.playerId)!;
  const interest = playerInterest(state, p, deal.buyerId);
  if (interest < 22) {
    deal.status = 'collapsed';
    note(state, deal, `${nameOf(p)} no está interesado en negociar.`);
    if (deal.buyerId === state.userClubId) {
      addMessage(state, { type: 'transfer', priority: 'normal', key: 'playerNotInterested', params: { player: nameOf(p) }, related: { playerId: p.id } });
    }
    return;
  }
  deal.status = 'negotiating';
  deal.demands = playerDemands(state, deal);
}

/** Renovación de un jugador propio. */
export function startRenewal(state: GameState, playerId: string): Deal {
  const p = indexes(state).players.get(playerId);
  if (!p || p.clubId !== state.userClubId) throw new Error('Solo puedes renovar a jugadores de tu club');
  if (p.contract?.type === 'loan') throw new Error('Está cedido: el contrato es de su club');
  const existing = activeDealFor(state, playerId, state.userClubId);
  if (existing?.kind === 'renewal') return existing;
  const deal = newDeal(state, { kind: 'renewal', playerId, buyerId: state.userClubId, sellerId: state.userClubId, terms: emptyTerms(), status: 'negotiating', respondOn: null, patience: 3 });
  const interest = playerInterest(state, p, state.userClubId);
  if (interest < 15) {
    deal.status = 'collapsed';
    note(state, deal, `${nameOf(p)} no quiere renovar.`);
    return deal;
  }
  deal.demands = playerDemands(state, deal);
  return deal;
}

export function emptyTerms(): OfferTerms {
  return { fee: 0, installments: 0, sellOnPct: 0, bonus: null, swapPlayerId: null, loan: null };
}

export type ContractResponse = { result: 'accepted' | 'counter' | 'rejected'; demands: ContractTerms | null; text: string; deal: Deal };

/** Propuesta de contrato al jugador (y a su agente). Respuesta inmediata. */
export function proposeContract(state: GameState, dealId: string, offer: ContractTerms): ContractResponse {
  const deal = state.transfers.deals.find((d) => d.id === dealId);
  if (!deal || deal.status !== 'negotiating') throw new Error('No hay negociación abierta');
  const ix = indexes(state);
  const p = ix.players.get(deal.playerId)!;
  const club = ix.clubs.get(deal.buyerId)!;
  // Límites del club
  const currentWage = deal.kind === 'renewal' ? p.contract?.wage ?? 0 : 0;
  if (playerWageBill(state, club.id) - currentWage + offer.wage > club.finances.wageBudget) throw new Error('El salario supera tu presupuesto salarial');
  if (offer.years < 1 || offer.years > 5) throw new Error('La duración va de 1 a 5 años');
  const upfront = deal.kind === 'transfer' ? deal.terms.fee : deal.kind === 'loan' ? deal.terms.loan?.fee ?? 0 : 0;
  if (deal.kind !== 'renewal' && club.id === state.userClubId && upfront + offer.signingBonus + offer.agentFee > club.finances.transferBudget) {
    throw new Error('El traspaso, la prima de fichaje y la comisión superan tu presupuesto');
  }
  deal.contract = offer;
  deal.rounds++;
  const demands = playerDemands(state, deal);
  // Cada ronda el jugador cede un poco
  const soft = 1 - Math.min(0.08, (deal.rounds - 1) * 0.03);
  const target: ContractTerms = { ...demands, wage: roundMoney(demands.wage * soft), agentFee: roundMoney(demands.agentFee * soft), signingBonus: roundMoney(demands.signingBonus * soft) };
  const gap = deficit(offer, target);
  const who = deal.kind === 'renewal' ? nameOf(p) : `El agente de ${nameOf(p)}`;
  if (gap <= 0.04) {
    agreeDeal(state, deal);
    return { result: 'accepted', demands: null, text: `${nameOf(p)} acepta el contrato.`, deal };
  }
  deal.patience -= gap > 0.35 ? 2 : 1;
  if (deal.patience <= 0) {
    deal.status = 'collapsed';
    note(state, deal, 'El jugador rompe las negociaciones.');
    return { result: 'rejected', demands: null, text: `${who} da por rotas las negociaciones.`, deal };
  }
  deal.demands = target;
  const reason = offer.wage < target.wage * 0.97 ? 'pide más salario' : ROLE_RANK[offer.role] > ROLE_RANK[target.role] ? `quiere un rol de ${ROLE_LABEL[target.role].toLowerCase()}` : offer.agentFee < target.agentFee * 0.9 ? 'pide una comisión mayor' : 'quiere mejores condiciones';
  return { result: 'counter', demands: target, text: `${who} ${reason}. ${deal.patience === 1 ? 'Es su última oportunidad.' : ''}`.trim(), deal };
}

function agreeDeal(state: GameState, deal: Deal): void {
  const p = indexes(state).players.get(deal.playerId)!;
  if (deal.kind === 'renewal') {
    applyContract(state, p, deal.contract!, p.clubId!);
    deal.status = 'completed';
    note(state, deal, 'Renovación firmada.');
    debit(state, deal.buyerId, 'bonuses', deal.contract!.signingBonus);
    debit(state, deal.buyerId, 'agents', deal.contract!.agentFee);
    return;
  }
  if (deal.kind === 'free' || windowOpen(state)) {
    completeDeal(state, deal);
  } else {
    deal.status = 'agreed';
    deal.completeOn = nextWindowOpen(state);
    note(state, deal, `Acuerdo cerrado; el fichaje se hará oficial el ${deal.completeOn}.`);
    if (deal.buyerId === state.userClubId) addMessage(state, { type: 'transfer', priority: 'normal', key: 'dealAgreedPending', params: { player: nameOf(p), date: deal.completeOn }, related: { playerId: p.id } });
  }
}

export function withdrawDeal(state: GameState, dealId: string): void {
  const d = state.transfers.deals.find((x) => x.id === dealId);
  if (!d || ['completed', 'rejected', 'collapsed', 'withdrawn'].includes(d.status)) return;
  if (d.status === 'agreed') throw new Error('El acuerdo ya está cerrado');
  d.status = 'withdrawn';
  note(state, d, 'Negociación retirada.');
}

/** Acepta la contraoferta del club vendedor. */
export function acceptCounter(state: GameState, dealId: string): Deal {
  const d = state.transfers.deals.find((x) => x.id === dealId);
  if (!d || d.status !== 'countered' || !d.counter) throw new Error('No hay contraoferta');
  validateOffer(state, indexes(state).players.get(d.playerId)!, d.counter);
  d.terms = d.counter;
  d.counter = null;
  note(state, d, 'Aceptas las condiciones del club.');
  openNegotiation(state, d);
  return d;
}

function applyContract(state: GameState, p: Player, c: ContractTerms, clubId: string): void {
  // Los contratos terminan el 30 de junio: temporada en curso + años
  const year = Number(state.date.slice(0, 4));
  const seasonStart = Number(state.date.slice(5, 7)) >= 7 ? year : year - 1;
  p.contract = {
    wage: c.wage,
    expires: isoFromParts(seasonStart + c.years, 6, 30),
    releaseClause: c.releaseClause,
    bonuses: { appearance: roundMoney(c.wage * 0.1), goal: c.goalBonus, cleanSheet: 0, signing: c.signingBonus, loyalty: 0 },
    type: 'full',
    loanFromClubId: null,
  };
  if (clubId === state.userClubId) state.transfers.roles[p.id] = c.role;
}

/** Hace oficial una operación: dinero, contrato, cambio de club e historial. */
export function completeDeal(state: GameState, deal: Deal): void {
  const ix = indexes(state);
  const p = ix.players.get(deal.playerId)!;
  const buyer = ix.clubs.get(deal.buyerId)!;
  const seller = deal.sellerId ? ix.clubs.get(deal.sellerId) : undefined;
  const t = deal.terms;
  const c = deal.contract ?? aiContract(state, deal);
  if (deal.kind === 'loan' && seller && t.loan) {
    state.transfers.loans.push({ playerId: p.id, ownerId: seller.id, borrowerId: buyer.id, until: state.calendar.end, buyOption: t.loan.buyOption, original: structuredClone(p.contract!) });
    if (t.loan.fee > 0) transferCash(state, buyer.id, seller.id, t.loan.fee);
    budget(state, buyer, -t.loan.fee);
    p.contract = { ...structuredClone(p.contract!), wage: roundMoney((p.contract?.wage ?? 0) * (t.loan.wageShare / 100)), type: 'loan', loanFromClubId: seller.id };
    if (buyer.id === state.userClubId) state.transfers.roles[p.id] = c.role;
  } else {
    if (seller && t.fee > 0) {
      payTransferFee(state, buyer.id, seller.id, t.fee, t.installments, p.id);
      // Porcentajes de reventa de operaciones anteriores
      for (const so of state.transfers.sellOn[p.id] ?? []) {
        if (so.clubId !== buyer.id) transferCash(state, seller.id, so.clubId, t.fee * (so.pct / 100));
      }
      delete state.transfers.sellOn[p.id];
      if (t.sellOnPct > 0) (state.transfers.sellOn[p.id] ??= []).push({ clubId: seller.id, pct: t.sellOnPct });
      if (t.bonus) state.transfers.bonuses.push({ playerId: p.id, fromClubId: buyer.id, toClubId: seller.id, amount: t.bonus.amount, apps: t.bonus.apps, since: state.date });
      budget(state, buyer, -t.fee);
      budget(state, seller, t.fee * (seller.id === state.userClubId ? 0.5 : 0.7));
    }
    if (t.swapPlayerId) {
      const sp = ix.players.get(t.swapPlayerId);
      if (sp && seller) moveClub(state, sp, seller.id, 0, false);
    }
    debit(state, buyer.id, 'agents', c.agentFee);
    debit(state, buyer.id, 'bonuses', c.signingBonus);
    budget(state, buyer, -(c.agentFee + c.signingBonus));
    applyContract(state, p, c, buyer.id);
  }
  moveClub(state, p, buyer.id, deal.kind === 'loan' ? t.loan?.fee ?? 0 : t.fee, deal.kind === 'loan');
  delete state.transfers.listed[p.id];
  deal.status = 'completed';
  deal.completeOn = state.date;
  note(state, deal, 'Operación oficial.');
  const feeText = deal.kind === 'free' ? 'libre' : deal.kind === 'loan' ? 'cedido' : money(t.fee);
  news(state, `${nameOf(p)} ficha por ${buyer.name}${seller ? ` procedente de ${seller.name}` : ''} (${feeText})`);
  if (buyer.id === state.userClubId || seller?.id === state.userClubId) {
    addMessage(state, {
      type: 'transfer', priority: 'high', key: buyer.id === state.userClubId ? 'signed' : 'sold',
      params: { player: nameOf(p), club: buyer.id === state.userClubId ? seller?.name ?? 'libre' : buyer.name, fee: feeText }, related: { playerId: p.id },
    });
  }
  // Las operaciones de este jugador que siguieran abiertas caducan
  for (const d of state.transfers.deals) if (d !== deal && d.playerId === p.id && ['pendingClub', 'countered', 'negotiating', 'pendingUser', 'agreed'].includes(d.status)) d.status = 'withdrawn';
}

function budget(state: GameState, club: Club, delta: number): void {
  club.finances.transferBudget = Math.max(0, Math.round(club.finances.transferBudget + delta));
  void state;
}

function moveClub(state: GameState, p: Player, toId: string, fee: number, loan: boolean): void {
  const ix = indexes(state);
  const from = p.clubId;
  const last = p.history[p.history.length - 1];
  if (last && last.to === null) last.to = state.date;
  const to = ix.clubs.get(toId);
  p.history.push({ clubId: toId, clubName: to?.name ?? toId, from: state.date, to: null, fee: Math.round(fee), loan });
  p.clubId = toId;
  p.morale = clamp(p.morale + 5, 5, 100);
  if (from === state.userClubId) {
    if (state.userLineup) {
      state.userLineup = { starting: state.userLineup.starting.filter((x) => x !== p.id), bench: state.userLineup.bench.filter((x) => x !== p.id) };
      if (state.userLineup.starting.length < 11) state.userLineup = null;
    }
    delete state.transfers.roles[p.id];
  }
  state.transfers.history.unshift({ date: state.date, playerId: p.id, name: nameOf(p), fromId: from, toId, fee: Math.round(fee), loan });
  if (state.transfers.history.length > 500) state.transfers.history.length = 500;
  invalidate(state);
}

/** Operación entre clubes de la IA (o fichaje de un libre): se cierra en el acto. */
export function aiTransfer(state: GameState, playerId: string, buyerId: string, fee: number, opts: { installments?: number; loan?: boolean } = {}): Deal | null {
  const p = indexes(state).players.get(playerId);
  if (!p) return null;
  const sellerId = p.clubId;
  const terms: OfferTerms = opts.loan
    ? { ...emptyTerms(), loan: { wageShare: 75, fee: 0, buyOption: null } }
    : { ...emptyTerms(), fee: sellerId ? fee : 0, installments: opts.installments ?? 0 };
  const deal = newDeal(state, { kind: opts.loan ? 'loan' : sellerId ? 'transfer' : 'free', playerId, buyerId, sellerId, terms, status: 'negotiating', respondOn: null, patience: 1 });
  completeDeal(state, deal);
  return deal;
}

export { rankIn, squadOf, isKey };

function aiContract(state: GameState, deal: Deal): ContractTerms {
  const d = playerDemands(state, deal);
  return { ...d, wage: roundMoney(d.wage * 0.95) };
}

function news(state: GameState, text: string): void {
  state.news.unshift({ date: state.date, type: 'transfer', text });
  if (state.news.length > 300) state.news.length = 300;
}

export function money(v: number): string {
  return v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M€` : v >= 1e3 ? `${Math.round(v / 1e3)} k€` : `${Math.round(v)} €`;
}

// ---------------------------------------------------------------- respuesta de los clubes
function clubResponds(state: GameState, deal: Deal): void {
  const ix = indexes(state);
  const p = ix.players.get(deal.playerId);
  const seller = deal.sellerId ? ix.clubs.get(deal.sellerId) : undefined;
  if (!p || !seller || p.clubId !== seller.id) { deal.status = 'collapsed'; return; }
  const t = deal.terms;
  const asking = askingPrice(state, p, deal.buyerId);
  const send = (key: string, params: Record<string, string | number>) => addMessage(state, { type: 'transfer', priority: 'high', key, sender: seller.name, params: { player: nameOf(p), club: seller.name, ...params }, related: { playerId: p.id, clubId: seller.id } });
  if (t.loan) {
    const r = rankIn(p, squadOf(state, seller.id));
    const young = ageAt(p.birthDate, state.date) <= 21;
    const available = r > 14 || (young && r > 11) || state.transfers.listed[p.id]?.loan;
    const share = seller.reputation > 7000 ? 50 : 70;
    if (!available) { deal.status = 'rejected'; note(state, deal, 'No lo ceden: cuentan con él.'); send('loanRejected', { reason: 'cuentan con él' }); return; }
    if (t.loan.wageShare < share) {
      deal.status = 'countered';
      deal.counter = { ...t, loan: { ...t.loan, wageShare: share } };
      note(state, deal, `Piden que pagues el ${share} % del salario.`);
      send('loanCounter', { share });
      return;
    }
    if (t.loan.buyOption !== null && t.loan.buyOption < asking * 0.9) {
      deal.status = 'countered';
      deal.counter = { ...t, loan: { ...t.loan, buyOption: roundMoney(asking) } };
      note(state, deal, `La opción de compra debe ser de al menos ${money(asking)}.`);
      send('loanCounter', { share: t.loan.wageShare });
      return;
    }
    note(state, deal, 'Aceptan la cesión.');
    send('loanAccepted', {});
    openNegotiation(state, deal);
    return;
  }
  const worth = offerWorth(state, t, seller.id);
  const notForSale = rankIn(p, squadOf(state, seller.id)) <= 3 && !state.transfers.listed[p.id] && worth < asking * 1.25 && seller.reputation >= (ix.clubs.get(deal.buyerId)?.reputation ?? 0);
  if (worth >= asking && !notForSale) {
    note(state, deal, 'El club acepta la oferta.');
    send('bidAccepted', { fee: money(t.fee) });
    openNegotiation(state, deal);
    return;
  }
  if (worth >= asking * (notForSale ? 0.9 : 0.7) && deal.rounds < 3) {
    const needFee = roundMoney(t.fee + (asking * (notForSale ? 1.25 : 1) - worth) / (1 - (t.installments / 12) * 0.04));
    deal.status = 'countered';
    deal.counter = { ...t, fee: needFee };
    deal.rounds++;
    note(state, deal, `Piden ${money(needFee)}.`);
    send('bidCounter', { fee: money(needFee) });
    return;
  }
  deal.status = 'rejected';
  note(state, deal, 'Oferta rechazada.');
  send('bidRejected', { fee: money(t.fee) });
}

// ---------------------------------------------------------------- ofertas de la IA por jugadores del usuario
function aiInterestDay(state: GameState): void {
  if (!windowOpen(state)) return;
  const ix = indexes(state);
  const user = ix.clubs.get(state.userClubId)!;
  const rng = createRng(hashString(`ai-bids:${state.seed}:${state.date}`));
  const open = state.transfers.deals.filter((d) => d.status === 'pendingUser').length;
  if (open >= 3) return;
  const lastWindowDay = state.calendar.windows.some((w) => w.deadline === state.date);
  for (const p of squadOf(state, user.id)) {
    if (p.contract?.type === 'loan') continue;
    const listed = state.transfers.listed[p.id];
    const chance = 0.0015 * (listed ? 16 : 1) * (lastWindowDay ? 3 : 1) * (p.ca >= 120 ? 1.4 : 1);
    if (!rng.chance(chance)) continue;
    if (state.transfers.deals.some((d) => d.playerId === p.id && ['pendingUser', 'agreed', 'negotiating'].includes(d.status))) continue;
    const loan = !!listed?.loan;
    const price = loan ? 0 : roundMoney((listed?.asking ?? p.marketValue) * rng.float(0.75, 1.15));
    const buyers = state.world.clubs.filter((c) => c.id !== user.id && c.reputation >= user.reputation * (loan ? 0.4 : 0.75) && c.finances.transferBudget >= price && (squadOf(state, c.id).length < 30) && expectedRole(state, p, c.id) !== 'backup');
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    const terms: OfferTerms = loan
      ? { ...emptyTerms(), loan: { wageShare: rng.pick([50, 75, 100]), fee: 0, buyOption: rng.chance(0.4) ? roundMoney(p.marketValue * 1.1) : null } }
      : { ...emptyTerms(), fee: price, installments: rng.chance(0.4) ? rng.pick([12, 24]) : 0, sellOnPct: rng.chance(0.2) ? 10 : 0 };
    const deal = newDeal(state, { kind: loan ? 'loan' : 'transfer', playerId: p.id, buyerId: buyer.id, sellerId: user.id, terms, status: 'pendingUser', respondOn: addDays(state.date, 4), patience: 2 });
    note(state, deal, `${buyer.name} hace una oferta.`);
    addMessage(state, {
      type: 'transfer', priority: 'high', key: loan ? 'incomingLoan' : 'incomingBid', sender: buyer.name,
      params: { player: nameOf(p), club: buyer.name, fee: money(price), extra: terms.installments ? ` (en ${terms.installments} plazos)` : '' },
      actions: [
        { id: 'accept', kind: 'accept', labelKey: 'common.accept', payload: { dealId: deal.id } },
        { id: 'reject', kind: 'reject', labelKey: 'common.reject', payload: { dealId: deal.id } },
        { id: 'negotiate', kind: 'negotiate', labelKey: 'common.negotiate', payload: { dealId: deal.id } },
      ],
      related: { playerId: p.id, clubId: buyer.id },
    });
  }
}

/** Respuesta del usuario a una oferta de otro club. */
export function respondIncoming(state: GameState, dealId: string, answer: 'accept' | 'reject' | { counterFee: number }): Deal {
  const d = state.transfers.deals.find((x) => x.id === dealId);
  if (!d || d.status !== 'pendingUser') throw new Error('Esta oferta ya no está disponible');
  const ix = indexes(state);
  const p = ix.players.get(d.playerId)!;
  const buyer = ix.clubs.get(d.buyerId)!;
  if (answer === 'reject') {
    d.status = 'rejected';
    note(state, d, 'Rechazas la oferta.');
    if (p.attributes.ambition >= 15 && buyer.reputation > (ix.clubs.get(state.userClubId)?.reputation ?? 0)) {
      p.morale = clamp(p.morale - 8, 5, 100);
      addConcern(state, p.id, 'transfer', buyer.reputation > (ix.clubs.get(state.userClubId)?.reputation ?? 0) + 1500 ? 2 : 1);
    }
    return d;
  }
  if (answer !== 'accept') {
    const max = roundMoney(p.marketValue * 1.35);
    if (answer.counterFee > max || answer.counterFee > buyer.finances.transferBudget) {
      d.status = 'rejected';
      note(state, d, `${buyer.name} no llega a ${money(answer.counterFee)} y se retira.`);
      return d;
    }
    d.terms = { ...d.terms, fee: roundMoney(answer.counterFee) };
    note(state, d, `${buyer.name} acepta pagar ${money(answer.counterFee)}.`);
  }
  // El jugador decide si quiere irse
  const interest = playerInterest(state, p, buyer.id);
  if (interest < 35) {
    d.status = 'collapsed';
    note(state, d, `${nameOf(p)} no quiere irse a ${buyer.name}.`);
    addMessage(state, { type: 'transfer', priority: 'normal', key: 'playerRefusesMove', params: { player: nameOf(p), club: buyer.name }, related: { playerId: p.id } });
    return d;
  }
  d.contract = aiContract(state, d);
  if (windowOpen(state)) completeDeal(state, d);
  else { d.status = 'agreed'; d.completeOn = nextWindowOpen(state); }
  return d;
}

export function setListed(state: GameState, playerId: string, listing: { asking: number | null; loan: boolean } | null): void {
  const p = indexes(state).players.get(playerId);
  if (!p || p.clubId !== state.userClubId) throw new Error('Solo puedes ofrecer jugadores de tu club');
  if (listing) state.transfers.listed[playerId] = listing;
  else delete state.transfers.listed[playerId];
}

export function exerciseBuyOption(state: GameState, playerId: string): void {
  const loan = state.transfers.loans.find((l) => l.playerId === playerId && l.borrowerId === state.userClubId);
  if (!loan?.buyOption) throw new Error('Esta cesión no tiene opción de compra');
  const club = indexes(state).clubs.get(state.userClubId)!;
  if (loan.buyOption > club.finances.transferBudget) throw new Error('No tienes presupuesto para la opción de compra');
  const p = indexes(state).players.get(playerId)!;
  transferCash(state, club.id, loan.ownerId, loan.buyOption);
  budget(state, club, -loan.buyOption);
  p.contract = { ...loan.original, type: 'full', loanFromClubId: null };
  state.transfers.loans = state.transfers.loans.filter((l) => l !== loan);
  state.transfers.history.unshift({ date: state.date, playerId, name: nameOf(p), fromId: loan.ownerId, toId: club.id, fee: loan.buyOption, loan: false });
  addMessage(state, { type: 'transfer', priority: 'normal', key: 'optionExercised', params: { player: nameOf(p), fee: money(loan.buyOption) }, related: { playerId } });
}

// ---------------------------------------------------------------- día a día y fin de temporada
export function transfersDay(state: GameState): void {
  const tr = state.transfers;
  for (const d of tr.deals) {
    if (d.status === 'pendingClub' && d.respondOn && d.respondOn <= state.date) clubResponds(state, d);
    else if (d.status === 'pendingUser' && d.respondOn && d.respondOn < state.date) { d.status = 'withdrawn'; note(state, d, 'La oferta caduca.'); }
    else if (d.status === 'agreed' && d.completeOn && d.completeOn <= state.date && windowOpen(state)) completeDeal(state, d);
  }
  aiInterestDay(state);
  // Bonus por partidos
  if (tr.bonuses.length) {
    const ix = indexes(state);
    tr.bonuses = tr.bonuses.filter((b) => {
      const p = ix.players.get(b.playerId);
      if (!p || p.clubId !== b.fromClubId || yearsBetween(b.since, state.date) > 3) return false;
      const apps = [...p.careerStats, ...p.seasonStats].filter((s) => s.clubId === b.fromClubId).reduce((a, s) => a + s.apps, 0);
      if (apps >= b.apps) { schedulePayment(state, { fromClubId: b.fromClubId, toClubId: b.toClubId, amount: b.amount, due: state.date, kind: 'bonus', playerId: p.id }); return false; }
      return true;
    });
  }
  // Avisos de contratos que vencen (1 de enero)
  if (state.date.endsWith('-01-01') && !state.processed[`expiring:${state.date}`]) {
    state.processed[`expiring:${state.date}`] = true;
    const end = state.calendar.end;
    const expiring = squadOf(state, state.userClubId).filter((p) => p.contract && p.contract.type !== 'loan' && p.contract.expires <= end);
    if (expiring.length) addMessage(state, { type: 'contract', priority: 'high', key: 'contractsExpiring', params: { names: expiring.map(nameOf).join(', '), date: end } });
  }
}

/** Fin de temporada: vuelven los cedidos y quedan libres los contratos vencidos. */
export function rolloverContracts(state: GameState, newStart: string, nextYear: number): void {
  const ix = indexes(state);
  const tr = state.transfers;
  for (const l of tr.loans) {
    const p = ix.players.get(l.playerId);
    if (!p || p.clubId !== l.borrowerId) continue;
    p.contract = structuredClone(l.original);
    moveClub(state, p, l.ownerId, 0, false);
    if (l.ownerId === state.userClubId || l.borrowerId === state.userClubId) addMessage(state, { type: 'transfer', priority: 'low', key: 'loanReturn', params: { player: nameOf(p), club: ix.clubs.get(l.ownerId)?.name ?? '' }, related: { playerId: p.id } });
  }
  tr.loans = [];
  const freed: string[] = [];
  for (const p of state.world.players) {
    if (!p.contract || p.contract.expires >= newStart || !p.clubId) continue;
    const age = ageAt(p.birthDate, newStart);
    if (p.clubId !== state.userClubId) {
      // IA: renueva a los que cuentan (puesto en la plantilla y edad); el resto se va libre
      const rank = rankIn(p, squadOf(state, p.clubId));
      const keep = (rank <= 18 && age <= 32) || (rank <= 24 && age <= 23 && p.pa > p.ca + 10) || hashString(`renew:${p.id}:${nextYear}`) % 100 < 25;
      if (keep) { p.contract.expires = isoFromParts(nextYear + (age <= 28 ? 3 : 1), 6, 30); continue; }
    }
    if (p.clubId === state.userClubId) freed.push(nameOf(p));
    const last = p.history[p.history.length - 1];
    if (last && last.to === null) last.to = newStart;
    p.clubId = null;
    p.contract = null;
    delete tr.roles[p.id];
    delete tr.listed[p.id];
  }
  if (freed.length) addMessage(state, { type: 'contract', priority: 'high', key: 'contractsEnded', params: { names: freed.join(', ') } });
  invalidate(state);
  aiFillSquads(state);
}

const MIN_BY_GROUP: Record<'GK' | 'DEF' | 'MID' | 'ATT', number> = { GK: 2, DEF: 7, MID: 7, ATT: 4 };
function groupOf(p: Player): 'GK' | 'DEF' | 'MID' | 'ATT' {
  const pos = mainPosition(p.positions);
  if (pos === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
  if (['ST', 'LW', 'RW'].includes(pos)) return 'ATT';
  return 'MID';
}

/**
 * Mantenimiento mínimo de las plantillas de la IA (hasta la Fase 8): los clubes con
 * huecos fichan agentes libres de su nivel para tener al menos 22 jugadores.
 */
export function aiFillSquads(state: GameState, target = 22): void {
  const ix = indexes(state);
  const free = state.world.players.filter((p) => !p.clubId && ageAt(p.birthDate, state.date) <= 34).sort((a, b) => b.ca - a.ca);
  const taken = new Set<string>();
  const clubs = state.world.clubs.filter((c) => c.id !== state.userClubId).sort((a, b) => b.reputation - a.reputation);
  for (const club of clubs) {
    const squad = squadOf(state, club.id);
    if (squad.length >= target) continue;
    const level = squad.map((p) => p.ca).sort((a, b) => b - a).slice(0, 16);
    const median = level[Math.floor(level.length / 2)] ?? 80;
    const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
    for (const p of squad) counts[groupOf(p)]++;
    let need = target - squad.length;
    const wanted = (p: Player) => counts[groupOf(p)] < MIN_BY_GROUP[groupOf(p)];
    for (const pass of [0, 1]) {
      for (const p of free) {
        if (need <= 0) break;
        if (taken.has(p.id) || p.ca > median + 10 || p.ca < median - 30) continue;
        if (pass === 0 && !wanted(p)) continue;
        taken.add(p.id);
        need--;
        counts[groupOf(p)]++;
        const age = ageAt(p.birthDate, state.date);
        const wage = roundMoney(estimateWage(p.ca, club.reputation, age) * 0.9);
        p.contract = {
          wage, expires: isoFromParts(state.seasonYear + 1 + (age <= 28 ? 2 : 1), 6, 30), releaseClause: null,
          bonuses: { appearance: roundMoney(wage * 0.1), goal: 0, cleanSheet: 0, signing: 0, loyalty: 0 }, type: 'full', loanFromClubId: null,
        };
        p.history.push({ clubId: club.id, clubName: club.name, from: state.date, to: null, fee: 0, loan: false });
        p.clubId = club.id;
        state.transfers.history.unshift({ date: state.date, playerId: p.id, name: nameOf(p), fromId: null, toId: club.id, fee: 0, loan: false });
      }
    }
  }
  if (state.transfers.history.length > 500) state.transfers.history.length = 500;
  invalidate(state);
  void ix;
}

// ---------------------------------------------------------------- vistas
export function dealView(state: GameState, d: Deal) {
  const ix = indexes(state);
  const p = ix.players.get(d.playerId);
  return {
    ...d,
    player: p ? { id: p.id, name: nameOf(p), age: ageAt(p.birthDate, state.date), position: mainPosition(p.positions), value: p.marketValue, wage: p.contract?.wage ?? 0 } : null,
    buyer: ix.clubs.get(d.buyerId)?.name ?? '',
    seller: d.sellerId ? ix.clubs.get(d.sellerId)?.name ?? '' : 'Libre',
    incoming: d.sellerId === state.userClubId && d.buyerId !== state.userClubId,
    interest: p ? playerInterest(state, p, d.buyerId, d.contract?.role) : 0,
  };
}

export function transfersView(state: GameState) {
  const ix = indexes(state);
  const club = ix.clubs.get(state.userClubId)!;
  const active = state.transfers.deals.filter((d) => (d.buyerId === state.userClubId || d.sellerId === state.userClubId) && !['completed', 'withdrawn'].includes(d.status) && (d.status !== 'rejected' && d.status !== 'collapsed' || d.log.at(-1)?.date === state.date || yearsBetween(d.created, state.date) < 0.05));
  return {
    window: { open: windowOpen(state), next: nextWindowOpen(state), deadline: state.calendar.windows.find((w) => state.date >= w.open && state.date <= w.deadline)?.deadline ?? null },
    embargo: transferEmbargo(state),
    budget: club.finances.transferBudget,
    wageBudget: club.finances.wageBudget,
    wageBill: playerWageBill(state, club.id),
    deals: active.map((d) => dealView(state, d)),
    listed: Object.entries(state.transfers.listed).map(([id, l]) => ({ id, name: ix.players.get(id) ? nameOf(ix.players.get(id)!) : id, ...l, value: ix.players.get(id)?.marketValue ?? 0 })),
    loans: state.transfers.loans.filter((l) => l.borrowerId === club.id || l.ownerId === club.id).map((l) => ({ ...l, name: ix.players.get(l.playerId) ? nameOf(ix.players.get(l.playerId)!) : '', owner: ix.clubs.get(l.ownerId)?.name ?? '', borrower: ix.clubs.get(l.borrowerId)?.name ?? '', in: l.borrowerId === club.id })),
    history: state.transfers.history.filter((h) => h.fromId === club.id || h.toId === club.id).slice(0, 40).map((h) => ({ ...h, from: h.fromId ? ix.clubs.get(h.fromId)?.name ?? '' : 'Libre', to: h.toId ? ix.clubs.get(h.toId)?.name ?? '' : 'Libre' })),
    latest: state.transfers.history.slice(0, 30).map((h) => ({ ...h, from: h.fromId ? ix.clubs.get(h.fromId)?.name ?? '' : 'Libre', to: h.toId ? ix.clubs.get(h.toId)?.name ?? '' : 'Libre' })),
  };
}
