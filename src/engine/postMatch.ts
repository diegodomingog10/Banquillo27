/**
 * Post-partido del usuario: informe del cuerpo técnico, consecuencias en la moral y
 * rueda de prensa (preguntas según el contexto; cada respuesta mueve la moral).
 */
import type { Player } from '../data/schema';
import type { Fixture, GameState } from './game';
import { indexes } from './game';
import type { MatchResult } from './matchEngine';
import { clamp } from './rng';

export interface PressOption {
  id: string;
  text: string;
  /** Cambio de moral del equipo (todos) y, si aplica, del jugador aludido. */
  team: number;
  player: number;
  /** Titular de prensa si se elige. */
  headline: string;
}

export interface PressQuestion {
  id: string;
  journalist: string;
  text: string;
  playerId: string | null;
  options: PressOption[];
  answer: string | null;
}

export interface PostMatchState {
  fixtureId: string;
  headline: string;
  report: string[];
  tone: 'good' | 'neutral' | 'bad';
  moraleChanges: { playerId: string; name: string; before: number; after: number }[];
  press: PressQuestion[];
  pressDone: boolean;
  skippedPress: boolean;
}

const name = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

export function buildPostMatch(state: GameState, f: Fixture, r: MatchResult, moraleBefore: Map<string, number>): PostMatchState {
  const ix = indexes(state);
  const home = f.homeId === state.userClubId;
  const side = home ? 'home' : 'away';
  const oppSide = home ? 'away' : 'home';
  const res = r.match.result!;
  const my = home ? res.homeGoals : res.awayGoals;
  const their = home ? res.awayGoals : res.homeGoals;
  const st = r.match.stats!;
  const ms = st[side];
  const os = st[oppSide];
  const won = r.winner === side;
  const lost = r.winner !== null && r.winner !== side;
  const opp = ix.clubs.get(home ? f.awayId : f.homeId)?.name ?? 'el rival';

  // Titular
  let headline: string;
  if (won) headline = ms.xg >= os.xg ? (my - their >= 3 ? 'Exhibición' : 'Victoria merecida') : 'Victoria con fortuna';
  else if (lost) headline = ms.xg > os.xg + 0.4 ? 'Derrota inmerecida' : their - my >= 3 ? 'Derrota dolorosa' : 'Derrota';
  else headline = Math.abs(ms.xg - os.xg) < 0.5 ? 'Empate justo' : ms.xg > os.xg ? 'Empate con sabor amargo' : 'Punto valioso';

  // Informe del cuerpo técnico
  const mine = Object.values(r.playerStats).filter((p) => (p.side === 0) === home && p.minutes > 0);
  const best = mine.slice().sort((a, b) => b.rating - a.rating)[0];
  const worst = mine.filter((p) => p.minutes >= 45).sort((a, b) => a.rating - b.rating)[0];
  const tired = mine.filter((p) => p.condition < 60);
  const report: string[] = [];
  report.push(`Posesión del ${ms.possession} %, ${ms.shots} tiros (${ms.shotsOnTarget} a puerta) y ${ms.xg.toFixed(2).replace('.', ',')} de xG frente a ${os.xg.toFixed(2).replace('.', ',')} de ${opp}.`);
  if (ms.possession >= 58 && ms.xg < 1) report.push('Tuvimos el balón, pero nos faltó profundidad: pocas ocasiones claras.');
  if (os.shots >= 15) report.push(`Concedimos demasiado: ${os.shots} tiros del rival.`);
  if (ms.xg >= 2 && my <= 1) report.push('Generamos para marcar más; hay que afinar la definición.');
  if (best) {
    const p = ix.players.get(best.playerId);
    if (p) report.push(`Lo mejor: ${name(p)} (${best.rating.toFixed(1).replace('.', ',')}).`);
  }
  if (worst && worst.rating < 6.2) {
    const p = ix.players.get(worst.playerId);
    if (p) report.push(`${name(p)} estuvo por debajo de su nivel (${worst.rating.toFixed(1).replace('.', ',')}).`);
  }
  if (tired.length) report.push(`Acaban muy cansados: ${tired.map((t) => ix.players.get(t.playerId)).filter(Boolean).map((p) => name(p!)).join(', ')}. Conviene rotar.`);
  const injuries = r.injuries.filter((i) => ix.players.get(i.playerId)?.clubId === state.userClubId);
  if (injuries.length) report.push(`Lesionados: ${injuries.map((i) => name(ix.players.get(i.playerId)!)).join(', ')}.`);
  if (state.tacticFamiliarity < 60) report.push(`El equipo aún no domina el sistema (familiaridad ${Math.round(state.tacticFamiliarity)} %).`);

  // Moral
  const moraleChanges = (ix.squads.get(state.userClubId) ?? [])
    .map((p) => ({ playerId: p.id, name: name(p), before: Math.round(moraleBefore.get(p.id) ?? p.morale), after: Math.round(p.morale) }))
    .filter((m) => m.before !== m.after)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 8);

  return {
    fixtureId: f.id,
    headline,
    report,
    tone: won ? 'good' : lost ? 'bad' : 'neutral',
    moraleChanges,
    press: pressQuestions(state, f, r, won, lost, best ? ix.players.get(best.playerId) ?? null : null, opp),
    pressDone: false,
    skippedPress: false,
  };
}

function pressQuestions(state: GameState, f: Fixture, r: MatchResult, won: boolean, lost: boolean, star: Player | null, opp: string): PressQuestion[] {
  const ix = indexes(state);
  const qs: PressQuestion[] = [];
  if (won) {
    qs.push({ id: 'result', journalist: 'Diario Deportivo', playerId: null, answer: null, text: `Victoria ante ${opp}. ¿Qué destacaría del equipo?`, options: [
      { id: 'humble', text: 'El trabajo de todos. Hay que seguir con los pies en el suelo.', team: 2, player: 0, headline: 'El técnico pide humildad tras la victoria' },
      { id: 'confident', text: 'Hemos demostrado que podemos ganar a cualquiera.', team: 3, player: 0, headline: 'El técnico, eufórico: «Podemos ganar a cualquiera»' },
      { id: 'demanding', text: 'Hemos ganado, pero no me ha gustado cómo jugamos.', team: -2, player: 0, headline: 'El técnico, exigente pese a la victoria' },
    ] });
  } else if (lost) {
    qs.push({ id: 'result', journalist: 'Radio Estadio', playerId: null, answer: null, text: `Derrota ante ${opp}. ¿Qué ha fallado?`, options: [
      { id: 'protect', text: 'Asumo la responsabilidad. El equipo lo ha dado todo.', team: 3, player: 0, headline: 'El técnico protege a sus jugadores tras la derrota' },
      { id: 'blame', text: 'Algunos jugadores no han estado a la altura.', team: -4, player: 0, headline: 'El técnico señala a sus jugadores' },
      { id: 'referee', text: 'Hay decisiones arbitrales que nos han perjudicado.', team: 1, player: 0, headline: 'El técnico carga contra el arbitraje' },
    ] });
  } else {
    qs.push({ id: 'result', journalist: 'Gaceta del Fútbol', playerId: null, answer: null, text: `Empate ante ${opp}. ¿Punto ganado o dos perdidos?`, options: [
      { id: 'positive', text: 'Un punto que suma; el equipo ha competido.', team: 2, player: 0, headline: 'El técnico valora el punto' },
      { id: 'ambitious', text: 'Dos puntos perdidos. Debíamos ganar.', team: -1, player: 0, headline: 'El técnico, insatisfecho con el empate' },
      { id: 'neutral', text: 'Un resultado justo para lo que vimos.', team: 0, player: 0, headline: 'El técnico ve justo el empate' },
    ] });
  }
  if (star && star.clubId === state.userClubId) {
    const n = name(star);
    qs.push({ id: 'star', journalist: 'Canal Fútbol', playerId: star.id, answer: null, text: `${n} ha sido de lo mejor. ¿Qué le diría?`, options: [
      { id: 'praise', text: `${n} ha estado brillante; se lo merece.`, team: 0, player: 7, headline: `El técnico se deshace en elogios hacia ${n}` },
      { id: 'measured', text: 'Ha cumplido, como se espera de él.', team: 0, player: 1, headline: `El técnico, comedido con ${n}` },
      { id: 'more', text: 'Puede dar mucho más todavía.', team: 0, player: -3, headline: `El técnico exige más a ${n}` },
    ] });
  }
  const userClub = state.userClubId;
  const sentOff = r.match.events.find((e) => (e.type === 'red' || e.type === 'secondYellow') && e.teamId === userClub && e.playerId);
  if (sentOff?.playerId) {
    const p = ix.players.get(sentOff.playerId);
    if (p) {
      const n = name(p);
      qs.push({ id: 'red', journalist: 'Diario Deportivo', playerId: p.id, answer: null, text: `La expulsión de ${n} condicionó el partido. ¿Fue justa?`, options: [
        { id: 'defend', text: 'No fue para tanto; le defenderé siempre.', team: 1, player: 5, headline: `El técnico defiende a ${n}` },
        { id: 'accept', text: 'Fue una acción innecesaria. Lo hablaremos en privado.', team: 0, player: -1, headline: 'El técnico, prudente con la expulsión' },
        { id: 'criticize', text: 'Nos ha dejado tirados. Es inaceptable.', team: -1, player: -8, headline: `El técnico critica duramente a ${n}` },
      ] });
    }
  }
  const next = state.fixtures.filter((x) => !x.played && x.id !== f.id && (x.homeId === userClub || x.awayId === userClub)).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (next && qs.length < 3) {
    const rival = ix.clubs.get(next.homeId === userClub ? next.awayId : next.homeId)?.name ?? 'el próximo rival';
    qs.push({ id: 'next', journalist: 'Radio Estadio', playerId: null, answer: null, text: `El próximo partido es contra ${rival}. ¿Cómo lo afronta?`, options: [
      { id: 'confident', text: 'Con confianza: vamos a por los tres puntos.', team: 2, player: 0, headline: `El técnico confía en ganar a ${rival}` },
      { id: 'respect', text: 'Con respeto. Será un partido muy difícil.', team: 0, player: 0, headline: `El técnico respeta a ${rival}` },
      { id: 'noPressure', text: 'Sin presión; partido a partido.', team: 1, player: 0, headline: 'El técnico quita presión al equipo' },
    ] });
  }
  return qs.slice(0, 3);
}

/** Aplica una respuesta de la rueda de prensa (moral y titular de prensa). */
export function answerPress(state: GameState, questionId: string, optionId: string): PostMatchState {
  const pm = state.postMatch;
  if (!pm) throw new Error('No hay rueda de prensa pendiente');
  const q = pm.press.find((x) => x.id === questionId);
  if (!q || q.answer) return pm;
  const o = q.options.find((x) => x.id === optionId);
  if (!o) throw new Error('Respuesta no válida');
  q.answer = o.id;
  const ix = indexes(state);
  const squad = ix.squads.get(state.userClubId) ?? [];
  for (const p of squad) {
    // Los jugadores con temperamento bajo se lo toman peor; los muy profesionales, mejor
    const k = o.team < 0 ? 1 + (10 - p.attributes.temperament) * 0.04 : 1;
    p.morale = clamp(p.morale + o.team * k, 5, 100);
  }
  if (q.playerId && o.player) {
    const p = ix.players.get(q.playerId);
    if (p) p.morale = clamp(p.morale + o.player * (o.player < 0 ? 1 + (10 - p.attributes.temperament) * 0.05 : 1), 5, 100);
  }
  state.news.unshift({ date: state.date, type: 'press', text: o.headline });
  pm.pressDone = pm.press.every((x) => x.answer);
  return pm;
}

export function skipPress(state: GameState): PostMatchState | null {
  const pm = state.postMatch;
  if (!pm || pm.pressDone) return pm;
  pm.skippedPress = true;
  pm.pressDone = true;
  state.news.unshift({ date: state.date, type: 'press', text: 'El técnico no comparece ante la prensa' });
  return pm;
}
