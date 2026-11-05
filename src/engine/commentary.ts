/**
 * Narración de texto del partido a partir de sus eventos. Determinista: la variante
 * de cada frase depende del índice del evento, no de Math.random().
 */
import type { MatchEvent } from '../data/schema';
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

export function commentFor(e: MatchEvent, index: number, n: Names): CommentLine | null {
  const seed = hashString(`${index}:${e.type}:${e.playerId ?? ''}`);
  const v = { p: n.player(e.playerId), o: n.player(e.otherPlayerId), t: n.team(e.teamId) };
  const line = (kind: CommentLine['kind'], text: string): CommentLine => ({ minute: minuteLabel(e), text: fill(text, v), kind, teamId: e.teamId, index });
  const how = SHOT_KIND[(e.detail ?? '').split(':').pop() ?? ''] ?? '';
  switch (e.type) {
    case 'kickOff': return line('whistle', '¡Arranca el partido!');
    case 'halfTime': return line('whistle', e.detail === '3' ? 'Descanso de la prórroga.' : 'Final de la primera parte.');
    case 'fullTime': return line('whistle', 'Final del partido.');
    case 'addedTime': return line('info', `Se añaden ${e.detail ?? 'unos'} minutos.`);
    case 'extraTimeStart': return line('whistle', 'Empate: vamos a la prórroga.');
    case 'penaltyShootout': return line('whistle', 'Todo se decide en la tanda de penaltis.');
    case 'goal':
      if (e.detail === 'shootout') return line('goal', pick(['{p} marca su penalti.', 'Gol de {p} en la tanda.'], seed));
      return line('goal', pick([
        `¡GOOOL de {p}! Remata ${how} y bate al portero.`,
        `¡Gol de {t}! {p} no perdona ${how}.`,
        `¡{p} la mete ${how}! Golazo para {t}.`,
      ], seed) + (e.otherPlayerId ? ` Asistencia de {o}.` : ''));
    case 'save':
      return line('chance', pick([`¡Paradón de {p}! Saca el disparo de {o} ${how}.`, `{o} lo intenta ${how}, pero {p} responde bien.`, `Tiro de {o} ${how}; atrapa {p}.`], seed));
    case 'woodwork': return line('chance', pick(['¡Al palo! {p} acaricia el gol.', '¡El larguero salva al rival! Disparo de {p}.'], seed));
    case 'shot': {
      const blocked = (e.detail ?? '').startsWith('blocked');
      if (blocked) return line('chance', pick(['Disparo de {p}, bloqueado por la defensa.', '{p} chuta, pero el balón choca en un defensor.'], seed));
      if ((e.xg ?? 0) >= 0.15) return line('chance', pick([`¡Qué ocasión! {p} la manda fuera ${how}.`, `¡Se le escapa a {p}! Clarísima ${how}.`], seed));
      return null;
    }
    case 'penalty': return line('chance', '¡Penalti a favor de {t}! Falta sobre {p}.');
    case 'penaltyMissed': return e.detail === 'shootout' ? line('chance', '¡{p} falla en la tanda!') : line('chance', '¡{p} falla el penalti!');
    case 'yellow': return line('card', pick(['Amarilla para {p}.', 'El árbitro amonesta a {p}.'], seed));
    case 'secondYellow': return line('card', '¡Segunda amarilla para {p}! {t} se queda con uno menos.');
    case 'red': return line('card', '¡Roja directa a {p}! {t} se queda con diez.');
    case 'substitution': return line('sub', e.detail === 'injury' ? 'Cambio obligado en {t}: entra {p} por el lesionado {o}.' : 'Cambio en {t}: entra {p}, se retira {o}.');
    case 'injury': return line('injury', 'Se duele {p}… parece que no puede seguir.');
    case 'offside': return seed % 3 === 0 ? line('info', 'Fuera de juego de {p}.') : null;
    case 'corner': return seed % 2 === 0 ? line('info', 'Córner para {t}.') : null;
    case 'freeKick': return line('info', 'Falta peligrosa para {t}; se prepara {p}.');
    case 'foul': return seed % 5 === 0 ? line('info', 'Falta de {p} sobre {o}.') : null;
    case 'tacticChange': {
      const d = e.detail ?? '';
      if (d.startsWith('mentality')) return line('tactic', `{t} cambia su planteamiento.`);
      if (d.startsWith('formation')) return line('tactic', `{t} cambia de sistema: ${d.split(':')[1]}.`);
      return null;
    }
    default: return null;
  }
}

export function commentary(events: readonly MatchEvent[], n: Names, offset = 0): CommentLine[] {
  const out: CommentLine[] = [];
  events.forEach((e, i) => {
    const c = commentFor(e, offset + i, n);
    if (c) out.push(c);
  });
  return out;
}
