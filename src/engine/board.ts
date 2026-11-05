/**
 * Directiva: confianza en el entrenador (resultados, objetivos y finanzas), peticiones
 * del entrenador (presupuestos e instalaciones), exigencias de la directiva (vender o
 * fichar antes de que cierre el mercado) y despido si la confianza se hunde.
 */
import { roundMoney } from '../data/ability';
import type { BoardObjective, Club } from '../data/schema';
import { t } from '../i18n';
import { addDays, yearsBetween } from './date';
import { debit, forecast, money, playerWageBill, revenueOf } from './economy';
import { addMessage, indexes, leagueOf, leagueTable, type Fixture, type GameState } from './game';
import { clamp } from './rng';

export const BOARD_REQUESTS = ['transferBudget', 'wageBudget', 'training', 'youth'] as const;
export type BoardRequestKind = (typeof BOARD_REQUESTS)[number];

export interface BoardState {
  confidence: number;
  history: { date: string; value: number }[];
  /** Motivos recientes de subida o bajada. */
  factors: { date: string; delta: number; text: string }[];
  requests: { date: string; kind: BoardRequestKind; accepted: boolean; text: string }[];
  demand: { kind: 'sell' | 'sign'; deadline: string; baseline: number; text: string } | null;
  projects: { kind: 'training' | 'youth'; done: string }[];
  warned: boolean;
  fired: boolean;
  /** Clubes que ofrecen trabajo tras el despido. */
  offers: string[];
}

export function initBoard(state: GameState): BoardState {
  return (state.board = { confidence: 65, history: [{ date: state.date, value: 65 }], factors: [], requests: [], demand: null, projects: [], warned: false, fired: false, offers: [] });
}

function change(state: GameState, delta: number, text: string): void {
  const b = state.board;
  if (b.fired || !delta) return;
  b.confidence = clamp(Math.round((b.confidence + delta) * 10) / 10, 0, 100);
  b.factors.unshift({ date: state.date, delta: Math.round(delta * 10) / 10, text });
  if (b.factors.length > 30) b.factors.length = 30;
  checkJob(state);
}

function userClub(state: GameState): Club {
  return indexes(state).clubs.get(state.userClubId)!;
}

// ---------------------------------------------------------------- resultados
export function boardAfterMatch(state: GameState, f: Fixture): void {
  if (!f.result || (f.homeId !== state.userClubId && f.awayId !== state.userClubId)) return;
  const ix = indexes(state);
  const home = f.homeId === state.userClubId;
  const opp = ix.clubs.get(home ? f.awayId : f.homeId);
  const me = userClub(state);
  const my = home ? f.result.homeGoals : f.result.awayGoals;
  const their = home ? f.result.awayGoals : f.result.homeGoals;
  const repGap = ((opp?.reputation ?? me.reputation) - me.reputation) / 1000; // >0: el rival es mejor
  const won = f.result.winnerId ? f.result.winnerId === me.id : my > their;
  const lost = f.result.winnerId ? f.result.winnerId !== me.id : my < their;
  const k = f.stage === 'league' ? 1 : 1.3;
  if (won) change(state, (1.6 + Math.max(0, repGap) * 0.8) * k, `Victoria ante ${opp?.name ?? 'el rival'}`);
  else if (lost) change(state, -(1.6 + Math.max(0, -repGap) * 0.9) * k + (my - their <= -4 ? -1.5 : 0), `Derrota ante ${opp?.name ?? 'el rival'}`);
  else if (repGap < -1.5) change(state, -0.6, `Empate ante ${opp?.name ?? 'el rival'}`);
  else if (repGap > 1.5) change(state, 0.6, `Empate ante ${opp?.name ?? 'el rival'}`);
}

function objectiveProgress(state: GameState, o: BoardObjective): 'ahead' | 'onTrack' | 'behind' | null {
  if (!o.competitionId || o.type === 'cupRound' || o.type === 'balanceBudget') return null;
  const row = leagueTable(state, o.competitionId).find((r) => r.clubId === state.userClubId);
  if (!row || row.played < 5) return null;
  const target = o.type === 'winLeague' ? 1 : o.type === 'promotion' ? (o.target ?? 2) : (o.target ?? 10);
  if (row.position <= target - 2) return 'ahead';
  if (row.position <= target) return 'onTrack';
  return row.position <= target + 2 ? 'onTrack' : 'behind';
}

// ---------------------------------------------------------------- día a día
export function boardDay(state: GameState): void {
  const b = state.board;
  if (b.fired) return;
  const club = userClub(state);
  // Proyectos de instalaciones terminados
  b.projects = b.projects.filter((p) => {
    if (p.done > state.date) return true;
    if (p.kind === 'training') club.facilities.training = clamp(club.facilities.training + 1, 1, 20);
    else club.facilities.youth = clamp(club.facilities.youth + 1, 1, 20);
    addMessage(state, { type: 'board', priority: 'normal', key: 'facilityDone', sender: `Directiva de ${club.name}`, params: { facility: p.kind === 'training' ? 'Las instalaciones de entrenamiento' : 'Las instalaciones de la cantera' } });
    return false;
  });
  // Exigencias con plazo
  if (b.demand && state.date >= b.demand.deadline) {
    const met = b.demand.kind === 'sell' ? playerWageBill(state, club.id) <= club.finances.wageBudget || club.finances.balance > b.demand.baseline : state.transfers.history.some((h) => h.toId === club.id && h.date >= addDays(b.demand!.deadline, -62));
    change(state, met ? 4 : -8, met ? 'Has cumplido lo que pidió la directiva' : 'No has atendido la petición de la directiva');
    b.demand = null;
  }
  if (!state.date.endsWith('-01') || state.processed[`board:${state.date}`]) return;
  state.processed[`board:${state.date}`] = true;
  // Mensual: finanzas y marcha de los objetivos
  const revenue = revenueOf(club);
  const fc = forecast(state);
  if (club.finances.balance < -revenue * 0.2) change(state, -4, 'Las cuentas están en números rojos');
  else if (club.finances.balance < 0) change(state, -2, 'Saldo negativo');
  else if (fc.projectedResult > 0) change(state, 0.5, 'Buena gestión económica');
  for (const o of club.boardObjectives) {
    const pr = objectiveProgress(state, o);
    const w = o.importance === 'critical' ? 2 : o.importance === 'high' ? 1.5 : 1;
    if (pr === 'ahead') change(state, 1.5 * w, 'Por encima del objetivo en la liga');
    else if (pr === 'behind') change(state, -2 * w, 'Por debajo del objetivo en la liga');
  }
  // Exigencias de la directiva durante el mercado
  const win = state.calendar.windows.find((w) => state.date >= w.open && state.date < w.deadline);
  if (win && !b.demand) {
    if (playerWageBill(state, club.id) > club.finances.wageBudget * 1.05 && club.finances.balance < revenue * 0.05) {
      b.demand = { kind: 'sell', deadline: win.deadline, baseline: club.finances.balance, text: 'Reducir la masa salarial vendiendo o cediendo jugadores' };
      addMessage(state, { type: 'board', priority: 'high', key: 'boardWantsSales', sender: `Directiva de ${club.name}`, params: { deadline: win.deadline } });
    } else if (club.finances.transferBudget > revenue * 0.15 && club.boardObjectives.some((o) => objectiveProgress(state, o) === 'behind')) {
      b.demand = { kind: 'sign', deadline: win.deadline, baseline: 0, text: 'Reforzar la plantilla antes del cierre del mercado' };
      addMessage(state, { type: 'board', priority: 'high', key: 'boardWantsSignings', sender: `Directiva de ${club.name}`, params: { deadline: win.deadline, budget: money(club.finances.transferBudget) } });
    }
  }
  b.history.push({ date: state.date, value: b.confidence });
  if (b.history.length > 40) b.history.splice(0, b.history.length - 40);
}

/** Fin de temporada: valoración de los objetivos. */
export function boardSeasonEnd(state: GameState, met: { objective: BoardObjective; met: boolean }[]): void {
  for (const m of met) {
    const w = m.objective.importance === 'critical' ? 26 : m.objective.importance === 'high' ? 18 : m.objective.importance === 'medium' ? 10 : 5;
    const label = t(`objective.${m.objective.type}`, { target: m.objective.target ?? '' });
    change(state, m.met ? w * 0.8 : -w, `${m.met ? 'Objetivo cumplido' : 'Objetivo no cumplido'}: ${label}`);
  }
}

function checkJob(state: GameState): void {
  const b = state.board;
  const club = userClub(state);
  if (b.confidence < 30 && !b.warned) {
    b.warned = true;
    addMessage(state, { type: 'board', priority: 'urgent', key: 'boardWarning', sender: `Directiva de ${club.name}`, params: { club: club.name } });
  }
  if (b.confidence >= 45) b.warned = false;
  // Un margen al principio de la etapa: no se despide en las primeras semanas
  const started = state.board.history[0]?.date ?? state.date;
  if (b.confidence < 12 && yearsBetween(started, state.date) > 0.2) fire(state);
}

function fire(state: GameState): void {
  const b = state.board;
  const club = userClub(state);
  b.fired = true;
  const rep = club.reputation;
  b.offers = state.world.clubs
    .filter((c) => c.id !== club.id && c.reputation <= rep * 0.85 && c.reputation >= rep * 0.35 && leagueOf(state, c.id))
    .sort((a, c) => c.reputation - a.reputation)
    .filter((_, i) => i % 3 === 0)
    .slice(0, 3)
    .map((c) => c.id);
  addMessage(state, {
    type: 'board', priority: 'urgent', key: 'sacked', sender: `Directiva de ${club.name}`, blocking: true,
    params: { club: club.name },
    actions: [{ id: 'ok', kind: 'accept', labelKey: 'common.understood', payload: {} }],
  });
}

// ---------------------------------------------------------------- peticiones
const REQUEST_COOLDOWN = 45;

export function boardRequest(state: GameState, kind: BoardRequestKind): { accepted: boolean; text: string } {
  const b = state.board;
  if (b.fired) throw new Error('Ya no eres el entrenador del club');
  const last = b.requests.find((r) => r.kind === kind);
  if (last && yearsBetween(last.date, state.date) * 365 < REQUEST_COOLDOWN) throw new Error('La directiva ya respondió a esta petición hace poco');
  const club = userClub(state);
  const f = club.finances;
  const revenue = revenueOf(club);
  const healthy = f.balance > revenue * 0.1 && forecast(state).projectedResult > -revenue * 0.1;
  let accepted = false;
  let text = '';
  switch (kind) {
    case 'transferBudget': {
      const extra = roundMoney(Math.min(f.balance * 0.2, revenue * 0.08));
      accepted = b.confidence >= 55 && healthy && extra > 0;
      if (accepted) { f.transferBudget += extra; text = `La directiva amplía el presupuesto de fichajes en ${money(extra)}.`; }
      else text = b.confidence < 55 ? 'La directiva no cree que sea el momento: antes quiere ver resultados.' : 'La situación económica no lo permite.';
      break;
    }
    case 'wageBudget': {
      const extra = roundMoney(f.wageBudget * 0.08);
      accepted = b.confidence >= 55 && healthy;
      if (accepted) { f.wageBudget += extra; text = `La directiva sube el presupuesto salarial en ${money(extra)} por semana.`; }
      else text = b.confidence < 55 ? 'La directiva no quiere comprometer más salarios ahora.' : 'La masa salarial ya es demasiado alta para las cuentas.';
      break;
    }
    case 'training':
    case 'youth': {
      const level = kind === 'training' ? club.facilities.training : club.facilities.youth;
      const cost = roundMoney(revenue * 0.02 * (1 + level / 10));
      const busy = b.projects.some((p) => p.kind === kind);
      accepted = !busy && level < 20 && b.confidence >= 60 && f.balance > cost * 3;
      if (accepted) {
        debit(state, club.id, 'facilities', cost);
        b.projects.push({ kind, done: addDays(state.date, 180) });
        text = `Aprobado: obras por ${money(cost)}, listas en unos seis meses.`;
      } else text = busy ? 'Ya hay unas obras en marcha.' : level >= 20 ? 'Las instalaciones ya son de primer nivel.' : 'La directiva no lo considera prioritario ahora.';
      break;
    }
  }
  b.requests.unshift({ date: state.date, kind, accepted, text });
  if (!accepted && b.confidence < 45) change(state, -1, 'Petición rechazada');
  return { accepted, text };
}

/** Tras el despido: aceptar una oferta de otro club. */
export function acceptJob(state: GameState, clubId: string): void {
  const b = state.board;
  if (!b.fired || !b.offers.includes(clubId)) throw new Error('Ese club no te ha ofrecido el puesto');
  state.userClubId = clubId;
  state.userLineup = null;
  state.postMatch = null;
  state.pendingUserMatchId = null;
  state.scouting.assignments = [];
  state.scouting.requests = [];
  for (const d of state.transfers.deals) if (['pendingClub', 'countered', 'negotiating', 'pendingUser'].includes(d.status)) d.status = 'withdrawn';
  state.transfers.listed = {};
  state.transfers.roles = {};
  initBoard(state);
  const club = userClub(state);
  addMessage(state, { type: 'board', priority: 'high', key: 'newJob', sender: `Directiva de ${club.name}`, params: { club: club.name } });
}

export function boardView(state: GameState) {
  const b = state.board;
  const club = userClub(state);
  const verdict = b.confidence >= 80 ? 'Encantada contigo' : b.confidence >= 60 ? 'Satisfecha' : b.confidence >= 45 ? 'Expectante' : b.confidence >= 30 ? 'Preocupada' : 'Tu puesto peligra';
  return {
    club: { id: club.id, name: club.name },
    confidence: Math.round(b.confidence),
    verdict,
    history: b.history,
    factors: b.factors.slice(0, 12),
    objectives: club.boardObjectives.map((o) => ({ ...o, label: t(`objective.${o.type}`, { target: o.target ?? '' }), progress: objectiveProgress(state, o), competition: o.competitionId ? indexes(state).comps.get(o.competitionId)?.name ?? '' : null })),
    requests: BOARD_REQUESTS.map((kind) => {
      const last = b.requests.find((r) => r.kind === kind);
      const wait = last ? Math.max(0, Math.ceil(REQUEST_COOLDOWN - yearsBetween(last.date, state.date) * 365)) : 0;
      return { kind, last: last ?? null, wait };
    }),
    demand: b.demand,
    projects: b.projects,
    facilities: club.facilities,
    fired: b.fired,
    offers: b.offers.map((id) => indexes(state).clubs.get(id)).filter((c): c is Club => !!c).map((c) => ({ id: c.id, name: c.name, reputation: c.reputation, league: leagueOf(state, c.id)?.name ?? '' })),
  };
}
