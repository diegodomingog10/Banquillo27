/**
 * Moral y vestuario del club del usuario: minutos frente a lo que espera cada jugador
 * según su rol, preocupaciones (minutos, contrato, traspaso frustrado, promesas rotas,
 * conflictos), promesas con plazo, grupos sociales y líderes (su humor se contagia) y
 * reuniones individuales y de equipo.
 */
import type { Player } from '../data/schema';
import { ageAt, addDays, yearsBetween } from './date';
import { addMessage, indexes, type Fixture, type GameState } from './game';
import type { MatchResult } from './matchEngine';
import { clamp, createRng, hashString } from './rng';
import { expectedRole, ROLE_LABEL, type SquadRole } from './transfers';
import { weekday } from './calendar';
import { GROUP_OF_POSITION } from '../data/positions';
import { mainPosition } from '../data/ability';

export type ConcernKind = 'playingTime' | 'contract' | 'transfer' | 'brokenPromise' | 'conflict';
export const CONCERN_LABEL: Record<ConcernKind, string> = {
  playingTime: 'Quiere más minutos', contract: 'Preocupado por su contrato', transfer: 'Le frenaste un traspaso',
  brokenPromise: 'No cumpliste tu promesa', conflict: 'Enfrentado contigo',
};

export interface Concern { kind: ConcernKind; since: string; level: 1 | 2 | 3 }

export interface Promise {
  id: string;
  playerId: string;
  kind: 'playingTime' | 'transfer';
  made: string;
  due: string;
  status: 'active' | 'kept' | 'broken';
}

export interface DressingState {
  happiness: Record<string, { concerns: Concern[]; share: number; shortWeeks: number }>;
  promises: Promise[];
  meetings: { date: string; playerId: string | null; kind: string; result: 'good' | 'neutral' | 'bad'; text: string }[];
  lastTeamMeeting: string | null;
  seq: number;
}

export function initDressing(state: GameState): DressingState {
  return (state.dressing = { happiness: {}, promises: [], meetings: [], lastTeamMeeting: null, seq: 0 });
}

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
export const EXPECTED_SHARE: Record<SquadRole, number> = { star: 0.85, important: 0.65, rotation: 0.4, backup: 0.15, youth: 0.08 };

function squad(state: GameState): Player[] {
  return indexes(state).squads.get(state.userClubId) ?? [];
}

function h(state: GameState, id: string) {
  return (state.dressing.happiness[id] ??= { concerns: [], share: 0.5, shortWeeks: 0 });
}

export function roleOf(state: GameState, p: Player): SquadRole {
  return state.transfers.roles[p.id] ?? expectedRole(state, p, state.userClubId);
}

export function addConcern(state: GameState, playerId: string, kind: ConcernKind, level: 1 | 2 | 3): void {
  const hh = h(state, playerId);
  const c = hh.concerns.find((x) => x.kind === kind);
  if (c) c.level = Math.max(c.level, level) as 1 | 2 | 3;
  else hh.concerns.push({ kind, since: state.date, level });
}

function removeConcern(state: GameState, playerId: string, kind: ConcernKind): void {
  const hh = h(state, playerId);
  hh.concerns = hh.concerns.filter((c) => c.kind !== kind);
}

/** Tras cada partido del usuario: cuota de minutos (media móvil). */
export function dressingAfterMatch(state: GameState, f: Fixture, r: MatchResult): void {
  if (f.homeId !== state.userClubId && f.awayId !== state.userClubId) return;
  const side = f.homeId === state.userClubId ? 0 : 1;
  const mins = new Map<string, number>();
  for (const st of Object.values(r.playerStats)) if (st.side === side) mins.set(st.playerId, st.minutes);
  for (const p of squad(state)) {
    if (p.injury) continue;
    const hh = h(state, p.id);
    hh.share = hh.share * 0.75 + Math.min(1, (mins.get(p.id) ?? 0) / 90) * 0.25;
  }
}

// ---------------------------------------------------------------- grupos y líderes
export function leaders(state: GameState): Player[] {
  return squad(state)
    .filter((p) => p.attributes.leadership >= 12)
    .map((p) => ({ p, s: p.attributes.leadership * 2 + Math.min(12, ageAt(p.birthDate, state.date) - 20) + h(state, p.id).share * 8 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.p);
}

export function socialGroups(state: GameState): { id: string; label: string; members: Player[] }[] {
  const sq = squad(state);
  const byNation = new Map<string, Player[]>();
  for (const p of sq) {
    const n = p.nationalities[0] ?? '';
    byNation.set(n, [...(byNation.get(n) ?? []), p]);
  }
  const clubNation = indexes(state).clubs.get(state.userClubId)?.nationId;
  const groups: { id: string; label: string; members: Player[] }[] = [];
  const rest: Player[] = [];
  for (const [n, members] of byNation) {
    if (n === clubNation) continue;
    if (members.length >= 3) groups.push({ id: `n:${n}`, label: `Grupo de ${state.world.nations.find((x) => x.id === n)?.name ?? n}`, members });
    else rest.push(...members);
  }
  const local = byNation.get(clubNation ?? '') ?? [];
  const veterans = local.filter((p) => ageAt(p.birthDate, state.date) >= 28);
  const young = local.filter((p) => ageAt(p.birthDate, state.date) < 28);
  if (veterans.length) groups.unshift({ id: 'veterans', label: 'Veteranos de la casa', members: veterans });
  if (young.length) groups.unshift({ id: 'young', label: 'Jóvenes de la casa', members: young });
  if (rest.length) groups.push({ id: 'rest', label: 'Extranjeros sueltos', members: rest });
  return groups;
}

function groupOf(state: GameState, p: Player, groups = socialGroups(state)) {
  return groups.find((g) => g.members.some((m) => m.id === p.id));
}

// ---------------------------------------------------------------- semana a semana
export function dressingDay(state: GameState): void {
  if (weekday(state.date) !== 1 || state.processed[`dress:${state.date}`]) return;
  state.processed[`dress:${state.date}`] = true;
  const sq = squad(state);
  const groups = socialGroups(state);
  const lead = new Set(leaders(state).map((p) => p.id));
  for (const p of sq) {
    const hh = h(state, p.id);
    const role = roleOf(state, p);
    // Minutos frente a lo esperado
    if (!p.injury && hh.share < EXPECTED_SHARE[role] - 0.25) hh.shortWeeks++;
    else hh.shortWeeks = Math.max(0, hh.shortWeeks - 1);
    const pt = hh.concerns.find((c) => c.kind === 'playingTime');
    if (hh.shortWeeks >= 3 && ageAt(p.birthDate, state.date) >= 19) {
      const level = (hh.shortWeeks >= 8 ? 3 : hh.shortWeeks >= 5 ? 2 : 1) as 1 | 2 | 3;
      const hasPromise = state.dressing.promises.some((x) => x.playerId === p.id && x.kind === 'playingTime' && x.status === 'active');
      if (!hasPromise) {
        if (level === 2 && (!pt || pt.level < 2)) addMessage(state, { type: 'player', priority: 'normal', key: 'wantsTalk', params: { player: nameOf(p), reason: 'no está contento con sus minutos' }, related: { playerId: p.id } });
        addConcern(state, p.id, 'playingTime', level);
      }
    } else if (pt && hh.shortWeeks === 0) removeConcern(state, p.id, 'playingTime');
    // Contrato que vence
    const yearsLeft = p.contract ? yearsBetween(state.date, p.contract.expires) : 0;
    if (p.contract && p.contract.type !== 'loan' && yearsLeft < 0.9 && p.attributes.ambition >= 12) addConcern(state, p.id, 'contract', yearsLeft < 0.4 ? 2 : 1);
    else removeConcern(state, p.id, 'contract');
    // Caducan las preocupaciones antiguas de traspaso y promesas rotas
    hh.concerns = hh.concerns.filter((c) => !((c.kind === 'transfer' || c.kind === 'brokenPromise') && yearsBetween(c.since, state.date) > 0.3));
    // Conflicto si la preocupación es grave y el carácter, difícil
    const worst = Math.max(0, ...hh.concerns.map((c) => c.level));
    if (worst >= 3 && p.attributes.temperament <= 8 && !hh.concerns.some((c) => c.kind === 'conflict')) {
      addConcern(state, p.id, 'conflict', 2);
      addMessage(state, { type: 'player', priority: 'high', key: 'conflict', params: { player: nameOf(p) }, related: { playerId: p.id } });
    }
    // Efecto en la moral
    const load = hh.concerns.reduce((a, c) => a + c.level, 0);
    if (load) p.morale = clamp(p.morale - load * 0.9, 5, 100);
    // Un líder descontento contagia a su grupo
    if (lead.has(p.id) && load >= 3) {
      const g = groupOf(state, p, groups);
      for (const m of g?.members ?? []) if (m.id !== p.id) m.morale = clamp(m.morale - 0.8, 5, 100);
    }
  }
  checkPromises(state);
}

function checkPromises(state: GameState): void {
  const ix = indexes(state);
  for (const pr of state.dressing.promises) {
    if (pr.status !== 'active' || pr.due > state.date) continue;
    const p = ix.players.get(pr.playerId);
    if (!p || p.clubId !== state.userClubId) { pr.status = 'kept'; continue; }
    const hh = h(state, p.id);
    const kept = pr.kind === 'playingTime' ? hh.share >= EXPECTED_SHARE[roleOf(state, p)] - 0.12 : !!state.transfers.listed[p.id];
    pr.status = kept ? 'kept' : 'broken';
    if (kept) {
      p.morale = clamp(p.morale + 8, 5, 100);
      removeConcern(state, p.id, 'playingTime');
    } else {
      p.morale = clamp(p.morale - 15, 5, 100);
      addConcern(state, p.id, 'brokenPromise', 3);
      addMessage(state, { type: 'player', priority: 'high', key: 'promiseBroken', params: { player: nameOf(p) }, related: { playerId: p.id } });
      if (leaders(state).some((l) => l.id === p.id)) for (const m of squad(state)) m.morale = clamp(m.morale - 2, 5, 100);
    }
  }
  state.dressing.promises = state.dressing.promises.filter((x) => x.status === 'active' || yearsBetween(x.due, state.date) < 0.25);
}

// ---------------------------------------------------------------- reuniones
export const PLAYER_TALKS = ['praise', 'demand', 'promiseTime', 'explainRole', 'allowLeave', 'resolveConflict'] as const;
export type PlayerTalk = (typeof PLAYER_TALKS)[number];
export const TALK_LABEL: Record<PlayerTalk, string> = {
  praise: 'Felicitarle por su trabajo', demand: 'Exigirle más', promiseTime: 'Prometerle más minutos',
  explainRole: 'Explicarle su papel en el equipo', allowLeave: 'Dejarle salir si llega una buena oferta', resolveConflict: 'Hacer las paces',
};

const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 6.5);

export function availableTalks(state: GameState, p: Player): PlayerTalk[] {
  const hh = h(state, p.id);
  const has = (k: ConcernKind) => hh.concerns.some((c) => c.kind === k);
  const out: PlayerTalk[] = ['praise', 'demand'];
  if (has('playingTime') || has('brokenPromise')) out.push('promiseTime', 'explainRole');
  if (has('transfer') || has('playingTime') || has('contract')) out.push('allowLeave');
  if (has('conflict')) out.push('resolveConflict');
  return out;
}

export function talkToPlayer(state: GameState, playerId: string, talk: PlayerTalk): { result: 'good' | 'neutral' | 'bad'; text: string } {
  const p = indexes(state).players.get(playerId);
  if (!p || p.clubId !== state.userClubId) throw new Error('Solo puedes hablar con jugadores de tu plantilla');
  const last = state.dressing.meetings.find((m) => m.playerId === playerId);
  if (last && yearsBetween(last.date, state.date) * 365 < 10) throw new Error(`Ya hablaste con ${nameOf(p)} hace poco`);
  if (!availableTalks(state, p).includes(talk)) throw new Error('Ese tema no viene a cuento ahora');
  const rng = createRng(hashString(`talk:${state.seed}:${p.id}:${state.date}:${talk}`));
  const a = p.attributes;
  const form = avg(p.form);
  const name = nameOf(p);
  let result: 'good' | 'neutral' | 'bad' = 'neutral';
  let text = '';
  let delta = 0;
  switch (talk) {
    case 'praise':
      if (form >= 7) { delta = 6; result = 'good'; text = `${name} agradece el reconocimiento.`; }
      else if (form < 6.3) { delta = a.professionalism >= 14 ? 1 : -2; text = `${name} no entiende la felicitación: sabe que no está jugando bien.`; result = delta < 0 ? 'bad' : 'neutral'; }
      else { delta = 3; result = 'good'; text = `${name} se lo toma bien.`; }
      break;
    case 'demand':
      if (a.professionalism >= 14 || a.determination >= 15) { delta = 3; result = 'good'; text = `${name} acepta el reto y promete dar más.`; p.form = [...p.form.slice(-4), Math.min(10, form + 0.4)]; }
      else if (a.temperament <= 8) { delta = -9; result = 'bad'; text = `${name} se enfada: no le gusta que le señalen.`; if (rng.chance(0.4)) addConcern(state, p.id, 'conflict', 1); }
      else { delta = -2; text = `${name} escucha, aunque no parece convencido.`; }
      break;
    case 'promiseTime': {
      const active = state.dressing.promises.filter((x) => x.status === 'active').length;
      const broken = state.dressing.promises.filter((x) => x.playerId === p.id && x.status === 'broken').length;
      if (broken) { delta = -3; result = 'bad'; text = `${name} ya no se cree tus promesas.`; break; }
      state.dressing.promises.push({ id: `pr${++state.dressing.seq}`, playerId: p.id, kind: 'playingTime', made: state.date, due: addDays(state.date, 42), status: 'active' });
      const hh = h(state, p.id);
      hh.shortWeeks = 0;
      for (const c of hh.concerns) if (c.kind === 'playingTime') c.level = 1;
      delta = active >= 3 ? 2 : 6;
      result = 'good';
      text = `${name} confía en ti: espera jugar más en las próximas seis semanas.${active >= 3 ? ' El vestuario empieza a ver que prometes mucho.' : ''}`;
      break;
    }
    case 'explainRole': {
      const role = roleOf(state, p);
      if (a.ambition >= 15 && (role === 'backup' || role === 'rotation')) { delta = -5; result = 'bad'; text = `${name} no acepta ser ${ROLE_LABEL[role].toLowerCase()}: quiere más.`; }
      else {
        delta = 3; result = 'good';
        text = `${name} entiende su papel (${ROLE_LABEL[role].toLowerCase()}) y lo acepta.`;
        removeConcern(state, p.id, 'playingTime');
        h(state, p.id).shortWeeks = 0;
      }
      break;
    }
    case 'allowLeave': {
      state.transfers.listed[p.id] = { asking: null, loan: false };
      const win = state.calendar.windows.find((w) => w.open > state.date || state.date <= w.deadline);
      state.dressing.promises.push({ id: `pr${++state.dressing.seq}`, playerId: p.id, kind: 'transfer', made: state.date, due: win?.deadline ?? addDays(state.date, 60), status: 'active' });
      removeConcern(state, p.id, 'transfer');
      delta = 6; result = 'good';
      text = `${name} agradece la sinceridad. Queda en venta: escucharás ofertas.`;
      break;
    }
    case 'resolveConflict': {
      const ok = rng.chance(clamp(0.35 + a.professionalism / 40 + (20 - a.temperament) / -60 + p.morale / 250, 0.1, 0.9));
      if (ok) { removeConcern(state, p.id, 'conflict'); delta = 5; result = 'good'; text = `Hacéis las paces. ${name} vuelve a estar centrado.`; }
      else { delta = -4; result = 'bad'; text = `${name} sigue molesto; la conversación no ha ido bien.`; }
      break;
    }
  }
  p.morale = clamp(p.morale + delta, 5, 100);
  state.dressing.meetings.unshift({ date: state.date, playerId: p.id, kind: talk, result, text });
  if (state.dressing.meetings.length > 60) state.dressing.meetings.length = 60;
  return { result, text };
}

export const TEAM_TALKS = ['praise', 'demand', 'calm', 'unity'] as const;
export type TeamTalk = (typeof TEAM_TALKS)[number];
export const TEAM_TALK_LABEL: Record<TeamTalk, string> = { praise: 'Felicitar al equipo', demand: 'Exigir más al equipo', calm: 'Quitar presión', unity: 'Pedir unidad' };

/** Forma reciente del equipo del usuario (puntos por partido en los últimos 5). */
function recentPoints(state: GameState): number {
  const me = state.userClubId;
  const last = state.fixtures.filter((f) => f.played && f.result && (f.homeId === me || f.awayId === me)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  if (!last.length) return 1.4;
  return last.reduce((a, f) => {
    const w = f.result!.winnerId ? f.result!.winnerId === me : (f.homeId === me ? f.result!.homeGoals > f.result!.awayGoals : f.result!.awayGoals > f.result!.homeGoals);
    const d = !f.result!.winnerId && f.result!.homeGoals === f.result!.awayGoals;
    return a + (w ? 3 : d ? 1 : 0);
  }, 0) / last.length;
}

export function teamMeeting(state: GameState, talk: TeamTalk): { result: 'good' | 'neutral' | 'bad'; text: string } {
  const d = state.dressing;
  if (d.lastTeamMeeting && yearsBetween(d.lastTeamMeeting, state.date) * 365 < 14) throw new Error('Ya reuniste al equipo hace poco');
  const ppg = recentPoints(state);
  const sq = squad(state);
  const prof = avg(sq.map((p) => p.attributes.professionalism));
  let base = 0;
  let text = '';
  switch (talk) {
    case 'praise': base = ppg >= 2 ? 4 : ppg >= 1.3 ? 1.5 : -2; text = ppg >= 2 ? 'El equipo disfruta del reconocimiento.' : ppg >= 1.3 ? 'El equipo lo agradece.' : 'Los jugadores no entienden la felicitación con estos resultados.'; break;
    case 'demand': base = ppg < 1.2 ? (prof >= 12 ? 3 : -1) : ppg >= 2 ? -3 : 0.5; text = ppg < 1.2 ? (prof >= 12 ? 'El vestuario reacciona: saben que hay que mejorar.' : 'Algunos se lo toman mal.') : ppg >= 2 ? 'El equipo no entiende la bronca tras una buena racha.' : 'Mensaje recibido.'; break;
    case 'calm': base = ppg < 1.2 ? 3 : 1; text = ppg < 1.2 ? 'Se respira algo más de tranquilidad.' : 'El equipo ya estaba tranquilo.'; break;
    case 'unity': base = 2; text = 'Mensaje de grupo: todos a una.'; break;
  }
  const result: 'good' | 'neutral' | 'bad' = base >= 2.5 ? 'good' : base < 0 ? 'bad' : 'neutral';
  for (const p of sq) {
    const hh = h(state, p.id);
    const extra = talk === 'unity' && hh.concerns.length ? 2 : 0;
    const temper = base < 0 ? 1 + (10 - p.attributes.temperament) * 0.05 : 1;
    p.morale = clamp(p.morale + base * temper + extra, 5, 100);
  }
  d.lastTeamMeeting = state.date;
  d.meetings.unshift({ date: state.date, playerId: null, kind: talk, result, text });
  return { result, text };
}

// ---------------------------------------------------------------- vistas
export function moraleLabel(m: number): string {
  return m >= 80 ? 'Excelente' : m >= 65 ? 'Buena' : m >= 50 ? 'Normal' : m >= 35 ? 'Baja' : 'Muy baja';
}

export function playerMood(state: GameState, p: Player) {
  const hh = h(state, p.id);
  const role = roleOf(state, p);
  return {
    morale: Math.round(p.morale),
    label: moraleLabel(p.morale),
    role: ROLE_LABEL[role],
    share: Math.round(hh.share * 100),
    expected: Math.round(EXPECTED_SHARE[role] * 100),
    concerns: hh.concerns.map((c) => ({ ...c, label: CONCERN_LABEL[c.kind] })),
    promises: state.dressing.promises.filter((x) => x.playerId === p.id && x.status === 'active').map((x) => ({ kind: x.kind, due: x.due })),
    talks: availableTalks(state, p).map((k) => ({ id: k, label: TALK_LABEL[k] })),
    lastTalk: state.dressing.meetings.find((m) => m.playerId === p.id) ?? null,
    leader: leaders(state).some((l) => l.id === p.id),
  };
}

export function dressingView(state: GameState) {
  const sq = squad(state);
  const lead = leaders(state);
  const groups = socialGroups(state);
  const morale = avg(sq.map((p) => p.morale));
  const rows = sq.map((p) => {
    const hh = h(state, p.id);
    return {
      id: p.id, name: nameOf(p), position: mainPosition(p.positions), group: GROUP_OF_POSITION[mainPosition(p.positions)], age: ageAt(p.birthDate, state.date),
      morale: Math.round(p.morale), label: moraleLabel(p.morale), role: ROLE_LABEL[roleOf(state, p)],
      share: Math.round(hh.share * 100), expected: Math.round(EXPECTED_SHARE[roleOf(state, p)] * 100),
      concerns: hh.concerns.map((c) => ({ ...c, label: CONCERN_LABEL[c.kind] })), leader: lead.some((l) => l.id === p.id), injured: !!p.injury,
    };
  }).sort((a, b) => b.concerns.reduce((s, c) => s + c.level, 0) - a.concerns.reduce((s, c) => s + c.level, 0) || a.morale - b.morale);
  return {
    morale: Math.round(morale), label: moraleLabel(morale),
    leaders: lead.map((p) => ({ id: p.id, name: nameOf(p), morale: Math.round(p.morale) })),
    groups: groups.map((g) => ({ id: g.id, label: g.label, size: g.members.length, morale: Math.round(avg(g.members.map((m) => m.morale))), members: g.members.map((m) => ({ id: m.id, name: nameOf(m) })) })),
    rows,
    promises: state.dressing.promises.map((x) => ({ ...x, name: indexes(state).players.get(x.playerId) ? nameOf(indexes(state).players.get(x.playerId)!) : '' })),
    meetings: state.dressing.meetings.slice(0, 15).map((m) => ({ ...m, name: m.playerId ? (indexes(state).players.get(m.playerId) ? nameOf(indexes(state).players.get(m.playerId)!) : '') : 'Equipo' })),
    teamTalks: TEAM_TALKS.map((k) => ({ id: k, label: TEAM_TALK_LABEL[k] })),
    teamMeetingWait: d(state),
  };
}

function d(state: GameState): number {
  const last = state.dressing.lastTeamMeeting;
  return last ? Math.max(0, Math.ceil(14 - yearsBetween(last, state.date) * 365)) : 0;
}
