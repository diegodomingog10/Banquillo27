/**
 * Partido en directo: envuelve MatchSimulation, entrega el avance por tramos (para la
 * vista 2D y el feed) y genera los consejos del cuerpo técnico. Módulo puro (Worker).
 */
import type { MatchEvent } from '../data/schema';
import { GROUP_OF_POSITION } from '../data/positions';
import { commentary, type CommentLine } from './commentary';
import { MatchSimulation, type LiveSnapshot, type LiveTeam, type MatchCommand, type MatchInput, type MatchResult, type ReplayAction, type ShoutOutcome } from './matchEngine';
import { SHOUT_IDS, TWEAK_IDS, type ShoutId, type TweakId } from './tactics';

export interface Advice {
  id: string;
  kind: 'tweakOn' | 'tweakOff' | 'sub' | 'info';
  text: string;
  tweak?: TweakId;
  outId?: string;
  inId?: string;
}

export interface LiveTick {
  snapshot: LiveSnapshot;
  events: MatchEvent[];
  comments: CommentLine[];
  replay: ReplayAction[];
  shouts: { outcome: ShoutOutcome; summary: string }[];
  advice: Advice[];
  /** Motivo para pausar automáticamente la vista (descanso, gol, lesión propia, expulsión propia). */
  pause: 'halfTime' | 'goal' | 'injury' | 'redCard' | 'fullTime' | null;
}

const KEY = new Set<MatchEvent['type']>(['goal', 'save', 'woodwork', 'penalty', 'red', 'secondYellow', 'injury', 'halfTime', 'fullTime', 'penaltyShootout', 'extraTimeStart']);

const SHOUT_TEXT: Record<ShoutId, string> = {
  encourage: 'animar', demandMore: 'exigir más', praise: 'felicitar', focus: 'pedir concentración', calmDown: 'pedir calma',
  fireUp: 'encender al equipo', showPassion: 'pedir pasión', noPressure: 'quitar presión',
};

export function shoutSummary(o: ShoutOutcome): string {
  const d = o.delta;
  const parts: string[] = [];
  if (d.confidence >= 0.1) parts.push('más confiados');
  if (d.confidence <= -0.08) parts.push('algo dolidos');
  if (d.concentration >= 0.1) parts.push('más concentrados');
  if (d.concentration <= -0.08) parts.push('algo despistados');
  if (d.aggression >= 0.15) parts.push('más agresivos (ojo con las tarjetas)');
  if (d.aggression <= -0.15) parts.push('más calmados');
  if (d.tension >= 0.12) parts.push('más tensos');
  if (d.tension <= -0.15) parts.push('más relajados');
  const head = o.verdict === 'positive' ? 'El equipo ha respondido bien' : o.verdict === 'negative' ? 'No ha sentado bien' : 'Efecto discreto';
  return `${head} al ${SHOUT_TEXT[o.shout]}: ${parts.length ? parts.join(', ') : 'sin cambios claros'}.`;
}

/** Consejos del cuerpo técnico según el marcador, el cansancio y lo que hace el rival. */
export function staffAdvice(snap: LiveSnapshot, side: 0 | 1): Advice[] {
  const me = snap.teams[side];
  const opp = snap.teams[side === 0 ? 1 : 0];
  const m = snap.minute + snap.stoppage;
  const diff = me.goals - opp.goals;
  const has = (t: TweakId) => me.tweaks.includes(t);
  const out: Advice[] = [];
  const on = (tweak: TweakId, text: string) => { if (!has(tweak)) out.push({ id: `on:${tweak}`, kind: 'tweakOn', tweak, text }); };
  const off = (tweak: TweakId, text: string) => { if (has(tweak)) out.push({ id: `off:${tweak}`, kind: 'tweakOff', tweak, text }); };

  if (diff < 0 && m >= 60) on('moreUrgency', 'Vamos por detrás: conviene meter más urgencia.');
  if (diff >= 0) off('moreUrgency', 'Ya no vamos perdiendo: quita la urgencia para no partirnos.');
  if (diff > 0 && m >= 75) on('slowDown', 'Con ventaja al final, bajar el ritmo nos ayuda a cerrar el partido.');
  if (diff <= 0) off('slowDown', 'Necesitamos el balón: deja de frenar el ritmo.');
  if (diff > 0 && m >= 80 && opp.mentality >= 6) on('dropDeeper', 'El rival se ha volcado: replegar la línea nos protege la espalda.');
  if (diff < 0) off('dropDeeper', 'Así no vamos a remontar: adelanta la línea.');
  if (me.avgCondition < 68 && me.instructions.pressIntensity >= 3) on('reducePressing', `El equipo está cansado (${me.avgCondition} %): reduce la presión.`);
  if (m >= 10 && (opp.instructions.pressIntensity >= 4 || opp.instructions.pressLine >= 4)) on('longerPasses', 'El rival presiona arriba: pases más largos para saltar su presión.');
  if (m >= 10 && opp.instructions.defensiveLine >= 4 && !has('longerPasses')) on('counterMore', 'Defienden muy arriba: hay espacio a su espalda para la contra.');
  if (opp.onCount < me.onCount) {
    on('useWidth', 'Tienen uno menos: abrir el campo les obliga a correr.');
    if (diff <= 0) on('pushLineUp', 'Con superioridad, adelanta la línea y encierra al rival.');
  }
  if (me.onCount < opp.onCount) {
    on('dropDeeper', 'Jugamos con uno menos: mejor replegar y defender juntos.');
    off('pushLineUp', 'Con uno menos, la línea alta es un riesgo.');
  }
  if (diff === -1 && m >= 87) on('goalkeeperUpForSetPieces', 'Últimos minutos: que el portero suba a rematar los córners.');
  if (diff >= 0) off('goalkeeperUpForSetPieces', 'El portero no debe subir ahora.');

  // Cambios
  const maxSubs = snap.maxSubstitutions;
  if (me.subsUsed < maxSubs && m >= 50) {
    const bench = me.players.filter((p) => !p.used && !p.injured);
    const tired = me.players.filter((p) => p.onPitch && !p.isGk && p.condition < 66).sort((a, b) => a.condition - b.condition).slice(0, 2);
    for (const t of tired) {
      const same = bench.filter((b) => GROUP_OF_POSITION[b.position] === GROUP_OF_POSITION[t.position]).sort((a, b) => b.caRef - a.caRef)[0]
        ?? bench.sort((a, b) => b.caRef - a.caRef)[0];
      if (same) out.push({ id: `sub:${t.id}`, kind: 'sub', outId: t.id, inId: same.id, text: `${t.name} está agotado (${t.condition} %). Propuesta: entra ${same.name}.` });
    }
    const booked = me.players.find((p) => p.onPitch && p.yellow > 0 && !p.isGk && m >= 60 && diff >= 0);
    if (booked && !out.some((a) => a.outId === booked.id)) out.push({ id: `info:yellow:${booked.id}`, kind: 'info', text: `${booked.name} tiene amarilla; con el marcador así, valora cambiarlo.` });
  }
  return out.slice(0, 5);
}

export class LiveMatch {
  readonly sim: MatchSimulation;
  private ev = 0;
  private rep = 0;
  private sh = 0;
  private names = new Map<string, string>();
  private teamNames = new Map<string, string>();

  constructor(readonly input: MatchInput, readonly userSide: 0 | 1, assistant = false) {
    this.sim = new MatchSimulation({ ...input, detail: 'full' });
    this.sim.setAi(userSide, assistant);
    for (const t of [input.home, input.away]) {
      this.teamNames.set(t.clubId, t.name);
      for (const p of t.squad) this.names.set(p.id, p.commonName ?? p.lastName);
    }
  }

  setAssistant(on: boolean): void {
    this.sim.setAi(this.userSide, on);
  }

  command(cmd: MatchCommand): void {
    if (cmd.type === 'tweak' && !TWEAK_IDS.includes(cmd.tweak)) throw new Error(`Ajuste desconocido: ${cmd.tweak}`);
    if (cmd.type === 'shout' && !SHOUT_IDS.includes(cmd.shout)) throw new Error(`Grito desconocido: ${cmd.shout}`);
    this.sim.command(this.userSide, cmd);
  }

  /**
   * Avanza: `phases` fases, o hasta el siguiente momento clave (`untilKey`), o hasta el
   * final (`toEnd`). Siempre se detiene en el descanso, en un gol y en incidencias propias graves.
   */
  tick(opts: { phases?: number; untilKey?: boolean; toEnd?: boolean } = {}): LiveTick {
    const startEv = this.ev;
    const limit = opts.toEnd ? 10_000 : opts.untilKey ? 400 : Math.max(1, opts.phases ?? 1);
    let pause: LiveTick['pause'] = null;
    const userClub = this.userSide === 0 ? this.input.home.clubId : this.input.away.clubId;
    for (let i = 0; i < limit; i++) {
      if (!this.sim.step()) break;
      const fresh = this.sim.eventsFrom(this.ev);
      this.ev = this.sim.eventCount;
      if (opts.toEnd) continue;
      let stop = false;
      for (const e of fresh) {
        if (e.type === 'halfTime') { pause = 'halfTime'; stop = true; }
        else if (e.type === 'goal' && e.detail !== 'shootout') { pause ??= 'goal'; stop = true; }
        else if (e.type === 'injury' && e.teamId === userClub) { pause ??= 'injury'; stop = true; }
        else if ((e.type === 'red' || e.type === 'secondYellow') && e.teamId === userClub) { pause ??= 'redCard'; stop = true; }
        else if (opts.untilKey && KEY.has(e.type)) stop = true;
      }
      if (stop || this.sim.isFinished()) break;
    }
    if (this.sim.isFinished()) pause = 'fullTime';
    const events = this.sim.eventsFrom(startEv);
    this.ev = this.sim.eventCount;
    let replay = this.sim.replayFrom(this.rep);
    this.rep = this.sim.replayCount;
    // Al saltar mucho, solo se envía el final (lo que se anima)
    if (replay.length > 60) replay = replay.slice(-24);
    const shouts = this.sim.shoutsFrom(this.sh).filter((s) => s.side === this.userSide).map((outcome) => ({ outcome, summary: shoutSummary(outcome) }));
    this.sh = this.sim.shoutsFrom(0).length;
    const snapshot = this.sim.live();
    const n = { player: (id: string | null) => (id ? this.names.get(id) ?? '' : ''), team: (id: string | null) => (id ? this.teamNames.get(id) ?? '' : '') };
    return {
      snapshot,
      events,
      comments: commentary(events, n, startEv),
      replay,
      shouts,
      advice: snapshot.finished ? [] : staffAdvice(snapshot, this.userSide),
      pause,
    };
  }

  result(): MatchResult {
    while (!this.sim.isFinished()) this.sim.step();
    return this.sim.result();
  }
}

export type { LiveSnapshot, LiveTeam };
