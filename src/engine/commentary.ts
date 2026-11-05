/**
 * Narración de texto del partido a partir de sus eventos. Determinista: la variante
 * de cada frase depende del índice del evento, no de Math.random().
 */
import type { MatchEvent } from '../data/schema';
import { phrases, type Moment, type NarratorId } from './narrators';
import { hashString } from './rng';

export interface CommentLine {
  minute: string;
  text: string;
  kind: 'goal' | 'chance' | 'card' | 'sub' | 'info' | 'injury' | 'tactic' | 'whistle';
  teamId: string | null;
  /** Índice del evento de origen. */
  index: number;
}

type Names = { player: (id: string | null) => string; team: (id: string | null) => string };

const pick = (variants: string[], seed: number) => variants[seed % variants.length] as string;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const SHOT_KIND: Record<string, string> = {
  open: 'desde dentro del área', longshot: 'desde lejos', header: 'de cabeza', cornerHeader: 'de cabeza tras un córner',
  oneOnOne: 'en el mano a mano', freeKick: 'de falta directa', penalty: 'de penalti',
};

export function minuteLabel(e: Pick<MatchEvent, 'minute' | 'stoppage'>): string {
  return `${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'`;
}

/** Contexto que acompaña a la narración: quién narra y cómo va el marcador. */
export interface NarrationContext {
  narrator: NarratorId | 'neutral';
  homeId: string;
  awayId: string;
  /** Goles [local, visitante] antes del próximo evento; se actualiza al narrar. */
  score: [number, number];
}

const tidy = (s: string) => s.replace(/\s+([,.!?…])/g, '$1').replace(/,\s*([!.])/g, '$1').replace(/\s{2,}/g, ' ').trim();

export function commentFor(e: MatchEvent, index: number, n: Names, ctx?: NarrationContext): CommentLine | null {
  const seed = hashString(`${index}:${e.type}:${e.playerId ?? ''}`);
  const narrator = ctx?.narrator ?? 'neutral';
  const how = SHOT_KIND[(e.detail ?? '').split(':').pop() ?? ''] ?? '';
  const isHome = ctx ? e.teamId === ctx.homeId : true;
  const rival = ctx ? n.team(isHome ? ctx.awayId : ctx.homeId) : '';
  // Marcador tras la jugada
  if (ctx && e.type === 'goal' && e.detail !== 'shootout') ctx.score[isHome ? 0 : 1] += 1;
  const score = ctx ? `${n.team(ctx.homeId)} ${ctx.score[0]}, ${n.team(ctx.awayId)} ${ctx.score[1]}` : '';
  const v: Record<string, string> = {
    p: n.player(e.playerId), o: n.player(e.otherPlayerId), t: n.team(e.teamId), r: rival, how, s: score,
    n: e.detail ?? 'unos', f: (e.detail ?? '').split(':')[1] ?? '',
  };
  const say = (kind: CommentLine['kind'], m: Moment, extra = ''): CommentLine => ({
    minute: minuteLabel(e), text: tidy(fill(pick(phrases(narrator, m), seed), v) + extra), kind, teamId: e.teamId, index,
  });
  switch (e.type) {
    case 'kickOff': return say('whistle', 'kickOff');
    case 'halfTime': return e.detail === '3' ? { minute: minuteLabel(e), text: 'Descanso de la prórroga.', kind: 'whistle', teamId: null, index } : say('whistle', 'halfTime');
    case 'fullTime': return say('whistle', 'fullTime');
    case 'addedTime': return say('info', 'addedTime');
    case 'extraTimeStart': return say('whistle', 'extraTime');
    case 'penaltyShootout': return say('whistle', 'shootout');
    case 'goal': {
      if (e.detail === 'shootout') return say('goal', 'goalShootout');
      const assist = e.otherPlayerId ? ` Asistencia de ${v.o}.` : '';
      if (!ctx) return say('goal', 'goal', assist);
      const mine = ctx.score[isHome ? 0 : 1];
      const theirs = ctx.score[isHome ? 1 : 0];
      const m: Moment = e.minute >= 85 && mine - theirs <= 1 && mine >= theirs ? 'goalLate'
        : mine === theirs ? 'goalEqualizer'
        : mine - theirs >= 3 ? 'goalRout'
        : mine - theirs === 1 ? 'goalAhead'
        : 'goal';
      // No siempre la frase de contexto: alterna con las de gol normal
      return say('goal', m === 'goalAhead' && seed % 2 === 0 ? 'goal' : m, assist);
    }
    case 'save': return say('chance', 'save');
    case 'woodwork': return say('chance', 'woodwork');
    case 'shot': {
      if ((e.detail ?? '').startsWith('blocked')) return say('chance', 'blocked');
      if ((e.xg ?? 0) >= 0.15) return say('chance', 'bigMiss');
      return null;
    }
    case 'penalty': return say('chance', 'penalty');
    case 'penaltyMissed': return say('chance', 'penaltyMissed');
    case 'yellow': return say('card', 'yellow');
    case 'secondYellow': return say('card', 'secondYellow');
    case 'red': return say('card', 'red');
    case 'substitution': return say('sub', e.detail === 'injury' ? 'subInjury' : 'sub');
    case 'injury': return say('injury', 'injury');
    case 'offside': return seed % 3 === 0 ? say('info', 'offside') : null;
    case 'corner': return seed % 2 === 0 ? say('info', 'corner') : null;
    case 'freeKick': return say('info', 'freeKick');
    case 'foul': return seed % 5 === 0 ? say('info', 'foul') : null;
    case 'tacticChange': {
      const d = e.detail ?? '';
      if (d.startsWith('mentality')) return say('tactic', 'mentality');
      if (d.startsWith('formation')) return say('tactic', 'formation');
      return null;
    }
    default: return null;
  }
}

export function commentary(events: readonly MatchEvent[], n: Names, offset = 0, ctx?: NarrationContext): CommentLine[] {
  const out: CommentLine[] = [];
  events.forEach((e, i) => {
    const c = commentFor(e, offset + i, n, ctx);
    if (c) out.push(c);
  });
  return out;
}
