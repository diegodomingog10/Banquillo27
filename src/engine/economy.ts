/**
 * Economía de los clubes: ingresos (taquilla, TV, patrocinio, merchandising, premios,
 * ventas), gastos (salarios, staff, fichajes, comisiones, instalaciones, operaciones,
 * intereses, multas), pagos aplazados, juego limpio financiero y previsión.
 *
 * Ritmo: taquilla en cada partido en casa, salarios cada lunes, ingresos y gastos fijos
 * el día 1 de cada mes y premios al final de la temporada (y al pasar rondas de copa).
 */
import type { Club, Staff } from '../data/schema';
import { roundMoney } from '../data/ability';
import { weekday } from './calendar';
import { addDays } from './date';
import { addMessage, indexes, leagueOf, leagueTable, type GameState } from './game';

export const INCOME_KEYS = ['tickets', 'tv', 'sponsorship', 'merchandising', 'prizes', 'transfers', 'other'] as const;
export const EXPENSE_KEYS = ['wages', 'staff', 'transfers', 'bonuses', 'agents', 'facilities', 'operations', 'interest', 'fines'] as const;
export type IncomeKey = (typeof INCOME_KEYS)[number];
export type ExpenseKey = (typeof EXPENSE_KEYS)[number];

export interface Ledger {
  income: Record<IncomeKey, number>;
  expense: Record<ExpenseKey, number>;
}

export interface ClubEconomy {
  season: Ledger;
  last: Ledger | null;
  /** Ajuste para que la taquilla anual se parezca a la prevista (asistencia × precio). */
  ticketFactor: number;
  /** Gastos de operación anuales (personal no deportivo, viajes, estadio...). */
  operations: number;
  /** Saldo a principio de cada mes (para la gráfica). */
  history: { date: string; balance: number }[];
}

export interface Payment {
  id: string;
  fromClubId: string;
  toClubId: string;
  amount: number;
  due: string;
  kind: 'installment' | 'sellOn' | 'loanFee' | 'bonus';
  playerId: string | null;
}

export type FfpStatus = 'ok' | 'warning' | 'embargo';

export interface EconomyState {
  clubs: Record<string, ClubEconomy>;
  payments: Payment[];
  /** Juego limpio financiero del club del usuario. */
  ffp: { status: FfpStatus; embargoUntil: string | null; fines: number; lastResult: number | null };
  seq: number;
}

const emptyLedger = (): Ledger => ({
  income: Object.fromEntries(INCOME_KEYS.map((k) => [k, 0])) as Ledger['income'],
  expense: Object.fromEntries(EXPENSE_KEYS.map((k) => [k, 0])) as Ledger['expense'],
});

export const sumIncome = (l: Ledger) => INCOME_KEYS.reduce((a, k) => a + l.income[k], 0);
export const sumExpense = (l: Ledger) => EXPENSE_KEYS.reduce((a, k) => a + l.expense[k], 0);

/** Ingresos recurrentes anuales (sin premios ni ventas). */
export function revenueOf(club: Club): number {
  const s = club.finances.seasonIncome;
  return s.tickets + s.tv + s.sponsorship + s.merchandising;
}

const HOME_GAMES = 21;

export function playerWageBill(state: GameState, clubId: string): number {
  return (indexes(state).squads.get(clubId) ?? []).reduce((a, p) => a + (p.contract?.wage ?? 0), 0);
}

const STAFF_INDEX = new WeakMap<object, Map<string, Staff>>();
/** Índice del staff por id (se rehace solo si cambia la lista). */
export function staffById(state: GameState): Map<string, Staff> {
  let m = STAFF_INDEX.get(state.world.staff);
  if (!m || m.size !== state.world.staff.length) {
    m = new Map(state.world.staff.map((s) => [s.id, s]));
    STAFF_INDEX.set(state.world.staff, m);
  }
  return m;
}

export function staffWageBill(state: GameState, clubId: string): number {
  const club = indexes(state).clubs.get(clubId);
  if (!club) return 0;
  const staff = staffById(state);
  return club.staffIds.reduce((a, id) => a + (staff.get(id)?.contract?.wage ?? 0), 0);
}

function clubEconomyFor(state: GameState, club: Club): ClubEconomy {
  const revenue = revenueOf(club);
  const wages = (playerWageBill(state, club.id) + staffWageBill(state, club.id)) * 52;
  return {
    season: emptyLedger(),
    last: null,
    ticketFactor: club.finances.seasonIncome.tickets / Math.max(1, club.stadium.capacity * 0.85 * club.finances.ticketPrice * HOME_GAMES),
    // Así un club con su plantilla actual cierra el año más o menos equilibrado
    operations: roundMoney(Math.max(revenue * 0.1, revenue * 0.94 - wages)),
    history: [{ date: state.date, balance: club.finances.balance }],
  };
}

export function initEconomy(state: GameState): EconomyState {
  const eco: EconomyState = { clubs: {}, payments: [], ffp: { status: 'ok', embargoUntil: null, fines: 0, lastResult: null }, seq: 0 };
  state.economy = eco;
  for (const c of state.world.clubs) eco.clubs[c.id] = clubEconomyFor(state, c);
  return eco;
}

function econ(state: GameState, clubId: string): ClubEconomy | null {
  const c = state.economy.clubs[clubId];
  if (c) return c;
  const club = indexes(state).clubs.get(clubId);
  if (!club) return null;
  return (state.economy.clubs[clubId] = clubEconomyFor(state, club));
}

export function credit(state: GameState, clubId: string, key: IncomeKey, amount: number): void {
  const club = indexes(state).clubs.get(clubId);
  const e = econ(state, clubId);
  if (!club || !e || amount <= 0) return;
  club.finances.balance = Math.round(club.finances.balance + amount);
  e.season.income[key] += Math.round(amount);
}

export function debit(state: GameState, clubId: string, key: ExpenseKey, amount: number): void {
  const club = indexes(state).clubs.get(clubId);
  const e = econ(state, clubId);
  if (!club || !e || amount <= 0) return;
  club.finances.balance = Math.round(club.finances.balance - amount);
  e.season.expense[key] += Math.round(amount);
}

/** Pago entre clubes en una fecha (fichajes a plazos, porcentajes de reventa, cesiones). */
export function schedulePayment(state: GameState, p: Omit<Payment, 'id'>): Payment {
  const pay = { ...p, id: `pay${(++state.economy.seq).toString(36)}`, amount: Math.round(p.amount) };
  state.economy.payments.push(pay);
  return pay;
}

/** Paga un traspaso: una parte ahora y el resto en plazos mensuales. */
export function payTransferFee(state: GameState, fromClubId: string, toClubId: string, fee: number, installments: number, playerId: string): void {
  const n = Math.max(0, Math.min(36, Math.round(installments)));
  const upfront = n === 0 ? fee : fee * 0.4;
  transferCash(state, fromClubId, toClubId, upfront);
  for (let i = 1; i <= n; i++) {
    schedulePayment(state, { fromClubId, toClubId, amount: (fee - upfront) / n, due: addDays(state.date, 30 * i), kind: 'installment', playerId });
  }
}

export function transferCash(state: GameState, fromClubId: string, toClubId: string, amount: number): void {
  debit(state, fromClubId, 'transfers', amount);
  credit(state, toClubId, 'transfers', amount);
  const club = indexes(state).clubs.get(toClubId);
  if (club) club.finances.seasonIncome.transfers += Math.round(amount);
}

/** Deuda pendiente con otros clubes (plazos aún no pagados). */
export function pendingPayments(state: GameState, clubId: string): { owed: number; due: number } {
  let owed = 0, due = 0;
  for (const p of state.economy.payments) {
    if (p.fromClubId === clubId) owed += p.amount;
    if (p.toClubId === clubId) due += p.amount;
  }
  return { owed, due };
}

// ---------------------------------------------------------------- día a día
export function economyDay(state: GameState): void {
  const d = state.date;
  const ix = indexes(state);
  // Taquilla de los partidos de hoy
  for (const f of ix.byDate.get(d) ?? []) {
    const key = `gate:${f.id}`;
    if (!f.played || state.processed[key]) continue;
    state.processed[key] = true;
    const home = ix.clubs.get(f.homeId);
    const e = home && econ(state, home.id);
    if (!home || !e) continue;
    const attendance = f.summary?.attendance || state.userMatches[f.id]?.attendance || home.stadium.capacity * 0.8;
    const cupBoost = f.stage === 'league' ? 1 : 1.15;
    credit(state, home.id, 'tickets', attendance * home.finances.ticketPrice * e.ticketFactor * cupBoost);
  }
  // Salarios (cada lunes)
  if (weekday(d) === 1 && !state.processed[`wages:${d}`]) {
    state.processed[`wages:${d}`] = true;
    for (const c of state.world.clubs) {
      debit(state, c.id, 'wages', playerWageBill(state, c.id));
      debit(state, c.id, 'staff', staffWageBill(state, c.id));
    }
  }
  // Mensual (día 1)
  if (d.endsWith('-01') && !state.processed[`month:${d}`]) {
    state.processed[`month:${d}`] = true;
    for (const c of state.world.clubs) {
      const e = econ(state, c.id);
      if (!e) continue;
      const s = c.finances.seasonIncome;
      credit(state, c.id, 'tv', s.tv / 12);
      credit(state, c.id, 'sponsorship', s.sponsorship / 12);
      credit(state, c.id, 'merchandising', s.merchandising / 12);
      debit(state, c.id, 'operations', e.operations / 12);
      const f = c.facilities;
      debit(state, c.id, 'facilities', (f.training + f.youth + f.youthRecruitment + f.juniorCoaching) * revenueOf(c) * 0.0004 / 12);
      if (c.finances.debt > 0) debit(state, c.id, 'interest', (c.finances.debt * 0.05) / 12);
      e.history.push({ date: d, balance: c.finances.balance });
      if (e.history.length > 40) e.history.splice(0, e.history.length - 40);
    }
    monthlyFfpNotice(state);
  }
  // Pagos aplazados que vencen hoy (o antes)
  if (state.economy.payments.some((p) => p.due <= d)) {
    const rest: Payment[] = [];
    for (const p of state.economy.payments) {
      if (p.due > d) { rest.push(p); continue; }
      debit(state, p.fromClubId, p.kind === 'bonus' ? 'bonuses' : 'transfers', p.amount);
      credit(state, p.toClubId, 'transfers', p.amount);
    }
    state.economy.payments = rest;
  }
}

/** Premio por ganar una eliminatoria de copa. */
export function cupPrize(state: GameState, clubId: string, round: string): void {
  const club = indexes(state).clubs.get(clubId);
  if (!club) return;
  const k = round === 'cup:final' ? 0.06 : round === 'cup:sf' ? 0.025 : round === 'cup:qf' ? 0.015 : 0.006;
  credit(state, clubId, 'prizes', Math.max(20000, club.finances.seasonIncome.tv * k));
}

// ---------------------------------------------------------------- juego limpio financiero
/** Pérdida máxima admitida en una temporada antes de sanción. */
export function ffpLimit(club: Club): number {
  return Math.max(5_000_000, revenueOf(club) * 0.3);
}

export function seasonResult(state: GameState, clubId: string): number {
  const e = econ(state, clubId);
  return e ? sumIncome(e.season) - sumExpense(e.season) : 0;
}

function monthlyFfpNotice(state: GameState): void {
  const club = indexes(state).clubs.get(state.userClubId);
  if (!club) return;
  const f = forecast(state);
  if (f.projectedResult < -ffpLimit(club) * 0.8 && club.finances.balance < revenueOf(club) * 0.1 && !state.processed[`ffpwarn:${state.season}`]) {
    state.processed[`ffpwarn:${state.season}`] = true;
    addMessage(state, {
      type: 'finance', priority: 'high', key: 'ffpRisk', sender: 'Departamento financiero',
      params: { loss: money(-f.projectedResult), limit: money(ffpLimit(club)) },
    });
  }
}

/** Fin de temporada: premios de liga, revisión del juego limpio financiero y nuevos presupuestos. */
export function seasonEndFinances(state: GameState): void {
  const ix = indexes(state);
  for (const comp of state.world.competitions) {
    if (comp.format !== 'league') continue;
    const table = leagueTable(state, comp.id);
    const n = table.length;
    for (const r of table) {
      const club = ix.clubs.get(r.clubId);
      if (!club) continue;
      const pool = club.finances.seasonIncome.tv * 0.15;
      credit(state, club.id, 'prizes', pool * ((n - r.position + 1) / n) + (r.position === 1 ? club.finances.seasonIncome.tv * 0.08 : 0));
    }
  }
  // Juego limpio financiero (club del usuario)
  const club = ix.clubs.get(state.userClubId);
  if (club) {
    const result = seasonResult(state, club.id);
    const ffp = state.economy.ffp;
    ffp.lastResult = result;
    const breach = result < -ffpLimit(club) && club.finances.balance < 0;
    if (breach) {
      if (ffp.status === 'ok') {
        ffp.status = 'warning';
        addMessage(state, { type: 'finance', priority: 'urgent', key: 'ffpWarning', sender: 'Comité de control financiero', params: { loss: money(-result), limit: money(ffpLimit(club)) } });
      } else {
        const fine = roundMoney(revenueOf(club) * 0.03);
        debit(state, club.id, 'fines', fine);
        ffp.fines += fine;
        ffp.status = 'embargo';
        ffp.embargoUntil = state.calendar.windows.find((w) => w.id === 'summer') ? `${state.seasonYear + 1}-09-02` : null;
        addMessage(state, { type: 'finance', priority: 'urgent', key: 'ffpSanction', sender: 'Comité de control financiero', params: { fine: money(fine) } });
      }
    } else if (ffp.status !== 'embargo') {
      ffp.status = 'ok';
    }
  }
}

/** Nueva temporada: se archiva el balance y se recalculan ingresos y presupuestos. */
export function rolloverFinances(state: GameState, levelChange: Map<string, number>): void {
  const ix = indexes(state);
  for (const club of state.world.clubs) {
    const e = econ(state, club.id);
    if (!e) continue;
    const s = club.finances.seasonIncome;
    const ch = levelChange.get(club.id) ?? 0;
    if (ch !== 0) {
      // Ascenso (ch < 0: sube de nivel) o descenso
      const k = ch < 0 ? 1.9 : 0.55;
      s.tv = roundMoney(s.tv * k);
      s.sponsorship = roundMoney(s.sponsorship * (ch < 0 ? 1.35 : 0.75));
      s.merchandising = roundMoney(s.merchandising * (ch < 0 ? 1.25 : 0.8));
    }
    s.prizes = 0;
    s.transfers = 0;
    e.last = e.season;
    e.season = emptyLedger();
    const revenue = revenueOf(club);
    const wages = playerWageBill(state, club.id);
    // Presupuestos: una parte del saldo y de los ingresos; menos si hay deuda
    const pend = pendingPayments(state, club.id);
    club.finances.transferBudget = roundMoney(Math.max(0, club.finances.balance * 0.35 + revenue * 0.06 - pend.owed - club.finances.debt * 0.1));
    club.finances.wageBudget = roundMoney(Math.max(wages * 1.04, (revenue - e.operations) * 0.85 / 52));
  }
  const ffp = state.economy.ffp;
  if (ffp.status === 'embargo' && ffp.embargoUntil && state.date > ffp.embargoUntil) { ffp.status = 'warning'; ffp.embargoUntil = null; }
  void ix;
}

export function transferEmbargo(state: GameState): boolean {
  const f = state.economy.ffp;
  return f.status === 'embargo' && (!f.embargoUntil || state.date <= f.embargoUntil);
}

// ---------------------------------------------------------------- previsión y vista
export function forecast(state: GameState, clubId = state.userClubId) {
  const ix = indexes(state);
  const club = ix.clubs.get(clubId)!;
  const e = econ(state, clubId)!;
  const end = state.calendar.end;
  const days = Math.max(0, (Date.parse(end) - Date.parse(state.date)) / 86400000);
  const months = Math.floor(days / 30.4);
  const weeks = Math.floor(days / 7);
  const s = club.finances.seasonIncome;
  const remainingHome = state.fixtures.filter((f) => !f.played && f.homeId === clubId).length;
  const gate = (club.stadium.capacity * 0.82 * club.finances.ticketPrice * e.ticketFactor) * remainingHome;
  const income = gate + months * (s.tv + s.sponsorship + s.merchandising) / 12;
  const wages = weeks * (playerWageBill(state, clubId) + staffWageBill(state, clubId));
  const fac = club.facilities;
  const fixed = months * (e.operations / 12 + (fac.training + fac.youth + fac.youthRecruitment + fac.juniorCoaching) * revenueOf(club) * 0.0004 / 12 + club.finances.debt * 0.05 / 12);
  const payments = state.economy.payments.filter((p) => p.due <= end);
  const out = payments.filter((p) => p.fromClubId === clubId).reduce((a, p) => a + p.amount, 0);
  const inn = payments.filter((p) => p.toClubId === clubId).reduce((a, p) => a + p.amount, 0);
  const projectedBalance = club.finances.balance + income - wages - fixed - out + inn;
  return {
    projectedBalance: Math.round(projectedBalance),
    projectedResult: Math.round(seasonResult(state, clubId) + income - wages - fixed - out + inn),
    remainingIncome: Math.round(income + inn),
    remainingExpense: Math.round(wages + fixed + out),
  };
}

export function financeView(state: GameState) {
  const ix = indexes(state);
  const club = ix.clubs.get(state.userClubId)!;
  const e = econ(state, club.id)!;
  const f = club.finances;
  const wageBill = playerWageBill(state, club.id);
  const pend = pendingPayments(state, club.id);
  const league = leagueOf(state, club.id);
  const fc = forecast(state);
  return {
    club: { id: club.id, name: club.name },
    season: state.season,
    balance: f.balance,
    debt: f.debt,
    transferBudget: f.transferBudget,
    wageBudget: f.wageBudget,
    wageBill,
    staffBill: staffWageBill(state, club.id),
    ticketPrice: f.ticketPrice,
    seasonTicketHolders: f.seasonTicketHolders,
    capacity: club.stadium.capacity,
    revenue: revenueOf(club),
    ledger: e.season,
    lastLedger: e.last,
    history: e.history,
    payments: state.economy.payments.filter((p) => p.fromClubId === club.id || p.toClubId === club.id)
      .sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 30)
      .map((p) => ({ ...p, out: p.fromClubId === club.id, other: ix.clubs.get(p.fromClubId === club.id ? p.toClubId : p.fromClubId)?.name ?? '', player: p.playerId ? ix.players.get(p.playerId)?.lastName ?? '' : '' })),
    owed: pend.owed,
    due: pend.due,
    forecast: fc,
    ffp: { ...state.economy.ffp, limit: ffpLimit(club), seasonResult: seasonResult(state, club.id), embargo: transferEmbargo(state) },
    league: league?.name ?? null,
  };
}

/**
 * Mueve dinero entre presupuestos: `weekly` euros semanales de salarios ↔ 52 semanas
 * de fichajes (positivo: más salario, menos fichajes).
 */
export function adjustBudgets(state: GameState, weekly: number): void {
  const club = indexes(state).clubs.get(state.userClubId)!;
  const f = club.finances;
  const w = Math.round(weekly);
  if (w > 0 && w * 52 > f.transferBudget) throw new Error('No hay presupuesto de fichajes suficiente');
  if (w < 0 && f.wageBudget + w < playerWageBill(state, club.id)) throw new Error('El presupuesto salarial no puede quedar por debajo de los salarios actuales');
  f.wageBudget += w;
  f.transferBudget -= w * 52;
}

export function setTicketPrice(state: GameState, price: number): void {
  const club = indexes(state).clubs.get(state.userClubId)!;
  const p = Math.round(price);
  const base = Math.round(10 + club.reputation / 250);
  if (p < Math.round(base * 0.5) || p > Math.round(base * 2)) throw new Error(`El precio debe estar entre ${Math.round(base * 0.5)} y ${Math.round(base * 2)} €`);
  const e = econ(state, club.id)!;
  // La asistencia baja si se sube el precio: el ingreso crece menos que el precio
  const ratio = p / club.finances.ticketPrice;
  e.ticketFactor *= Math.pow(ratio, -0.45);
  club.finances.ticketPrice = p;
}

export function money(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1).replace('.', ',')} M€` : a >= 1e3 ? `${Math.round(a / 1e3)} k€` : `${Math.round(a)} €`;
  return v < 0 ? `-${s}` : s;
}

